import { supabase } from "./supabase";
import { getUser } from "./auth";
import { getOnline } from "./offline";
import type { Json } from "./database.types";

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
  notifications?: import("./notifications").NotificationPrefs;
  theme?: import("../context/Theme").ThemeId;
  accent?: import("../context/Theme").AccentId;
  accent_custom_hex?: string;
  font?: import("../context/Theme").FontId;
  density?: import("../context/Theme").DensityId;
  dashboard_layout?: import("./dashboardLayout").DashboardLayout;
  /** ISO timestamp when the onboarding wizard was completed or explicitly skipped; unset = never seen. */
  onboarded_at?: string | null;
  /** Plain-text signature auto-appended to new Compose drafts (not replies-in-place — user can still edit/remove it). */
  mail_signature?: string;
  /** Auto-pause the focus timer after N idle minutes on this tab — browser-tab-based only, see src/hooks/useIdleDetection.ts. */
  idle_detection_enabled?: boolean;
  idle_minutes?: number;
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
    if (!getOnline()) return;
    const u = getUser();
    if (!u) return;
    // A single atomic DB-side merge (see merge_user_settings in supabase/schema.sql)
    // instead of fetch-then-merge-then-upsert, which two concurrent saves (e.g.
    // starting a break while a timezone change is in flight) could race on.
    const { error } = await supabase.rpc("merge_user_settings", { p_patch: patch as Json });
    if (error) throw error;
  } catch { /* table/function may not exist yet — localStorage remains the fallback */ }
}
