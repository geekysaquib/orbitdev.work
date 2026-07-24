/**
 * Minimal in-memory rate limiter for Netlify Functions.
 *
 * No new infrastructure (no Redis/KV) — a Netlify Function container keeps
 * this module's state alive across warm invocations, which is enough to
 * blunt sustained abuse from a single client without a durable store. It is
 * explicitly NOT a hard, distributed guarantee: a cold start clears the map,
 * and concurrent/parallel warm instances each keep their own counters, so an
 * attacker spread across many instances sees a higher effective ceiling than
 * `max`. That's an accepted trade-off for a closed beta of ~20 teams, not a
 * substitute for a real gateway-level limiter if abuse at scale shows up
 * (RC2+ concern — see docs/architecture/rc1-release.md task 7).
 *
 * Existing higher-value targets (per-account login lockout in auth.ts,
 * per-email OTP caps in _lib/otp.ts) are already durable/DB-backed, which is
 * correct for those — this fills the remaining gap: endpoints with no
 * throttling at all.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Fixed-window counters are bounded by (active users x rate-limited
// endpoints), which is small for this app's scale — but cap the map so a
// pathological key-generation bug (e.g. keying on unvalidated user input)
// can't grow it unbounded across a long-lived warm container. Sweeping on
// every call would cost more than the problem it solves at this volume.
const MAX_BUCKETS = 5000;

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets, only meaningful when `allowed` is false. */
  retryAfterSec: number;
}

/**
 * Fixed-window limiter: at most `max` calls per `windowMs` for a given key.
 * Callers build the key (e.g. `${functionName}:${session.userId}` or
 * `${functionName}:${ip}`) so one shared map can serve every endpoint
 * without their counters colliding.
 */
export function rateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) buckets.clear();
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  if (bucket.count >= max) {
    return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

/** Test-only: clears all counters so tests don't leak state into each other. */
export function _resetRateLimitsForTests(): void {
  buckets.clear();
}
