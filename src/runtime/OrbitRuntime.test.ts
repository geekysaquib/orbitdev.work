import { describe, it, expect, vi } from "vitest";
import { OrbitRuntime } from "./OrbitRuntime";
import { createInMemoryEventStore, type DomainEvent } from "../engines/events";
import { createInMemoryKnowledgeStore } from "../engines/knowledge";

function createFakeRealtime() {
  let handler: ((event: DomainEvent) => void) | null = null;
  const subscribeRealtime = vi.fn((_filter: { source?: string }, onEvent: (event: DomainEvent) => void) => {
    handler = onEvent;
    return vi.fn(() => { handler = null; });
  });
  return { subscribeRealtime, fire: (event: DomainEvent) => handler?.(event) };
}

const connectedEvent: Omit<DomainEvent, "id"> = {
  source: "integration-engine", type: "connected", occurredAt: "2026-01-01T00:00:00.000Z", payload: { integrationId: "github", account: "me" },
};

// The realtime bridge and local subscription both apply via a fire-and-forget
// `void knowledge.ingest(...)` inside OrbitRuntime — give that microtask a tick.
const flush = () => new Promise((r) => setTimeout(r, 0));

function build() {
  const knowledgeStore = createInMemoryKnowledgeStore();
  const syncKnowledge = vi.fn().mockResolvedValue(undefined);
  const realtime = createFakeRealtime();
  const runtime = new OrbitRuntime({
    eventStore: createInMemoryEventStore(),
    knowledgeStore,
    syncKnowledge,
    subscribeRealtime: realtime.subscribeRealtime,
  });
  return { runtime, syncKnowledge, realtime };
}

describe("OrbitRuntime", () => {
  it("start() is idempotent — a second call doesn't re-sync or re-subscribe", async () => {
    const { runtime, syncKnowledge, realtime } = build();
    await runtime.start();
    await runtime.start();
    expect(syncKnowledge).toHaveBeenCalledTimes(1);
    expect(realtime.subscribeRealtime).toHaveBeenCalledTimes(1);
    expect(runtime.isStarted).toBe(true);
  });

  it("a locally-published event reaches the knowledge graph via the local subscription", async () => {
    const { runtime } = build();
    await runtime.start();
    await runtime.events.publish(connectedEvent);
    expect(await runtime.knowledge.getEntity({ type: "integration", id: "github" })).toMatchObject({ label: "github" });
  });

  it("a realtime-delivered event reaches the knowledge graph via ingest()", async () => {
    const { runtime, realtime } = build();
    await runtime.start();
    realtime.fire({ ...connectedEvent, id: "remote-1" });
    await flush();
    expect(await runtime.knowledge.getEntity({ type: "integration", id: "github" })).toMatchObject({ label: "github" });
  });

  it("stop() unsubscribes both feeds — neither local nor realtime events reach the graph afterward", async () => {
    const { runtime, realtime } = build();
    await runtime.start();
    runtime.stop();
    expect(runtime.isStarted).toBe(false);

    await runtime.events.publish(connectedEvent);
    realtime.fire({ ...connectedEvent, id: "remote-2" });
    await flush();

    expect(await runtime.knowledge.getEntity({ type: "integration", id: "github" })).toBeNull();
  });

  it("dispose() followed by start() again re-subscribes and re-syncs (StrictMode double-mount safety)", async () => {
    const { runtime, syncKnowledge, realtime } = build();
    await runtime.start();
    runtime.dispose();
    await runtime.start();

    expect(syncKnowledge).toHaveBeenCalledTimes(2);
    expect(realtime.subscribeRealtime).toHaveBeenCalledTimes(2);
    expect(runtime.isStarted).toBe(true);

    await runtime.events.publish(connectedEvent);
    expect(await runtime.knowledge.getEntity({ type: "integration", id: "github" })).toMatchObject({ label: "github" });
  });

  it("instantiates integrations and ai for a consistent API surface", () => {
    const { runtime } = build();
    expect(runtime.integrations.list().map((a) => a.id).sort()).toEqual(["azuredevops", "github", "gitlab"]);
    expect(runtime.ai).toBeDefined();
  });
});
