import { supabase } from "./supabase";

/**
 * Chore history for breaks. Requires:
 *   create table break_logs (
 *     id uuid primary key default gen_random_uuid(),
 *     user_id uuid not null references auth.users on delete cascade,
 *     started_at timestamptz not null,
 *     ended_at timestamptz not null,
 *     seconds int not null default 0,
 *     beverage text,
 *     rows jsonb not null default '[]'::jsonb,
 *     summary jsonb not null default '{}'::jsonb,
 *     created_at timestamptz not null default now()
 *   );
 *   alter table break_logs enable row level security;
 *   create policy "own break logs" on break_logs
 *     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
 *
 * Fails soft: if the table isn't there, the break still ends cleanly.
 */
export interface BreakLogRow { icon: string; title: string; meta: string; delta: string; tone: string; href?: string | null; }
export interface BreakSummary { chores: number; pulled: number; bugs: number; issues: number; }

export interface BreakLog {
  id: string; started_at: string; ended_at: string; seconds: number;
  beverage: string | null; rows: BreakLogRow[]; summary: BreakSummary;
}

export async function saveBreakLog(input: {
  startedAt: number; seconds: number; beverage: string; rows: BreakLogRow[]; summary: BreakSummary;
}): Promise<void> {
  try {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase.from("break_logs").insert({
      user_id: u.user.id,
      started_at: new Date(input.startedAt).toISOString(),
      ended_at: new Date().toISOString(),
      seconds: input.seconds,
      beverage: input.beverage,
      rows: input.rows,
      summary: input.summary,
    } as never);
  } catch { /* table may not exist yet */ }
}

export async function fetchBreakLogs(limit = 20): Promise<BreakLog[]> {
  try {
    const { data, error } = await supabase.from("break_logs").select("*").order("ended_at", { ascending: false }).limit(limit);
    if (error) return [];
    return (data ?? []) as unknown as BreakLog[];
  } catch { return []; }
}

/** Push a notification so a warning found mid-break outlives the break screen. */
export async function notify(kind: string, title: string, body?: string): Promise<void> {
  try {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase.from("notifications").insert({ user_id: u.user.id, kind, title, body: body ?? null, read: false } as never);
  } catch { /* noop */ }
}
