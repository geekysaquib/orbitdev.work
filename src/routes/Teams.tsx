import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Icon } from "../lib/icons";
import { Select } from "../components/Select";
import { ACCENT, Empty } from "../components/ui";
import { useToast } from "../context/Toast";
import { useAuth } from "../context/AuthContext";
import {
  listMyTeams, listMembers, listInvites, createTeam, inviteMember,
  resendInvite, revokeInvite, removeMember, changeRole, leaveTeam,
} from "../lib/teams";
import type { Team, TeamMember, TeamInvite, TeamRole } from "../lib/types";

const ROLE_COLOR: Record<TeamRole, string> = { owner: ACCENT.violet, admin: ACCENT.blue, member: "var(--dim)" };
const TEAM_DOT_COLORS = [ACCENT.mint, ACCENT.blue, ACCENT.violet, ACCENT.amber];
function RoleBadge({ role }: { role: TeamRole }) {
  return <span className="tm-rolelabel" style={{ color: ROLE_COLOR[role] }}>{role.toUpperCase()}</span>;
}

export default function Teams() {
  const toast = useToast();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [newModal, setNewModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Exclude<TeamRole, "owner">>("member");
  const [inviting, setInviting] = useState(false);

  const loadTeams = async (selectId?: string) => {
    const t = await listMyTeams();
    setTeams(t);
    setTeamId((cur) => {
      const want = selectId ?? params.get("team") ?? cur;
      return want && t.some((x) => x.id === want) ? want : (t[0]?.id ?? null);
    });
  };
  useEffect(() => { loadTeams(); }, []); // eslint-disable-line

  const loadTeamDetail = () => {
    if (!teamId) { setMembers([]); setInvites([]); return; }
    listMembers(teamId).then(setMembers);
    listInvites(teamId).then(setInvites);
  };
  useEffect(loadTeamDetail, [teamId]); // eslint-disable-line

  function selectTeam(id: string) {
    setTeamId(id);
    setParams((p) => { p.set("team", id); return p; }, { replace: true });
  }

  const myRole = members.find((m) => m.user_id === user?.id)?.role ?? null;
  const canManageTeam = myRole === "owner" || myRole === "admin";
  const team = teams.find((t) => t.id === teamId) ?? null;

  async function handleCreateTeam() {
    const name = newTeamName.trim();
    if (!name) return;
    setCreatingTeam(true);
    const res = await createTeam(name);
    setCreatingTeam(false);
    if (!res.ok) { toast(`Couldn't create team: ${res.error}`); return; }
    setNewTeamName("");
    setNewModal(false);
    toast(`Created ${res.team.name}`);
    await loadTeams(res.team.id);
  }

  async function handleInvite() {
    if (!teamId) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    setInviting(true);
    const res = await inviteMember(teamId, email, inviteRole);
    setInviting(false);
    if (!res.ok) { toast(`Couldn't send invite: ${res.error}`); return; }
    setInviteEmail("");
    toast(`Invite sent to ${email}`);
    listInvites(teamId).then(setInvites);
  }

  async function handleRevoke(inviteId: string) {
    const res = await revokeInvite(inviteId);
    toast(res.ok ? "Invite revoked" : `Couldn't revoke invite: ${res.error}`);
    if (res.ok && teamId) listInvites(teamId).then(setInvites);
  }

  async function handleResend(inviteId: string) {
    const res = await resendInvite(inviteId);
    toast(res.ok ? "Invite resent" : `Couldn't resend invite: ${res.error}`);
  }

  async function handleRemoveMember(userId: string) {
    if (!teamId) return;
    const res = await removeMember(teamId, userId);
    toast(res.ok ? "Member removed" : `Couldn't remove member: ${res.error}`);
    if (res.ok) listMembers(teamId).then(setMembers);
  }

  async function handleChangeRole(userId: string, role: Exclude<TeamRole, "owner">) {
    if (!teamId) return;
    const res = await changeRole(teamId, userId, role);
    toast(res.ok ? "Role updated" : `Couldn't update role: ${res.error}`);
    if (res.ok) listMembers(teamId).then(setMembers);
  }

  async function handleLeaveTeam() {
    if (!teamId) return;
    const res = await leaveTeam(teamId);
    if (!res.ok) { toast(`Couldn't leave team: ${res.error}`); return; }
    toast("Left the team");
    await loadTeams();
  }

  return (
    <main className="page">
      <div className="rowhead">
        <div><div className="h1">Teams</div><div className="sub">Manage every team you're part of, invite people, and see what's shared where.</div></div>
        <button className="tm-addbtn" onClick={() => setNewModal(true)}><Icon name="plus" size={14} />New team</button>
      </div>

      {teams.length === 0 ? (
        <div style={{ marginTop: 22 }}>
          <Empty icon="users" title="No teams yet" sub="Create one to invite teammates by email and start sharing tasks &amp; projects." />
        </div>
      ) : (
        <div className="tm-shell">
          <nav className="team-rail">
            {teams.map((t, i) => {
              const mine = t.id === teamId;
              const color = TEAM_DOT_COLORS[i % TEAM_DOT_COLORS.length];
              return (
                <button key={t.id} className={"team-rail-item" + (mine ? " on" : "")} onClick={() => selectTeam(t.id)}>
                  <span className="trn" style={{ color: mine ? "var(--text)" : "var(--muted)" }}>
                    <span className="dot" style={{ background: color }} />{t.name}
                  </span>
                  <span className="trm">{t.owner_id === user?.id ? "You own this" : "Member"}</span>
                </button>
              );
            })}
            <button className="team-rail-newbtn" onClick={() => setNewModal(true)}><Icon name="plus" size={12} />New team</button>
          </nav>

          <section className="tm-detail">
            {team && (
              <>
                <div className="tm-dhead">
                  <div className="tm-dname">{team.name}</div>
                  {myRole && <span className="tm-drole" style={{ color: ROLE_COLOR[myRole] }}>{myRole.toUpperCase()}</span>}
                </div>
                <div className="tm-dsub">{members.length} member{members.length === 1 ? "" : "s"}{invites.length > 0 ? ` · ${invites.length} pending invite${invites.length === 1 ? "" : "s"}` : ""}</div>
                <div className="tm-divider" />

                {members.map((m) => {
                  const canSelectRole = myRole === "owner" && m.role !== "owner";
                  const canRemove = canManageTeam && m.role !== "owner" && m.user_id !== user?.id && !(myRole === "admin" && m.role === "admin");
                  const canLeave = m.user_id === user?.id && m.role !== "owner";
                  return (
                    <div className="tm-row" key={m.user_id}>
                      <div className="tm-name">
                        <span className="tm-nm">{m.full_name || m.email || m.user_id}</span>
                        <RoleBadge role={m.role} />
                      </div>
                      <span className="tm-email">{m.email}</span>
                      {(canSelectRole || canRemove || canLeave) && (
                        <div className="tm-actions">
                          {canSelectRole && (
                            <Select className="tm-role-select" chevron={false} value={m.role} onChange={(e) => handleChangeRole(m.user_id, e.target.value as Exclude<TeamRole, "owner">)}>
                              <option value="member">Member</option>
                              <option value="admin">Admin</option>
                            </Select>
                          )}
                          {canRemove && <button className="tm-remove" onClick={() => handleRemoveMember(m.user_id)}>Remove</button>}
                          {canLeave && <button className="tm-remove" onClick={handleLeaveTeam}>Leave</button>}
                        </div>
                      )}
                    </div>
                  );
                })}

                {canManageTeam && (
                  <>
                    <div className="eyebrow" style={{ margin: "32px 0 16px" }}>Invite someone</div>
                    <div className="tm-invite-row">
                      <input className="tm-uinput" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleInvite()} placeholder="teammate@company.com" />
                      <Select className="tm-usel" chevron={false} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Exclude<TeamRole, "owner">)}>
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </Select>
                      <button className="btn accent" disabled={inviting || !inviteEmail.trim()} onClick={handleInvite}>{inviting ? "Sending…" : "Send invite"}</button>
                    </div>
                    <div className="tm-note">They'll get an email with a link — it expires in 7 days and only works for that address.</div>

                    {invites.length > 0 && (
                      <>
                        <div className="eyebrow" style={{ margin: "32px 0 16px" }}>Pending invites</div>
                        {invites.map((inv) => (
                          <div className="tm-row" key={inv.id}>
                            <div className="tm-name"><span className="tm-nm">{inv.email}</span></div>
                            <span className="tm-email">{inv.role} · expires {new Date(inv.expires_at).toLocaleDateString()}</span>
                            <div className="tm-actions">
                              <button className="tm-resend" onClick={() => handleResend(inv.id)}>Resend</button>
                              <button className="tm-remove" onClick={() => handleRevoke(inv.id)}>Revoke</button>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {newModal && (
        <div className="modal-bg" onClick={() => setNewModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <h3>New team</h3>
              <button className="iconbtn" onClick={() => setNewModal(false)}><Icon name="x" size={16} /></button>
            </div>
            <div className="fld">
              <label>Team name</label>
              <input value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreateTeam()} placeholder="e.g. Meritech Core" autoFocus />
            </div>
            <div style={{ fontSize: 12, color: "var(--dim)", marginTop: 10 }}>You'll be the owner and can invite others by email afterward.</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 22 }}>
              <button className="btn" onClick={() => setNewModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleCreateTeam} disabled={creatingTeam || !newTeamName.trim()}>{creatingTeam ? "Creating…" : "Create team"}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
