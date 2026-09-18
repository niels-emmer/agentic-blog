/**
 * Minimal in-memory fixed-window rate limiter for the content API.
 *
 * Suitable for a single-container deployment (the VPS runs one instance).
 * Per-process state: limits reset on restart, which is acceptable for this
 * threat model. For multi-instance deployments, move this to the reverse
 * proxy (nginx) instead.
 */

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 120;

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

function prune(): void {
  const now = Date.now();
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

/**
 * Returns null if the request is within the limit, or a 429 response with a
 * Retry-After header if it is being throttled.
 */
export function checkRateLimit(key: string): { limited: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const window = windows.get(key);

  if (!window || window.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { limited: false, retryAfterSeconds: 0 };
  }

  window.count += 1;
  if (window.count > MAX_REQUESTS_PER_WINDOW) {
    const retryAfterSeconds = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
    return { limited: true, retryAfterSeconds };
  }
  return { limited: false, retryAfterSeconds: 0 };
}

/**
 * Client key for rate limiting.
 *
 * `X-Forwarded-For` is client-spoofable, so it is only trusted when the app
 * sits behind a reverse proxy that sets it (set `TRUST_PROXY=1`). Without
 * that flag we key on `x-real-ip` — Next.js sets it to the socket address,
 * which a client cannot forge. Behind a proxy without TRUST_PROXY, all
 * proxied clients share one bucket (conservative, never a bypass).
 */
export function clientKey(request: Request): string {
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) {
      const first = forwarded.split(',')[0]?.trim();
      if (first) return first;
    }
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}

// Keep the map from growing unboundedly across long-running processes.
setInterval(prune, WINDOW_MS).unref();