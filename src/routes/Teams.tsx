import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { Icon } from "../lib/icons";
import { Select } from "../components/Select";
import { ACCENT, Empty, Eyebrow, OrbitLoader } from "../components/ui";
import { InsightPreviewRow } from "../components/InsightPreviewRow";
import type { OrbitInsightsContext } from "../hooks/useOrbitInsights";
import { useToast } from "../context/Toast";
import { useAuth } from "../context/AuthContext";
import { useTeamPresence } from "../context/Presence";
import { readImageAsDataUrl } from "../lib/imageUpload";
import { ConfirmModal } from "../components/ConfirmModal";
import {
  listMyTeams, listMembers, listInvites, createTeam, inviteMember,
  resendInvite, revokeInvite, removeMember, changeRole, leaveTeam, updateTeam, deleteTeam,
} from "../lib/teams";
import { recordAudit } from "../lib/audit";
import { fetchTeamActivity, subscribeTeamActivity, activityMeta, activityDetail } from "../lib/activity";
import { notifAgo } from "../lib/notifications";
import type { Team, TeamMember, TeamInvite, TeamRole, TeamActivity } from "../lib/types";

const ROLE_COLOR: Record<TeamRole, string> = { owner: ACCENT.violet, admin: ACCENT.blue, member: "var(--dim)", viewer: ACCENT.amber };
const TEAM_DOT_COLORS = [ACCENT.mint, ACCENT.blue, ACCENT.violet, ACCENT.amber];

function TeamLogo({ src, size, fallbackColor }: { src: string | null | undefined; size: number; fallbackColor?: string }) {
  if (src) return <img className="team-logo" src={src} alt="" style={{ width: size, height: size }} />;
  return <span className="dot" style={{ background: fallbackColor ?? "var(--dim)" }} />;
}

