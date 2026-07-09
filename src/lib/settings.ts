import { supabase } from "./supabase";
import { getUser } from "./auth";

/**
 * Durable per-user settings, stored in the `user_settings` table (see
 * supabase/schema.sql). If the table isn't there yet, every call fails soft
 * and the app falls back to localStorage, so nothing breaks before the
 * migration is applied.
 */
export interface OrbitSettings {
  on_break?: boolean;
  break_started_at?: string | null;
  timer_paused?: boolean;
  timezone?: string;
  chores?: import("./chores").ChoreSettings;
}

const TABLE = "user_settings";

export async function fetchSettings(): Promise<OrbitSettings> {
  try {
    const u = getUser();
    if (!u) return {};
    const { data, error } = await supabase.from(TABLE).select("data").eq("user_id", u.id).maybeSingle();
    if (error) return {};
    return ((data?.data as OrbitSettings) || {});
  } catch { return {}; }
}

export async function saveSettings(patch: OrbitSettings): Promise<void> {
  try {
    const u = getUser();
    if (!u) return;
    const current = await fetchSettings();
    const merged = { ...current, ...patch };
    await supabase.from(TABLE).upsert({ user_id: u.id, data: merged, updated_at: new Date().toISOString() });
  } catch { /* table may not exist yet — localStorage remains the fallback */ }
}
