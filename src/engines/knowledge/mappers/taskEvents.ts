import type { DomainEvent } from "../../events";
import type { Entity, EntityRef, Relationship } from "../types";

/**
 * Translates `task-workflow` domain events (src/routes/Tasks.tsx, see
 * docs/architecture/event-engine-adoption.md) into graph updates — the
 * incremental complement to `src/lib/knowledgeSync.ts`'s full-table sync.
 *
 * Only `created`/`status_changed` upsert an entity, and only because their
 * payloads carry every graph-relevant field (not just what changed) —
 * `upsertEntity` fully replaces an entity, so a partial payload would drop
 * fields silently. `shared` (team_id change) is published for audit/history
 * value but ignored here: team sharing isn't modeled in task attributes at
 * all today, so there's nothing for this mapper to update.
 */
export function taskEventMapper(event: DomainEvent): { entity?: Entity; relationships?: Relationship[]; deleteRef?: EntityRef } | null {
  if (event.source !== "task-workflow") return null;
  const p = event.payload as Record<string, unknown>;
  const taskId = p.taskId as string | undefined;
  if (!taskId) return null;
  const ref: EntityRef = { type: "task", id: taskId };

  if (event.type === "deleted") return { deleteRef: ref };

  if (event.type !== "created" && event.type !== "status_changed") return null;

  const projectId = (p.projectId as string | null | undefined) ?? null;
  const entity: Entity = {
    ref,
    label: (p.title as string | undefined) ?? taskId,
    attributes: {
      status: p.status ?? null,
      priority: p.priority ?? null,
      dueDate: p.dueDate ?? null,
      completedAt: p.completedAt ?? null,
    },
    updatedAt: event.occurredAt,
  };
  const relationships: Relationship[] = projectId ? [{ from: ref, type: "belongs_to", to: { type: "project", id: projectId } }] : [];
  return { entity, relationships };
}
