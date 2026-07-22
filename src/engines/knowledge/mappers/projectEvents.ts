import type { DomainEvent } from "../../events";
import type { Entity, EntityRef } from "../types";

/**
 * Translates `project-workflow` domain events (src/routes/Projects.tsx,
 * src/routes/ProjectDetail.tsx — see docs/architecture/event-engine-adoption.md)
 * into graph updates, the incremental complement to
 * `src/lib/knowledgeSync.ts`'s full-table sync.
 *
 * `created`/`updated`/`repo_linked`/`repo_unlinked` upsert an entity, and
 * only because their publish call sites were written to carry every
 * graph-relevant field (status/client/repo*), not just what changed —
 * `upsertEntity` fully replaces an entity, so a partial payload would drop
 * fields silently. `shared` (team_id) and `sprint_linked`/`sprint_unlinked`
 * are published for audit/history value but ignored here: neither team
 * sharing nor sprint linkage is modeled in project attributes today (see
 * `src/lib/knowledgeSync.ts`'s `syncFromSupabase`).
 */
export function projectEventMapper(event: DomainEvent): { entity?: Entity; deleteRef?: EntityRef } | null {
  if (event.source !== "project-workflow") return null;
  const p = event.payload as Record<string, unknown>;
  const projectId = p.projectId as string | undefined;
  if (!projectId) return null;
  const ref: EntityRef = { type: "project", id: projectId };

  if (event.type === "deleted") return { deleteRef: ref };
  if (event.type !== "created" && event.type !== "updated" && event.type !== "repo_linked" && event.type !== "repo_unlinked") return null;

  return {
    entity: {
      ref,
      label: (p.name as string | undefined) ?? projectId,
      attributes: {
        status: p.status ?? null,
        client: p.client ?? null,
        repoProvider: p.repoProvider ?? null,
        repoFullName: p.repoFullName ?? null,
        repoDefaultBranch: p.repoDefaultBranch ?? null,
      },
      updatedAt: event.occurredAt,
    },
  };
}
