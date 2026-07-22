import { supabase } from "./supabase";
import { getUser } from "./auth";

/**
 * Save a completed focus-timer session to Supabase (Orbit hours). Returns the
 * new row's id (or `null` if it no-op'd) so callers that need to reference
 * this specific session — e.g. `timer.ts`'s `timer-workflow.stopped` event —
 * don't have to re-query for it.
 */
export async function logOrbitSession(seconds: number, projectId?: string | null, taskId?: string | null): Promise<{ id: string } | null> {
  if (seconds < 1) return null;
  const u = getUser();
  if (!u) return null;
  const now = new Date();
  const { data } = await supabase.from("time_entries").insert({
    user_id: u.id,
    project_id: projectId ?? null,
    task_id: taskId ?? null,
    started_at: new Date(now.getTime() - seconds * 1000).toISOString(),
    ended_at: now.toISOString(),
    seconds,
  }).select("id").single();
  return data ? { id: data.id as string } : null;
}

export interface OrbitHours { todayH: number; totalH: number; }
export async function fetchOrbitHours(): Promise<OrbitHours> {
  // Aggregated server-side (see orbit_hours in supabase/schema.sql) instead of
  // pulling every time_entries row ever created just to sum two numbers.
  // p_day_start is *this browser's* local midnight, not the DB server's, so
  // "today" still means the user's own local day.
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const { data, error } = await supabase.rpc("orbit_hours", { p_day_start: dayStart.toISOString() });
  if (error || !data) return { todayH: 0, totalH: 0 };
  const row = (Array.isArray(data) ? data[0] : data) as { today_seconds?: number; total_seconds?: number } | undefined;
  if (!row) return { todayH: 0, totalH: 0 };
  return {
    todayH: +((row.today_seconds ?? 0) / 3600).toFixed(2),
    totalH: +((row.total_seconds ?? 0) / 3600).toFixed(2),
  };
}
