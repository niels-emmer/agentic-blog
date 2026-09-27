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
// Hard ceiling on tracked windows so a flood of distinct keys (spoofed
// X-Forwarded-For behind a misconfigured proxy, or a large botnet) cannot
// grow the map without bound. Oldest entries are evicted first.
const MAX_WINDOWS = 10_000;

interface Window {
  count: number;
  resetAt: number;
  max: number;
  windowMs: number;
}

const windows = new Map<string, Window>();

function prune(): void {
  const now = Date.now();
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
  // Evict oldest entries beyond the cap (Map preserves insertion order).
  while (windows.size > MAX_WINDOWS) {
    const oldest = windows.keys().next().value;
    if (oldest === undefined) break;
    windows.delete(oldest);
  }
}

/**
 * Returns null if the request is within the limit, or a 429 response with a
 * Retry-After header if it is being throttled.
 *
 * `opts` allows a stricter per-endpoint limit (e.g. the public feedback
 * submission endpoint). The window is keyed by (key, max, windowMs), so a
 * strict endpoint's bucket can never be primed away by a laxer one sharing
 * the same client key.
 */
export function checkRateLimit(
  key: string,
  opts?: { max?: number; windowMs?: number },
): { limited: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const max = opts?.max ?? MAX_REQUESTS_PER_WINDOW;
  const windowMs = opts?.windowMs ?? WINDOW_MS;
  const windowKey = `${key}|${max}|${windowMs}`;
  const window = windows.get(windowKey);

  if (!window || window.resetAt <= now) {
    windows.set(windowKey, { count: 1, resetAt: now + windowMs, max, windowMs });
    return { limited: false, retryAfterSeconds: 0 };
  }

  window.count += 1;
  if (window.count > window.max) {
    const retryAfterSeconds = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
    return { limited: true, retryAfterSeconds };
  }
  return { limited: false, retryAfterSeconds: 0 };
}

/**
 * Client key for rate limiting.
 *
 * `X-Forwarded-For` is client-spoofable, so it is only trusted when the app
 * sits behind a reverse proxy that sets it (set `TRUST_PROXY=1`). When
 * trusted, the LAST hop is used: a proxy that forwards with
 * `$proxy_add_x_forwarded_for` APPENDS the real client address to any
 * client-supplied value, so the last hop is the trusted address and the
 * earlier hops are attacker-controlled (a spoofed first hop would grant a
 * fresh budget per request). Without TRUST_PROXY we key on `x-real-ip` —
 * Next.js sets it to the socket address, which a client cannot forge.
 */
export function clientKey(request: Request): string {
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) {
      const hops = forwarded.split(',').map((h) => h.trim()).filter(Boolean);
      const last = hops[hops.length - 1];
      if (last) return last;
    }
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}

// Keep the map from growing unboundedly across long-running processes.
setInterval(prune, WINDOW_MS).unref();

// TRUST_PROXY=1 keys rate limits on the last X-Forwarded-For hop. That is
// only sound when the app is reachable exclusively through a proxy that
// appends the real client address; direct exposure would let a client send a
// fresh header per request and get an unlimited budget. Warn loudly so a
// misconfiguration is visible.
if (process.env.TRUST_PROXY === '1') {
  console.warn(
    '[rate-limit] TRUST_PROXY=1: rate limits key on the last X-Forwarded-For hop. ' +
      'Verify the app is ONLY reachable through the proxy — direct exposure voids per-IP limits.',
  );
}