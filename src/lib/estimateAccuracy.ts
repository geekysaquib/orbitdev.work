/**
 * Estimate accuracy (planned vs actual) — joins tasks.estimate_minutes with the
 * sum of time_entries.seconds logged against that task (see timer.ts's
 * task-attribution support). Only tasks with an estimate set are included; a
 * task with an estimate but zero logged time still shows up (0m actual) so a
 * "never actually worked yet" gap is visible, not silently dropped.
 */
import { supabase } from "./supabase";
import type { Task, TaskStatus } from "./types";

export interface EstimateRow {
  taskId: string; title: string; projectId: string | null; status: TaskStatus;
  estimateMinutes: number; actualMinutes: number;
  varianceMinutes: number; variancePct: number | null;
}

export async function fetchEstimateAccuracy(tasks: Task[]): Promise<EstimateRow[]> {
  const estimated = tasks.filter((t): t is Task & { estimate_minutes: number } => t.estimate_minutes != null);
  if (estimated.length === 0) return [];

  const { data, error } = await supabase
    .from("time_entries")
    .select("task_id, seconds")
    .in("task_id", estimated.map((t) => t.id));
  if (error) throw new Error(error.message);

  const secondsByTask: Record<string, number> = {};
  for (const row of data ?? []) {
    if (!row.task_id) continue;
    secondsByTask[row.task_id] = (secondsByTask[row.task_id] ?? 0) + row.seconds;
  }

  return estimated
    .map((t) => {
      const actualMinutes = Math.round((secondsByTask[t.id] ?? 0) / 60);
      const varianceMinutes = actualMinutes - t.estimate_minutes;
      const variancePct = t.estimate_minutes > 0 ? Math.round((varianceMinutes / t.estimate_minutes) * 100) : null;
      return {
        taskId: t.id, title: t.title, projectId: t.project_id, status: t.status,
        estimateMinutes: t.estimate_minutes, actualMinutes, varianceMinutes, variancePct,
      };
    })
    .sort((a, b) => Math.abs(b.varianceMinutes) - Math.abs(a.varianceMinutes));
}
