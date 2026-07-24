import type { Handler } from "@netlify/functions";
import { randomBytes, createHash } from "node:crypto";
import { dbSelect, dbInsert, dbUpdate, dbDelete, dbRpc } from "./_lib/db";
import { sendMail } from "./_lib/mailer";
import { teamInviteEmail } from "./_lib/email-templates";
import { verifySession } from "./_lib/verifyToken";
import { serverEventEngine } from "./_lib/serverEvents";
import { validateImageDataUrl } from "./_lib/imageValidation";
import { rateLimit } from "./_lib/rateLimit";
import { maskEmail } from "./_lib/mailLog";

/**
 * Fire-and-forget, same principle as every other event-publish call in this
 * codebase — a failed publish must never affect a team-membership response
 * that already succeeded. `userId` here is the *subject* of the membership
 * change (who joined/left/was re-roled), not necessarily the caller —
 * consistent with the payload's own `userId` field, and it still means the
 * affected person can see this in their own history later via
 * domain_events' owner-select RLS policy, even after leaving the team. See
 * docs/architecture/event-engine-adoption.md.
 */
function publishTeamEvent(type: string, teamId: string, userId: string, payload: Record<string, unknown>): void {
  void serverEventEngine.publish({ source: "team-workflow", type, occurredAt: new Date().toISOString(), userId, teamId, payload }).catch(() => {});
}

/**
 * Everything that changes who's on a team lives here, behind the
 * service-role key — team_members/team_invites have no client-facing write
 * policies in supabase/schema.sql on purpose (see the comment there). That
 * keeps exactly one file to audit for "can this request change team
 * membership," instead of relying on RLS to get a self-insert-as-owner edge
 * case right.
 *
 * Routes (dispatched by ?action=), all POST except preview-invite (GET):
 *   create            { name }                               -> new team, caller becomes owner
 *   invite            { team_id, email, role? }               -> owner/admin only
 *   resend-invite     { invite_id }                            -> owner/admin only
 *   revoke-invite     { invite_id }                            -> owner/admin only
 *   preview-invite    ?token=                                  -> public, read-only
 *   accept-invite     { token }                                -> authenticated, email must match
 *   remove-member     { team_id, user_id }                     -> owner/admin only
 *   change-role       { team_id, user_id, role }                -> owner only
 *   transfer-ownership{ team_id, new_owner_user_id }            -> owner only
 *   leave             { team_id }                               -> any member except a sole owner
 *   update            { team_id, name, logo_data_url? }          -> owner/admin only
 *   delete            { team_id }                                -> owner only; notifies every other member
 */

interface TeamRow { id: string; name: string; owner_id: string; logo_data_url: string | null; created_at: string; }
interface TeamMemberRow { team_id: string; user_id: string; role: "owner" | "admin" | "member" | "viewer"; joined_at: string; }
interface TeamInviteRow {
  id: string; team_id: string; email: string; role: "admin" | "member" | "viewer"; token_hash: string;
  invited_by: string; status: string; expires_at: string; accepted_at: string | null; created_at: string;
}
interface UserRow { id: string; email: string; full_name: string; }

const INVITE_TTL_DAYS = 7;
const RESEND_COOLDOWN_SEC = 60;
const TEAM_NAME_MAX = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_SITE_URL = (process.env.PUBLIC_SITE_URL || "").replace(/\/+$/, "");

