import { supabase } from "./supabase";
import { getUser } from "./auth";

const localKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Save a completed focus-timer session to Supabase (Orbit hours). */
export async function logOrbitSession(seconds: number, projectId?: string | null) {
  if (seconds < 1) return;
  const u = getUser();
  if (!u) return;
  const now = new Date();
  await supabase.from("time_entries").insert({
    user_id: u.id,
    project_id: projectId ?? null,
    started_at: new Date(now.getTime() - seconds * 1000).toISOString(),
    ended_at: now.toISOString(),
    seconds,
  } as never);
}

export interface OrbitHours { todayH: number; totalH: number; }
export async function fetchOrbitHours(): Promise<OrbitHours> {
  const { data } = await supabase.from("time_entries").select("seconds,started_at");
  const rows = (data ?? []) as { seconds: number; started_at: string }[];
  const todayKey = localKey(new Date());
  let today = 0, total = 0;
  for (const r of rows) {
    total += r.seconds;
    if (localKey(new Date(r.started_at)) === todayKey) today += r.seconds;
  }
  return { todayH: +(today / 3600).toFixed(2), totalH: +(total / 3600).toFixed(2) };
}
