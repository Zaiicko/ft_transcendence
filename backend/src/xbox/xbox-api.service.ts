import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const OPENXBL_URL = 'https://xbl.io/api/v2';

export interface XboxAccount {
  xuid: string;
  gamertag: string;
  avatarUrl: string | null;
  gamerscore: number;
}

// A game played on Xbox: identity plus achievement progress (Gamerscore, the
// counterpart of PSN trophies). `lastPlayed` drives the sort.
export interface XboxTitle {
  name: string;
  currentGamerscore: number;
  totalGamerscore: number;
  currentAchievements: number;
  totalAchievements: number;
  progress: number; // % of achievements earned
  lastPlayed: string | null;
}

// Partial shapes returned by OpenXBL: only what we actually read is typed.
interface OpenXblPerson {
  xuid?: string;
  gamertag?: string;
  displayPicRaw?: string;
  gamerScore?: string;
}
// OpenXBL wraps every response in `content`.
interface OpenXblSearch {
  content?: { people?: OpenXblPerson[] };
}
interface OpenXblAchievement {
  currentAchievements?: number;
  totalAchievements?: number;
  currentGamerscore?: number;
  totalGamerscore?: number;
  progressPercentage?: number;
}
interface OpenXblTitle {
  name?: string;
  achievement?: OpenXblAchievement;
  titleHistory?: { lastTimePlayed?: string };
}
interface OpenXblTitles {
  content?: { titles?: OpenXblTitle[] };
}
interface OpenXblAccount {
  content?: { profileUsers?: { settings?: { id?: string; value?: string }[] }[] };
}

// Xbox account features through OpenXBL (xbl.io). Single service-key model
// (XBL_API_KEY, the counterpart of PSN_SERVICE_NPSSO): users declare their
// public gamertag, the backend resolves it to a XUID and reads their public
// games and achievements. No per-user token. Mirrors PsnApiService.
@Injectable()
export class XboxApiService {
  private readonly logger = new Logger(XboxApiService.name);

  constructor(private readonly config: ConfigService) {}

  private apiKey(): string {
    const key = this.config.get<string>('XBL_API_KEY');
    if (!key) {
      throw new ServiceUnavailableException(
        'Xbox non configuré — XBL_API_KEY manquant dans .env',
      );
    }
    return key;
  }

  private async request<T>(path: string): Promise<{ ok: boolean; status: number; data: T | null }> {
    const res = await fetch(`${OPENXBL_URL}${path}`, {
      headers: {
        'X-Authorization': this.apiKey(),
        Accept: 'application/json',
        'Accept-Language': 'en-US',
      },
    });
    // 404/403: the profile may exist but be unreadable (private). The caller
    // decides; the body is only parsed on success.
    const data = res.ok ? ((await res.json()) as T) : null;
    return { ok: res.ok, status: res.status, data };
  }

  // Resolves a public gamertag to { xuid, gamertag, avatar, gamerscore }.
  // null when no account matches exactly.
  async resolveGamertag(gamertag: string): Promise<XboxAccount | null> {
    const wanted = gamertag.trim().toLowerCase();
    let res;
    try {
      res = await this.request<OpenXblSearch>(`/search/${encodeURIComponent(gamertag.trim())}`);
    } catch (e) {
      this.logger.warn(`Recherche Xbox échouée: ${this.msg(e)}`);
      throw new ServiceUnavailableException('Recherche Xbox indisponible');
    }
    if (!res.ok) {
      if (res.status === 404) return null;
      this.logger.warn(`Recherche Xbox a renvoyé ${res.status}`);
      throw new ServiceUnavailableException('Recherche Xbox indisponible');
    }

    for (const person of res.data?.content?.people ?? []) {
      if (person.gamertag?.toLowerCase() === wanted && person.xuid) {
        const gamerscore = Number(person.gamerScore);
        return {
          xuid: person.xuid,
          gamertag: person.gamertag,
          avatarUrl: person.displayPicRaw || null,
          gamerscore: Number.isFinite(gamerscore) ? gamerscore : 0,
        };
      }
    }
    return null;
  }

  // A XUID's played games with achievements, sorted by the caller.
  // null when the game/achievement history isn't public.
  async getTitles(xuid: string): Promise<XboxTitle[] | null> {
    let res;
    try {
      res = await this.request<OpenXblTitles>(`/achievements/player/${encodeURIComponent(xuid)}`);
    } catch (e) {
      this.logger.warn(`getTitles(${xuid}) échoué: ${this.msg(e)}`);
      return null;
    }
    // 403 means a private history; any other error also yields null.
    if (!res.ok) {
      this.logger.warn(`getTitles(${xuid}) a renvoyé ${res.status} (profil privé ?)`);
      return null;
    }

    return (res.data?.content?.titles ?? [])
      .filter((t) => t.name)
      .map((t) => {
        const a = t.achievement ?? {};
        return {
          name: t.name!,
          currentGamerscore: a.currentGamerscore ?? 0,
          totalGamerscore: a.totalGamerscore ?? 0,
          currentAchievements: a.currentAchievements ?? 0,
          totalAchievements: a.totalAchievements ?? 0,
          progress: a.progressPercentage ?? 0,
          lastPlayed: t.titleHistory?.lastTimePlayed ?? null,
        };
      });
  }

  // Official profile Gamerscore, as shown on Xbox. Differs from summing
  // getTitles, which caps at ~1000 titles. null when unavailable.
  async getGamerscore(xuid: string): Promise<number | null> {
    let res;
    try {
      res = await this.request<OpenXblAccount>(`/account/${encodeURIComponent(xuid)}`);
    } catch (e) {
      this.logger.warn(`getGamerscore(${xuid}) échoué: ${this.msg(e)}`);
      return null;
    }
    if (!res.ok) return null;
    const settings = res.data?.content?.profileUsers?.[0]?.settings ?? [];
    const gs = Number(settings.find((s) => s.id === 'Gamerscore')?.value);
    return Number.isFinite(gs) ? gs : null;
  }

  private msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}