const json = (statusCode: number, data: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

function genToken(): string {
  return randomBytes(32).toString("base64url");
}
function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// Defense in depth: every call site below validates its id fields as UUIDs
// before calling these, but these shared helpers guard too — a non-UUID
// value (e.g. containing `&`) must never reach a raw PostgREST filter string.
async function membershipRole(teamId: string, userId: string): Promise<"owner" | "admin" | "member" | "viewer" | null> {
  if (!UUID_RE.test(teamId) || !UUID_RE.test(userId)) return null;
  const rows = await dbSelect<TeamMemberRow>("team_members", `team_id=eq.${teamId}&user_id=eq.${userId}&limit=1`);
  return rows[0]?.role ?? null;
}

async function findUserByEmail(email: string): Promise<UserRow | null> {
  const rows = await dbSelect<UserRow>("users", `email=eq.${encodeURIComponent(email)}&limit=1`);
  return rows[0] ?? null;
}

async function findUserById(id: string): Promise<UserRow | null> {
  if (!UUID_RE.test(id)) return null;
  const rows = await dbSelect<UserRow>("users", `id=eq.${id}&limit=1&select=id,email,full_name`);
  return rows[0] ?? null;
}

export const handler: Handler = async (event) => {
  const action = event.queryStringParameters?.action || "";

  if (action === "preview-invite") {
    if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });
    const token = event.queryStringParameters?.token || "";
    if (!token) return json(400, { error: "Missing token." });
    try {
      const rows = await dbSelect<TeamInviteRow>(
        "team_invites",
        `token_hash=eq.${hashToken(token)}&status=eq.pending&limit=1`,
      );
      const invite = rows[0];
      if (!invite || new Date(invite.expires_at).getTime() < Date.now()) {
        return json(404, { error: "This invite is invalid or has expired." });
      }
      const [team, inviter] = await Promise.all([
        dbSelect<TeamRow>("teams", `id=eq.${invite.team_id}&limit=1`),
        findUserById(invite.invited_by),
      ]);
      return json(200, {
        team_name: team[0]?.name ?? "a team",
        invited_by_name: inviter?.full_name || inviter?.email || "Someone",
        email: maskEmail(invite.email),
      });
    } catch (e) {
      console.error("[teams] preview-invite", e);
      return json(500, { error: "Something went wrong. Please try again." });
    }
  }

  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const session = await verifySession(event.headers.authorization);
  if (!session) return json(401, { error: "Sign in required." });

  let body: Record<string, unknown>;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid request body." }); }

  try {
    switch (action) {
      case "create": {
        const name = String(body.name || "").trim();
        if (!name || name.length > TEAM_NAME_MAX) return json(400, { error: `Team name must be 1–${TEAM_NAME_MAX} characters.` });
        const logo = validateImageDataUrl(body.logo_data_url, "Logo");
        if (logo && typeof logo === "object") return json(400, { error: logo.error });

        // One atomic DB-function call (see create_team_with_owner in supabase/schema.sql)
        // instead of insert-team-then-insert-member with a manual compensating delete.
        const team = await dbRpc<TeamRow>("create_team_with_owner", { p_name: name, p_owner_id: session.userId, p_logo_data_url: logo });
        publishTeamEvent("member_joined", team.id, session.userId, { role: "owner" });
        return json(200, { team, role: "owner" });
      }

      case "invite": {
        const teamId = String(body.team_id || "");
        if (!UUID_RE.test(teamId)) return json(400, { error: "Invalid team id." });
        const email = String(body.email || "").trim().toLowerCase();
        const role = body.role === "admin" ? "admin" : body.role === "viewer" ? "viewer" : "member";
        if (!EMAIL_RE.test(email)) return json(400, { error: "Enter a valid email address." });

        const callerRole = await membershipRole(teamId, session.userId);
        if (callerRole !== "owner" && callerRole !== "admin") return json(403, { error: "Only team owners/admins can invite." });

        // The cooldown below (RESEND_COOLDOWN_SEC) only throttles re-inviting
        // the SAME email — nothing capped how many DIFFERENT addresses one
        // inviter could send to, i.e. the actual sendMail()-as-spam surface.
        const inviteRl = rateLimit(`teams-invite:${session.userId}`, 20, 3_600_000);
        if (!inviteRl.allowed) return json(429, { error: `Too many invites sent — try again in ${Math.ceil(inviteRl.retryAfterSec / 60)} minute(s).` });

        const existingUser = await findUserByEmail(email);
        if (existingUser && (await membershipRole(teamId, existingUser.id))) {
          return json(200, { ok: true }); // already a member — quietly a no-op
        }

        const pending = await dbSelect<TeamInviteRow>(
          "team_invites",
          `team_id=eq.${teamId}&email=eq.${encodeURIComponent(email)}&status=eq.pending&limit=1`,
        );
        if (pending[0]) {
          const ageSec = (Date.now() - new Date(pending[0].created_at).getTime()) / 1000;
          if (ageSec < RESEND_COOLDOWN_SEC) return json(429, { error: `Please wait ${Math.ceil(RESEND_COOLDOWN_SEC - ageSec)}s before resending.` });
        }

        const [team, inviter] = await Promise.all([
          dbSelect<TeamRow>("teams", `id=eq.${teamId}&limit=1`),
          findUserById(session.userId),
        ]);
        if (!team[0]) return json(404, { error: "Team not found." });
        if (!PUBLIC_SITE_URL) return json(500, { error: "Server misconfigured — PUBLIC_SITE_URL is not set." });

        const token = genToken();
        const token_hash = hashToken(token);
        const expires_at = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString();

        if (pending[0]) {
          await dbUpdate("team_invites", `id=eq.${pending[0].id}`, { token_hash, role, invited_by: session.userId, expires_at, created_at: new Date().toISOString() });
        } else {
          await dbInsert("team_invites", { team_id: teamId, email, role, token_hash, invited_by: session.userId, expires_at });
        }

        const tpl = teamInviteEmail(inviter?.full_name || inviter?.email || "Someone", team[0].name, `${PUBLIC_SITE_URL}/invite/${token}`);
        await sendMail(email, tpl.subject, tpl.html, tpl.text, "team_invite");
        return json(200, { ok: true });
      }

      case "resend-invite": {
        const inviteId = String(body.invite_id || "");
        if (!UUID_RE.test(inviteId)) return json(404, { error: "Invite not found." });
        const rows = await dbSelect<TeamInviteRow>("team_invites", `id=eq.${inviteId}&limit=1`);
        const invite = rows[0];
        if (!invite || invite.status !== "pending") return json(404, { error: "Invite not found." });

        const callerRole = await membershipRole(invite.team_id, session.userId);
        if (callerRole !== "owner" && callerRole !== "admin") return json(403, { error: "Only team owners/admins can resend invites." });

        const ageSec = (Date.now() - new Date(invite.created_at).getTime()) / 1000;
        if (ageSec < RESEND_COOLDOWN_SEC) return json(429, { error: `Please wait ${Math.ceil(RESEND_COOLDOWN_SEC - ageSec)}s before resending.` });

        const [team, inviter] = await Promise.all([
          dbSelect<TeamRow>("teams", `id=eq.${invite.team_id}&limit=1`),
          findUserById(session.userId),
        ]);
        if (!PUBLIC_SITE_URL) return json(500, { error: "Server misconfigured — PUBLIC_SITE_URL is not set." });

        const token = genToken();
        const token_hash = hashToken(token);
        const expires_at = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString();
        await dbUpdate("team_invites", `id=eq.${invite.id}`, { token_hash, expires_at, created_at: new Date().toISOString() });

        const tpl = teamInviteEmail(inviter?.full_name || inviter?.email || "Someone", team[0]?.name ?? "the team", `${PUBLIC_SITE_URL}/invite/${token}`);
        await sendMail(invite.email, tpl.subject, tpl.html, tpl.text, "team_invite_resend");
        return json(200, { ok: true });
      }

      case "revoke-invite": {
        const inviteId = String(body.invite_id || "");
        if (!UUID_RE.test(inviteId)) return json(200, { ok: true });
        const rows = await dbSelect<TeamInviteRow>("team_invites", `id=eq.${inviteId}&limit=1`);
        const invite = rows[0];
        if (!invite) return json(200, { ok: true });

        const callerRole = await membershipRole(invite.team_id, session.userId);
        if (callerRole !== "owner" && callerRole !== "admin") return json(403, { error: "Only team owners/admins can revoke invites." });

        await dbUpdate("team_invites", `id=eq.${invite.id}`, { status: "revoked" });
        return json(200, { ok: true });
      }

      case "accept-invite": {
        const token = String(body.token || "");
        if (!token) return json(400, { error: "Missing token." });

        const rows = await dbSelect<TeamInviteRow>("team_invites", `token_hash=eq.${hashToken(token)}&status=eq.pending&limit=1`);
        const invite = rows[0];
        if (!invite) return json(404, { error: "This invite is invalid or has already been used." });
        if (new Date(invite.expires_at).getTime() < Date.now()) {
          await dbUpdate("team_invites", `id=eq.${invite.id}`, { status: "expired" });
          return json(400, { error: "This invite has expired — ask for a new one." });
        }
        if (invite.email.toLowerCase() !== session.email.toLowerCase()) {
          return json(403, { error: `This invite was sent to ${maskEmail(invite.email)} — sign in with that email to accept it.` });
        }

        const existingRole = await membershipRole(invite.team_id, session.userId);
        if (!existingRole) {
          await dbInsert("team_members", { team_id: invite.team_id, user_id: session.userId, role: invite.role });
          publishTeamEvent("member_joined", invite.team_id, session.userId, { role: invite.role });
        }
        await dbUpdate("team_invites", `id=eq.${invite.id}`, { status: "accepted", accepted_at: new Date().toISOString() });

        const team = await dbSelect<TeamRow>("teams", `id=eq.${invite.team_id}&limit=1`);
        return json(200, { ok: true, team_id: invite.team_id, team_name: team[0]?.name ?? "" });
      }

      case "remove-member": {
        const teamId = String(body.team_id || "");
        const targetId = String(body.user_id || "");
        if (!UUID_RE.test(teamId) || !UUID_RE.test(targetId)) return json(400, { error: "Invalid id." });
        const callerRole = await membershipRole(teamId, session.userId);
        if (callerRole !== "owner" && callerRole !== "admin") return json(403, { error: "Only team owners/admins can remove members." });

        const targetRole = await membershipRole(teamId, targetId);
        if (!targetRole) return json(200, { ok: true });
        if (targetRole === "owner") return json(400, { error: "The owner can't be removed — transfer ownership first." });
        if (callerRole === "admin" && targetRole === "admin") return json(403, { error: "Admins can't remove other admins." });

        await dbDelete("team_members", `team_id=eq.${teamId}&user_id=eq.${targetId}`);
        publishTeamEvent("member_left", teamId, targetId, {});
        return json(200, { ok: true });
      }

      case "change-role": {
        const teamId = String(body.team_id || "");
        const targetId = String(body.user_id || "");
        if (!UUID_RE.test(teamId) || !UUID_RE.test(targetId)) return json(400, { error: "Invalid id." });
        const role = body.role === "admin" ? "admin" : body.role === "viewer" ? "viewer" : "member";
        const callerRole = await membershipRole(teamId, session.userId);
        if (callerRole !== "owner") return json(403, { error: "Only the team owner can change roles." });

        const targetRole = await membershipRole(teamId, targetId);
        if (!targetRole) return json(404, { error: "That person isn't a member of this team." });
        if (targetRole === "owner") return json(400, { error: "Use transfer-ownership to change the owner." });

        await dbUpdate("team_members", `team_id=eq.${teamId}&user_id=eq.${targetId}`, { role });
        publishTeamEvent("member_role_changed", teamId, targetId, { role, previousRole: targetRole });
        return json(200, { ok: true });
      }

      case "transfer-ownership": {
        const teamId = String(body.team_id || "");
        const newOwnerId = String(body.new_owner_user_id || "");
        if (!UUID_RE.test(teamId) || !UUID_RE.test(newOwnerId)) return json(400, { error: "Invalid id." });
        const callerRole = await membershipRole(teamId, session.userId);
        if (callerRole !== "owner") return json(403, { error: "Only the current owner can transfer ownership." });

        const newOwnerRole = await membershipRole(teamId, newOwnerId);
        if (!newOwnerRole) return json(400, { error: "The new owner must already be a member of this team." });

        // Atomic: promote/demote/re-point owner_id all in one DB-function call, so a
        // mid-sequence failure can't leave two "owners" or an unset teams.owner_id.
        await dbRpc("transfer_team_ownership", { p_team_id: teamId, p_old_owner_id: session.userId, p_new_owner_id: newOwnerId });
        return json(200, { ok: true });
      }

      case "leave": {
        const teamId = String(body.team_id || "");
        if (!UUID_RE.test(teamId)) return json(200, { ok: true });
        const callerRole = await membershipRole(teamId, session.userId);
        if (!callerRole) return json(200, { ok: true });
        if (callerRole === "owner") return json(400, { error: "Transfer ownership or delete the team before leaving." });

        await dbDelete("team_members", `team_id=eq.${teamId}&user_id=eq.${session.userId}`);
        publishTeamEvent("member_left", teamId, session.userId, {});
        return json(200, { ok: true });
      }

      case "update": {
        const teamId = String(body.team_id || "");
        if (!UUID_RE.test(teamId)) return json(400, { error: "Invalid team id." });
        const name = String(body.name || "").trim();
        if (!name || name.length > TEAM_NAME_MAX) return json(400, { error: `Team name must be 1–${TEAM_NAME_MAX} characters.` });
        const logo = validateImageDataUrl(body.logo_data_url, "Logo");
        if (logo && typeof logo === "object") return json(400, { error: logo.error });

        const callerRole = await membershipRole(teamId, session.userId);
        if (callerRole !== "owner" && callerRole !== "admin") return json(403, { error: "Only team owners/admins can edit the team." });

        await dbUpdate("teams", `id=eq.${teamId}`, { name, logo_data_url: logo });
        const rows = await dbSelect<TeamRow>("teams", `id=eq.${teamId}&limit=1`);
        if (!rows[0]) return json(404, { error: "Team not found." });
        return json(200, { team: rows[0] });
      }

      // Members/invites cascade-delete with the team row itself (see the FKs
      // on team_members/team_invites in supabase/schema.sql) — nothing to
      // clean up by hand there. Shared projects/tasks keep existing (their
      // team_id just goes null, "on delete set null"), same as any other
      // un-share. The audit row has to be written *before* the delete: its
      // team_id column FKs to teams.id, and that reference must resolve at
      // INSERT time — "on delete set null" only rewrites rows that already
      // existed when the delete happened, it doesn't let a brand new row
      // point at an id that's already gone.
      case "delete": {
        const teamId = String(body.team_id || "");
        if (!UUID_RE.test(teamId)) return json(400, { error: "Invalid team id." });

        const callerRole = await membershipRole(teamId, session.userId);
        if (callerRole !== "owner") return json(403, { error: "Only the team owner can delete the team." });

        const [team, members, actor] = await Promise.all([
          dbSelect<TeamRow>("teams", `id=eq.${teamId}&limit=1`),
          dbSelect<TeamMemberRow>("team_members", `team_id=eq.${teamId}`),
          findUserById(session.userId),
        ]);
        if (!team[0]) return json(200, { ok: true });

        await dbInsert("audit_log", {
          user_id: session.userId, team_id: teamId, action: "team.delete",
          entity_type: "team", entity_id: teamId, meta: { name: team[0].name },
        });

        await dbDelete("teams", `id=eq.${teamId}`);

        // Best-effort — a failed notification fan-out must never undo an
        // already-successful delete. Only teammates other than the caller
        // get one; the person who just clicked "delete" doesn't need to be
        // told their own team is gone.
        const actorName = actor?.full_name || actor?.email || "The team owner";
        const others = members.filter((m) => m.user_id !== session.userId);
        void Promise.all(others.map((m) => dbInsert("notifications", {
          user_id: m.user_id, kind: "team_deleted", title: "Team deleted",
          body: `${actorName} deleted the "${team[0].name}" team.`, link: "/teams",
        }))).catch((e) => console.error("[teams] delete notify failed:", e));

        return json(200, { ok: true });
      }

      default:
        return json(400, { error: "Unknown action." });
    }
  } catch (e) {
    console.error("[teams]", e);
    return json(500, { error: "Something went wrong. Please try again." });
  }
};
