import { supabase } from "./supabase";
import { getUser } from "./auth";
import type { Json } from "./database.types";
import type { DomainEvent, EventStore } from "../engines/events";

interface DomainEventRow {
  id: string; source: string; type: string; user_id: string | null; team_id: string | null;
  payload: Record<string, unknown>; occurred_at: string;
}

function fromRow(row: DomainEventRow): DomainEvent {
  return { id: row.id, source: row.source, type: row.type, userId: row.user_id, teamId: row.team_id, payload: row.payload, occurredAt: row.occurred_at };
}

/**
 * Browser-side `EventStore` — the `domain_events` table's RLS (owner
 * insert/select, plus team-member select when `team_id` is set) mirrors
 * `audit_log`'s already-proven policy shape (see
 * docs/architecture/event-engine.md). `user_id` defaults to the signed-in
 * user, same convention as `recordAudit()` in src/lib/audit.ts.
 */
export const eventStore: EventStore = {
  async append(event) {
    const userId = event.userId ?? getUser()?.id ?? null;
    const { data, error } = await supabase
      .from("domain_events")
      .insert({ source: event.source, type: event.type, user_id: userId, team_id: event.teamId ?? null, payload: event.payload as Json, occurred_at: event.occurredAt })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return fromRow(data as DomainEventRow);
  },

  async listSince(filter) {
    let q = supabase.from("domain_events").select("*").order("occurred_at", { ascending: true });
    if (filter.source) q = q.eq("source", filter.source);
    if (filter.type) q = q.eq("type", filter.type);
    if (filter.since) q = q.gt("occurred_at", filter.since);
    if (filter.limit) q = q.limit(filter.limit);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return ((data ?? []) as DomainEventRow[]).map(fromRow);
  },
};
