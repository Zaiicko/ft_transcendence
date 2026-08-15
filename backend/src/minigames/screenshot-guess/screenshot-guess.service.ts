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
import { CreateScreenshotGuessMatchDto } from './dto/create-match.dto';
import { ScreenshotGuessGateway } from './screenshot-guess.gateway';
import { BLUR_STEP_COUNT, ScreenshotGuessDifficulty, ScreenshotGuessRoundMode } from './screenshot-guess.types';

// Rank-limited pools for easy/normal (cheap: fetch only ids, pick one at
// random client-side); "hard" has no cutoff — the whole filtered catalog is
// in play, picked via a random offset instead of materialising ~37k rows.
const TIER_LIMIT: Record<ScreenshotGuessDifficulty, number | null> = {
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
  screenshots: { isEmpty: false },
  // Same "real base game" filter as the catalog list — DLC/expansions never
  // show up as a screenshot to guess.
  OR: [{ parentId: null }, { gameType: { in: [GameType.STANDALONE, GameType.REMAKE, GameType.REMASTER] } }],
};

interface PickedGame {
  id: number;
  title: string;
  screenshotUrl: string;
}

interface PendingLocalRound {
  gameId: number;
  title: string;
  screenshotUrl: string;
  blurStepIndex: number;
  blur: boolean;
  // No-blur TURNS only: attempts left across the whole round before it's
  // considered lost (there's no blur budget to spend instead). Unused in
  // RACE mode (still unlimited attempts) or when blur is enabled.
  attemptsLeft?: number;
  expiresAt: number;
}

type ScreenshotGuessMatchStatus = 'LOBBY' | 'PLAYING' | 'FINISHED' | 'ABANDONED';
type ScreenshotGuessPlayerStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED';

interface ScreenshotGuessPlayer {
  userId: number;
  username: string;
  avatarUrl: string | null;
  score: number;
  status: ScreenshotGuessPlayerStatus;
}

interface ScreenshotGuessRound {
  index: number;
  gameId: number;
  title: string;
  screenshotUrl: string;
  blurStepIndex: number;
  turnOrder: number[]; // userIds, this round's rotation
  turnPointer: number;
  resolved: boolean;
  // Epoch ms the current turn auto-passes at — purely informational for the
  // client's countdown; the server enforces it via `turnTimer` below.
  turnDeadline: number;
  // No-blur TURNS only — see PendingLocalRound.attemptsLeft.
  attemptsLeft?: number;
}

interface ScreenshotGuessMatchSession {
  id: string;
  hostId: number;
  difficulty: ScreenshotGuessDifficulty;
  roundMode: ScreenshotGuessRoundMode;
  // false = "no blur" mode — see CreateScreenshotGuessMatchDto.blur.
  blur: boolean;
  targetScore: number;
  // Seconds a player gets before their turn is auto-passed.
  answerTimeSec: number;
  status: ScreenshotGuessMatchStatus;
  // Map preserves insertion order — host first, then invitees in invite order.
  players: Map<number, ScreenshotGuessPlayer>;
  usedGameIds: Set<number>;
  round: ScreenshotGuessRound | null;
  roundIndex: number;
  // Every game shown so far this match, in order — for the post-match recap.
  history: { gameId: number; title: string; screenshotUrl: string }[];
  createdAt: number;
  nextRoundTimer?: ReturnType<typeof setTimeout>;
  turnTimer?: ReturnType<typeof setTimeout>;
  winnerId?: number | null;
}

