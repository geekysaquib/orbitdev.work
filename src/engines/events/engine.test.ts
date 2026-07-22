import { describe, it, expect, vi } from "vitest";
import { EventEngine } from "./engine";
import { createInMemoryEventStore } from "./inMemoryStore";

describe("EventEngine", () => {
  it("appends to the store and dispatches to matching subscribers", async () => {
    const engine = new EventEngine(createInMemoryEventStore());
    const received: string[] = [];
    engine.subscribe({ source: "integration-engine" }, (e) => { received.push(e.type); });

    await engine.publish({ source: "integration-engine", type: "connected", occurredAt: "2026-01-01T00:00:00.000Z", payload: {} });
    await engine.publish({ source: "ai-engine", type: "fallback", occurredAt: "2026-01-01T00:00:01.000Z", payload: {} });

    expect(received).toEqual(["connected"]);
  });

  it("filters subscribers by type as well as source", async () => {
    const engine = new EventEngine(createInMemoryEventStore());
    const received: string[] = [];
    engine.subscribe({ source: "integration-engine", type: "connected" }, (e) => { received.push(e.type); });

    await engine.publish({ source: "integration-engine", type: "disconnected", occurredAt: "2026-01-01T00:00:00.000Z", payload: {} });
    await engine.publish({ source: "integration-engine", type: "connected", occurredAt: "2026-01-01T00:00:01.000Z", payload: {} });

    expect(received).toEqual(["connected"]);
  });

  it("unsubscribe stops further delivery", async () => {
    const engine = new EventEngine(createInMemoryEventStore());
    const received: string[] = [];
    const unsubscribe = engine.subscribe({}, (e) => { received.push(e.type); });
    await engine.publish({ source: "s", type: "a", occurredAt: "2026-01-01T00:00:00.000Z", payload: {} });
    unsubscribe();
    await engine.publish({ source: "s", type: "b", occurredAt: "2026-01-01T00:00:01.000Z", payload: {} });
    expect(received).toEqual(["a"]);
  });

  it("a throwing subscriber doesn't stop other subscribers or fail publish", async () => {
    const engine = new EventEngine(createInMemoryEventStore());
    const received: string[] = [];
    engine.subscribe({}, () => { throw new Error("boom"); });
    engine.subscribe({}, (e) => { received.push(e.type); });

    const stored = await engine.publish({ source: "s", type: "a", occurredAt: "2026-01-01T00:00:00.000Z", payload: {} });

    expect(stored.type).toBe("a");
    expect(received).toEqual(["a"]);
  });

  it("reports subscriber errors to telemetry without throwing", async () => {
    const onSubscriberError = vi.fn();
    const engine = new EventEngine(createInMemoryEventStore(), { onSubscriberError });
    engine.subscribe({}, () => { throw new Error("boom"); });
    await engine.publish({ source: "s", type: "a", occurredAt: "2026-01-01T00:00:00.000Z", payload: {} });
    expect(onSubscriberError).toHaveBeenCalledTimes(1);
  });

  it("publish rejects and reports telemetry when the store fails, without dispatching", async () => {
    const onPublishError = vi.fn();
    const store = { append: vi.fn().mockRejectedValue(new Error("db down")), listSince: vi.fn() };
    const engine = new EventEngine(store, { onPublishError });
    const received: string[] = [];
    engine.subscribe({}, (e) => { received.push(e.type); });

    await expect(engine.publish({ source: "s", type: "a", occurredAt: "2026-01-01T00:00:00.000Z", payload: {} })).rejects.toThrow("db down");
    expect(received).toEqual([]);
    expect(onPublishError).toHaveBeenCalledTimes(1);
  });

  it("replay redelivers historical events in order to the given handler only, without re-broadcasting to subscribers", async () => {
    const engine = new EventEngine(createInMemoryEventStore());
    const live: string[] = [];
    engine.subscribe({}, (e) => { live.push(e.type); });

    await engine.publish({ source: "integration-engine", type: "connected", occurredAt: "2026-01-01T00:00:00.000Z", payload: { n: 1 } });
    await engine.publish({ source: "integration-engine", type: "disconnected", occurredAt: "2026-01-01T00:00:01.000Z", payload: { n: 2 } });
    await engine.publish({ source: "ai-engine", type: "fallback", occurredAt: "2026-01-01T00:00:02.000Z", payload: { n: 3 } });
    live.length = 0; // only care about replay delivery from here

    const replayed: number[] = [];
    const count = await engine.replay({ source: "integration-engine" }, (e) => { replayed.push((e.payload as { n: number }).n); });

    expect(count).toBe(2);
    expect(replayed).toEqual([1, 2]);
    expect(live).toEqual([]);
  });
});
