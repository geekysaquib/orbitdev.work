import { supabase } from "./supabase";
import { getUser } from "./auth";

export type FocusEventType = "idle" | "resume" | "route_change";

/**
 * Best-effort write to the focus_events log (see supabase/schema.sql) — the
 * raw material for the focus-analytics view planned for src/routes/Insights.tsx
 * (context-switching cost, most-interrupted hours, deep-work trends). Nothing
 * reads this yet; it's fire-and-forget instrumentation so data is already
 * there once that view exists.
 */
export async function logFocusEvent(type: FocusEventType, opts?: { projectId?: string | null; route?: string }): Promise<void> {
  const u = getUser();
  if (!u) return;
  await supabase.from("focus_events").insert({
    user_id: u.id,
    project_id: opts?.projectId ?? null,
    type,
    route: opts?.route ?? null,
  });
}
