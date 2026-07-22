import { supabase } from "./supabase";
import type { DomainEvent } from "../engines/events";

interface DomainEventRow {
  id: string; source: string; type: string; user_id: string | null; team_id: string | null;
  payload: Record<string, unknown>; occurred_at: string;
}

function fromRow(row: DomainEventRow): DomainEvent {
  return { id: row.id, source: row.source, type: row.type, userId: row.user_id, teamId: row.team_id, payload: row.payload, occurredAt: row.occurred_at };
}

/**
 * Cross-process delivery for the Event Engine — the actual "communication
 * backbone" behavior: a browser tab reacts live to a `DomainEvent` published
 * by a Netlify function, a cron job, or another tab. A direct generalization
 * of `subscribeTeamActivity()` (src/lib/activity.ts), which already proves
 * this exact mechanism (Supabase Realtime over Postgres inserts) in
 * production for the team activity feed. `EventEngine.subscribe()`, by
 * contrast, only ever sees events published within its own process — this
 * is the piece that reaches across processes.
 */
export function subscribeDomainEvents(filter: { source?: string; type?: string }, onEvent: (event: DomainEvent) => void): () => void {
  // Realtime's `postgres_changes` filter supports one column condition, not a
  // compound AND (see subscribeTeamActivity's single `team_id=eq.` filter for
  // the same constraint) — `source` narrows at the DB/transport level since
  // it's the coarser, more common filter; `type` (when given) is re-checked
  // client-side below, which is correct regardless either way.
  const dbFilter = filter.source ? { filter: `source=eq.${filter.source}` } : {};
  const channel = supabase
    .channel(`domain-events:${filter.source ?? "*"}:${filter.type ?? "*"}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "domain_events", ...dbFilter },
      (payload: { new: DomainEventRow }) => {
        if (filter.type && payload.new.type !== filter.type) return;
        onEvent(fromRow(payload.new));
      },
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
