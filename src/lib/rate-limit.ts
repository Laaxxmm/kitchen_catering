// In-memory sliding-window rate limiter. Stateless across restarts (which
// is fine — a brute-force attacker doesn't get magically reset by a
// container restart any more than they would on a normal request). For
// small Railway deploys with a single instance this works as-is. If we
// ever scale horizontally, swap the Map for Redis.

const buckets = new Map<string, number[]>();

// Bound the map so a creative attacker spraying random keys can't grow
// memory unbounded. We sweep entries older than the longest window any
// caller is using; in practice all our windows are ≤ 60s.
const SWEEP_INTERVAL_MS = 60_000;
let lastSweepAt = 0;

function sweep(now: number) {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  const cutoff = now - 60_000; // anything older than 60s is dead for any caller
  for (const [k, arr] of buckets) {
    const fresh = arr.filter((t) => t > cutoff);
    if (fresh.length === 0) buckets.delete(k);
    else if (fresh.length !== arr.length) buckets.set(k, fresh);
  }
}

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterMs: number };

/**
 * Checks a sliding-window limit and records this attempt if allowed.
 * Returns `allowed: false` with `retryAfterMs` when the caller should back off.
 *
 * @param key   Identity to rate-limit on (email | ip | deviceId).
 *              Use distinct prefixes for distinct limiters: "login:email:foo@bar".
 * @param limit Max attempts in the window.
 * @param windowMs Window length in milliseconds.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const cutoff = now - windowMs;
  const existing = buckets.get(key) ?? [];
  // Drop timestamps outside the window.
  const fresh = existing.filter((t) => t > cutoff);

  if (fresh.length >= limit) {
    // Time until the oldest in-window attempt rolls off.
    const oldest = fresh[0];
    return { allowed: false, retryAfterMs: oldest + windowMs - now };
  }

  fresh.push(now);
  buckets.set(key, fresh);
  return { allowed: true, remaining: limit - fresh.length };
}

/**
 * Best-effort client IP from a NextRequest / Request. Returns "unknown"
 * when no x-forwarded-for is present (all unknown-IP traffic shares one
 * bucket — that's fine as a defensive fallback, not the primary key).
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

// --- test helper: not part of the public API. Lets unit tests reset state. ---
export function _resetForTests() {
  buckets.clear();
  lastSweepAt = 0;
}
