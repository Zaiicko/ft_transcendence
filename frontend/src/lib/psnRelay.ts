// Runs PlayStation Network API calls directly from the browser instead of the
// backend. Sony's Akamai WAF blocks datacenter/VPS IPs outright (verified: a
// server-side request gets a 403 "Access Denied" before Sony's app logic even
// sees it), but the API sends permissive CORS headers (`Access-Control-Allow-
// Origin: *`), so the user's own residential IP reaches it fine. The backend
// hands over a short-lived access token + the exact calls to make; this file
// makes them and reports the raw results back for the backend to parse and
// store, exactly as if it had fetched them itself.
export interface PsnRelayCall {
  id: string;
  url: string;
  method: 'GET' | 'POST';
  body?: unknown;
}

export interface PsnRelayResult {
  id: string;
  ok: boolean;
  body: unknown;
}

export async function runPsnRelay(
  calls: PsnRelayCall[],
  accessToken: string,
): Promise<PsnRelayResult[]> {
  return Promise.all(
    calls.map(async (call): Promise<PsnRelayResult> => {
      try {
        const res = await fetch(call.url, {
          method: call.method,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(call.body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: call.body ? JSON.stringify(call.body) : undefined,
        });
        const body = await res.json().catch(() => null);
        return { id: call.id, ok: res.ok, body };
      } catch {
        return { id: call.id, ok: false, body: null };
      }
    }),
  );
}
