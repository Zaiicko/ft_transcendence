import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { FriendshipStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePanoramaGuessMatchDto } from './dto/create-match.dto';
import { PanoramaGuessGateway } from './panorama-guess.gateway';

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

interface PickedEntry {
  entryId: number;
  gameId: number;
  title: string;
  kuulaId: string;
}

interface PendingLocalRound {
  entryId: number;
  gameId: number;
  title: string;
  kuulaId: string;
  expiresAt: number;
}

type PanoramaGuessMatchStatus = 'LOBBY' | 'PLAYING' | 'FINISHED' | 'ABANDONED';
type PanoramaGuessPlayerStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED';

interface PanoramaGuessPlayer {
  userId: number;
  username: string;
  avatarUrl: string | null;
  score: number;
  status: PanoramaGuessPlayerStatus;
}

interface PanoramaGuessRound {
  index: number;
  entryId: number;
  gameId: number;
  title: string;
  kuulaId: string;
  resolved: boolean;
  // Epoch ms the round auto-ends unresolved at — purely informational for
  // the client's countdown; the server enforces it via `roundTimer` below.
  turnDeadline: number;
}

interface PanoramaGuessMatchSession {
  id: string;
  hostId: number;
  targetScore: number;
  // Seconds a round stays open before it ends unresolved.
  answerTimeSec: number;
  status: PanoramaGuessMatchStatus;
  // Map preserves insertion order — host first, then invitees in invite order.
  players: Map<number, PanoramaGuessPlayer>;
  usedEntryIds: Set<number>;
  round: PanoramaGuessRound | null;
  roundIndex: number;
  // Every panorama shown so far this match, in order — for the post-match recap.
  history: { gameId: number; title: string; kuulaId: string }[];
  createdAt: number;
  nextRoundTimer?: ReturnType<typeof setTimeout>;
  roundTimer?: ReturnType<typeof setTimeout>;
  winnerId?: number | null;
}

