import type { DomainEvent, EventEngineTelemetry, EventFilter, EventHandler, EventStore } from "./types";

interface Subscription { filter: EventFilter; handler: EventHandler<any>; }

function matches(filter: EventFilter, event: DomainEvent): boolean {
  return (!filter.source || filter.source === event.source) && (!filter.type || filter.type === event.type);
}

/**
 * Orbit's central communication backbone (see docs/architecture/event-engine.md).
 * Every engine publishes immutable `DomainEvent`s through one of these —
 * durability first (append to the injected `EventStore`), then in-process
 * dispatch to matching subscribers. Nothing here talks to Postgres or
 * Supabase directly; `store` is injected so the engine works identically in
 * tests (`createInMemoryEventStore()`), the browser, or a Netlify function.
 */
export class EventEngine {
  private readonly subscriptions = new Set<Subscription>();

  constructor(private readonly store: EventStore, private readonly telemetry?: EventEngineTelemetry) {}

  /**
   * Appends `event` to the durable store, then dispatches it to every
   * matching in-process subscriber. A subscriber that throws doesn't stop
   * other subscribers or fail this call — its error goes to
   * `telemetry.onSubscriberError` instead.
   *
   * In-process dispatch only reaches subscribers registered on *this*
   * `EventEngine` instance, in the *same running process* — a Netlify
   * function's subscribers never see events published by another invocation
   * or by the browser, because each invocation is a fresh process. Durable,
   * cross-process delivery is what `replay()` and the Realtime-backed
   * `subscribeDomainEvents()` (src/lib/eventsRealtime.ts) are for.
   */
  async publish<T = Record<string, unknown>>(event: Omit<DomainEvent<T>, "id">): Promise<DomainEvent<T>> {
    // `EventStore`/telemetry operate on the untyped `DomainEvent` shape — `T`
    // is purely a convenience for typed callers at this method's boundary;
    // payload is opaque JSON as far as the store and dispatch loop care.
    const untyped = event as unknown as Omit<DomainEvent, "id">;
    let stored: DomainEvent;
    try {
      stored = await this.store.append(untyped);
    } catch (error) {
      this.telemetry?.onPublishError?.({ event: untyped, error });
      throw error;
    }
    this.telemetry?.onPublish?.(stored);
    await this.dispatch(stored);
    return stored as DomainEvent<T>;
  }

  /** Registers an in-process handler for events matching `filter`. Returns an unsubscribe function. */
  subscribe<T = Record<string, unknown>>(filter: EventFilter, handler: EventHandler<T>): () => void {
    const subscription: Subscription = { filter, handler };
    this.subscriptions.add(subscription);
    return () => { this.subscriptions.delete(subscription); };
  }

  /**
   * Re-delivers historical events matching `filter` to `handler`, oldest
   * first — for a subscriber catching up after being offline, or for
   * rebuilding derived state from the durable log. Replayed events are
   * delivered only to `handler`, not re-broadcast to other subscribers, and
   * are not re-appended to the store. Returns the number of events replayed.
   */
  async replay<T = Record<string, unknown>>(filter: EventFilter & { since?: string; limit?: number }, handler: EventHandler<T>): Promise<number> {
    const events = await this.store.listSince(filter);
    for (const event of events) await handler(event as DomainEvent<T>);
    return events.length;
  }

  private async dispatch(event: DomainEvent): Promise<void> {
    for (const { filter, handler } of this.subscriptions) {
      if (!matches(filter, event)) continue;
      try {
        await handler(event);
      } catch (error) {
        this.telemetry?.onSubscriberError?.({ event, error });
      }
    }
  }
}
