import { Response } from 'express';
import { TokenPair } from './auth.service';

export const REFRESH_COOKIE_PATH = '/api/auth';

// Shared by AuthController (local/42/Google) and SteamAuthController so every
// login path issues identical cookies.
// Browser only ever talks to nginx over HTTPS in this stack — cookies are always Secure.
export function setAuthCookies(res: Response, tokens: TokenPair): void {
  res.cookie('access_token', tokens.accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: tokens.accessTtlMs,
  });
  res.cookie('refresh_token', tokens.refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: tokens.refreshTtlMs,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie('access_token', { path: '/' });
  res.clearCookie('refresh_token', { path: REFRESH_COOKIE_PATH });
}
