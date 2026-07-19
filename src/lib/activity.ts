import { ACCENT } from "../components/ui";
import { supabase } from "./supabase";
import type { TeamActivity } from "./types";

/** Shared with Teams.tsx's Activity section. Only actions that can carry a team_id ever show up here. */
export const ACTION_META: Record<string, { icon: string; color: string; verb: string }> = {
  "task.create": { icon: "layers", color: ACCENT.blue, verb: "created a task" },
  "task.update": { icon: "layers", color: ACCENT.blue, verb: "updated a task" },
  "task.delete": { icon: "layers", color: ACCENT.red, verb: "deleted a task" },
  "project.create": { icon: "boxes", color: ACCENT.mint, verb: "created a project" },
  "project.update": { icon: "boxes", color: ACCENT.mint, verb: "updated a project" },
  "project.delete": { icon: "boxes", color: ACCENT.red, verb: "deleted a project" },
  "project.link_repo": { icon: "git", color: ACCENT.violet, verb: "linked a repo to" },
  "project.unlink_repo": { icon: "git", color: ACCENT.dim, verb: "unlinked a repo from" },
  "team.invite": { icon: "users", color: ACCENT.amber, verb: "invited someone to" },
  "team.join": { icon: "users", color: ACCENT.mint, verb: "joined" },
  "team.remove_member": { icon: "users", color: ACCENT.red, verb: "removed a member from" },
  "team.transfer_ownership": { icon: "users", color: ACCENT.violet, verb: "transferred ownership of" },
};
const DEFAULT_META = { icon: "activity", color: ACCENT.muted, verb: "did something with" };

export function activityMeta(action: string) {
  return ACTION_META[action] || DEFAULT_META;
}
/** The one detail worth showing under the verb — whichever the call site happened to log. */
export function activityDetail(row: TeamActivity): string | null {
  const m = row.meta as Record<string, unknown>;
  return (m.title as string) || (m.name as string) || (m.repo_full_name as string) || (m.email as string) || null;
}

interface ActivityRow extends TeamActivity { users: { full_name: string; email: string } | null; }

export async function fetchTeamActivity(teamId: string, opts: { page?: number; pageSize?: number } = {}): Promise<{ rows: TeamActivity[]; total: number; error?: string }> {
  const page = opts.page ?? 0;
  const pageSize = opts.pageSize ?? 30;
  const { data, error, count } = await supabase
    .from("audit_log")
    .select("*, users(full_name, email)", { count: "exact" })
    .eq("team_id", teamId)
    .order("created_at", { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) return { rows: [], total: 0, error: error.message };
  const rows = ((data ?? []) as unknown as ActivityRow[]).map((row) => ({
    id: row.id, user_id: row.user_id, team_id: row.team_id, action: row.action, entity_type: row.entity_type,
    entity_id: row.entity_id, meta: row.meta, created_at: row.created_at,
    full_name: row.users?.full_name, email: row.users?.email,
  }));
  return { rows, total: count ?? 0 };
}

/** Live top-up for the feed — a fresh row has no joined author name yet, so the caller re-fetches page 0 rather than trying to splice this in directly. */
export function subscribeTeamActivity(teamId: string, onInsert: () => void) {
  const channel = supabase
    .channel(`activity:team:${teamId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "audit_log", filter: `team_id=eq.${teamId}` }, onInsert)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
