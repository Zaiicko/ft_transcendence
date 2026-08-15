import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { FriendshipStatus, GameType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CreateCoverGuessMatchDto } from './dto/create-match.dto';
import { CoverGuessGateway } from './cover-guess.gateway';
import { BLUR_STEP_COUNT, CoverGuessDifficulty } from './cover-guess.types';

// Rank-limited pools for easy/normal (cheap: fetch only ids, pick one at
// random client-side); "hard" has no cutoff — the whole filtered catalog is
// in play, picked via a random offset instead of materialising ~37k rows.
const TIER_LIMIT: Record<CoverGuessDifficulty, number | null> = {
  easy: 300,
  normal: 5000,
  hard: null,
};

// Pause between a round ending (reveal shown) and the next one starting, so
// players have time to read the answer/scoreboard.
const NEXT_ROUND_DELAY_MS = 4000;
// A lobby nobody finishes responding to is abandoned after this long.
const LOBBY_TTL_MS = 2 * 60_000;
// How long a finished/abandoned match stays queryable in memory afterwards
// (the durable DB row outlives this — see getState's fallback).
const FINISHED_GRACE_MS = 5 * 60_000;
// A picked-but-unanswered LOCAL round token expires after this long.
const LOCAL_ROUND_TTL_MS = 5 * 60_000;

const BASE_GAME_WHERE: Prisma.GameWhereInput = {
  coverUrl: { not: null },
  // Same "real base game" filter as the catalog list — DLC/expansions never
  // show up as a cover to guess.
  OR: [{ parentId: null }, { gameType: { in: [GameType.STANDALONE, GameType.REMAKE, GameType.REMASTER] } }],
};

interface PickedGame {
  id: number;
  title: string;
  coverUrl: string;
}

interface PendingLocalRound {
  gameId: number;
  title: string;
  coverUrl: string;
  blurStepIndex: number;
  expiresAt: number;
}

type CoverGuessMatchStatus = 'LOBBY' | 'PLAYING' | 'FINISHED' | 'ABANDONED';
type CoverGuessPlayerStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED';

interface CoverGuessPlayer {
  userId: number;
  username: string;
  avatarUrl: string | null;
  score: number;
  status: CoverGuessPlayerStatus;
}

interface CoverGuessRound {
  index: number;
  gameId: number;
  title: string;
  coverUrl: string;
  blurStepIndex: number;
  turnOrder: number[]; // userIds, this round's rotation
  turnPointer: number;
  resolved: boolean;
  // Epoch ms the current turn auto-passes at — purely informational for the
  // client's countdown; the server enforces it via `turnTimer` below.
  turnDeadline: number;
}

interface CoverGuessMatchSession {
  id: string;
  hostId: number;
  difficulty: CoverGuessDifficulty;
  targetScore: number;
  // Seconds a player gets before their turn is auto-passed.
  answerTimeSec: number;
  status: CoverGuessMatchStatus;
  // Map preserves insertion order — host first, then invitees in invite order.
  players: Map<number, CoverGuessPlayer>;
  usedGameIds: Set<number>;
  round: CoverGuessRound | null;
  roundIndex: number;
  createdAt: number;
  nextRoundTimer?: ReturnType<typeof setTimeout>;
  turnTimer?: ReturnType<typeof setTimeout>;
  winnerId?: number | null;
}

