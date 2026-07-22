/**
 * "My Work" — pure query functions over the Knowledge Graph's already-synced
 * task entities, powering the `/home` dashboard's task list. A module, not
 * an engine, same footing as `src/lib/intelligence.ts`/`src/lib/insights.ts`.
 * `attributes.userId`/`.dueDate`/`.status` are populated by
 * `syncFromSupabase()` (`src/lib/knowledgeSync.ts`) — nothing new to sync.
 *
 * Overdue semantics match `src/routes/Tasks.tsx`'s existing `dueLabel()`
 * (`days < 0` via `Math.ceil`), so "N days overdue" means the same thing
 * everywhere in the app.
 */
import type { Entity } from "../engines/knowledge";

const DAY_MS = 86_400_000;

export function myOpenTasks(tasks: Entity[], userId: string): Entity[] {
  return tasks.filter((t) => t.attributes.userId === userId && t.attributes.status !== "done");
}

export function myOverdueTasks(tasks: Entity[], userId: string, now: Date = new Date()): Entity[] {
  return myOpenTasks(tasks, userId).filter((t) => {
    const due = t.attributes.dueDate as string | null | undefined;
    if (!due) return false;
    return Math.ceil((new Date(due).getTime() - now.getTime()) / DAY_MS) < 0;
  });
}

/** Overdue tasks sort earliest first (most overdue), then soonest-due, undated last. A single ascending due-date sort achieves all three. */
export function sortByUrgency(tasks: Entity[]): Entity[] {
  return [...tasks].sort((a, b) => {
    const da = a.attributes.dueDate as string | null | undefined;
    const db = b.attributes.dueDate as string | null | undefined;
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return new Date(da).getTime() - new Date(db).getTime();
  });
}
