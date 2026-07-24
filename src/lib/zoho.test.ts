import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./auth", () => ({ authHeader: () => ({ Authorization: "Bearer test" }) }));

const { fetchZohoTickets, fetchSprintProjects, fetchSprintBoard, fetchTimesheet } = await import("./zoho");

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

describe("zoho.ts — RC1 task 10 throw→result conversion", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns { ok: true, data } on a successful response, unwrapping the envelope", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ data: [{ id: "1", ticketNumber: "1", subject: "x", status: "Open", priority: "med" }] }));
    const r = await fetchZohoTickets();
    expect(r).toEqual({ ok: true, data: [{ id: "1", ticketNumber: "1", subject: "x", status: "Open", priority: "med" }] });
  });

  it("defaults to an empty array when the envelope has no data field, same as before this refactor", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}));
    const r = await fetchZohoTickets();
    expect(r).toEqual({ ok: true, data: [] });
  });

  it("returns { ok: false, error } on a non-2xx response, never throws", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: "Zoho not configured — add your keys in Settings." }, false, 400));
    const r = await fetchSprintProjects();
    expect(r).toEqual({ ok: false, error: "Zoho not configured — add your keys in Settings." });
  });

  it("falls back to a generic message when a non-2xx response has no error field", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, false, 502));
    const r = await fetchSprintBoard("p1");
    expect(r).toEqual({ ok: false, error: "Zoho fetch failed (502)" });
  });

  it("returns { ok: false, error } instead of rejecting when fetch itself throws (network error)", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));
    const r = await fetchTimesheet();
    expect(r).toEqual({ ok: false, error: "network down" });
  });
});
