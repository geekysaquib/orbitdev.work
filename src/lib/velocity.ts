import type { BoardSprint, ZohoItem } from "./zoho";

export interface SprintVelocity {
  sprintId: string;
  sprintName: string;
  points: number;
  completedCount: number;
  totalCount: number;
}

/** Same done/closed/resolved/complete heuristic BreakView.tsx's isOpenBug already uses on `status`. */
const isDone = (it: ZohoItem) => /done|closed|resolved|complete/i.test(it.status || "");

export function computeVelocity(sprints: BoardSprint[]): SprintVelocity[] {
  return sprints.map((s) => {
    const completed = s.items.filter(isDone);
    const points = completed.reduce((sum, it) => sum + (Number(it.points) || 0), 0);
    return { sprintId: s.id, sprintName: s.name, points, completedCount: completed.length, totalCount: s.items.length };
  });
}

/** Zoho boards that don't use story points at all would otherwise chart an all-zero line — fall back to completed-item counts. */
export function velocityMetric(rows: SprintVelocity[]): { values: number[]; label: string } {
  const usesPoints = rows.some((r) => r.points > 0);
  return usesPoints
    ? { values: rows.map((r) => r.points), label: "points" }
    : { values: rows.map((r) => r.completedCount), label: "items" };
}
