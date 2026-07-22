import type { DomainEvent } from "../../events";
import type { Entity, EntityRef, Relationship } from "../types";

/**
 * Translates `ticket-workflow` domain events (src/routes/Tickets.tsx,
 * src/routes/Mail.tsx — see docs/architecture/event-engine-adoption.md)
 * into graph updates, the incremental complement to
 * `src/lib/knowledgeSync.ts`'s full-table sync.
 *
 * All three event types (`created`/`status_changed`/`updated`) upsert an
 * entity, and only because their publish call sites were written to carry
 * both `status` and `priority` regardless of which one actually changed —
 * `upsertEntity` fully replaces an entity, so a partial payload would drop
 * the other field silently. No `deleted` type exists — tickets are never
 * deleted anywhere in the app.
 */
export function ticketEventMapper(event: DomainEvent): { entity?: Entity; relationships?: Relationship[] } | null {
  if (event.source !== "ticket-workflow") return null;
  if (event.type !== "created" && event.type !== "status_changed" && event.type !== "updated") return null;

  const p = event.payload as Record<string, unknown>;
  const ticketId = p.ticketId as string | undefined;
  if (!ticketId) return null;
  const ref: EntityRef = { type: "ticket", id: ticketId };

  const projectId = (p.projectId as string | null | undefined) ?? null;
  const entity: Entity = {
    ref,
    label: (p.title as string | undefined) ?? ticketId,
    attributes: { status: p.status ?? null, priority: p.priority ?? null },
    updatedAt: event.occurredAt,
  };
  const relationships: Relationship[] = projectId ? [{ from: ref, type: "belongs_to", to: { type: "project", id: projectId } }] : [];
  return { entity, relationships };
}