@Injectable()
export class CoverGuessService implements OnModuleDestroy {
  private readonly logger = new Logger(CoverGuessService.name);
  private readonly matches = new Map<string, CoverGuessMatchSession>();
  private readonly localRounds = new Map<string, PendingLocalRound>();
  private readonly sweepTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly gateway: CoverGuessGateway,
  ) {
    this.sweepTimer = setInterval(() => this.sweep(), 60_000);
  }

  onModuleDestroy(): void {
    clearInterval(this.sweepTimer);
  }

  // ---------------------------------------------------------------- LOCAL --

  async pickLocalRound(difficulty: CoverGuessDifficulty, excludeIds: number[]) {
    const game = await this.pickGame(difficulty, excludeIds);
    if (!game) throw new NotFoundException('Aucun jeu disponible pour cette difficulté');
    const roundToken = randomUUID();
    this.localRounds.set(roundToken, {
      gameId: game.id,
      title: game.title,
      coverUrl: game.coverUrl,
      blurStepIndex: 0,
      expiresAt: Date.now() + LOCAL_ROUND_TTL_MS,
    });
    return { roundToken, coverUrl: game.coverUrl, blurStepIndex: 0 };
  }

  guessLocal(roundToken: string, catalogId: number | null) {
    const round = this.localRounds.get(roundToken);
    if (!round) throw new NotFoundException('Manche introuvable ou expirée');

    const outcome = this.resolveAttempt(round, catalogId);
    if (outcome.resolved) this.localRounds.delete(roundToken);
    return outcome;
  }

  // ---------------------------------------------------------------- MULTI --

  async createMatch(hostId: number, dto: CreateCoverGuessMatchDto): Promise<{ matchId: string }> {
    const host = await this.prisma.user.findUnique({
      where: { id: hostId },
      select: { id: true, username: true, avatarUrl: true },
    });
    if (!host) throw new NotFoundException();

    // Only real, accepted friends can be invited — same status the friends
    // list itself relies on.
    const friendships = await this.prisma.friendship.findMany({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [
          { requesterId: hostId, addresseeId: { in: dto.inviteeUserIds } },
          { addresseeId: hostId, requesterId: { in: dto.inviteeUserIds } },
        ],
      },
      select: { requesterId: true, addresseeId: true },
    });
    const friendIds = new Set(
      friendships.map((f) => (f.requesterId === hostId ? f.addresseeId : f.requesterId)),
    );
    const invitees = await this.prisma.user.findMany({
      where: { id: { in: [...friendIds] } },
      select: { id: true, username: true, avatarUrl: true },
    });
    if (invitees.length === 0) {
      throw new BadRequestException('Invite au moins un ami');
    }

    const id = randomUUID();
    const players = new Map<number, CoverGuessPlayer>();
    players.set(hostId, {
      userId: hostId,
      username: host.username,
      avatarUrl: host.avatarUrl,
      score: 0,
      status: 'ACCEPTED',
    });
    for (const u of invitees) {
      players.set(u.id, {
        userId: u.id,
        username: u.username,
        avatarUrl: u.avatarUrl,
        score: 0,
        status: 'PENDING',
      });
    }

    this.matches.set(id, {
      id,
      hostId,
      difficulty: dto.difficulty,
      targetScore: dto.targetScore,
      answerTimeSec: dto.answerTimeSec,
      status: 'LOBBY',
      players,
      usedGameIds: new Set(),
      round: null,
      roundIndex: -1,
      createdAt: Date.now(),
    });

    await this.prisma.coverGuessMatch.create({
      data: { id, hostId, status: 'LOBBY', difficulty: dto.difficulty, targetScore: dto.targetScore },
    });

    for (const u of invitees) {
      void this.notifications.gameInvited(hostId, u.id, id, 'cover-guess', dto.difficulty);
    }

    return { matchId: id };
  }

  respond(matchId: string, userId: number, accept: boolean) {
    const session = this.requireSession(matchId);
    if (session.status !== 'LOBBY') throw new BadRequestException('La partie a déjà commencé');
    const player = session.players.get(userId);
    if (!player || player.status !== 'PENDING') throw new NotFoundException('Invitation introuvable');

    // Declining keeps the player visible in the lobby list (marked as
    // declined) rather than silently vanishing — only an explicit leave()
    // actually removes someone from the roster.
    player.status = accept ? 'ACCEPTED' : 'DECLINED';

    this.broadcastState(session);
    return this.toStateDto(session);
  }

  async start(matchId: string, hostId: number) {
    const session = this.requireSession(matchId);
    if (session.hostId !== hostId) throw new ForbiddenException();
    if (session.status !== 'LOBBY') throw new BadRequestException('La partie a déjà commencé');

    // Validate BEFORE mutating anything — a start attempt that turns out to
    // have too few accepted players must be a no-op, not silently drop the
    // still-pending invitees as a side effect of a call that then fails.
    if (this.activePlayers(session).length < 2) {
      throw new BadRequestException('Il faut au moins un ami qui a accepté');
    }
    // Anyone who never responded is simply left out — the host decides when
    // enough friends are in, not required to wait for everyone. Declined
    // invitees are kept in `players` (visible in the lobby list) but were
    // never counted as active to begin with.
    for (const [id, p] of session.players) if (p.status === 'PENDING') session.players.delete(id);

    session.status = 'PLAYING';
    await this.prisma.coverGuessMatch
      .update({ where: { id: matchId }, data: { status: 'PLAYING' } })
      .catch(() => {});
    await this.startRound(session);
    return this.toStateDto(session);
  }

  async guess(matchId: string, userId: number, catalogId: number | null) {
    const session = this.requireSession(matchId);
    if (session.status !== 'PLAYING' || !session.round || session.round.resolved) {
      throw new BadRequestException('Aucune manche en cours');
    }
    const round = session.round;
    const currentTurnUserId = round.turnOrder[round.turnPointer];
    if (currentTurnUserId !== userId) throw new ForbiddenException("Ce n'est pas ton tour");

    // The acting player (human guess or their own timer firing) just used up
    // their turn either way — clear it before deciding what comes next.
    if (session.turnTimer) clearTimeout(session.turnTimer);

    const outcome = this.resolveAttempt(round, catalogId);
    // resolveAttempt only reports the outcome — the round's own `resolved`
    // flag (what toStateDto/broadcastState actually reads) must be set here.
    if (outcome.resolved) round.resolved = true;

    if (outcome.correct) {
      const player = session.players.get(userId)!;
      player.score += 1;
      this.broadcastState(session);
      if (player.score >= session.targetScore) await this.finishMatch(session, userId);
      else this.scheduleNextRound(session);
      return this.toStateDto(session);
    }

    if (outcome.resolved) {
      // Fully revealed and still wrong — round over, nobody scored.
      this.broadcastState(session);
      this.scheduleNextRound(session);
      return this.toStateDto(session);
    }

    round.turnPointer = (round.turnPointer + 1) % round.turnOrder.length;
    this.scheduleTurnTimer(session);
    this.broadcastState(session);
    return this.toStateDto(session);
  }

  async leave(matchId: string, userId: number): Promise<void> {
    const session = this.matches.get(matchId);
    if (!session) return;
    if (session.status !== 'LOBBY' && session.status !== 'PLAYING') return;

    session.players.delete(userId);

    if (session.round && !session.round.resolved) {
      const idx = session.round.turnOrder.indexOf(userId);
      if (idx !== -1) {
        session.round.turnOrder.splice(idx, 1);
        if (session.round.turnOrder.length === 0) {
          session.round.resolved = true;
          if (session.turnTimer) clearTimeout(session.turnTimer);
        } else {
          if (idx <= session.round.turnPointer) {
            session.round.turnPointer =
              session.round.turnPointer % session.round.turnOrder.length;
          }
          // The departing player may have been the one on the clock —
          // re-arm for whoever it is now.
          this.scheduleTurnTimer(session);
        }
      }
    }

    if (session.status === 'LOBBY' && session.hostId === userId) {
      session.status = 'ABANDONED';
      await this.prisma.coverGuessMatch
        .update({ where: { id: matchId }, data: { status: 'ABANDONED', endedAt: new Date() } })
        .catch(() => {});
    } else if (session.status === 'PLAYING' && this.activePlayers(session).length < 2) {
      if (session.turnTimer) clearTimeout(session.turnTimer);
      const winner = this.activePlayers(session)[0]?.userId ?? null;
      await this.finishMatch(session, winner);
      return;
    }

    this.broadcastState(session);
  }

  async getState(matchId: string, userId: number) {
    const session = this.matches.get(matchId);
    if (session) {
      if (session.hostId !== userId && !session.players.has(userId)) throw new ForbiddenException();
      return this.toStateDto(session);
    }
    // Evicted from memory (backend restart or long gone) — durable fallback.
    const row = await this.prisma.coverGuessMatch.findUnique({ where: { id: matchId } });
    if (!row) throw new NotFoundException('Partie introuvable');
    return {
      id: row.id,
      status: row.status,
      difficulty: row.difficulty,
      targetScore: row.targetScore,
      winnerId: row.winnerId,
      participants: row.participants,
      round: null,
    };
  }

  // ------------------------------------------------------------ internals --

  // Shared by both LOCAL and MULTI: applies one guess attempt against the
  // current blur step, mutates the round's step forward, and reports whether
  // the round is over (correct guess, or fully revealed and still wrong).
  private resolveAttempt(
    round: { gameId: number; title: string; blurStepIndex: number },
    catalogId: number | null,
  ): { correct: boolean; resolved: boolean; blurStepIndex: number; answerGameId?: number; answerTitle?: string } {
    const correct = catalogId != null && catalogId === round.gameId;
    if (correct) {
      return {
        correct: true,
        resolved: true,
        blurStepIndex: round.blurStepIndex,
        answerGameId: round.gameId,
        answerTitle: round.title,
      };
    }
    const wasFinalAttempt = round.blurStepIndex >= BLUR_STEP_COUNT - 1;
    if (wasFinalAttempt) {
      return {
        correct: false,
        resolved: true,
        blurStepIndex: round.blurStepIndex,
        answerGameId: round.gameId,
        answerTitle: round.title,
      };
    }
    round.blurStepIndex += 1;
    return { correct: false, resolved: false, blurStepIndex: round.blurStepIndex };
  }

  private async startRound(session: CoverGuessMatchSession): Promise<void> {
    session.roundIndex += 1;
    const activeIds = this.activePlayers(session).map((p) => p.userId);
    // The starting player shifts by one every round so nobody is always
    // first or always last — relative order (J1→J2→J3) stays fixed.
    const startOffset = session.roundIndex % activeIds.length;
    const turnOrder = [...activeIds.slice(startOffset), ...activeIds.slice(0, startOffset)];

    const game = await this.pickGame(session.difficulty, [...session.usedGameIds]);
    if (!game) {
      // Exhausted the tier's pool (astronomically unlikely) — end the match
      // with whoever's leading rather than getting stuck.
      const leader = this.activePlayers(session).sort((a, b) => b.score - a.score)[0];
      await this.finishMatch(session, leader?.userId ?? null);
      return;
    }

    session.usedGameIds.add(game.id);
    session.round = {
      index: session.roundIndex,
      gameId: game.id,
      title: game.title,
      coverUrl: game.coverUrl,
      blurStepIndex: 0,
      turnOrder,
      turnPointer: 0,
      resolved: false,
      turnDeadline: 0, // set by scheduleTurnTimer below
    };
    this.scheduleTurnTimer(session);
    this.broadcastState(session);
  }

  private scheduleNextRound(session: CoverGuessMatchSession): void {
    session.nextRoundTimer = setTimeout(() => {
      if (session.status === 'PLAYING') void this.startRound(session);
    }, NEXT_ROUND_DELAY_MS);
  }

  // (Re)arms the current turn's auto-pass timer — always clears any previous
  // one first, so this is safe to call both when a round starts and whenever
  // the turn advances within it. A round that's already resolved has nothing
  // to schedule (the 4s inter-round gap needs no timer of its own).
  private scheduleTurnTimer(session: CoverGuessMatchSession): void {
    if (session.turnTimer) clearTimeout(session.turnTimer);
    const round = session.round;
    if (!round || round.resolved) return;
    const userId = round.turnOrder[round.turnPointer];
    round.turnDeadline = Date.now() + session.answerTimeSec * 1000;
    session.turnTimer = setTimeout(() => {
      // Same effect as that player passing manually. guess() re-checks whose
      // turn it is before mutating anything, so this is a harmless no-op if
      // the round has since moved on for any other reason.
      void this.guess(session.id, userId, null).catch(() => {});
    }, session.answerTimeSec * 1000);
  }

  private async finishMatch(session: CoverGuessMatchSession, winnerId: number | null): Promise<void> {
    session.status = 'FINISHED';
    session.winnerId = winnerId;
    if (session.nextRoundTimer) clearTimeout(session.nextRoundTimer);
    if (session.turnTimer) clearTimeout(session.turnTimer);
    const participants = [...session.players.values()].map((p) => ({
      userId: p.userId,
      username: p.username,
      score: p.score,
    }));
    await this.prisma.coverGuessMatch
      .update({
        where: { id: session.id },
        data: {
          status: 'FINISHED',
          winnerId,
          participants: participants as Prisma.InputJsonValue,
          endedAt: new Date(),
        },
      })
      .catch(() => {});
    this.broadcastState(session);
  }

  private requireSession(matchId: string): CoverGuessMatchSession {
    const session = this.matches.get(matchId);
    if (!session) throw new NotFoundException('Partie introuvable ou terminée');
    return session;
  }

  // `players` is the full roster ever invited (host, accepted, pending,
  // declined — declined ones stay for the lobby list, never removed on
  // decline). Anything gameplay-related (turn order, win/abandon counts,
  // leader fallback) must only ever consider the ACCEPTED subset.
  private activePlayers(session: CoverGuessMatchSession): CoverGuessPlayer[] {
    return [...session.players.values()].filter((p) => p.status === 'ACCEPTED');
  }

  private toStateDto(session: CoverGuessMatchSession) {
    return {
      id: session.id,
      hostId: session.hostId,
      status: session.status,
      difficulty: session.difficulty,
      targetScore: session.targetScore,
      answerTimeSec: session.answerTimeSec,
      winnerId: session.winnerId ?? null,
      players: [...session.players.values()].map((p) => ({
        userId: p.userId,
        username: p.username,
        avatarUrl: p.avatarUrl,
        score: p.score,
        status: p.status,
      })),
      round: session.round && {
        index: session.round.index,
        coverUrl: session.round.coverUrl,
        blurStepIndex: session.round.blurStepIndex,
        currentTurnUserId: session.round.turnOrder[session.round.turnPointer] ?? null,
        resolved: session.round.resolved,
        turnDeadline: session.round.resolved ? null : session.round.turnDeadline,
        ...(session.round.resolved
          ? { answerGameId: session.round.gameId, answerTitle: session.round.title }
          : {}),
      },
    };
  }

  private broadcastState(session: CoverGuessMatchSession): void {
    const dto = this.toStateDto(session);
    for (const p of session.players.values()) this.gateway.emitToUser(p.userId, 'coverguess:state', dto);
    // The host still needs the update even if they've just been removed as a
    // player (can't happen today — leave() only drops the caller — kept for
    // safety since hostId isn't always in `players`' key set by construction).
    if (!session.players.has(session.hostId)) {
      this.gateway.emitToUser(session.hostId, 'coverguess:state', dto);
    }
  }

  // Picks one random game within a difficulty tier, excluding ids already
  // used earlier in the same session/local run.
  private async pickGame(
    difficulty: CoverGuessDifficulty,
    excludeIds: number[],
  ): Promise<PickedGame | null> {
    const where: Prisma.GameWhereInput = {
      ...BASE_GAME_WHERE,
      ...(excludeIds.length && { id: { notIn: excludeIds } }),
    };
    const limit = TIER_LIMIT[difficulty];

    if (limit) {
      const pool = await this.prisma.game.findMany({
        where,
        orderBy: { igdbRatingCount: { sort: 'desc', nulls: 'last' } },
        take: limit,
        select: { id: true },
      });
      if (pool.length === 0) return null;
      const id = pool[Math.floor(Math.random() * pool.length)].id;
      return this.prisma.game.findUnique({
        where: { id },
        select: { id: true, title: true, coverUrl: true },
      }) as Promise<PickedGame>;
    }

    const total = await this.prisma.game.count({ where });
    if (total === 0) return null;
    const [row] = await this.prisma.game.findMany({
      where,
      skip: Math.floor(Math.random() * total),
      take: 1,
      select: { id: true, title: true, coverUrl: true },
    });
    return (row as PickedGame) ?? null;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, session] of this.matches) {
      if (session.status === 'LOBBY' && now - session.createdAt > LOBBY_TTL_MS) {
        session.status = 'ABANDONED';
        this.prisma.coverGuessMatch
          .update({ where: { id }, data: { status: 'ABANDONED', endedAt: new Date() } })
          .catch(() => {});
        this.broadcastState(session);
        this.matches.delete(id);
      } else if (
        (session.status === 'FINISHED' || session.status === 'ABANDONED') &&
        now - session.createdAt > FINISHED_GRACE_MS
      ) {
        this.matches.delete(id);
      }
    }
    for (const [token, round] of this.localRounds) {
      if (now > round.expiresAt) this.localRounds.delete(token);
    }
  }
}
