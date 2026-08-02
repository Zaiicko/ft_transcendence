import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FriendshipStatus, Prisma } from '@prisma/client';
import { AchievementsService } from '../achievements/achievements.service';
import { FeedService } from '../feed/feed.service';
import { PrismaService } from '../prisma/prisma.service';
import { PsnApiService } from '../psn/psn-api.service';
import { SteamWebApiService, SteamOwnedGame } from '../steam/steam-web-api.service';
import { XboxApiService } from '../xbox/xbox-api.service';

// How stale an account may get before a background resync — i.e. how fresh
// friends' 100% games are. Product call: ~6h.
const STALE_MS = 6 * 60 * 60 * 1000;
// (account, platform) pairs refreshed per tick. Deliberately low: the limiting
// factor is OpenXBL, whose SERVICE KEY is SHARED by every user and capped at
// ~150 req/h; the shared PSN session wants gentleness too. 6/h x 2 calls is
// ~12 req/h, far below the ceiling.
const BATCH = 6;
// Gap between two accounts: spreads calls on the shared keys instead of
// bursting, which is the real rate-limit risk rather than overall frequency.
const INTER_JOB_MS = 3000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Same normalisation as the Xbox/PSN controllers (lowercase, alphanumeric).
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

type PlatformKey = 'steam' | 'xbox' | 'psn';
interface Job {
  userId: number;
  platform: PlatformKey;
  linkId: string; // steamId / xuid / psnAccountId
  staleFor: number;
}

// Background detection of games that reached 100%. Without it, a friend who
// never reopens their library would never broadcast a completion. Refetches
// from the APIs, refreshes the cache, then delegates to
// FeedService.syncCompletions — the exact same path as an interactive sync.
// Best-effort: no failure propagates, every attempt is bounded and spaced out.
@Injectable()
export class CompletionsService {
  private readonly logger = new Logger(CompletionsService.name);
  private running = false; // garde anti-chevauchement si un tick déborde

