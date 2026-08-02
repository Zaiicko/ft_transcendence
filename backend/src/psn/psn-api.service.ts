import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  exchangeAccessCodeForAuthTokens,
  exchangeNpssoForAccessCode,
  getUserFriendsAccountIds,
  getUserTitles,
  getUserTrophyProfileSummary,
  makeUniversalSearch,
  type AuthorizationPayload,
  type TrophyCounts,
  type TrophyTitle,
} from 'psn-api';

export interface PsnAccount {
  accountId: string;
  onlineId: string;
  avatarUrl: string | null;
}

export interface PsnTrophySummary {
  level: number;
  tier: number;
  progress: number; // % vers le niveau suivant
  earned: TrophyCounts; // { bronze, silver, gold, platinum }
}

// PSN has no public API and no open OAuth. "infinitebacklog" model: the backend
// holds ONE PSN session (a service NPSSO token, PSN_SERVICE_NPSSO) and reads the
// PUBLIC profiles users declare by their Online ID. No per-user token.
@Injectable()
export class PsnApiService {
  private readonly logger = new Logger(PsnApiService.name);

  // Cached service authorization and its deadline (access tokens last ~1h). The
  // NPSSO is simply re-exchanged on expiry; it stays valid ~2 months.
  private auth: AuthorizationPayload | null = null;
  private authExpiresAt = 0;

  constructor(private readonly config: ConfigService) {}

  private npsso(): string {
    const npsso = this.config.get<string>('PSN_SERVICE_NPSSO');
    if (!npsso) {
      throw new ServiceUnavailableException(
        'PlayStation non configuré — PSN_SERVICE_NPSSO manquant dans .env',
      );
    }
    return npsso;
  }

  // A valid service authorization, from cache or by re-exchanging the NPSSO.
  // An expired NPSSO yields 503, prompting a server-side regeneration.
  private async serviceAuth(): Promise<AuthorizationPayload> {
    if (this.auth && Date.now() < this.authExpiresAt) return this.auth;
    // Outside the try: the "not configured" 503 must surface with its own
    // message instead of being swallowed by the generic catch below.
    const npsso = this.npsso();
    try {
      const accessCode = await exchangeNpssoForAccessCode(npsso);
      const auth = await exchangeAccessCodeForAuthTokens(accessCode);
      this.auth = auth;
      // 60s margin so a token on the edge of expiry is never used
      this.authExpiresAt = Date.now() + Math.max(0, (auth.expiresIn - 60) * 1000);
      return auth;
    } catch (e) {
      this.auth = null;
      this.authExpiresAt = 0;
      this.logger.error(`Session PSN service indisponible: ${e instanceof Error ? e.message : e}`);
      throw new ServiceUnavailableException(
        'Session PlayStation service indisponible — le jeton NPSSO service est peut-être expiré',
      );
    }
  }

  // Resolves a public PSN Online ID to { accountId, onlineId, avatar }.
  // null when no account matches exactly.
  async resolveOnlineId(onlineId: string): Promise<PsnAccount | null> {
    const auth = await this.serviceAuth();
    let res;
    try {
      res = await makeUniversalSearch(auth, onlineId, 'SocialAllAccounts');
    } catch (e) {
      this.logger.warn(`Recherche PSN échouée: ${e instanceof Error ? e.message : e}`);
      throw new ServiceUnavailableException('Recherche PlayStation indisponible');
    }

    const wanted = onlineId.trim().toLowerCase();
    for (const domain of res.domainResponses ?? []) {
      for (const result of domain.results ?? []) {
        const meta = result.socialMetadata;
        if (meta?.onlineId?.toLowerCase() === wanted && meta.accountId) {
          return {
            accountId: meta.accountId,
            onlineId: meta.onlineId,
            avatarUrl: meta.avatarUrl || null,
          };
        }
      }
    }
    return null;
  }

  // An account's played trophy titles, most recently unlocked first.
  // null when the games/trophies aren't public.
  async getTitles(accountId: string): Promise<TrophyTitle[] | null> {
    const auth = await this.serviceAuth();
    try {
      const res = await getUserTitles(auth, accountId, { limit: 800 });
      return res.trophyTitles ?? [];
    } catch (e) {
      this.logger.warn(`getUserTitles(${accountId}) échoué (profil privé ?): ${this.msg(e)}`);
      return null;
    }
  }

  // Trophy summary (level, tier, progress, counts per grade). null when private.
  async getTrophySummary(accountId: string): Promise<PsnTrophySummary | null> {
    const auth = await this.serviceAuth();
    try {
      const s = await getUserTrophyProfileSummary(auth, accountId);
      const level = Number(s.trophyLevel);
      return {
        level: Number.isFinite(level) ? level : 0,
        tier: s.tier,
        progress: s.progress,
        earned: s.earnedTrophies,
      };
    } catch (e) {
      this.logger.warn(`getUserTrophyProfileSummary(${accountId}) échoué: ${this.msg(e)}`);
      return null;
    }
  }

  // accountIds of an account's PSN friends. null when the list isn't public.
  async getFriendAccountIds(accountId: string): Promise<string[] | null> {
    const auth = await this.serviceAuth();
    try {
      const res = await getUserFriendsAccountIds(auth, accountId, { limit: 1000 });
      return res.friends ?? [];
    } catch (e) {
      this.logger.warn(`getUserFriendsAccountIds(${accountId}) échoué: ${this.msg(e)}`);
      return null;
    }
  }

  private msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}
