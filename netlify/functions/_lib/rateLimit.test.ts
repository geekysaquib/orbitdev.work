import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { rateLimit, _resetRateLimitsForTests } from "./rateLimit";

describe("rateLimit", () => {
  beforeEach(() => {
    _resetRateLimitsForTests();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows calls under the limit", () => {
    expect(rateLimit("k", 3, 1000).allowed).toBe(true);
    expect(rateLimit("k", 3, 1000).allowed).toBe(true);
    expect(rateLimit("k", 3, 1000).allowed).toBe(true);
  });

  it("blocks once the limit is hit within the window", () => {
    rateLimit("k", 2, 1000);
    rateLimit("k", 2, 1000);
    const r = rateLimit("k", 2, 1000);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
  });

  it("resets once the window elapses", () => {
    rateLimit("k", 1, 1000);
    expect(rateLimit("k", 1, 1000).allowed).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(rateLimit("k", 1, 1000).allowed).toBe(true);
  });

  it("tracks separate keys independently", () => {
    rateLimit("a", 1, 1000);
    expect(rateLimit("a", 1, 1000).allowed).toBe(false);
    expect(rateLimit("b", 1, 1000).allowed).toBe(true);
  });
});
