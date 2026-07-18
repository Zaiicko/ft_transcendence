import { Injectable, Logger } from '@nestjs/common';

// Steam's "Sign in through Steam" is OpenID 2.0 (not OAuth). The whole flow
// is two steps, implemented by hand — no extra dependency, easy to explain:
//  1. redirect the browser to Steam with our return URL,
//  2. when Steam redirects back, POST the received params back to Steam with
//     mode=check_authentication — Steam answers is_valid:true if (and only
//     if) it really signed them. The steamId sits in openid.claimed_id.
const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';
const CLAIMED_ID_RE = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

@Injectable()
export class SteamOpenidService {
  private readonly logger = new Logger(SteamOpenidService.name);

  buildLoginUrl(returnTo: string, realm: string): string {
    const params = new URLSearchParams({
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'checkid_setup',
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.return_to': returnTo,
      'openid.realm': realm,
    });
    return `${STEAM_OPENID_URL}?${params}`;
  }

  // Returns the verified 17-digit steamId, or null if the assertion is
  // invalid/forged.
  async verifyAssertion(query: Record<string, unknown>): Promise<string | null> {
    if (query['openid.mode'] !== 'id_res') return null;

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (key.startsWith('openid.') && typeof value === 'string') {
        params.set(key, value);
      }
    }
    params.set('openid.mode', 'check_authentication');

    const res = await fetch(STEAM_OPENID_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    if (!res.ok) {
      this.logger.warn(`Steam OpenID verification failed (HTTP ${res.status})`);
      return null;
    }
    const body = await res.text();
    if (!/is_valid\s*:\s*true/.test(body)) return null;

    const claimedId = query['openid.claimed_id'];
    const match = typeof claimedId === 'string' ? CLAIMED_ID_RE.exec(claimedId) : null;
    return match ? match[1] : null;
  }
}