@Injectable()
export class ScreenshotGuessService implements OnModuleDestroy {
  private readonly logger = new Logger(ScreenshotGuessService.name);
  private readonly matches = new Map<string, ScreenshotGuessMatchSession>();
  private readonly localRounds = new Map<string, PendingLocalRound>();
  private readonly sweepTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ScreenshotGuessGateway,
  ) {
    this.sweepTimer = setInterval(() => this.sweep(), 60_000);
  }

  onModuleDestroy(): void {
    clearInterval(this.sweepTimer);
  }

  // ---------------------------------------------------------------- LOCAL --

  async pickLocalRound(
    difficulty: ScreenshotGuessDifficulty,
    excludeIds: number[],
    blur = true,
    attempts?: number,
  ) {
    const game = await this.pickGame(difficulty, excludeIds);
    if (!game) throw new NotFoundException('Aucun jeu disponible pour cette difficulté');
    const roundToken = randomUUID();
    // No blur = shown fully clear from the start, nothing to reveal.
    const blurStepIndex = blur ? 0 : BLUR_STEP_COUNT - 1;
    this.localRounds.set(roundToken, {
      gameId: game.id,
      title: game.title,
      screenshotUrl: game.screenshotUrl,
      blurStepIndex,
      blur,
      attemptsLeft: blur ? undefined : (attempts ?? 1),
      expiresAt: Date.now() + LOCAL_ROUND_TTL_MS,
    });
    return { roundToken, screenshotUrl: game.screenshotUrl, blurStepIndex };
  }

  guessLocal(roundToken: string, catalogId: number | null, mode: ScreenshotGuessRoundMode = 'TURNS') {
    const round = this.localRounds.get(roundToken);
    if (!round) throw new NotFoundException('Manche introuvable ou expirée');

    if (mode === 'RACE') {
      // Unlimited real attempts in RACE regardless of blur — only the
      // client's own reveal-schedule ticks (catalogId === null) ever
      // mutate the round.
      const outcome = this.resolveAttempt(round, catalogId, catalogId === null);
      if (outcome.resolved) this.localRounds.delete(roundToken);
      return outcome;
    }

    if (!round.blur) {
      // No blur budget to spend on a wrong TURNS guess — a fixed attempt
      // count instead (see PendingLocalRound.attemptsLeft).
      const correct = catalogId != null && catalogId === round.gameId;
      if (correct) {
        this.localRounds.delete(roundToken);
        return {
          correct: true,
          resolved: true,
          blurStepIndex: round.blurStepIndex,
          answerGameId: round.gameId,
          answerTitle: round.title,
        };
      }
      round.attemptsLeft = (round.attemptsLeft ?? 1) - 1;
      if (round.attemptsLeft <= 0) {
        this.localRounds.delete(roundToken);
        return {
          correct: false,
          resolved: true,
          blurStepIndex: round.blurStepIndex,
          answerGameId: round.gameId,
          answerTitle: round.title,
        };
      }
      return { correct: false, resolved: false, blurStepIndex: round.blurStepIndex };
    }

    // TURNS + blur (existing behavior): every attempt (guess or pass)
    // advances the blur.
    const outcome = this.resolveAttempt(round, catalogId, true);
    if (outcome.resolved) this.localRounds.delete(roundToken);
    return outcome;
  }

  // ---------------------------------------------------------------- MULTI --

  async createMatch(hostId: number, dto: CreateScreenshotGuessMatchDto): Promise<{ matchId: string }> {
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
    const players = new Map<number, ScreenshotGuessPlayer>();
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
      roundMode: dto.roundMode,
      blur: dto.blur,
      targetScore: dto.targetScore,
      answerTimeSec: dto.answerTimeSec,
      status: 'LOBBY',
      players,
      usedGameIds: new Set(),
      round: null,
      roundIndex: -1,
      history: [],
      createdAt: Date.now(),
    });

    await this.prisma.screenshotGuessMatch.create({
      data: { id, hostId, status: 'LOBBY', difficulty: dto.difficulty, targetScore: dto.targetScore },
    });

    // A dedicated live event (shared by every mini-game, not just this one)
    // rather than the general notification pipeline: GameInviteOverlay is a
    // full-screen blocking prompt already shown the moment this arrives, so
    // there's nothing left for a bell entry to add — no Notification row,
    // no unread badge, no opt-out preference.
    for (const u of invitees) {
      this.gateway.emitToUser(u.id, 'minigame:invite', {
        matchId: id,
        game: 'screenshot-guess',
        difficulty: dto.difficulty,
        actorId: hostId,
        actorUsername: host.username,
        actorAvatarUrl: host.avatarUrl,
      });
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
    await this.prisma.screenshotGuessMatch
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

    if (session.roundMode === 'RACE') return this.guessRace(session, round, userId, catalogId);

    const currentTurnUserId = round.turnOrder[round.turnPointer];
    if (currentTurnUserId !== userId) throw new ForbiddenException("Ce n'est pas ton tour");

    // The acting player (human guess or their own timer firing) just used up
    // their turn either way — clear it before deciding what comes next.
    if (session.turnTimer) clearTimeout(session.turnTimer);

    if (!session.blur) return this.guessTurnsNoBlur(session, round, userId, catalogId);

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

  // TURNS + no blur: the screenshot was already shown fully clear from the
  // start, so a wrong guess has nothing to reveal — instead of a blur
  // budget, the round gets a fixed attemptsLeft (seeded to the player count
  // in startRound) and ends once everyone's had their one shot.
  private async guessTurnsNoBlur(
    session: ScreenshotGuessMatchSession,
    round: ScreenshotGuessRound,
    userId: number,
    catalogId: number | null,
  ) {
    const correct = catalogId != null && catalogId === round.gameId;

    if (correct) {
      round.resolved = true;
      const player = session.players.get(userId)!;
      player.score += 1;
      this.broadcastState(session);
      if (player.score >= session.targetScore) await this.finishMatch(session, userId);
      else this.scheduleNextRound(session);
      return this.toStateDto(session);
    }

    round.attemptsLeft = (round.attemptsLeft ?? round.turnOrder.length) - 1;
    if (round.attemptsLeft <= 0) {
      round.resolved = true;
      this.broadcastState(session);
      this.scheduleNextRound(session);
      return this.toStateDto(session);
    }

    round.turnPointer = (round.turnPointer + 1) % round.turnOrder.length;
    this.scheduleTurnTimer(session);
    this.broadcastState(session);
    return this.toStateDto(session);
  }

  // RACE: any accepted player can attempt at any time, no turn to check.
  // A wrong guess doesn't touch the round at all — the cover only clears via
  // scheduleRaceDeblur's own timer — so there's nothing to broadcast for a
  // miss, it just quietly tells the guesser themself "not that one".
  private async guessRace(
    session: ScreenshotGuessMatchSession,
    round: ScreenshotGuessRound,
    userId: number,
    catalogId: number | null,
  ) {
    if (!this.activePlayers(session).some((p) => p.userId === userId)) throw new ForbiddenException();

    const correct = catalogId != null && catalogId === round.gameId;
    if (!correct) return this.toStateDto(session);

    round.resolved = true;
    round.blurStepIndex = BLUR_STEP_COUNT - 1;
    if (session.turnTimer) clearTimeout(session.turnTimer);

    const player = session.players.get(userId)!;
    player.score += 1;
    this.broadcastState(session);
    if (player.score >= session.targetScore) await this.finishMatch(session, userId);
    else this.scheduleNextRound(session);
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
      await this.prisma.screenshotGuessMatch
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
    const row = await this.prisma.screenshotGuessMatch.findUnique({ where: { id: matchId } });
    if (!row) throw new NotFoundException('Partie introuvable');
    return {
      id: row.id,
      status: row.status,
      difficulty: row.difficulty,
      targetScore: row.targetScore,
      winnerId: row.winnerId,
      participants: row.participants,
      history: row.rounds ?? [],
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
    advanceOnWrong = true,
  ): { correct: boolean; resolved: boolean; blurStepIndex: number; answerGameId?: number; answerTitle?: string } {
    const correct = catalogId != null && catalogId === round.gameId;
    if (correct) {
      // The answer is known now regardless of how blurred the guess was made
      // at — jump straight to the last step so the client can animate a full
      // reveal instead of leaving the cover only partly cleared.
      round.blurStepIndex = BLUR_STEP_COUNT - 1;
      return {
        correct: true,
        resolved: true,
        blurStepIndex: round.blurStepIndex,
        answerGameId: round.gameId,
        answerTitle: round.title,
      };
    }
    if (!advanceOnWrong) {
      return { correct: false, resolved: false, blurStepIndex: round.blurStepIndex };
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

  private async startRound(session: ScreenshotGuessMatchSession): Promise<void> {
    session.roundIndex += 1;
    // RACE has no turn rotation — everyone can guess at any time, so
    // turnOrder stays empty (toStateDto then reports currentTurnUserId as
    // null, which is exactly what the client needs to not highlight anyone).
    let turnOrder: number[] = [];
    if (session.roundMode === 'TURNS') {
      const activeIds = this.activePlayers(session).map((p) => p.userId);
      // The starting player shifts by one every round so nobody is always
      // first or always last — relative order (J1→J2→J3) stays fixed.
      const startOffset = session.roundIndex % activeIds.length;
      turnOrder = [...activeIds.slice(startOffset), ...activeIds.slice(0, startOffset)];
    }

    const game = await this.pickGame(session.difficulty, [...session.usedGameIds]);
    if (!game) {
      // Exhausted the tier's pool (astronomically unlikely) — end the match
      // with whoever's leading rather than getting stuck.
      const leader = this.activePlayers(session).sort((a, b) => b.score - a.score)[0];
      await this.finishMatch(session, leader?.userId ?? null);
      return;
    }

    session.usedGameIds.add(game.id);
    session.history.push({ gameId: game.id, title: game.title, screenshotUrl: game.screenshotUrl });
    session.round = {
      index: session.roundIndex,
      gameId: game.id,
      title: game.title,
      screenshotUrl: game.screenshotUrl,
      // No blur = shown fully clear from the start, nothing to reveal.
      blurStepIndex: session.blur ? 0 : BLUR_STEP_COUNT - 1,
      turnOrder,
      turnPointer: 0,
      resolved: false,
      turnDeadline: 0, // set by scheduleTurnTimer/scheduleRaceDeblur below
      attemptsLeft: !session.blur && session.roundMode === 'TURNS' ? turnOrder.length : undefined,
    };
    if (session.roundMode === 'RACE') this.scheduleRaceDeblur(session);
    else this.scheduleTurnTimer(session);
    this.broadcastState(session);
  }

  private scheduleNextRound(session: ScreenshotGuessMatchSession): void {
    session.nextRoundTimer = setTimeout(() => {
      if (session.status === 'PLAYING') void this.startRound(session);
    }, NEXT_ROUND_DELAY_MS);
  }

  // (Re)arms the current turn's auto-pass timer — always clears any previous
  // one first, so this is safe to call both when a round starts and whenever
  // the turn advances within it. A round that's already resolved has nothing
  // to schedule (the 4s inter-round gap needs no timer of its own).
  private scheduleTurnTimer(session: ScreenshotGuessMatchSession): void {
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

  // RACE's equivalent of scheduleTurnTimer: instead of a specific player's
  // turn expiring, the cover itself clears by one step on a fixed schedule,
  // independent of who (if anyone) is guessing. Reuses the same
  // `turnTimer`/`turnDeadline` fields as TURNS — only one of the two modes'
  // schedulers is ever active for a given session, and the client already
  // reads `turnDeadline` as "when does the next thing happen" either way.
  private scheduleRaceDeblur(session: ScreenshotGuessMatchSession): void {
    if (session.turnTimer) clearTimeout(session.turnTimer);
    const round = session.round;
    if (!round || round.resolved) return;
    round.turnDeadline = Date.now() + session.answerTimeSec * 1000;
    session.turnTimer = setTimeout(() => {
      const r = session.round;
      if (!r || r.resolved || r !== round) return;
      if (r.blurStepIndex >= BLUR_STEP_COUNT - 1) {
        // Fully revealed and still nobody found it.
        r.resolved = true;
        this.broadcastState(session);
        this.scheduleNextRound(session);
      } else {
        r.blurStepIndex += 1;
        this.broadcastState(session);
        this.scheduleRaceDeblur(session);
      }
    }, session.answerTimeSec * 1000);
  }

  private async finishMatch(session: ScreenshotGuessMatchSession, winnerId: number | null): Promise<void> {
    session.status = 'FINISHED';
    session.winnerId = winnerId;
    if (session.nextRoundTimer) clearTimeout(session.nextRoundTimer);
    if (session.turnTimer) clearTimeout(session.turnTimer);
    const participants = [...session.players.values()].map((p) => ({
      userId: p.userId,
      username: p.username,
      score: p.score,
    }));
    await this.prisma.screenshotGuessMatch
      .update({
        where: { id: session.id },
        data: {
          status: 'FINISHED',
          winnerId,
          participants: participants as Prisma.InputJsonValue,
          rounds: session.history as unknown as Prisma.InputJsonValue,
          endedAt: new Date(),
        },
      })
      .catch(() => {});
    this.broadcastState(session);
  }

  private requireSession(matchId: string): ScreenshotGuessMatchSession {
    const session = this.matches.get(matchId);
    if (!session) throw new NotFoundException('Partie introuvable ou terminée');
    return session;
  }

  // `players` is the full roster ever invited (host, accepted, pending,
  // declined — declined ones stay for the lobby list, never removed on
  // decline). Anything gameplay-related (turn order, win/abandon counts,
  // leader fallback) must only ever consider the ACCEPTED subset.
  private activePlayers(session: ScreenshotGuessMatchSession): ScreenshotGuessPlayer[] {
    return [...session.players.values()].filter((p) => p.status === 'ACCEPTED');
  }

  private toStateDto(session: ScreenshotGuessMatchSession) {
    return {
      id: session.id,
      hostId: session.hostId,
      status: session.status,
      difficulty: session.difficulty,
      roundMode: session.roundMode,
      blur: session.blur,
      targetScore: session.targetScore,
      answerTimeSec: session.answerTimeSec,
      winnerId: session.winnerId ?? null,
      history: session.history,
      players: [...session.players.values()].map((p) => ({
        userId: p.userId,
        username: p.username,
        avatarUrl: p.avatarUrl,
        score: p.score,
        status: p.status,
      })),
      round: session.round && {
        index: session.round.index,
        screenshotUrl: session.round.screenshotUrl,
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

  private broadcastState(session: ScreenshotGuessMatchSession): void {
    const dto = this.toStateDto(session);
    for (const p of session.players.values()) this.gateway.emitToUser(p.userId, 'screenshotguess:state', dto);
    // The host still needs the update even if they've just been removed as a
    // player (can't happen today — leave() only drops the caller — kept for
    // safety since hostId isn't always in `players`' key set by construction).
    if (!session.players.has(session.hostId)) {
      this.gateway.emitToUser(session.hostId, 'screenshotguess:state', dto);
    }
  }

  // Picks one random game within a difficulty tier, excluding ids already
  // used earlier in the same session/local run.
  private async pickGame(
    difficulty: ScreenshotGuessDifficulty,
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
      const row = await this.prisma.game.findUnique({
        where: { id },
        select: { id: true, title: true, screenshots: true },
      });
      return row && this.toPickedGame(row);
    }

    const total = await this.prisma.game.count({ where });
    if (total === 0) return null;
    const [row] = await this.prisma.game.findMany({
      where,
      skip: Math.floor(Math.random() * total),
      take: 1,
      select: { id: true, title: true, screenshots: true },
    });
    return row ? this.toPickedGame(row) : null;
  }

  // A game can have several screenshots on file (MAX_SCREENSHOTS = 6 at
  // import time) — pick one at random each time this game comes up rather
  // than always showing the same one.
  private toPickedGame(row: { id: number; title: string; screenshots: string[] }): PickedGame {
    const screenshotUrl = row.screenshots[Math.floor(Math.random() * row.screenshots.length)];
    return { id: row.id, title: row.title, screenshotUrl };
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, session] of this.matches) {
      if (session.status === 'LOBBY' && now - session.createdAt > LOBBY_TTL_MS) {
        session.status = 'ABANDONED';
        this.prisma.screenshotGuessMatch
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
