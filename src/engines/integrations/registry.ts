import type { IntegrationAdapter, IntegrationCapabilityKind, IntegrationId, IntegrationStatus, IntegrationTelemetry } from "./types";
import type { EventEngine } from "../events";

/** Publishes a `DomainEvent` through the Event Engine — see docs/architecture/event-engine.md's "Publishers" section, worked example. */
export interface IntegrationEventsSink {
  engine: EventEngine;
  /** `DomainEvent.source` — defaults to `"integration-engine"` if omitted. */
  source?: string;
}

function publishStatusEvent(sink: IntegrationEventsSink, integrationId: IntegrationId, status: IntegrationStatus): void {
  const type = status.connected ? "connected" : status.error ? "authentication_failed" : "disconnected";
  // Fire-and-forget: a domain-events write failing must never affect the
  // caller (same "never let this break the caller's flow" principle
  // src/lib/audit.ts's recordAudit() already documents for itself).
  void sink.engine
    .publish({
      source: sink.source ?? "integration-engine",
      type,
      occurredAt: new Date().toISOString(),
      payload: { integrationId, account: status.account ?? null, error: status.error },
    })
    .catch(() => {});
}

/**
 * Wraps every method an adapter exposes with start/end timing calls into a
 * telemetry sink, and (for `checkStatus` specifically) publishes a
 * `connected`/`disconnected`/`authentication_failed` domain event when an
 * `events` sink is configured. Adapters are plain object literals (factory
 * functions returning `{ id, displayName, capabilities, checkStatus,
 * ...methods }`), so this can generically instrument any of them without
 * knowing which capability they implement. `ok` is read from either an
 * `IntegrationResult` (`.ok`) or an `IntegrationStatus` (`.connected`)
 * return shape — both are used across the engine's methods.
 *
 * Only `checkStatus` publishes — not every capability method — because
 * `listPulls`/`listRuns`/etc. can be called frequently for dashboard
 * polling, and a durable event row per call would make `domain_events` grow
 * unboundedly for no real benefit; `checkStatus` is inherently low-frequency.
 */
function instrument<T extends IntegrationAdapter>(adapter: T, telemetry?: IntegrationTelemetry, events?: IntegrationEventsSink): T {
  const wrapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(adapter)) {
    if (typeof value !== "function") {
      wrapped[key] = value;
      continue;
    }
    wrapped[key] = async (...args: unknown[]) => {
      const start = Date.now();
      telemetry?.onCallStart?.({ integrationId: adapter.id, operation: key });
      try {
        const result = (await value.apply(adapter, args)) as { ok?: boolean; connected?: boolean; status?: number } | undefined;
        const ok = typeof result?.ok === "boolean" ? result.ok : typeof result?.connected === "boolean" ? result.connected : true;
        telemetry?.onCallEnd?.({ integrationId: adapter.id, operation: key, ok, durationMs: Date.now() - start, status: result?.status });
        if (events && key === "checkStatus") publishStatusEvent(events, adapter.id, result as IntegrationStatus);
        return result;
      } catch (e) {
        telemetry?.onCallEnd?.({ integrationId: adapter.id, operation: key, ok: false, durationMs: Date.now() - start });
        throw e;
      }
    };
  }
  return wrapped as T;
}

/**
 * Runtime lookup of registered adapters by id — the "install a new
 * integration with minimal changes" mechanism: adding one is a new adapter
 * file plus one `register()` call at setup, never a shared switch statement
 * to edit (see docs/architecture/integration-engine.md).
 */
export class IntegrationRegistry {
  private readonly adapters = new Map<IntegrationId, IntegrationAdapter>();
  private readonly telemetry?: IntegrationTelemetry;
  private readonly events?: IntegrationEventsSink;

  constructor(opts?: { telemetry?: IntegrationTelemetry; events?: IntegrationEventsSink }) {
    this.telemetry = opts?.telemetry;
    this.events = opts?.events;
  }

  register(adapter: IntegrationAdapter): void {
    if (this.adapters.has(adapter.id)) throw new Error(`Integration "${adapter.id}" is already registered`);
    this.adapters.set(adapter.id, adapter);
  }

  get(id: IntegrationId): IntegrationAdapter | undefined {
    const adapter = this.adapters.get(id);
    if (!adapter || (!this.telemetry && !this.events)) return adapter;
    return instrument(adapter, this.telemetry, this.events);
  }

  /** Looks up an adapter and narrows it to a capability, e.g. `registry.getCapable(id, isScmAdapter)`. `undefined` if unregistered or the adapter doesn't implement that capability. */
  getCapable<T extends IntegrationAdapter>(id: IntegrationId, guard: (a: IntegrationAdapter) => a is T): T | undefined {
    const adapter = this.get(id);
    return adapter && guard(adapter) ? adapter : undefined;
  }

  /** Every registered adapter that declares a given capability — the "resolution instead of provider-specific branching" mechanism: callers ask for "everything that does SCM," never switch on provider id. */
  listByCapability(kind: IntegrationCapabilityKind): IntegrationAdapter[] {
    return this.list().filter((a) => a.capabilities.includes(kind));
  }

  list(): IntegrationAdapter[] {
    return [...this.adapters.values()];
  }
}
