const API_BASE = '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// The access token cookie lives 15 minutes; the refresh token 30 days. These
// must never themselves trigger a refresh-and-retry (that would either loop
// or refresh mid-login/mid-logout for no reason).
const AUTH_PATHS = ['/auth/refresh', '/auth/login', '/auth/signup', '/auth/logout', '/auth/2fa/verify-login'];

// Fired once a refresh attempt itself fails — the session is genuinely over
// (refresh token expired/revoked/absent), not just the short-lived access
// token. AuthContext listens for this to clear the user and redirect with a
// visible message, instead of every open page failing silently one by one.
export const SESSION_EXPIRED_EVENT = 'saveboxd:session-expired';

// Refresh tokens rotate (single-use): two requests 401-ing at the same
// moment must share ONE refresh call, or the second would consume an
// already-spent token and fail. `refreshing` de-dupes concurrent callers.
let refreshing: Promise<unknown | null> | null = null;

// POSTs /auth/refresh directly (bypassing apiFetch's own 401 handling — this
// IS that handling) and returns the refreshed user, or null if the refresh
// token is itself invalid/expired. Also used by AuthContext on mount, so a
// page reload after the 15-minute access token lapsed doesn't look like a
// logout while a valid 30-day refresh token is still sitting in the cookies.
export function refreshSession<T = unknown>(): Promise<T | null> {
  if (!refreshing) {
    refreshing = fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing as Promise<T | null>;
}

// Same-origin via nginx (frontend + backend share https://localhost:8443), so
// cookies just work with `credentials: 'include'` — no CORS/tokens needed.
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  _retried = false,
): Promise<T> {
  const isFormData = options.body instanceof FormData;

  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });

  if (res.status === 401 && !_retried && !AUTH_PATHS.includes(path)) {
    if (await refreshSession()) return apiFetch<T>(path, options, true);
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = Array.isArray(data?.message) ? data.message.join(', ') : (data?.message ?? res.statusText);
    throw new ApiError(res.status, message);
  }
  return data as T;
}
