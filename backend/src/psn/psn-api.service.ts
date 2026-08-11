import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  exchangeAccessCodeForAuthTokens,
  exchangeNpssoForAccessCode,
  getUserFriendsAccountIds,
  getUserTitles,
  getUserTrophyProfileSummary,
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

// One Sony call the BROWSER must perform directly (see relay note below).
export interface PsnRelayCall {
  id: string;
  url: string;
  method: 'GET' | 'POST';
  body?: unknown;
}

// What the browser reports back after making a relay call: the raw HTTP
// status + parsed JSON body, so the backend can tell "private/unavailable"
// (non-2xx, or a Sony {error:...} envelope) from a real payload — the same
// distinction a server-side try/catch used to make.
export interface PsnRelayResult {
  id: string;
  ok: boolean;
  body: unknown;
}

// PSN has no public API and no open OAuth. "infinitebacklog" model: the backend
// holds ONE PSN session (a service NPSSO token, PSN_SERVICE_NPSSO) and reads the
// PUBLIC profiles users declare by their Online ID. No per-user token.
//
// RELAY NOTE: m.np.playstation.com sits behind an Akamai WAF that blocks
// datacenter/hosting IP ranges outright (403 "Access Denied", verified live
// against the VPS) — a request from OUR server never reaches Sony's app logic.
// ca.account.sony.com (the NPSSO -> access token exchange) is NOT blocked, so
// the service session below still lives server-side. But every actual data
// call (search, trophies) is instead described as a { url, method, body } spec
// here and executed by the USER'S OWN BROWSER (residential IP, never blocked —
// Sony's endpoints send `Access-Control-Allow-Origin: *`, verified live), which
// posts the raw JSON back for parsing. See PsnController's relay-prepare /
// relay-submit endpoints.
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

  // Access token handed to the browser for one relay round-trip. Only the
  // short-lived access token leaves the backend — never the refresh token or
  // the NPSSO itself.
  private async relayAuth(): Promise<{ accessToken: string; expiresInSeconds: number }> {
    const auth = await this.serviceAuth();
    return {
      accessToken: auth.accessToken,
      expiresInSeconds: Math.max(0, Math.floor((this.authExpiresAt - Date.now()) / 1000)),
    };
  }

  // Spec for the browser to search a public Online ID. Mirrors psn-api's
  // makeUniversalSearch (m.np.playstation.com/api/search/v1/universalSearch).
  async searchRelay(
    onlineId: string,
  ): Promise<{ accessToken: string; expiresInSeconds: number; call: PsnRelayCall }> {
    const { accessToken, expiresInSeconds } = await this.relayAuth();
    return {
      accessToken,
      expiresInSeconds,
      call: {
        id: 'search',
        url: 'https://m.np.playstation.com/api/search/v1/universalSearch',
        method: 'POST',
        body: { searchTerm: onlineId, domainRequests: [{ domain: 'SocialAllAccounts' }] },
      },
    };
  }

  // Specs for the browser to fetch an account's trophy titles + summary.
  // Mirrors psn-api's getUserTitles / getUserTrophyProfileSummary.
  async libraryRelay(
    accountId: string,
  ): Promise<{ accessToken: string; expiresInSeconds: number; calls: PsnRelayCall[] }> {
    const { accessToken, expiresInSeconds } = await this.relayAuth();
    const id = encodeURIComponent(accountId);
    return {
      accessToken,
      expiresInSeconds,
      calls: [
        {
          id: 'titles',
          url: `https://m.np.playstation.com/api/trophy/v1/users/${id}/trophyTitles?limit=800`,
          method: 'GET',
        },
        {
          id: 'summary',
          url: `https://m.np.playstation.com/api/trophy/v1/users/${id}/trophySummary`,
          method: 'GET',
        },
      ],
    };
  }

  // Turns the browser's raw search response into { accountId, onlineId, avatar
  // } — null when no exact match. Same matching logic the old server-side
  // resolveOnlineId() used.
  parseSearchResult(result: PsnRelayResult, onlineId: string): PsnAccount | null {
    if (!result.ok) return null;
    const res = result.body as {
      domainResponses?: { results?: { socialMetadata?: Record<string, unknown> }[] }[];
    };
    const wanted = onlineId.trim().toLowerCase();
    for (const domain of res.domainResponses ?? []) {
      for (const r of domain.results ?? []) {
        const meta = r.socialMetadata as
          | { onlineId?: string; accountId?: string; avatarUrl?: string }
          | undefined;
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

  // null when the titles aren't public (matches the old getTitles() contract).
  parseTitles(result: PsnRelayResult): TrophyTitle[] | null {
    if (!result.ok) return null;
    const res = result.body as { trophyTitles?: TrophyTitle[] };
    return res.trophyTitles ?? [];
  }

  // null when the summary isn't public (matches the old getTrophySummary()).
  parseTrophySummary(result: PsnRelayResult): PsnTrophySummary | null {
    if (!result.ok) return null;
    const s = result.body as {
      trophyLevel?: string | number;
      tier?: number;
      progress?: number;
      earnedTrophies?: TrophyCounts;
    };
    const level = Number(s.trophyLevel);
    return {
      level: Number.isFinite(level) ? level : 0,
      tier: s.tier ?? 0,
      progress: s.progress ?? 0,
      earned: s.earnedTrophies ?? { bronze: 0, silver: 0, gold: 0, platinum: 0 },
    };
  }

  // Direct server-side calls, kept for CompletionsService's hourly background
  // resync (backend/src/completions/completions.service.ts): there is no
  // browser to relay through outside an interactive request, so this cron
  // stays on the (blocked-in-prod, fine-in-dev) direct path — same behaviour
  // as before this file's relay split, not a regression. Interactive PSN
  // linking/library-sync no longer use these; see searchRelay/libraryRelay
  // above.
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
  // NOT relayed (yet): friend suggestions are a soft, non-gamified feature —
  // this quietly stays server-side and returns null in environments where
  // m.np.playstation.com is blocked, same as a private profile would.
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
