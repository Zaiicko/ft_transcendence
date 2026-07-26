import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const API_URL = 'https://api.steampowered.com';

export interface SteamOwnedGame {
  appid: number;
  name?: string;
  // Total playtime, in minutes
  playtime_forever: number;
  // Unix seconds du dernier lancement (0/absent si jamais lancé). Renvoyé par
  // GetOwnedGames — sert à dater le jeu dans le calendrier « joué ».
  rtime_last_played?: number;
}

export interface SteamAchievements {
  unlocked: number;
  total: number;
}

@Injectable()
export class SteamWebApiService {
  private readonly logger = new Logger(SteamWebApiService.name);

  constructor(private readonly config: ConfigService) {}

  private key(): string {
    const key = this.config.get<string>('STEAM_API_KEY');
    if (!key) {
      throw new ServiceUnavailableException(
        'Steam Web API key missing — set STEAM_API_KEY in .env (https://steamcommunity.com/dev/apikey)',
      );
    }
    return key;
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T | null> {
    const qs = new URLSearchParams({ key: this.key(), ...params });
    const res = await fetch(`${API_URL}/${path}?${qs}`);
    // Steam answers 401/403 when the target profile is private
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) {
      this.logger.warn(`Steam API ${path} failed (HTTP ${res.status})`);
      throw new ServiceUnavailableException(`Steam API request failed (HTTP ${res.status})`);
    }
    return res.json() as Promise<T>;
  }

  // null = private profile ("game details" visibility must be public)
  async getOwnedGames(steamId: string): Promise<SteamOwnedGame[] | null> {
    const data = await this.get<{ response?: { games?: SteamOwnedGame[] } }>(
      'IPlayerService/GetOwnedGames/v1/',
      { steamid: steamId, include_appinfo: '1', include_played_free_games: '1' },
    );
    if (data === null) return null;
    // An empty response object (no games field) also means a private profile
    return data.response?.games ?? null;
  }

  // null = private friend list
  async getFriendIds(steamId: string): Promise<string[] | null> {
    const data = await this.get<{ friendslist?: { friends?: { steamid: string }[] } }>(
      'ISteamUser/GetFriendList/v1/',
      { steamid: steamId, relationship: 'friend' },
    );
    if (data === null) return null;
    return data.friendslist?.friends?.map((f) => f.steamid) ?? [];
  }

  // Achievements du joueur pour un jeu donné. null = le jeu n'a pas de succès,
  // le profil est privé, ou l'app n'a pas de stats. Résilient (aucune exception
  // remontée) car il est appelé en masse, un appel par jeu — un jeu qui
  // échoue ne doit pas casser toute la bibliothèque.
  async getPlayerAchievements(steamId: string, appId: number): Promise<SteamAchievements | null> {
    try {
      const qs = new URLSearchParams({ key: this.key(), steamid: steamId, appid: String(appId) });
      const res = await fetch(
        `${API_URL}/ISteamUserStats/GetPlayerAchievements/v1/?${qs}`,
      );
      if (!res.ok) return null; // 400 = pas de stats, 403 = privé
      const data = (await res.json()) as {
        playerstats?: { success?: boolean; achievements?: { achieved: number }[] };
      };
      const stats = data.playerstats;
      if (!stats?.success || !stats.achievements?.length) return null;
      return {
        unlocked: stats.achievements.filter((a) => a.achieved === 1).length,
        total: stats.achievements.length,
      };
    } catch {
      return null;
    }
  }

  async getPersonaName(steamId: string): Promise<string | null> {
    const data = await this.get<{ response?: { players?: { personaname?: string }[] } }>(
      'ISteamUser/GetPlayerSummaries/v2/',
      { steamids: steamId },
    );
    return data?.response?.players?.[0]?.personaname ?? null;
  }

  // `avatarfull` is the 184x184 profile picture on Steam's public CDN — always
  // available (Steam serves a default avatar even for accounts without one)
  async getAvatarUrl(steamId: string): Promise<string | null> {
    const data = await this.get<{ response?: { players?: { avatarfull?: string }[] } }>(
      'ISteamUser/GetPlayerSummaries/v2/',
      { steamids: steamId },
    );
    return data?.response?.players?.[0]?.avatarfull ?? null;
  }
}
