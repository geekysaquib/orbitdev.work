import { describe, it, expect } from "vitest";
import { ticketEventMapper } from "./ticketEvents";

function event(type: string, payload: Record<string, unknown>) {
  return { id: "1", source: "ticket-workflow", type, occurredAt: "2026-01-01T00:00:00.000Z", payload };
}

describe("ticketEventMapper", () => {
  it("upserts a ticket entity + belongs_to relationship on created", () => {
    const r = ticketEventMapper(event("created", { ticketId: "k1", projectId: "p1", title: "Crash on save", status: "Open", priority: "high", origin: "zoho_sync" }));
    expect(r?.entity).toEqual({
      ref: { type: "ticket", id: "k1" }, label: "Crash on save",
      attributes: { status: "Open", priority: "high" },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(r?.relationships).toEqual([{ from: { type: "ticket", id: "k1" }, type: "belongs_to", to: { type: "project", id: "p1" } }]);
  });

  it("carries both status and priority on status_changed", () => {
    const r = ticketEventMapper(event("status_changed", { ticketId: "k1", status: "Closed", previousStatus: "Open", priority: "high", title: "Crash on save" }));
    expect(r?.entity?.attributes).toEqual({ status: "Closed", priority: "high" });
  });

  it("carries both status and priority on updated (triage)", () => {
    const r = ticketEventMapper(event("updated", { ticketId: "k1", status: "Open", priority: "low", hasAiNote: true, title: "Crash on save" }));
    expect(r?.entity?.attributes).toEqual({ status: "Open", priority: "low" });
  });

  it("omits the relationship when the ticket has no project", () => {
    const r = ticketEventMapper(event("created", { ticketId: "k1", title: "Standalone", status: "Open" }));
    expect(r?.relationships).toEqual([]);
  });

  it("has no deleted handling — tickets are never deleted", () => {
    expect(ticketEventMapper(event("deleted", { ticketId: "k1" }))).toBeNull();
  });

  it("ignores events from other sources or missing ticketId", () => {
    expect(ticketEventMapper(event("created", { title: "x" }))).toBeNull();
    expect(ticketEventMapper({ id: "1", source: "task-workflow", type: "created", occurredAt: "t", payload: { ticketId: "k1" } })).toBeNull();
  });
});