function agoSince(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

function LivePanel({ teamId }: { teamId: string | null }) {
  const present = useTeamPresence(teamId);
  return (
    <>
      <div className="eyebrow" style={{ margin: "32px 0 16px" }}>Live now</div>
      {present.length === 0 ? (
        <div className="tm-live-empty">No one else is online right now.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {present.map((p) => (
            <div className="tm-live-row" key={p.user_id}>
              <span className="tm-live-dot" />
              <span className="tm-nm">{p.full_name}</span>
              <span className="tm-live-label">{p.label}</span>
              <span className="mono tm-live-since">since {agoSince(p.since)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function ActivityPanel({ teamId }: { teamId: string | null }) {
  const [rows, setRows] = useState<TeamActivity[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const PAGE_SIZE = 30;

  const load = (p: number) => {
    if (!teamId) return;
    setLoading(true);
    fetchTeamActivity(teamId, { page: p, pageSize: PAGE_SIZE }).then((res) => {
      setRows((prev) => (p === 0 ? res.rows : [...prev, ...res.rows]));
      setTotal(res.total);
      setLoading(false);
    });
  };
  useEffect(() => { setPage(0); load(0); }, [teamId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!teamId) return;
    return subscribeTeamActivity(teamId, () => load(0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  return (
    <>
      <div className="eyebrow" style={{ margin: "32px 0 16px" }}>Activity</div>
      {loading && rows.length === 0 ? (
        <div className="tm-live-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="tm-live-empty">Nothing's happened here yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r) => {
            const m = activityMeta(r.action);
            const detail = activityDetail(r);
            return (
              <div className="tm-activity-row" key={r.id}>
                <span className="tm-activity-ic" style={{ color: m.color }}><Icon name={m.icon} size={15} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="tm-activity-text"><b>{r.full_name || r.email || "Someone"}</b> {m.verb}{detail ? ` "${detail}"` : ""}</div>
                </div>
                <span className="mono tm-live-since">{notifAgo(r.created_at)}</span>
              </div>
            );
          })}
          {rows.length < total && (
            <button className="btn ghost" style={{ alignSelf: "flex-start", marginTop: 4 }} disabled={loading} onClick={() => { setPage((p) => p + 1); load(page + 1); }}>
              {loading ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}
    </>
  );
}
function RoleBadge({ role }: { role: TeamRole }) {
  return <span className="tm-rolelabel" style={{ color: ROLE_COLOR[role] }}>{role.toUpperCase()}</span>;
}

export default function Teams() {
  const toast = useToast();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  const [teams, setTeams] = useState<Team[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [newModal, setNewModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamLogo, setNewTeamLogo] = useState<string | null>(null);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Exclude<TeamRole, "owner">>("member");
  const [inviting, setInviting] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [editName, setEditName] = useState("");
  const [editLogo, setEditLogo] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const editLogoInputRef = useRef<HTMLInputElement>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadTeams = async (selectId?: string) => {
    const t = await listMyTeams();
    setTeams(t);
    setTeamId((cur) => {
      const want = selectId ?? params.get("team") ?? cur;
      return want && t.some((x) => x.id === want) ? want : (t[0]?.id ?? null);
    });
    setLoadingTeams(false);
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

  const nav = useNavigate();
  const { insights } = useOutletContext<OrbitInsightsContext>();
  // Only the two detectors that are actually about teams/team workload — see
  // docs/architecture/ambient-intelligence.md. `team-no-updates`'s subject is
  // the team itself; `overloaded-developer`'s subject is a user, so it's
  // scoped to this team by checking membership against data this page
  // already loaded (`members`), not by adding team-awareness to the detector.
  const teamInsights = insights.filter((i) =>
    (i.detectorId === "team-no-updates" && i.subject.id === teamId)
    || (i.detectorId === "overloaded-developer" && members.some((m) => m.user_id === i.subject.id)),
  );

  async function handleCreateTeam() {
    const name = newTeamName.trim();
    if (!name) return;
    setCreatingTeam(true);
    const res = await createTeam(name, newTeamLogo);
    setCreatingTeam(false);
    if (!res.ok) { toast(`Couldn't create team: ${res.error}`); return; }
    setNewTeamName("");
    setNewTeamLogo(null);
    setNewModal(false);
    toast(`Created ${res.team.name}`);
    await loadTeams(res.team.id);
  }

  async function handlePickLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const res = await readImageAsDataUrl(file);
    if (!res.ok) { toast(res.error); return; }
    setNewTeamLogo(res.dataUrl);
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
    recordAudit({ action: "team.invite", entityType: "team", entityId: teamId, teamId, meta: { email } });
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
    if (res.ok) { recordAudit({ action: "team.remove_member", entityType: "team", entityId: teamId, teamId, meta: { userId } }); listMembers(teamId).then(setMembers); }
  }

  async function handleChangeRole(userId: string, role: Exclude<TeamRole, "owner">) {
    if (!teamId) return;
    const res = await changeRole(teamId, userId, role);
    toast(res.ok ? "Role updated" : `Couldn't update role: ${res.error}`);
    // This action had no audit record before — closed here alongside
    // teams.ts's new member_role_changed event publish, not as a separate change.
    if (res.ok) { recordAudit({ action: "team.change_role", entityType: "team", entityId: teamId, teamId, meta: { userId, role } }); listMembers(teamId).then(setMembers); }
  }

  async function handleLeaveTeam() {
    if (!teamId) return;
    const res = await leaveTeam(teamId);
    if (!res.ok) { toast(`Couldn't leave team: ${res.error}`); return; }
    recordAudit({ action: "team.leave", entityType: "team", entityId: teamId, teamId });
    toast("Left the team");
    await loadTeams();
  }

  function openEditModal() {
    if (!team) return;
    setEditName(team.name);
    setEditLogo(team.logo_data_url);
    setEditModal(true);
  }

  async function handlePickEditLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const res = await readImageAsDataUrl(file);
    if (!res.ok) { toast(res.error); return; }
    setEditLogo(res.dataUrl);
  }

  async function handleUpdateTeam() {
    if (!teamId) return;
    const name = editName.trim();
    if (!name) return;
    setSavingEdit(true);
    const res = await updateTeam(teamId, name, editLogo);
    setSavingEdit(false);
    if (!res.ok) { toast(`Couldn't save changes: ${res.error}`); return; }
    setEditModal(false);
    recordAudit({ action: "team.update", entityType: "team", entityId: teamId, teamId, meta: { name } });
    toast("Team updated");
    await loadTeams(teamId);
  }

  async function handleDeleteTeam() {
    if (!teamId) return;
    setDeleting(true);
    const res = await deleteTeam(teamId);
    setDeleting(false);
    setDeleteConfirmOpen(false);
    if (!res.ok) { toast(`Couldn't delete team: ${res.error}`); return; }
    toast(team ? `Deleted ${team.name}` : "Team deleted");
    setParams((p) => { p.delete("team"); return p; }, { replace: true });
    await loadTeams();
  }

  return (
    <main className="page">
      <div className="rowhead">
        <div><div className="h1">Teams</div><div className="sub">Manage every team you're part of, invite people, and see what's shared where.</div></div>
        <button className="tm-addbtn" onClick={() => setNewModal(true)}><Icon name="plus" size={14} />New team</button>
      </div>

      {loadingTeams ? (
        <div className="page-loader"><OrbitLoader label="Loading teams…" /></div>
      ) : teams.length === 0 ? (
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
                    <TeamLogo src={t.logo_data_url} size={16} fallbackColor={color} />{t.name}
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
                  <div className="tm-dname">
                    {team.logo_data_url && <img className="team-logo-md" src={team.logo_data_url} alt="" />}
                    {team.name}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {myRole && <span className="tm-drole" style={{ color: ROLE_COLOR[myRole] }}>{myRole.toUpperCase()}</span>}
                    {canManageTeam && <button className="iconbtn" title="Edit team" onClick={openEditModal}><Icon name="edit" size={15} /></button>}
                    {myRole === "owner" && <button className="iconbtn" title="Delete team" onClick={() => setDeleteConfirmOpen(true)}><Icon name="trash" size={15} /></button>}
                  </div>
                </div>
                <div className="tm-dsub">{members.length} member{members.length === 1 ? "" : "s"}{invites.length > 0 ? ` · ${invites.length} pending invite${invites.length === 1 ? "" : "s"}` : ""}</div>

                {teamInsights.length > 0 && (
                  <div className="card" style={{ padding: 14, margin: "14px 0" }}>
                    <div className="rowhead" style={{ marginBottom: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <span style={{ color: ACCENT.mint }}><Icon name="sparkles" size={13} /></span>
                        <Eyebrow>Orbit Intelligence</Eyebrow>
                      </div>
                      <button className="dash-more" onClick={() => nav("/intelligence")}>View all<Icon name="chevR" size={12} /></button>
                    </div>
                    <div className="insight-list">
                      {teamInsights.map((i) => <InsightPreviewRow key={i.id} insight={i} />)}
                    </div>
                  </div>
                )}

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
                              <option value="viewer">Viewer</option>
                            </Select>
                          )}
                          {canRemove && <button className="tm-remove" onClick={() => handleRemoveMember(m.user_id)}>Remove</button>}
                          {canLeave && <button className="tm-remove" onClick={handleLeaveTeam}>Leave</button>}
                        </div>
                      )}
                    </div>
                  );
                })}

                <LivePanel teamId={teamId} />
                <ActivityPanel teamId={teamId} />

                {canManageTeam && (
                  <>
                    <div className="eyebrow" style={{ margin: "32px 0 16px" }}>Invite someone</div>
                    <div className="tm-invite-row">
                      <input className="tm-uinput" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleInvite()} placeholder="teammate@company.com" />
                      <Select className="tm-usel" chevron={false} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Exclude<TeamRole, "owner">)}>
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                        <option value="viewer">Viewer</option>
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
        <div className="modal-bg" onClick={() => { setNewModal(false); setNewTeamLogo(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <h3>New team</h3>
              <button className="iconbtn" onClick={() => { setNewModal(false); setNewTeamLogo(null); }}><Icon name="x" size={16} /></button>
            </div>
            <div className="fld">
              <label>Team name</label>
              <input value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreateTeam()} placeholder="e.g. Meritech Core" autoFocus />
            </div>
            <div className="fld">
              <label>Team logo (optional)</label>
              <input ref={logoInputRef} type="file" accept="image/*" hidden onChange={handlePickLogo} />
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {newTeamLogo ? (
                  <img src={newTeamLogo} alt="" className="team-logo-md" />
                ) : (
                  <span className="team-logo-placeholder"><Icon name="upload" size={14} /></span>
                )}
                <button type="button" className="btn ghost sm" onClick={() => logoInputRef.current?.click()}>{newTeamLogo ? "Change" : "Upload logo"}</button>
                {newTeamLogo && <button type="button" className="btn ghost sm" onClick={() => setNewTeamLogo(null)}>Remove</button>}
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--dim)", marginTop: 10 }}>You'll be the owner and can invite others by email afterward.</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 22 }}>
              <button className="btn" onClick={() => { setNewModal(false); setNewTeamLogo(null); }}>Cancel</button>
              <button className="btn-primary" onClick={handleCreateTeam} disabled={creatingTeam || !newTeamName.trim()}>{creatingTeam ? "Creating…" : "Create team"}</button>
            </div>
          </div>
        </div>
      )}

      {editModal && (
        <div className="modal-bg" onClick={() => setEditModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <h3>Edit team</h3>
              <button className="iconbtn" onClick={() => setEditModal(false)}><Icon name="x" size={16} /></button>
            </div>
            <div className="fld">
              <label>Team name</label>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleUpdateTeam()} placeholder="e.g. Meritech Core" autoFocus />
            </div>
            <div className="fld">
              <label>Team logo (optional)</label>
              <input ref={editLogoInputRef} type="file" accept="image/*" hidden onChange={handlePickEditLogo} />
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {editLogo ? (
                  <img src={editLogo} alt="" className="team-logo-md" />
                ) : (
                  <span className="team-logo-placeholder"><Icon name="upload" size={14} /></span>
                )}
                <button type="button" className="btn ghost sm" onClick={() => editLogoInputRef.current?.click()}>{editLogo ? "Change" : "Upload logo"}</button>
                {editLogo && <button type="button" className="btn ghost sm" onClick={() => setEditLogo(null)}>Remove</button>}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 22 }}>
              <button className="btn" onClick={() => setEditModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleUpdateTeam} disabled={savingEdit || !editName.trim()}>{savingEdit ? "Saving…" : "Save changes"}</button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirmOpen && team && (
        <ConfirmModal
          title="Delete this team?"
          message={`This permanently deletes "${team.name}" — every member loses access, pending invites are revoked, and any projects or tasks shared with it become personal again. Every other member gets notified. This can't be undone.`}
          confirmLabel={deleting ? "Deleting…" : "Delete team"}
          danger
          onConfirm={handleDeleteTeam}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      )}
    </main>
  );
}
