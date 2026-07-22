import type { DomainEvent, EventFilter, EventStore } from "./types";

/**
 * Dependency-free `EventStore` — used by tests, and available to any caller
 * that doesn't need durability across process restarts (e.g. a short-lived
 * script). `new EventEngine(store)` never silently reaches for Postgres; a
 * real store is always explicit (see src/lib/eventsStore.ts,
 * netlify/functions/_lib/eventStore.ts).
 */
export function createInMemoryEventStore(): EventStore {
  const events: DomainEvent[] = [];
  let nextId = 1;

  return {
    async append(event) {
      const stored: DomainEvent = { ...event, id: String(nextId++) };
      events.push(stored);
      return stored;
    },
    async listSince(filter: EventFilter & { since?: string; limit?: number }) {
      let rows = events.filter((e) => (!filter.source || filter.source === e.source) && (!filter.type || filter.type === e.type));
      if (filter.since) rows = rows.filter((e) => e.occurredAt > filter.since!);
      rows = rows.slice().sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
      return filter.limit ? rows.slice(0, filter.limit) : rows;
    },
  };
}