@Injectable()
export class PanoramaGuessService implements OnModuleDestroy {
  private readonly logger = new Logger(PanoramaGuessService.name);
  private readonly matches = new Map<string, PanoramaGuessMatchSession>();
  private readonly localRounds = new Map<string, PendingLocalRound>();
  private readonly sweepTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PanoramaGuessGateway,
  ) {
    this.sweepTimer = setInterval(() => this.sweep(), 60_000);
  }

  onModuleDestroy(): void {
    clearInterval(this.sweepTimer);
  }

  // ---------------------------------------------------------------- LOCAL --

  async pickLocalRound(excludeIds: number[]) {
    const entry = await this.pickEntry(excludeIds);
    if (!entry) throw new NotFoundException('Aucun panorama disponible');
    const roundToken = randomUUID();
    this.localRounds.set(roundToken, {
      entryId: entry.entryId,
      gameId: entry.gameId,
      title: entry.title,
      kuulaId: entry.kuulaId,
      expiresAt: Date.now() + LOCAL_ROUND_TTL_MS,
    });
    return { roundToken, entryId: entry.entryId, kuulaId: entry.kuulaId };
  }

  // No blur/reveal to advance on a panorama — a wrong (non-null) guess just
  // leaves the round open for another attempt. `catalogId === null` is a
  // deliberate signal (the round's own client-side timer ran out, or the
  // player gave up) rather than "a real guess that happened to be wrong" —
  // it always resolves the round and reveals the answer, same as a correct
  // guess would, since otherwise LOCAL play would have no way to learn what
  // the answer was on a timeout.
  guessLocal(roundToken: string, catalogId: number | null) {
    const round = this.localRounds.get(roundToken);
    if (!round) throw new NotFoundException('Manche introuvable ou expirée');

    const correct = catalogId != null && catalogId === round.gameId;
    const resolved = correct || catalogId === null;
    if (resolved) this.localRounds.delete(roundToken);
    return {
      correct,
      resolved,
      ...(resolved ? { answerGameId: round.gameId, answerTitle: round.title } : {}),
    };
  }

  // ---------------------------------------------------------------- MULTI --

  async createMatch(hostId: number, dto: CreatePanoramaGuessMatchDto): Promise<{ matchId: string }> {
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
    const players = new Map<number, PanoramaGuessPlayer>();
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
      targetScore: dto.targetScore,
      answerTimeSec: dto.answerTimeSec,
      status: 'LOBBY',
      players,
      usedEntryIds: new Set(),
      round: null,
      roundIndex: -1,
      history: [],
      createdAt: Date.now(),
    });

    await this.prisma.panoramaGuessMatch.create({
      data: { id, hostId, status: 'LOBBY', targetScore: dto.targetScore },
    });

    // Same shared live event as the other mini-games — see
    // screenshot-guess.service.ts's createMatch for why this bypasses the
    // general notification pipeline (GameInviteOverlay IS the notification).
    for (const u of invitees) {
      this.gateway.emitToUser(u.id, 'minigame:invite', {
        matchId: id,
        game: 'panorama-guess',
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

    player.status = accept ? 'ACCEPTED' : 'DECLINED';

    this.broadcastState(session);
    return this.toStateDto(session);
  }

  async start(matchId: string, hostId: number) {
    const session = this.requireSession(matchId);
    if (session.hostId !== hostId) throw new ForbiddenException();
    if (session.status !== 'LOBBY') throw new BadRequestException('La partie a déjà commencé');

    if (this.activePlayers(session).length < 2) {
      throw new BadRequestException('Il faut au moins un ami qui a accepté');
    }
    for (const [id, p] of session.players) if (p.status === 'PENDING') session.players.delete(id);

    session.status = 'PLAYING';
    await this.prisma.panoramaGuessMatch
      .update({ where: { id: matchId }, data: { status: 'PLAYING' } })
      .catch(() => {});
    await this.startRound(session);
    return this.toStateDto(session);
  }

  // Race: any accepted player can attempt at any time, no turn to check. A
  // wrong guess doesn't touch the round at all — it just quietly tells the
  // guesser themself "not that one" — only a correct guess (or the round
  // timer) resolves the round.
  async guess(matchId: string, userId: number, catalogId: number | null) {
    const session = this.requireSession(matchId);
    if (session.status !== 'PLAYING' || !session.round || session.round.resolved) {
      throw new BadRequestException('Aucune manche en cours');
    }
    if (!this.activePlayers(session).some((p) => p.userId === userId)) throw new ForbiddenException();

    const round = session.round;
    const correct = catalogId != null && catalogId === round.gameId;
    if (!correct) return this.toStateDto(session);

    round.resolved = true;
    if (session.roundTimer) clearTimeout(session.roundTimer);

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

    if (session.status === 'LOBBY' && session.hostId === userId) {
      session.status = 'ABANDONED';
      await this.prisma.panoramaGuessMatch
        .update({ where: { id: matchId }, data: { status: 'ABANDONED', endedAt: new Date() } })
        .catch(() => {});
    } else if (session.status === 'PLAYING' && this.activePlayers(session).length < 2) {
      if (session.roundTimer) clearTimeout(session.roundTimer);
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
    const row = await this.prisma.panoramaGuessMatch.findUnique({ where: { id: matchId } });
    if (!row) throw new NotFoundException('Partie introuvable');
    return {
      id: row.id,
      status: row.status,
      targetScore: row.targetScore,
      winnerId: row.winnerId,
      participants: row.participants,
      history: row.rounds ?? [],
      round: null,
    };
  }

  // ------------------------------------------------------------ internals --

  private async startRound(session: PanoramaGuessMatchSession): Promise<void> {
    session.roundIndex += 1;

    const entry = await this.pickEntry([...session.usedEntryIds]);
    if (!entry) {
      // Exhausted the curated pool (small, hand-verified list — can happen
      // in a very long match) — end the match with whoever's leading rather
      // than getting stuck.
      const leader = this.activePlayers(session).sort((a, b) => b.score - a.score)[0];
      await this.finishMatch(session, leader?.userId ?? null);
      return;
    }

    session.usedEntryIds.add(entry.entryId);
    session.history.push({ gameId: entry.gameId, title: entry.title, kuulaId: entry.kuulaId });
    session.round = {
      index: session.roundIndex,
      entryId: entry.entryId,
      gameId: entry.gameId,
      title: entry.title,
      kuulaId: entry.kuulaId,
      resolved: false,
      turnDeadline: 0, // set by scheduleRoundTimer below
    };
    this.scheduleRoundTimer(session);
    this.broadcastState(session);
  }

  private scheduleNextRound(session: PanoramaGuessMatchSession): void {
    session.nextRoundTimer = setTimeout(() => {
      if (session.status === 'PLAYING') void this.startRound(session);
    }, NEXT_ROUND_DELAY_MS);
  }

  // The round's shared time limit — nobody's turn to pass, it just expires
  // unresolved for everyone at once if no one found it in time.
  private scheduleRoundTimer(session: PanoramaGuessMatchSession): void {
    if (session.roundTimer) clearTimeout(session.roundTimer);
    const round = session.round;
    if (!round || round.resolved) return;
    round.turnDeadline = Date.now() + session.answerTimeSec * 1000;
    session.roundTimer = setTimeout(() => {
      const r = session.round;
      if (!r || r.resolved || r !== round) return;
      r.resolved = true;
      this.broadcastState(session);
      this.scheduleNextRound(session);
    }, session.answerTimeSec * 1000);
  }

  private async finishMatch(session: PanoramaGuessMatchSession, winnerId: number | null): Promise<void> {
    session.status = 'FINISHED';
    session.winnerId = winnerId;
    if (session.nextRoundTimer) clearTimeout(session.nextRoundTimer);
    if (session.roundTimer) clearTimeout(session.roundTimer);
    const participants = [...session.players.values()].map((p) => ({
      userId: p.userId,
      username: p.username,
      score: p.score,
    }));
    await this.prisma.panoramaGuessMatch
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

  private requireSession(matchId: string): PanoramaGuessMatchSession {
    const session = this.matches.get(matchId);
    if (!session) throw new NotFoundException('Partie introuvable ou terminée');
    return session;
  }

  private activePlayers(session: PanoramaGuessMatchSession): PanoramaGuessPlayer[] {
    return [...session.players.values()].filter((p) => p.status === 'ACCEPTED');
  }

  private toStateDto(session: PanoramaGuessMatchSession) {
    return {
      id: session.id,
      hostId: session.hostId,
      status: session.status,
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
        kuulaId: session.round.kuulaId,
        resolved: session.round.resolved,
        turnDeadline: session.round.resolved ? null : session.round.turnDeadline,
        ...(session.round.resolved
          ? { answerGameId: session.round.gameId, answerTitle: session.round.title }
          : {}),
      },
    };
  }

  private broadcastState(session: PanoramaGuessMatchSession): void {
    const dto = this.toStateDto(session);
    for (const p of session.players.values()) this.gateway.emitToUser(p.userId, 'panoramaguess:state', dto);
    if (!session.players.has(session.hostId)) {
      this.gateway.emitToUser(session.hostId, 'panoramaguess:state', dto);
    }
  }

  // Picks one random curated entry, excluding ones already used earlier in
  // the same session/local run. Two-step pick (a random GAME, then a random
  // panorama for that game) rather than one flat random row: the curated
  // set is very unevenly distributed per game (some games have 100+ hand-
  // verified panoramas, others just one), so picking a row directly would
  // make the most-photographed games come up constantly — every game in the
  // pool should have an equal shot at being asked about, not every photo.
  private async pickEntry(excludeIds: number[]): Promise<PickedEntry | null> {
    const where: Prisma.PanoramaGuessEntryWhereInput = {
      active: true,
      ...(excludeIds.length && { id: { notIn: excludeIds } }),
    };
    const games = await this.prisma.panoramaGuessEntry.findMany({
      where,
      distinct: ['gameId'],
      select: { gameId: true },
    });
    if (games.length === 0) return null;
    const gameId = games[Math.floor(Math.random() * games.length)].gameId;

    const entries = await this.prisma.panoramaGuessEntry.findMany({
      where: { ...where, gameId },
      select: { id: true, kuulaId: true, game: { select: { id: true, title: true } } },
    });
    const row = entries[Math.floor(Math.random() * entries.length)];
    return { entryId: row.id, gameId: row.game.id, title: row.game.title, kuulaId: row.kuulaId };
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, session] of this.matches) {
      if (session.status === 'LOBBY' && now - session.createdAt > LOBBY_TTL_MS) {
        session.status = 'ABANDONED';
        this.prisma.panoramaGuessMatch
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
