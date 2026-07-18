import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const IGDB_API_URL = 'https://api.igdb.com/v4';

// Raw shape returned by our IGDB queries (subset of the real API)
export interface IgdbGame {
  id: number;
  name: string;
  summary?: string;
  first_release_date?: number;
  total_rating?: number;
  total_rating_count?: number;
  // IGDB game_type codes (successor of the deprecated "category"): 0 main,
  // 1 dlc, 2 expansion, 3 bundle, 4 standalone expansion, 5 mod, 8 remake,
  // 9 remaster, 11 port, ...
  game_type?: number;
  parent_game?: number;
  cover?: { image_id: string };
  screenshots?: { image_id: string }[];
  genres?: { id: number; name: string }[];
  platforms?: { id: number; name: string }[];
  involved_companies?: { company: { id: number; name: string } }[];
}

@Injectable()
export class IgdbService {
  private readonly logger = new Logger(IgdbService.name);
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly config: ConfigService) {}

  // fetch() can fail transiently (cold DNS, dropped connection) — one retry
  // after a short pause smooths it out without hiding real outages
  private async fetchWithRetry(
    url: string,
    init?: RequestInit,
  ): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch {
      await new Promise((r) => setTimeout(r, 500));
      return fetch(url, init);
    }
  }

  // Client-credentials token, cached until shortly before expiry
  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.token;
    }

    const clientId = this.config.get<string>('IGDB_CLIENT_ID');
    const clientSecret = this.config.get<string>('IGDB_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new ServiceUnavailableException(
        'IGDB credentials missing — set IGDB_CLIENT_ID and IGDB_CLIENT_SECRET in .env',
      );
    }

    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    });
    const res = await this.fetchWithRetry(`${TWITCH_TOKEN_URL}?${params}`, {
      method: 'POST',
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `Twitch token request failed (HTTP ${res.status})`,
      );
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
    return this.token;
  }

  // Raw APIcalypse query, e.g. query('games', 'fields name; limit 10;')
  async query<T>(endpoint: string, body: string): Promise<T[]> {
    const token = await this.getToken();
    const res = await this.fetchWithRetry(`${IGDB_API_URL}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Client-ID': this.config.get<string>('IGDB_CLIENT_ID')!,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      body,
    });
    if (!res.ok) {
      this.logger.error(
        `IGDB /${endpoint} failed (HTTP ${res.status}): ${await res.text()}`,
      );
      throw new ServiceUnavailableException(
        `IGDB request failed (HTTP ${res.status})`,
      );
    }
    return res.json() as Promise<T[]>;
  }

  // Max quality available on IGDB. The size token is part of the URL, so the
  // frontend can derive lighter variants for thumbnails by swapping it
  // (e.g. t_1080p -> t_screenshot_med, t_cover_big_2x -> t_cover_small).
  static coverUrl(imageId: string): string {
    return `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${imageId}.jpg`;
  }

  static screenshotUrl(imageId: string): string {
    return `https://images.igdb.com/igdb/image/upload/t_1080p/${imageId}.jpg`;
  }
}