  constructor(
    private readonly prisma: PrismaService,
    private readonly feed: FeedService,
    private readonly steam: SteamWebApiService,
    private readonly xbox: XboxApiService,
    private readonly psn: PsnApiService,
    private readonly config: ConfigService,
    private readonly achievements: AchievementsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async refreshDueUsers(): Promise<void> {
    if (this.config.get<string>('COMPLETIONS_REFRESH') === 'off') return;
    if (this.running) return;
    this.running = true;
    try {
      const jobs = (await this.selectDueJobs()).slice(0, BATCH);
      for (let i = 0; i < jobs.length; i += 1) {
        const job = jobs[i];
        if (i > 0) await sleep(INTER_JOB_MS); // espace les appels aux clés partagées
        try {
          await this.refreshOne(job);
        } catch (err) {
          this.logger.warn(
            `refresh ${job.platform}#${job.userId} failed: ${(err as Error).message}`,
          );
        } finally {
          // Bumped even on failure, so a private profile isn't retried every tick.
          await this.prisma.user
            .update({ where: { id: job.userId }, data: { completionCheckedAt: new Date() } })
            .catch(() => undefined);
        }
      }
    } finally {
      this.running = false;
    }
  }

  // Linked accounts with at least one accepted friend (nobody reads the feed
  // otherwise) whose last check is missing or stale. Stalest first.
  private async selectDueJobs(): Promise<Job[]> {
    const threshold = new Date(Date.now() - STALE_MS);
    const users = await this.prisma.user.findMany({
      where: {
        AND: [
          { OR: [{ completionCheckedAt: null }, { completionCheckedAt: { lt: threshold } }] },
          {
            OR: [
              { steamId: { not: null } },
              { xboxXuid: { not: null } },
              { psnAccountId: { not: null } },
            ],
          },
          {
            OR: [
              { sentFriendships: { some: { status: FriendshipStatus.ACCEPTED } } },
              { receivedFriendships: { some: { status: FriendshipStatus.ACCEPTED } } },
            ],
          },
        ],
      },
      select: {
        id: true,
        steamId: true,
        xboxXuid: true,
        psnAccountId: true,
        completionCheckedAt: true,
      },
    });

    const now = Date.now();
    const staleFor = (u: { completionCheckedAt: Date | null }) =>
      u.completionCheckedAt ? now - u.completionCheckedAt.getTime() : Number.MAX_SAFE_INTEGER;

    const jobs: Job[] = [];
    for (const u of users) {
      const s = staleFor(u);
      if (u.steamId) jobs.push({ userId: u.id, platform: 'steam', linkId: u.steamId, staleFor: s });
      if (u.xboxXuid) jobs.push({ userId: u.id, platform: 'xbox', linkId: u.xboxXuid, staleFor: s });
      if (u.psnAccountId)
        jobs.push({ userId: u.id, platform: 'psn', linkId: u.psnAccountId, staleFor: s });
    }
    jobs.sort((a, b) => b.staleFor - a.staleFor);
    return jobs;
  }

  private async refreshOne(job: Job): Promise<void> {
    if (job.platform === 'steam') return this.detectSteam(job.userId, job.linkId);
    if (job.platform === 'xbox') return this.detectXbox(job.userId, job.linkId);
    return this.detectPsn(job.userId, job.linkId);
  }

  // ---- Steam: achievements per game (1 request each), matched by steamAppId ----

  private async detectSteam(userId: number, steamId: string): Promise<void> {
    const owned = await this.steam.getOwnedGames(steamId);
    if (owned === null) return; // private profile or error: leave the cache alone
    const perGame = await this.syncSteamAchievements(steamId, owned);
    await this.prisma.user.update({
      where: { id: userId },
      data: { steamAchievements: { syncedAt: new Date().toISOString(), perGame } },
    });

    const games = await this.prisma.game.findMany({
      where: { steamAppId: { in: owned.map((g) => g.appid) } },
      select: { id: true, steamAppId: true },
    });
    const completed = games
      .filter((g) => {
        const a = g.steamAppId ? perGame[String(g.steamAppId)] : undefined;
        return a && a[1] > 0 && a[0] === a[1]; // every achievement earned
      })
      .map((g) => {
        const lastUnlock = g.steamAppId ? (perGame[String(g.steamAppId)]?.[2] ?? 0) : 0;
        return {
          gameId: g.id,
          completedAt: lastUnlock > 0 ? new Date(lastUnlock * 1000) : undefined,
        };
      });
    await this.feed.syncCompletions(userId, 'steam', completed);
    void this.achievements.evaluate(userId, ['completions', 'perfect', 'genres']);
  }

  // Deliberate copy of SteamController.syncAchievements (Steam has no batch
  // call): both paths must stay identical. perGame is
  // [earned, total, lastUnlock], lastUnlock (unix s) being the real 100% date.
  private async syncSteamAchievements(
    steamId: string,
    owned: SteamOwnedGame[],
  ): Promise<Record<string, [number, number, number]>> {
    const SAFETY_CAP = 1000;
    const CONCURRENCY = 10;
    const played = owned
      .filter((g) => g.playtime_forever > 0)
      .sort((a, b) => b.playtime_forever - a.playtime_forever)
      .slice(0, SAFETY_CAP);

    const perGame: Record<string, [number, number, number]> = {};
    for (let i = 0; i < played.length; i += CONCURRENCY) {
      const batch = played.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (g) => {
          const a = await this.steam.getPlayerAchievements(steamId, g.appid);
          if (a) perGame[String(g.appid)] = [a.unlocked, a.total, a.lastUnlock];
        }),
      );
    }
    return perGame;
  }

  // ---- Xbox : Gamerscore complet ----

  private async detectXbox(userId: number, xuid: string): Promise<void> {
    const titles = await this.xbox.getTitles(xuid);
    if (titles === null) return;
    const gamerscore = await this.xbox.getGamerscore(xuid);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        xboxLibrary: {
          syncedAt: new Date().toISOString(),
          gamerscore,
          titles,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    const completed = await this.matchCompleted(
      titles,
      (t) => t.name,
      (t) => t.totalGamerscore > 0 && t.currentGamerscore === t.totalGamerscore,
      // Xbox gives no per-achievement date without a call per game: use lastPlayed.
      (t) => (t.lastPlayed ? new Date(t.lastPlayed) : undefined),
    );
    await this.feed.syncCompletions(userId, 'xbox', completed);
    void this.achievements.evaluate(userId, ['completions', 'perfect', 'genres']);
  }

  // ---- PSN: all trophies OR a platinum, a product call ----

  private async detectPsn(userId: number, accountId: string): Promise<void> {
    const titles = await this.psn.getTitles(accountId);
    if (titles === null) return;
    const summary = await this.psn.getTrophySummary(accountId);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        psnLibrary: {
          syncedAt: new Date().toISOString(),
          titles,
          summary,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    const completed = await this.matchCompleted(
      titles,
      (t) => t.trophyTitleName,
      (t) => t.progress === 100 || (t.earnedTrophies?.platinum ?? 0) >= 1,
      // PSN: date of the last trophy, standing in for the 100%/platinum date.
      (t) => (t.lastUpdatedDateTime ? new Date(t.lastUpdatedDateTime) : undefined),
    );
    await this.feed.syncCompletions(userId, 'psn', completed);
    void this.achievements.evaluate(userId, ['completions', 'perfect', 'genres']);
  }

  // Completed titles -> catalog { gameId, completedAt }, by normalised name
  // (same SQL as the controllers). A name counts as completed as soon as one of
  // its titles is, keeping the most recent completion date for that name.
  private async matchCompleted<T>(
    titles: T[],
    getName: (t: T) => string,
    isComplete: (t: T) => boolean,
    getDate: (t: T) => Date | undefined,
  ): Promise<{ gameId: number; completedAt?: Date }[]> {
    // norm -> most recent completion date (undefined when undated)
    const dateByNorm = new Map<string, Date | undefined>();
    for (const t of titles) {
      if (!isComplete(t)) continue;
      const n = normalize(getName(t));
      if (!n) continue;
      const d = getDate(t);
      const valid = d && !isNaN(d.getTime()) ? d : undefined;
      const prev = dateByNorm.get(n);
      if (!dateByNorm.has(n) || (valid && (!prev || valid > prev))) dateByNorm.set(n, valid);
    }
    if (dateByNorm.size === 0) return [];

    const rows = await this.prisma.$queryRaw<{ id: number; norm: string }[]>`
      SELECT id, lower(regexp_replace(title, '[^a-zA-Z0-9]', '', 'g')) AS norm
      FROM "Game"
      WHERE lower(regexp_replace(title, '[^a-zA-Z0-9]', '', 'g')) = ANY(${[...dateByNorm.keys()]})
    `;
    const seen = new Set<number>();
    const out: { gameId: number; completedAt?: Date }[] = [];
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ gameId: r.id, completedAt: dateByNorm.get(r.norm) });
    }
    return out;
  }
}
