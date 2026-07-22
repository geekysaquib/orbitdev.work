import { describe, it, expect, vi } from "vitest";
import { KnowledgeEngine } from "./engine";
import { createInMemoryKnowledgeStore } from "./inMemoryStore";
import { integrationEventMapper } from "./mappers/integrationEvents";
import { EventEngine, createInMemoryEventStore } from "../events";
import type { Entity, KnowledgeStore } from "./types";

const project: Entity = { ref: { type: "project", id: "p1" }, label: "Orbit", attributes: { status: "active" }, updatedAt: "2026-01-01T00:00:00.000Z" };
const task: Entity = { ref: { type: "task", id: "t1" }, label: "Fix bug", attributes: { status: "todo" }, updatedAt: "2026-01-02T00:00:00.000Z" };

describe("KnowledgeEngine", () => {
  it("upserts and retrieves an entity", async () => {
    const engine = new KnowledgeEngine(createInMemoryKnowledgeStore());
    await engine.upsertEntity(project);
    expect(await engine.getEntity(project.ref)).toEqual(project);
    expect(await engine.getEntity({ type: "project", id: "nope" })).toBeNull();
  });

  it("relates entities and traverses outward and inward", async () => {
    const engine = new KnowledgeEngine(createInMemoryKnowledgeStore());
    await engine.upsertEntity(project);
    await engine.upsertEntity(task);
    await engine.upsertRelationship({ from: task.ref, type: "belongs_to", to: project.ref });

    const out = await engine.related(task.ref);
    expect(out).toHaveLength(1);
    expect(out[0].entity).toEqual(project);

    const inbound = await engine.related(project.ref, { direction: "in" });
    expect(inbound).toHaveLength(1);
    expect(inbound[0].entity).toEqual(task);

    expect(await engine.related(task.ref, { type: "assigned_to" })).toHaveLength(0);
  });

  it("traverses multiple hops, breadth-first, without revisiting a node in a cycle", async () => {
    const engine = new KnowledgeEngine(createInMemoryKnowledgeStore());
    const a = { ref: { type: "x", id: "a" }, label: "A", attributes: {}, updatedAt: "2026-01-01T00:00:00.000Z" };
    const b = { ref: { type: "x", id: "b" }, label: "B", attributes: {}, updatedAt: "2026-01-01T00:00:00.000Z" };
    const c = { ref: { type: "x", id: "c" }, label: "C", attributes: {}, updatedAt: "2026-01-01T00:00:00.000Z" };
    for (const e of [a, b, c]) await engine.upsertEntity(e);
    await engine.upsertRelationship({ from: a.ref, type: "next", to: b.ref });
    await engine.upsertRelationship({ from: b.ref, type: "next", to: c.ref });
    await engine.upsertRelationship({ from: c.ref, type: "next", to: a.ref }); // cycle back to a

    const result = await engine.traverse(a.ref, { depth: 5 });
    expect(result.map((r) => r.entity.ref.id)).toEqual(["b", "c"]); // never revisits "a"
    expect(result.map((r) => r.depth)).toEqual([1, 2]);
  });

  it("queries entities by type and keyword, with a limit", async () => {
    const engine = new KnowledgeEngine(createInMemoryKnowledgeStore());
    await engine.upsertEntity(project);
    await engine.upsertEntity(task);
    await engine.upsertEntity({ ref: { type: "task", id: "t2" }, label: "Write docs", attributes: { status: "done" }, updatedAt: "2026-01-03T00:00:00.000Z" });

    expect((await engine.query({ type: "project" })).map((e) => e.ref.id)).toEqual(["p1"]);
    expect((await engine.query({ text: "bug" })).map((e) => e.ref.id)).toEqual(["t1"]);
    expect(await engine.query({ type: "task", limit: 1 })).toHaveLength(1);
  });

  it("builds context, optionally enriched with related entities", async () => {
    const engine = new KnowledgeEngine(createInMemoryKnowledgeStore());
    await engine.upsertEntity(project);
    await engine.upsertEntity(task);
    await engine.upsertRelationship({ from: task.ref, type: "belongs_to", to: project.ref });

    const bare = await engine.buildContext({ type: "task" });
    expect(bare.entities).toEqual([task]);
    expect(bare.relationships).toEqual([]);
    expect(bare.renderedText).toContain("task:");
    expect(bare.renderedText).toContain("Fix bug");

    const enriched = await engine.buildContext({ type: "task", includeRelated: true });
    expect(enriched.entities.map((e) => e.ref.id).sort()).toEqual(["p1", "t1"]);
    expect(enriched.relationships).toHaveLength(1);
  });

  it("renders a message when nothing matches", async () => {
    const engine = new KnowledgeEngine(createInMemoryKnowledgeStore());
    const result = await engine.buildContext({ type: "nonexistent" });
    expect(result.renderedText).toBe("No matching knowledge found.");
  });

  describe("subscribeToEvents", () => {
    it("applies a mapper's entity/relationships when it matches", async () => {
      const engine = new KnowledgeEngine(createInMemoryKnowledgeStore());
      const events = new EventEngine(createInMemoryEventStore());
      engine.subscribeToEvents(events, integrationEventMapper);

      await events.publish({ source: "integration-engine", type: "connected", occurredAt: "2026-01-01T00:00:00.000Z", payload: { integrationId: "github", account: "me" } });

      const entity = await engine.getEntity({ type: "integration", id: "github" });
      expect(entity).toMatchObject({ label: "github", attributes: { connected: true, status: "connected", account: "me" } });
    });

    it("skips events the mapper doesn't recognize", async () => {
      const engine = new KnowledgeEngine(createInMemoryKnowledgeStore());
      const events = new EventEngine(createInMemoryEventStore());
      engine.subscribeToEvents(events, integrationEventMapper);

      await events.publish({ source: "ai-engine", type: "fallback", occurredAt: "2026-01-01T00:00:00.000Z", payload: {} });

      expect(await engine.query({})).toHaveLength(0);
    });

    it("reports a mapper error to telemetry instead of throwing", async () => {
      const onEventIngestError = vi.fn();
      const engine = new KnowledgeEngine(createInMemoryKnowledgeStore(), { onEventIngestError });
      const events = new EventEngine(createInMemoryEventStore());
      engine.subscribeToEvents(events, () => { throw new Error("bad mapper"); });

      await events.publish({ source: "s", type: "t", occurredAt: "2026-01-01T00:00:00.000Z", payload: {} });
      expect(onEventIngestError).toHaveBeenCalledTimes(1);
    });

    it("reports a store failure during ingest to telemetry instead of throwing", async () => {
      const onEventIngestError = vi.fn();
      const failingStore: KnowledgeStore = {
        ...createInMemoryKnowledgeStore(),
        upsertEntity: vi.fn().mockRejectedValue(new Error("store down")),
      };
      const engine = new KnowledgeEngine(failingStore, { onEventIngestError });
      const events = new EventEngine(createInMemoryEventStore());
      engine.subscribeToEvents(events, integrationEventMapper);

      await events.publish({ source: "integration-engine", type: "connected", occurredAt: "2026-01-01T00:00:00.000Z", payload: { integrationId: "github" } });
      expect(onEventIngestError).toHaveBeenCalledTimes(1);
    });
  });
});

