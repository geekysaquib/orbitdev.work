/**
 * A single-value async cache with TTL and in-flight deduplication.
 *
 * The dedupe is the point: without it, a prefetch and a user action firing at the
 * same moment both start the same expensive gather. Callers that arrive mid-flight
 * join the existing promise instead of starting a second one.
 *
 * On failure the previous value is kept rather than cleared — stale data beats no
 * data for a snapshot that's only used to ground a prompt.
 */
export interface TtlCache<T> {
  get(): Promise<T>;
  invalidate(): void;
  /** ms since the cached value was stored, or null if there isn't one. */
  age(): number | null;
}

export function ttlCache<T>(ttlMs: number, load: () => Promise<T>): TtlCache<T> {
  let value: T | undefined;
  let at = 0;
  let has = false;
  let inflight: Promise<T> | null = null;

  return {
    get() {
      if (inflight) return inflight;
      if (has && Date.now() - at < ttlMs) return Promise.resolve(value as T);
      inflight = load()
        .then((v) => { value = v; at = Date.now(); has = true; return v; })
        .finally(() => { inflight = null; });
      return inflight;
    },
    invalidate() { has = false; },
    age() { return has ? Date.now() - at : null; },
  };
}
