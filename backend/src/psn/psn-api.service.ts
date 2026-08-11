import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  exchangeAccessCodeForAuthTokens,
  exchangeNpssoForAccessCode,
  type AuthorizationPayload,
  type TrophyCounts,
  type TrophyTitle,
} from 'psn-api';
import { fetch, ProxyAgent } from 'undici';

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
//
// PROXY NOTE: m.np.playstation.com sits behind an Akamai WAF that blocks
// datacenter/hosting IP ranges outright (403 "Access Denied", verified live —
// our VPS never even reaches Sony's app logic). ca.account.sony.com (the
// NPSSO -> access token exchange, serviceAuth() below) is NOT blocked. So
// every call that actually reads PSN data goes through sonyFetch(), which
// routes through PSN_PROXY_URL (a residential proxy) when configured — with
// it unset (e.g. local dev, where the direct connection already works fine),
// it just calls Sony directly. This is why these 3 calls are hand-rolled
// instead of using the psn-api library's own request functions: they don't
// accept a custom dispatcher/agent, so there'd be no way to route only these
// through a proxy without it.
@Injectable()
export class PsnApiService {
  private readonly logger = new Logger(PsnApiService.name);

  // Cached service authorization and its deadline (access tokens last ~1h). The
  // NPSSO is simply re-exchanged on expiry; it stays valid ~2 months.
  private auth: AuthorizationPayload | null = null;
  private authExpiresAt = 0;

  // undefined = not resolved yet, null = no proxy configured. Built once.
  private agent: ProxyAgent | null | undefined;

  constructor(private readonly config: ConfigService) {}

  private proxyAgent(): ProxyAgent | undefined {
    if (this.agent === undefined) {
      const url = this.config.get<string>('PSN_PROXY_URL');
      this.agent = url ? new ProxyAgent(url) : null;
    }
    return this.agent ?? undefined;
  }

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

  // Authenticated call to a Sony endpoint, through the residential proxy when
  // configured. Throws on a non-2xx response (private profile vs a real
  // failure is sorted out by each caller's try/catch, same as before).
  //
  // Uses undici's OWN fetch, not Node's global one: Node's built-in fetch
  // bundles its own (older) internal copy of undici, and handing it a
  // ProxyAgent built from the npm undici package throws ("invalid
  // onRequestStart method") — the two copies' internal Dispatcher interfaces
  // don't match. Importing fetch from 'undici' alongside ProxyAgent keeps
  // both on the same version, verified live against the proxy.
  private async sonyFetch<T>(url: string, body?: unknown): Promise<T> {
    const auth = await this.serviceAuth();
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      dispatcher: this.proxyAgent(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<T>;
  }

  // Resolves a public PSN Online ID to { accountId, onlineId, avatar }.
  // null when no account matches exactly.
  async resolveOnlineId(onlineId: string): Promise<PsnAccount | null> {
    let res: {
      domainResponses?: { results?: { socialMetadata?: Record<string, unknown> }[] }[];
    };
    try {
      res = await this.sonyFetch('https://m.np.playstation.com/api/search/v1/universalSearch', {
        searchTerm: onlineId,
        domainRequests: [{ domain: 'SocialAllAccounts' }],
      });
    } catch (e) {
      this.logger.warn(`Recherche PSN échouée: ${this.msg(e)}`);
      throw new ServiceUnavailableException('Recherche PlayStation indisponible');
    }

    const wanted = onlineId.trim().toLowerCase();
    for (const domain of res.domainResponses ?? []) {
      for (const result of domain.results ?? []) {
        const meta = result.socialMetadata as
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

  // An account's played trophy titles, most recently unlocked first.
  // null when the games/trophies aren't public.
  async getTitles(accountId: string): Promise<TrophyTitle[] | null> {
    try {
      const id = encodeURIComponent(accountId);
      const res = await this.sonyFetch<{ trophyTitles?: TrophyTitle[] }>(
        `https://m.np.playstation.com/api/trophy/v1/users/${id}/trophyTitles?limit=800`,
      );
      return res.trophyTitles ?? [];
    } catch (e) {
      this.logger.warn(`getUserTitles(${accountId}) échoué (profil privé ?): ${this.msg(e)}`);
      return null;
    }
  }

  // Trophy summary (level, tier, progress, counts per grade). null when private.
  async getTrophySummary(accountId: string): Promise<PsnTrophySummary | null> {
    try {
      const id = encodeURIComponent(accountId);
      const s = await this.sonyFetch<{
        trophyLevel?: string | number;
        tier?: number;
        progress?: number;
        earnedTrophies?: TrophyCounts;
      }>(`https://m.np.playstation.com/api/trophy/v1/users/${id}/trophySummary`);
      const level = Number(s.trophyLevel);
      return {
        level: Number.isFinite(level) ? level : 0,
        tier: s.tier ?? 0,
        progress: s.progress ?? 0,
        earned: s.earnedTrophies ?? { bronze: 0, silver: 0, gold: 0, platinum: 0 },
      };
    } catch (e) {
      this.logger.warn(`getUserTrophyProfileSummary(${accountId}) échoué: ${this.msg(e)}`);
      return null;
    }
  }

  // accountIds of an account's PSN friends. null when the list isn't public.
  async getFriendAccountIds(accountId: string): Promise<string[] | null> {
    try {
      const id = encodeURIComponent(accountId);
      const res = await this.sonyFetch<{ friends?: string[] }>(
        `https://m.np.playstation.com/api/userProfile/v1/internal/users/${id}/friends?limit=1000`,
      );
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
