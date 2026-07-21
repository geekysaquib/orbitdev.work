import { describe, it, expect, vi, beforeEach } from "vitest";

const orderMock = vi.fn();
vi.mock("./supabase", () => ({
  supabase: { from: () => ({ select: () => ({ gte: () => ({ order: (...args: unknown[]) => orderMock(...args) }) }) }) },
}));

const { computeFocusAnalytics } = await import("./focusAnalytics");

beforeEach(() => { orderMock.mockReset(); });

const iso = (d: Date) => d.toISOString();

describe("computeFocusAnalytics", () => {
  it("returns hasData:false with no events", async () => {
    orderMock.mockResolvedValue({ data: [], error: null });
    const r = await computeFocusAnalytics();
    expect(r.hasData).toBe(false);
    expect(r.totalInterruptions).toBe(0);
  });

  it("throws when the query errors", async () => {
    orderMock.mockResolvedValue({ data: null, error: { message: "nope" } });
    await expect(computeFocusAnalytics()).rejects.toThrow("nope");
  });

  it("pairs sequential idle/resume events into interruption duration", async () => {
    const day = new Date();
    day.setHours(10, 0, 0, 0);
    const idleAt = new Date(day.getTime());
    const resumeAt = new Date(day.getTime() + 5 * 60_000); // 5 min later
    orderMock.mockResolvedValue({
      data: [
        { type: "idle", at: iso(idleAt) },
        { type: "resume", at: iso(resumeAt) },
      ],
      error: null,
    });
    const r = await computeFocusAnalytics();
    expect(r.hasData).toBe(true);
    expect(r.totalInterruptions).toBe(1);
    expect(r.totalInterruptedMinutes).toBe(5);
    expect(r.peakInterruptedHour).toBe(idleAt.getHours());
  });

  it("counts route_change events per day without affecting interruption pairing", async () => {
    const day = new Date();
    orderMock.mockResolvedValue({
      data: [
        { type: "route_change", at: iso(day) },
        { type: "route_change", at: iso(new Date(day.getTime() + 1000)) },
      ],
      error: null,
    });
    const r = await computeFocusAnalytics();
    expect(r.totalRouteChanges).toBe(2);
    expect(r.totalInterruptions).toBe(0);
  });

  it("ignores a resume with no preceding idle", async () => {
    orderMock.mockResolvedValue({ data: [{ type: "resume", at: iso(new Date()) }], error: null });
    const r = await computeFocusAnalytics();
    expect(r.totalInterruptedMinutes).toBe(0);
  });
});
