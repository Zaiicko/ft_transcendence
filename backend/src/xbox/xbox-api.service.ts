import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const OPENXBL_URL = 'https://xbl.io/api/v2';

export interface XboxAccount {
  xuid: string;
  gamertag: string;
  avatarUrl: string | null;
  gamerscore: number;
}

// Un jeu joué côté Xbox : identité + progression de succès (Gamerscore, le
// pendant des trophées PSN). `lastPlayed` sert au tri.
export interface XboxTitle {
  name: string;
  currentGamerscore: number;
  totalGamerscore: number;
  currentAchievements: number;
  totalAchievements: number;
  progress: number; // % de succès obtenus
  lastPlayed: string | null;
}

// Formes brutes (partielles) renvoyées par OpenXBL — on ne type que ce qu'on lit.
interface OpenXblPerson {
  xuid?: string;
  gamertag?: string;
  displayPicRaw?: string;
  gamerScore?: string;
}
// OpenXBL enveloppe toutes ses réponses dans `content`.
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

// Fonctionnalités liées au compte Xbox via OpenXBL (xbl.io). Modèle à clé
// service unique (XBL_API_KEY, le pendant du PSN_SERVICE_NPSSO) : les
// utilisateurs déclarent leur gamertag public, le backend le résout en XUID et
// lit leurs jeux/succès publics. Aucun jeton par utilisateur. Miroir de
// PsnApiService.
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
    // 404/403 : le profil existe peut-être mais n'est pas lisible (privé) — on
    // laisse l'appelant décider ; on ne parse le corps que sur succès.
    const data = res.ok ? ((await res.json()) as T) : null;
    return { ok: res.ok, status: res.status, data };
  }

  // Résout un gamertag (pseudo public) en compte { xuid, gamertag, avatar,
  // gamerscore }. Renvoie null si aucun compte ne correspond exactement.
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

  // Jeux joués (avec succès) d'un XUID, triés par déblocage récent côté appelant.
  // null = profil dont l'historique de jeux/succès n'est pas public.
  async getTitles(xuid: string): Promise<XboxTitle[] | null> {
    let res;
    try {
      res = await this.request<OpenXblTitles>(`/achievements/player/${encodeURIComponent(xuid)}`);
    } catch (e) {
      this.logger.warn(`getTitles(${xuid}) échoué: ${this.msg(e)}`);
      return null;
    }
    // 403 = historique privé ; autre erreur = on renvoie null (pas de biblio).
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

  // Gamerscore officiel du profil (celui affiché sur Xbox). Différent de la
  // somme des titres renvoyés par getTitles, qui plafonne à ~1000 titres.
  // null si indisponible.
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
