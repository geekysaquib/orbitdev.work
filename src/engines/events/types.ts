/**
 * Shared contract for the Event Engine (see docs/architecture/event-engine.md)
 * — Orbit's central communication backbone. Every engine (AI, Integration,
 * and future ones) publishes immutable domain events through one shared
 * shape instead of each inventing its own ad hoc logging. Environment-
 * agnostic, zero dependencies — same rule the AI/Integration Engines' cores
 * follow; concrete durable stores live outside this package (see
 * src/lib/eventsStore.ts, netlify/functions/_lib/eventStore.ts).
 */

export interface DomainEvent<TPayload = Record<string, unknown>> {
  id: string;
  /** Publishing engine, e.g. "integration-engine" | "ai-engine". Open string — no central union to edit when a new engine starts publishing, same convention as IntegrationId. */
  source: string;
  /** Engine-defined event type, e.g. "connected", "sync_completed". */
  type: string;
  occurredAt: string;
  userId?: string | null;
  teamId?: string | null;
  payload: TPayload;
}

/** Filter shared by subscriptions and replay — `undefined` on a field means "any". */
export interface EventFilter {
  source?: string;
  type?: string;
}

/**
 * Durable append-only log an `EventEngine` writes through. Never exposes
 * update/delete — events are immutable once published (see the `domain_events`
 * table's RLS policies, which grant select+insert only, in
 * docs/architecture/event-engine.md).
 */
export interface EventStore {
  append(event: Omit<DomainEvent, "id">): Promise<DomainEvent>;
  /** Historical rows, oldest first — the replay primitive. */
  listSince(filter: EventFilter & { since?: string; limit?: number }): Promise<DomainEvent[]>;
}

export type EventHandler<T = Record<string, unknown>> = (event: DomainEvent<T>) => void | Promise<void>;

/**
 * Optional instrumentation for future health monitoring — publish latency,
 * failure rates, subscriber errors. All methods optional and unset by
 * default, so an `EventEngine` with no telemetry sink behaves identically to
 * one with no telemetry support at all (same convention as
 * IntegrationTelemetry).
 */
export interface EventEngineTelemetry {
  onPublish?(event: DomainEvent): void;
  onPublishError?(info: { event: Omit<DomainEvent, "id">; error: unknown }): void;
  onSubscriberError?(info: { event: DomainEvent; error: unknown }): void;
}
