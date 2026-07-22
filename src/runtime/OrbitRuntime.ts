import { EventEngine, type DomainEvent, type EventStore } from "../engines/events";
import {
  KnowledgeEngine, createInMemoryKnowledgeStore,
  integrationEventMapper, taskEventMapper, projectEventMapper, ticketEventMapper,
  type KnowledgeStore, type EventEntityMapper,
} from "../engines/knowledge";
import { createDefaultRegistry, type IntegrationRegistry } from "../engines/integrations";
import { AIRouter, createCloudAdapters } from "../engines/ai";
import { eventStore as browserEventStore } from "../lib/eventsStore";
import { syncFromSupabase } from "../lib/knowledgeSync";
import { subscribeDomainEvents } from "../lib/eventsRealtime";

export interface OrbitRuntimeDeps {
  eventStore?: EventStore;
  knowledgeStore?: KnowledgeStore;
  syncKnowledge?: (engine: KnowledgeEngine) => Promise<void>;
  subscribeRealtime?: (filter: { source?: string }, onEvent: (event: DomainEvent) => void) => () => void;
}

/**
 * Every mapper the Knowledge Engine subscribes to, local and realtime alike
 * — one per event-publishing workflow (see docs/architecture/
 * event-engine-adoption.md). Adding a new workflow's mapper here is the only
 * wiring step required; each mapper independently ignores events it doesn't
 * recognize (see `EventEntityMapper`), so this list can grow without any of
 * them needing to know about each other.
 */
const MAPPERS: EventEntityMapper[] = [integrationEventMapper, taskEventMapper, projectEventMapper, ticketEventMapper];

/**
 * Orbit's browser-side composition root (see
 * docs/architecture/orbit-runtime.md) — constructs, wires, and exposes all
 * engines as singletons so React components never construct one themselves.
 * There is no server-side equivalent of this class: Netlify functions are
 * stateless, one invocation at a time, with no persistent process to hold
 * lifecycle in — see netlify/functions/_lib/serverEvents.ts for the much
 * smaller server-side wiring.
 *
 * `events` and `knowledge` are genuinely live here — `start()` populates the
 * knowledge graph and keeps it updated. `integrations` and `ai` are
 * constructed for a consistent API surface across all four engines, but are
 * structurally inert in the browser: Integration Engine adapters need
 * credentials that only exist server-side (RLS-protected tokens), and
 * Orbit's AI calls deliberately route through the local agent
 * (src/lib/ai.ts) rather than a direct browser-to-provider fetch that would
 * leak API keys client-side. No browser code should call
 * `runtime.integrations.get(id)!.checkStatus(...)` or `runtime.ai.complete(...)`
 * — neither has anything valid to call with today.
 */
export class OrbitRuntime {
  readonly events: EventEngine;
  readonly knowledge: KnowledgeEngine;
  readonly integrations: IntegrationRegistry;
  readonly ai: AIRouter;

  private readonly syncKnowledge: (engine: KnowledgeEngine) => Promise<void>;
  private readonly subscribeRealtime: (filter: { source?: string }, onEvent: (event: DomainEvent) => void) => () => void;
  private unsubscribeLocal: (() => void)[] = [];
  private unsubscribeRealtime: (() => void) | null = null;
  private started = false;

  constructor(deps: OrbitRuntimeDeps = {}) {
    this.events = new EventEngine(deps.eventStore ?? browserEventStore);
    this.knowledge = new KnowledgeEngine(deps.knowledgeStore ?? createInMemoryKnowledgeStore());
    this.integrations = createDefaultRegistry({ events: { engine: this.events } });
    this.ai = new AIRouter(createCloudAdapters());
    this.syncKnowledge = deps.syncKnowledge ?? syncFromSupabase;
    this.subscribeRealtime = deps.subscribeRealtime ?? subscribeDomainEvents;
  }

  get isStarted(): boolean {
    return this.started;
  }

  /**
   * Idempotent — a second `start()` call while already started is a no-op,
   * so React StrictMode's mount→unmount→remount dev cycle (which calls
   * start() twice) can't double-subscribe. Wires the Knowledge Engine to
   * both local (in-process) and realtime (cross-process) event delivery for
   * every mapper in `MAPPERS`, then runs the direct-sync bootstrap — see
   * docs/architecture/knowledge-engine.md's Transitional architecture for
   * why both delivery paths exist.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.unsubscribeLocal = MAPPERS.map((mapper) => this.knowledge.subscribeToEvents(this.events, mapper));
    this.unsubscribeRealtime = this.subscribeRealtime({}, (event) => {
      for (const mapper of MAPPERS) void this.knowledge.ingest(event, mapper);
    });
    await this.syncKnowledge(this.knowledge);
  }

  /** Unsubscribes live feeds — engines and their accumulated data stay intact, and `start()` can be called again. */
  stop(): void {
    for (const unsubscribe of this.unsubscribeLocal) unsubscribe();
    this.unsubscribeRealtime?.();
    this.unsubscribeLocal = [];
    this.unsubscribeRealtime = null;
    this.started = false;
  }

  /** Same effect as `stop()`, named separately to signal end-of-life intent to callers (e.g. RuntimeProvider's unmount). */
  dispose(): void {
    this.stop();
  }
}
