/**
 * Team system client. Reads (listing teams/members/invites) go straight to
 * Postgres via the `supabase` client — RLS already scopes them correctly.
 * Writes that change membership go through netlify/functions/teams.ts, which
 * holds the service-role key and does the authorization checks; see the
 * comment at the top of that file and in supabase/schema.sql for why.
 */
import { supabase } from "./supabase";
import { postJson } from "./apiClient";
import type { Team, TeamMember, TeamInvite, TeamRole } from "./types";

const FN = "/.netlify/functions/teams";

function call<T = Record<string, never>>(action: string, payload: Record<string, unknown>) {
  return postJson<T>(`${FN}?action=${action}`, payload);
}

// ---------- reads ----------

export async function listMyTeams(): Promise<Team[]> {
  const { data, error } = await supabase.from("teams").select("*").order("created_at");
  if (error) throw error;
  return data ?? [];
}

interface MemberRow { team_id: string; user_id: string; role: TeamRole; joined_at: string; users: { full_name: string; email: string } | null; }

export async function listMembers(teamId: string): Promise<TeamMember[]> {
  const { data, error } = await supabase
    .from("team_members")
    .select("team_id, user_id, role, joined_at, users(full_name, email)")
    .eq("team_id", teamId)
    .order("joined_at");
  if (error) throw error;
  return ((data ?? []) as unknown as MemberRow[]).map((row) => ({
    team_id: row.team_id, user_id: row.user_id, role: row.role, joined_at: row.joined_at,
    full_name: row.users?.full_name, email: row.users?.email,
  }));
}

export async function listInvites(teamId: string): Promise<TeamInvite[]> {
  const { data, error } = await supabase.from("team_invites").select("*").eq("team_id", teamId).eq("status", "pending").order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ---------- writes (via the Netlify function) ----------

export async function createTeam(name: string, logoDataUrl?: string | null) {
  return call<{ team: Team; role: TeamRole }>("create", { name, logo_data_url: logoDataUrl ?? null });
}
export async function inviteMember(teamId: string, email: string, role: Exclude<TeamRole, "owner"> = "member") {
  return call("invite", { team_id: teamId, email, role });
}
export async function resendInvite(inviteId: string) {
  return call("resend-invite", { invite_id: inviteId });
}
export async function revokeInvite(inviteId: string) {
  return call("revoke-invite", { invite_id: inviteId });
}
export async function removeMember(teamId: string, userId: string) {
  return call("remove-member", { team_id: teamId, user_id: userId });
}
export async function changeRole(teamId: string, userId: string, role: Exclude<TeamRole, "owner">) {
  return call("change-role", { team_id: teamId, user_id: userId, role });
}
export async function transferOwnership(teamId: string, newOwnerUserId: string) {
  return call("transfer-ownership", { team_id: teamId, new_owner_user_id: newOwnerUserId });
}
export async function leaveTeam(teamId: string) {
  return call("leave", { team_id: teamId });
}
export async function updateTeam(teamId: string, name: string, logoDataUrl?: string | null) {
  return call<{ team: Team }>("update", { team_id: teamId, name, logo_data_url: logoDataUrl ?? null });
}
export async function deleteTeam(teamId: string) {
  return call("delete", { team_id: teamId });
}
export async function acceptInvite(token: string) {
  return call<{ team_id: string; team_name: string }>("accept-invite", { token });
}

export async function previewInvite(token: string): Promise<{ ok: true; team_name: string; invited_by_name: string; email: string } | { ok: false; error: string }> {
  try {
    const r = await fetch(`${FN}?action=preview-invite&token=${encodeURIComponent(token)}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: (j as { error?: string }).error || `Request failed (${r.status})` };
    return { ok: true, ...(j as { team_name: string; invited_by_name: string; email: string }) };
  } catch {
    return { ok: false, error: "Couldn't reach ORBIT — check your connection and try again." };
  }
}
