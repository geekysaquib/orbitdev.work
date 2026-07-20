import { supabase } from "./supabase";
import { getUser } from "./auth";

/** Save a completed focus-timer session to Supabase (Orbit hours). */
export async function logOrbitSession(seconds: number, projectId?: string | null, taskId?: string | null) {
  if (seconds < 1) return;
  const u = getUser();
  if (!u) return;
  const now = new Date();
  await supabase.from("time_entries").insert({
    user_id: u.id,
    project_id: projectId ?? null,
    task_id: taskId ?? null,
    started_at: new Date(now.getTime() - seconds * 1000).toISOString(),
    ended_at: now.toISOString(),
    seconds,
  });
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
