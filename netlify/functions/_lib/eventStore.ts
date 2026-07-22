import { dbInsert, dbSelect } from "./db";
import type { DomainEvent, EventFilter, EventStore } from "../../../src/engines/events";

interface DomainEventRow {
  id: string; source: string; type: string; user_id: string | null; team_id: string | null;
  payload: Record<string, unknown>; occurred_at: string;
}

function fromRow(row: DomainEventRow): DomainEvent {
  return { id: row.id, source: row.source, type: row.type, userId: row.user_id, teamId: row.team_id, payload: row.payload, occurredAt: row.occurred_at };
}

/**
 * Service-role `EventStore` — for server-side publishers (cron functions,
 * other Netlify functions) with no caller JWT to scope an RLS-based insert
 * with, same trust model as `_lib/db.ts`'s other consumers. Unlike the
 * browser store (src/lib/eventsStore.ts), there's no "current session user"
 * to default `userId` to — callers here always know which user an event
 * belongs to (e.g. a cron loop already iterating per-user).
 */
export const eventStore: EventStore = {
  async append(event) {
    const row = await dbInsert<DomainEventRow>("domain_events", {
      source: event.source, type: event.type, user_id: event.userId ?? null, team_id: event.teamId ?? null,
      payload: event.payload, occurred_at: event.occurredAt,
    });
    return fromRow(row);
  },

  async listSince(filter: EventFilter & { since?: string; limit?: number }) {
    const params = new URLSearchParams({ select: "*", order: "occurred_at.asc" });
    if (filter.source) params.set("source", `eq.${filter.source}`);
    if (filter.type) params.set("type", `eq.${filter.type}`);
    if (filter.since) params.set("occurred_at", `gt.${filter.since}`);
    if (filter.limit) params.set("limit", String(filter.limit));
    const rows = await dbSelect<DomainEventRow>("domain_events", params.toString());
    return rows.map(fromRow);
  },
};
