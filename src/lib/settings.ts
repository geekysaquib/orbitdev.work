import { supabase } from "./supabase";

/**
 * Durable per-user settings, stored in a `user_settings` table:
 *   create table user_settings (
 *     user_id uuid primary key references auth.users on delete cascade,
 *     data jsonb not null default '{}'::jsonb,
 *     updated_at timestamptz not null default now()
 *   );
 *   alter table user_settings enable row level security;
 *   create policy "own settings" on user_settings
 *     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
 *
 * If the table doesn't exist yet, every call fails soft and the app falls back
 * to localStorage, so nothing breaks before the migration is applied.
 */
export interface OrbitSettings {
  on_break?: boolean;
  break_started_at?: string | null;
  timer_paused?: boolean;
  timezone?: string;
}

const TABLE = "user_settings";

export async function fetchSettings(): Promise<OrbitSettings> {
  try {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return {};
    const { data, error } = await supabase.from(TABLE).select("data").eq("user_id", u.user.id).maybeSingle();
    if (error) return {};
    return ((data?.data as OrbitSettings) || {});
  } catch { return {}; }
}

export async function saveSettings(patch: OrbitSettings): Promise<void> {
  try {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const current = await fetchSettings();
    const merged = { ...current, ...patch };
    await supabase.from(TABLE).upsert({ user_id: u.user.id, data: merged, updated_at: new Date().toISOString() });
  } catch { /* table may not exist yet — localStorage remains the fallback */ }
}
