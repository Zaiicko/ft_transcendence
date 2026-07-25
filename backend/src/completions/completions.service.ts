import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FriendshipStatus, Prisma } from '@prisma/client';
import { FeedService } from '../feed/feed.service';
import { PrismaService } from '../prisma/prisma.service';
import { PsnApiService } from '../psn/psn-api.service';
import { SteamWebApiService, SteamOwnedGame } from '../steam/steam-web-api.service';
import { XboxApiService } from '../xbox/xbox-api.service';

// Âge max d'un compte avant re-synchro de fond des complétions ≈ fraîcheur avec
// laquelle les amis voient les jeux finis à 100 % (décision produit : ~6 h).
const STALE_MS = 6 * 60 * 60 * 1000;
// Nombre de (compte, plateforme) rafraîchis par tick. Volontairement bas : le
// facteur limitant est OpenXBL (Xbox), dont la CLÉ SERVICE est PARTAGÉE par tous
// les utilisateurs et plafonnée à ~150 req/h ; PSN (session NPSSO partagée) veut
// aussi de la douceur. À 6/h × 2 appels ≈ 12 req/h : très loin du plafond.
const BATCH = 6;
// Pause entre deux comptes : lisse les appels vers les clés partagées au lieu
// d'une rafale (le vrai risque de rate-limit, plus que la fréquence globale).
const INTER_JOB_MS = 3000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Même normalisation que les contrôleurs Xbox/PSN (minuscules + alphanumérique).
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

type PlatformKey = 'steam' | 'xbox' | 'psn';
interface Job {
  userId: number;
  platform: PlatformKey;
  linkId: string; // steamId / xuid / psnAccountId
  staleFor: number;
}

// Détection périodique, en tâche de fond, des jeux passés à 100 % : sans elle,
// un ami qui ne rouvre jamais sa bibliothèque ne diffuserait jamais ses
// complétions. On re-synchronise depuis les API (fetch frais), on met à jour le
// cache, puis on délègue à FeedService.syncCompletions — EXACTEMENT le même
// chemin (seuil 100 %, amorçage silencieux) que la synchro interactive. Best
// effort : aucun échec ne remonte, chaque tentative est bornée et espacée.
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
          // Bumpé même en échec : on ne re-tente pas un profil privé tous les ticks.
          await this.prisma.user
            .update({ where: { id: job.userId }, data: { completionCheckedAt: new Date() } })
            .catch(() => undefined);
        }
      }
    } finally {
      this.running = false;
    }
  }

  // Comptes liés, ayant au moins un ami accepté (sinon personne ne lit ce feed),
  // dont la dernière vérification est absente ou périmée. Les plus périmés d'abord.
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

  // ---- Steam : succès par jeu (1 requête/jeu), match catalogue par steamAppId ----

  private async detectSteam(userId: number, steamId: string): Promise<void> {
    const owned = await this.steam.getOwnedGames(steamId);
    if (owned === null) return; // profil privé/erreur : on ne touche pas au cache
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
        return a && a[1] > 0 && a[0] === a[1]; // tous les succès obtenus
      })
      .map((g) => g.id);
    await this.feed.syncCompletions(userId, 'steam', completed);
  }

  // Copie assumée de SteamController.syncAchievements (Steam n'a pas d'appel
  // groupé) : les deux chemins doivent rester identiques.
  private async syncSteamAchievements(
    steamId: string,
    owned: SteamOwnedGame[],
  ): Promise<Record<string, [number, number]>> {
    const SAFETY_CAP = 1000;
    const CONCURRENCY = 10;
    const played = owned
      .filter((g) => g.playtime_forever > 0)
      .sort((a, b) => b.playtime_forever - a.playtime_forever)
      .slice(0, SAFETY_CAP);

    const perGame: Record<string, [number, number]> = {};
    for (let i = 0; i < played.length; i += CONCURRENCY) {
      const batch = played.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (g) => {
          const a = await this.steam.getPlayerAchievements(steamId, g.appid);
          if (a) perGame[String(g.appid)] = [a.unlocked, a.total];
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
    );
    await this.feed.syncCompletions(userId, 'xbox', completed);
  }

  // ---- PSN : 100 % des trophées OU platine (décision produit) ----

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
    );
    await this.feed.syncCompletions(userId, 'psn', completed);
  }

  // Titres complétés → identifiants du catalogue, par nom normalisé (même SQL que
  // les contrôleurs). Un nom compte comme complété dès qu'un de ses titres l'est.
  private async matchCompleted<T>(
    titles: T[],
    getName: (t: T) => string,
    isComplete: (t: T) => boolean,
  ): Promise<number[]> {
    const completeNorms = new Set<string>();
    for (const t of titles) {
      if (!isComplete(t)) continue;
      const n = normalize(getName(t));
      if (n) completeNorms.add(n);
    }
    if (completeNorms.size === 0) return [];

    const rows = await this.prisma.$queryRaw<{ id: number; norm: string }[]>`
      SELECT id, lower(regexp_replace(title, '[^a-zA-Z0-9]', '', 'g')) AS norm
      FROM "Game"
      WHERE lower(regexp_replace(title, '[^a-zA-Z0-9]', '', 'g')) = ANY(${[...completeNorms]})
    `;
    const byNorm = new Map<string, number>();
    for (const r of rows) if (!byNorm.has(r.norm)) byNorm.set(r.norm, r.id);
    return [...byNorm.values()];
  }
}
