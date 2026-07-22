import type { BoardSprint, ZohoItem } from "./zoho";
import { ask, type ProviderKeys, type CloudProvider } from "./ai";

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

export async function explainVelocity(rows: SprintVelocity[], keys: ProviderKeys, preferred?: CloudProvider): Promise<{ ok: boolean; text?: string; error?: string }> {
  if (rows.length === 0) return { ok: false, error: "No sprints to explain yet." };
  const { values, label } = velocityMetric(rows);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const system = "You explain agile sprint-velocity charts to a project manager in plain English. Reply in 3-5 sentences, no markdown, no headers, no bullet points. Call out the trend (rising/falling/flat), any notable spike or drop and a likely reason a PM would care about it, and what the average suggests for planning the next sprint.";
  const lines = rows.map((r, i) => `${r.sprintName}: ${values[i]} ${label} (${r.completedCount}/${r.totalCount} items completed)`);
  const prompt = `Sprint velocity, in chronological order:\n${lines.join("\n")}\n\nAverage: ${avg.toFixed(1)} ${label} per sprint.`;
  const r = await ask(prompt, system, keys, preferred);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, text: (r.text || "").trim() };
}