describe("integrationEventMapper", () => {
  it("maps connected/disconnected/authentication_failed to an integration entity", () => {
    expect(integrationEventMapper({ id: "1", source: "integration-engine", type: "connected", occurredAt: "t", payload: { integrationId: "github", account: "me" } })?.entity.attributes)
      .toEqual({ connected: true, status: "connected", account: "me", error: null });
    expect(integrationEventMapper({ id: "2", source: "integration-engine", type: "disconnected", occurredAt: "t", payload: { integrationId: "gitlab" } })?.entity.attributes)
      .toEqual({ connected: false, status: "disconnected", account: null, error: null });
    expect(integrationEventMapper({ id: "3", source: "integration-engine", type: "authentication_failed", occurredAt: "t", payload: { integrationId: "azuredevops", error: "bad PAT" } })?.entity.attributes)
      .toEqual({ connected: false, status: "authentication_failed", account: null, error: "bad PAT" });
  });

  it("returns null for events from other sources or missing integrationId", () => {
    expect(integrationEventMapper({ id: "4", source: "ai-engine", type: "fallback", occurredAt: "t", payload: {} })).toBeNull();
    expect(integrationEventMapper({ id: "5", source: "integration-engine", type: "connected", occurredAt: "t", payload: {} })).toBeNull();
  });
});
