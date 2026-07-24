import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { withMailLog, maskEmail, newCorrelationId, getMailMetrics, _resetMailMetricsForTests } from "./mailLog";

describe("maskEmail", () => {
  it("masks the local part, keeps the domain", () => {
    expect(maskEmail("alice@example.com")).toBe("a****@example.com");
  });
  it("leaves input without an @ unchanged", () => {
    expect(maskEmail("not-an-email")).toBe("not-an-email");
  });
});

describe("newCorrelationId", () => {
  it("produces distinct ids", () => {
    const ids = new Set(Array.from({ length: 20 }, () => newCorrelationId()));
    expect(ids.size).toBe(20);
  });
});

describe("withMailLog", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetMailMetricsForTests();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("returns the wrapped send's result and counts it as sent", async () => {
    const result = await withMailLog("verify", "a@example.com", async () => "ok");
    expect(result).toBe("ok");
    expect(getMailMetrics().verify).toEqual({ sent: 1, failed: 0 });
  });

  it("rethrows the wrapped send's error and counts it as failed", async () => {
    await expect(withMailLog("verify", "a@example.com", async () => { throw new Error("smtp down"); })).rejects.toThrow("smtp down");
    expect(getMailMetrics().verify).toEqual({ sent: 0, failed: 1 });
  });

  it("keeps separate counters per kind", async () => {
    await withMailLog("verify", "a@example.com", async () => "ok");
    await withMailLog("team_invite", "b@example.com", async () => "ok");
    const m = getMailMetrics();
    expect(m.verify.sent).toBe(1);
    expect(m.team_invite.sent).toBe(1);
  });

  it("logs a structured attempt + sent line with a correlation id and masked recipient", async () => {
    await withMailLog("verify", "alice@example.com", async () => "ok");
    const calls = logSpy.mock.calls.filter((c: unknown[]) => c[0] === "[mail]");
    expect(calls).toHaveLength(2);
    const attempt = JSON.parse(calls[0][1] as string);
    const sent = JSON.parse(calls[1][1] as string);
    expect(attempt).toMatchObject({ event: "attempt", kind: "verify", to: "a****@example.com" });
    expect(sent).toMatchObject({ event: "sent", kind: "verify", to: "a****@example.com" });
    expect(sent.correlationId).toBe(attempt.correlationId);
    expect(typeof sent.durationMs).toBe("number");
  });

  it("logs a structured failed line via console.error", async () => {
    await withMailLog("verify", "alice@example.com", async () => { throw new Error("boom"); }).catch(() => {});
    const calls = errorSpy.mock.calls.filter((c: unknown[]) => c[0] === "[mail]");
    expect(calls).toHaveLength(1);
    const failed = JSON.parse(calls[0][1] as string);
    expect(failed).toMatchObject({ event: "failed", kind: "verify", to: "a****@example.com", error: "boom" });
  });
});
