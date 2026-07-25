import { Injectable } from '@nestjs/common';
import { FriendshipStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Trois classements possibles, chacun = un simple comptage par utilisateur :
//  - completions : nombre de jeux finis à 100 % (table GameCompletion)
//  - played      : nombre de jeux « faits » (PlayedGame, status PLAYED)
//  - reviews     : nombre d'avis écrits (Review)
export type LeaderboardMetric = 'completions' | 'played' | 'reviews';
// Portée : entre amis (moi + mes amis acceptés) ou tout le site.
export type LeaderboardScope = 'friends' | 'global';
// Fenêtre : cumul depuis toujours ou 30 derniers jours glissants (via createdAt).
export type LeaderboardWindow = 'all' | 'month';

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const actorSelect = { id: true, username: true, avatarUrl: true } as const;

// Table SQL par métrique. Whitelist FERMÉE (jamais d'entrée utilisateur) : le
// nom de table ne peut pas être un paramètre lié, on l'injecte via Prisma.raw
// depuis cette map uniquement — donc sûr (pas d'injection possible).
const TABLE: Record<LeaderboardMetric, string> = {
  completions: 'GameCompletion',
  played: 'PlayedGame',
  reviews: 'Review',
};

export interface LeaderboardRow {
  rank: number;
  user: { id: number; username: string; avatarUrl: string | null };
  score: number;
}

export interface LeaderboardResult {
  metric: LeaderboardMetric;
  scope: LeaderboardScope;
  window: LeaderboardWindow;
  rows: LeaderboardRow[];
  // Position du viewer même s'il n'apparaît pas dans le top affiché. null s'il
  // n'a encore rien dans cette métrique/fenêtre (score 0 ⇒ pas classé).
  me: { rank: number; score: number } | null;
}

@Injectable()
export class LeaderboardService {
  constructor(private readonly prisma: PrismaService) {}

  // IDs des amis acceptés (mêmes deux sens que le feed).
  private async friendIds(userId: number): Promise<number[]> {
    const rows = await this.prisma.friendship.findMany({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      select: { requesterId: true, addresseeId: true },
    });
    return rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId));
  }

  // Fragment WHERE partagé par toutes les requêtes (top N + rang du viewer) :
  // une seule source de vérité pour les filtres métrique/portée/fenêtre.
  private whereSql(
    metric: LeaderboardMetric,
    userIds: number[] | undefined,
    since: Date | undefined,
  ): Prisma.Sql {
    const parts: Prisma.Sql[] = [];
    if (metric === 'played') parts.push(Prisma.sql`"status"::text = 'PLAYED'`);
    if (metric === 'reviews') parts.push(Prisma.sql`"userId" IS NOT NULL`);
    if (userIds) parts.push(Prisma.sql`"userId" = ANY(${userIds})`);
    if (since) parts.push(Prisma.sql`"createdAt" >= ${since}`);
    if (parts.length === 0) return Prisma.sql`TRUE`;
    return Prisma.join(parts, ' AND ');
  }

  async getLeaderboard(
    viewerId: number,
    metric: LeaderboardMetric,
    scope: LeaderboardScope,
    window: LeaderboardWindow,
    limit = DEFAULT_LIMIT,
  ): Promise<LeaderboardResult> {
    limit = Math.min(Math.max(limit, 1), MAX_LIMIT);

    // Portée « amis » : moi inclus (pour voir ma place). « global » : pas de
    // restriction d'utilisateur.
    const userIds =
      scope === 'friends' ? [viewerId, ...(await this.friendIds(viewerId))] : undefined;
    const since = window === 'month' ? new Date(Date.now() - MONTH_MS) : undefined;

    const table = Prisma.raw(`"${TABLE[metric]}"`);
    const where = this.whereSql(metric, userIds, since);

    // Top N trié ET tronqué par Postgres : on ne charge jamais tous les
    // utilisateurs en mémoire (point de scalabilité). Départage : à score égal,
    // le PREMIER arrivé à ce score passe devant. Sa dernière occurrence (MAX
    // createdAt) est le moment où il a atteint son total ; la plus ancienne
    // gagne, d'où MAX("createdAt") ASC.
    const raw = await this.prisma.$queryRaw<{ userId: number; score: number }[]>(Prisma.sql`
      SELECT "userId", COUNT(*)::int AS "score"
      FROM ${table}
      WHERE ${where}
      GROUP BY "userId"
      ORDER BY "score" DESC, MAX("createdAt") ASC
      LIMIT ${limit}
    `);

    const users = await this.prisma.user.findMany({
      where: { id: { in: raw.map((r) => r.userId) } },
      select: actorSelect,
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    const rows: LeaderboardRow[] = [];
    for (let i = 0; i < raw.length; i += 1) {
      const u = byId.get(raw[i].userId);
      if (!u) continue; // user supprimé entre-temps : on saute
      rows.push({ rank: i + 1, user: u, score: raw[i].score });
    }

    const me = await this.computeMyRank(viewerId, table, where);
    return { metric, scope, window, rows, me };
  }

  // Rang exact du viewer, calculé côté Postgres (aucun chargement de la liste
  // complète) : on compte les utilisateurs qui le devancent, avec le MÊME
  // départage que le top N. `where` est le fragment déjà construit (portée +
  // fenêtre + métrique).
  private async computeMyRank(
    viewerId: number,
    table: Prisma.Sql,
    where: Prisma.Sql,
  ): Promise<{ rank: number; score: number } | null> {
    const mine = await this.prisma.$queryRaw<{ score: number; lastAt: Date | null }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS "score", MAX("createdAt") AS "lastAt"
      FROM ${table}
      WHERE ${where} AND "userId" = ${viewerId}
    `);
    const myScore = mine[0]?.score ?? 0;
    const myLastAt = mine[0]?.lastAt ?? null;
    if (myScore === 0 || !myLastAt) return null; // rien dans cette métrique ⇒ pas classé

    // Devancé par : score strictement supérieur, OU même score mais atteint plus
    // tôt (MAX createdAt antérieur). COUNT groupé ⇒ un seul entier renvoyé.
    const above = await this.prisma.$queryRaw<{ above: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS "above" FROM (
        SELECT "userId"
        FROM ${table}
        WHERE ${where}
        GROUP BY "userId"
        HAVING COUNT(*) > ${myScore}
            OR (COUNT(*) = ${myScore} AND MAX("createdAt") < ${myLastAt})
      ) t
    `);
    return { rank: (above[0]?.above ?? 0) + 1, score: myScore };
  }
}
