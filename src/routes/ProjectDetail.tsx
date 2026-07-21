import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { Select } from "../components/Select";
import { Chip, ACCENT, Empty, OrbitLoader } from "../components/ui";
import { useTable } from "../hooks/useTable";
import { useToast } from "../context/Toast";
import { useAgent } from "../context/Agent";
import { launch, gitPull, gitStatus, gitBranches, gitLog, gitDiff, type GitStatusResult, type GitBranch, type GitCommit } from "../lib/agent";
import { openProjectWorkspace } from "../lib/vscode";
import { fetchIntegrations, providerKeys } from "../lib/integrations";
import { generateCommitMessage, generatePrDescription } from "../lib/gitWriter";
import type { ProviderKeys, CloudProvider } from "../lib/ai";
import { AiWriterModal } from "../components/AiWriterModal";
import { ProjectTerminal } from "../components/ProjectTerminal";
import { CommitGraph } from "../components/CommitGraph";
import { CommitDiffModal } from "../components/CommitDiffModal";
import { fetchSprintProjects, type SprintProject } from "../lib/zoho";
import { listMyTeams, listMembers } from "../lib/teams";
import { usePresenceDetail } from "../context/Presence";
import { getUser } from "../lib/auth";
import { recordAudit } from "../lib/audit";
import { fetchProviderConnection } from "../lib/providerConnections";
import { notifAgo } from "../lib/notifications";
import { fetchGithubCommits, fetchGithubPulls, fetchGithubRuns, type GithubCommit, type GithubPull, type GithubRun } from "../lib/github";
import { fetchGitlabCommits, fetchGitlabPulls, fetchGitlabRuns } from "../lib/gitlab";
import { fetchAzureDevopsCommits, fetchAzureDevopsPulls, fetchAzureDevopsRuns } from "../lib/azureDevops";
import { LinkRepoModal, type RepoLinkPatch } from "../components/LinkRepoModal";
import { MentionTextarea } from "../components/MentionTextarea";
import { useMyTeamRoles } from "../hooks/useMyTeamRoles";
import type { Project, Task, Team } from "../lib/types";

interface RemoteGitData { commits: GithubCommit[]; pulls: GithubPull[]; runs: GithubRun[]; }

const TABS = ["overview", "tasks", "git", "terminal", "environment", "notes"];

export default function ProjectDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { status: agentStatus } = useAgent();
  const agentDown = agentStatus !== "online";
  const { rows, loading, update, remove } = useTable<Project>("projects");
  const { rows: tasks } = useTable<Task>("tasks");
  const [tab, setTab] = useState("overview");
  const [sprintProjects, setSprintProjects] = useState<SprintProject[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [edit, setEdit] = useState(false);
  const p = rows.find((x) => x.id === id);
  const myId = getUser()?.id;
  const myRoleByTeam = useMyTeamRoles();

  useEffect(() => { fetchSprintProjects().then(setSprintProjects).catch(() => {}); }, []);
  useEffect(() => { listMyTeams().then(setTeams); }, []);

  const setPresenceDetail = usePresenceDetail();
  useEffect(() => {
    if (!p) return;
    setPresenceDetail(p.name);
    return () => setPresenceDetail(null);
  }, [p?.name, setPresenceDetail]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Git tab: local status (via the desktop agent) + remote commits/PRs/CI (via the linked GitHub/GitLab connection) ----
  const [gitLocal, setGitLocal] = useState<GitStatusResult | null>(null);
  const [gitLocalLoading, setGitLocalLoading] = useState(false);
  const [gitRemote, setGitRemote] = useState<RemoteGitData | null>(null);
  const [gitRemoteLoading, setGitRemoteLoading] = useState(false);
  const [gitRemoteError, setGitRemoteError] = useState<string | null>(null);
  const [linkRepoOpen, setLinkRepoOpen] = useState(false);

  // ---- AI commit-message / PR-description writer ----
  const [aiKeys, setAiKeys] = useState<ProviderKeys>({});
  const [aiProvider, setAiProvider] = useState<CloudProvider | undefined>(undefined);
  useEffect(() => { fetchIntegrations().then((i) => { setAiKeys(providerKeys(i)); setAiProvider(i?.ai_provider ?? undefined); }); }, []);
  const [commitAi, setCommitAi] = useState<{ loading: boolean; text: string; error?: string } | null>(null);
  const [prAi, setPrAi] = useState<{ loading: boolean; text: string; error?: string } | null>(null);

  async function generateCommitMsg() {
    const path = p?.fe_path || p?.sln_path;
    if (!path) return;
    setCommitAi({ loading: true, text: "" });
    const d = await gitDiff(path);
    if (!d.ok) { setCommitAi({ loading: false, text: "", error: d.error }); return; }
    const diff = d.staged?.trim() ? d.staged : (d.unstaged || "");
    const r = await generateCommitMessage(diff, aiKeys, aiProvider);
    setCommitAi({ loading: false, text: r.text || "", error: r.error });
  }

  async function generatePrDesc() {
    const path = p?.fe_path || p?.sln_path;
    const base = p?.repo_default_branch;
    if (!path || !base) return;
    setPrAi({ loading: true, text: "" });
    const d = await gitDiff(path, base);
    if (!d.ok) { setPrAi({ loading: false, text: "", error: d.error }); return; }
    const subjects = commits.slice(0, 15).map((c) => c.subject);
    const r = await generatePrDescription(subjects, d.range || "", aiKeys, aiProvider);
    setPrAi({ loading: false, text: r.text || "", error: r.error });
  }

  async function loadLocalGit() {
    const path = p?.fe_path || p?.sln_path;
    if (!path || agentDown) { setGitLocal(null); return; }
    setGitLocalLoading(true);
    setGitLocal(await gitStatus(path));
    setGitLocalLoading(false);
  }
  useEffect(() => {
    if (tab !== "git") return;
    loadLocalGit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, p?.id, p?.fe_path, p?.sln_path, agentDown]);

  // ---- History card: branch list + commit graph, both local (agent) — independent of whether a remote is linked ----
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [commitsError, setCommitsError] = useState<string | null>(null);
  const [diffHash, setDiffHash] = useState<string | null>(null);

  useEffect(() => {
    const path = p?.fe_path || p?.sln_path;
    if (tab !== "git" || !path || agentDown) { setBranches([]); return; }
    gitBranches(path).then((r) => {
      if (!r.ok) return;
      setBranches(r.branches);
      setSelectedBranch((cur) => cur && r.branches.some((b) => b.name === cur) ? cur : (r.branches.find((b) => b.current) ?? r.branches[0])?.name ?? null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, p?.id, p?.fe_path, p?.sln_path, agentDown]);

  useEffect(() => {
    const path = p?.fe_path || p?.sln_path;
    if (tab !== "git" || !path || agentDown || !selectedBranch) { setCommits([]); return; }
    setCommitsLoading(true); setCommitsError(null);
    gitLog(path, 40, selectedBranch).then((r) => {
      setCommitsLoading(false);
      if (!r.ok) { setCommitsError(r.error || "Couldn't load commit history."); return; }
      setCommits(r.commits);
    });
  }, [tab, p?.id, p?.fe_path, p?.sln_path, agentDown, selectedBranch]);

  async function loadRemoteGit() {
    if (!p?.repo_provider || !p.repo_full_name) { setGitRemote(null); return; }
    setGitRemoteLoading(true); setGitRemoteError(null);
    const conn = await fetchProviderConnection(p.repo_provider);
    if (!conn || conn.status !== "connected") {
      setGitRemote(null);
      setGitRemoteError(`${p.repo_provider === "github" ? "GitHub" : p.repo_provider === "gitlab" ? "GitLab" : "Azure DevOps"} isn't connected — reconnect in Settings.`);
      setGitRemoteLoading(false);
      return;
    }
    try {
      const branch = p.repo_default_branch || undefined;
      const [commits, pulls, runs] = p.repo_provider === "github"
        ? await Promise.all([fetchGithubCommits(p.repo_full_name, branch), fetchGithubPulls(p.repo_full_name), fetchGithubRuns(p.repo_full_name, branch)])
        : p.repo_provider === "gitlab"
        ? await Promise.all([fetchGitlabCommits(p.repo_full_name, branch), fetchGitlabPulls(p.repo_full_name), fetchGitlabRuns(p.repo_full_name, branch)])
        : await Promise.all([fetchAzureDevopsCommits(p.repo_full_name, branch), fetchAzureDevopsPulls(p.repo_full_name), fetchAzureDevopsRuns(p.repo_full_name, branch)]);
      setGitRemote({ commits, pulls, runs });
    } catch (e) {
      setGitRemoteError((e as Error).message);
    }
    setGitRemoteLoading(false);
  }
  useEffect(() => {
    if (tab !== "git") return;
    loadRemoteGit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, p?.id, p?.repo_provider, p?.repo_full_name, p?.repo_default_branch]);

  if (!p) {
    if (loading) return <main className="page"><div className="page-loader"><OrbitLoader label="Loading project…" /></div></main>;
    return (
      <main className="page">
        <Empty icon="boxes" title="Project not found" sub="It may have been deleted, or the link is out of date." />
        <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
          <button className="btn accent" onClick={() => nav("/projects")}>Back to projects</button>
        </div>
      </main>
    );
  }
  const mine = tasks.filter((t) => t.project_id === p.id);
  const owned = p.user_id === myId;
  const canEdit = owned || (!!p.team_id && ["owner", "admin"].includes(myRoleByTeam[p.team_id]));
  const teamName = p.team_id ? teams.find((t) => t.id === p.team_id)?.name : undefined;

  async function share(teamId: string) {
    const { error } = await update(p!.id, { team_id: teamId || null } as Partial<Project>);
    if (error) { toast(`Couldn't update sharing: ${error}`); return; }
    recordAudit({ action: "project.update", entityType: "project", entityId: p!.id, teamId: teamId || p!.team_id, meta: { team_change: true } });
    toast(teamId ? `Shared with ${teams.find((t) => t.id === teamId)?.name}` : "Made personal");
  }
  // robust: linked if an id exists; resolve a display name even if not stored
  const linkedId = p.sprint_project_id || null;
  const linkedName = p.sprint_project_name || sprintProjects.find((x) => x.id === linkedId)?.name || linkedId;

  async function linkSprint(sprintProjectId: string) {
    const sp = sprintProjects.find((x) => x.id === sprintProjectId);
    const { error } = await update(p!.id, { sprint_project_id: sprintProjectId || null, sprint_project_name: sp?.name || null } as Partial<Project>);
    if (error) { toast(`Couldn't save link: ${error}`); return; }
    toast(sprintProjectId ? `Linked to ${sp?.name}` : "Unlinked from Sprints");
  }

  async function doLaunch(kind: "vscode" | "visualstudio" | "terminal" | "browser" | "all") {
    const res = await launch(kind, { fe_path: p!.fe_path, sln_path: p!.sln_path, dev_port: p!.dev_port, name: p!.name });
    toast(res.ok ? `Opening ${res.opened?.join(", ") || kind} · ${p!.name}` : (res.error === "agent offline" ? "Local agent offline — start it to launch apps" : res.error || "Couldn't launch"));
  }

  /**
   * Opens frontend + solution folders as one multi-root VS Code window instead
   * of the two separate ones `launch("vscode")` gives, which only ever opens
   * fe_path. Falls back to that when the project has a single folder.
   */
  async function doOpenWorkspace() {
    const folders = [p!.fe_path, p!.sln_path ? p!.sln_path.replace(/[\\/][^\\/]+\.sln$/i, "") : null];
    const r = await openProjectWorkspace(p!.name, folders);
    if (!r.ok) { toast("No folder set on this project — add a frontend or solution path first"); return; }
    toast(r.via === "deeplink" ? `Opening ${p!.name} in VS Code (agent offline)` : `Opened ${p!.name} workspace in VS Code`);
  }

  async function doPull() {
    const path = p!.fe_path || p!.sln_path;
    if (!path) return;
    const r = await gitPull(path);
    toast(r.ok ? (r.reason === "up_to_date" ? "Already up to date" : `Pulled${r.files ? ` ${r.files} file${r.files === 1 ? "" : "s"}` : ""}`) : r.error || "Pull failed");
    loadLocalGit();
  }

  async function doLinkRepo(patch: RepoLinkPatch) {
    const { error } = await update(p!.id, patch as Partial<Project>);
    setLinkRepoOpen(false);
    if (error) { toast(`Couldn't link repo: ${error}`); return; }
    recordAudit({ action: "project.link_repo", entityType: "project", entityId: p!.id, teamId: p!.team_id, meta: { repo_full_name: patch.repo_full_name } });
    toast(`Linked to ${patch.repo_full_name}`);
  }

  async function doUnlinkRepo() {
    const { error } = await update(p!.id, { repo_provider: null, repo_full_name: null, repo_id: null, repo_default_branch: null } as Partial<Project>);
    if (error) { toast(`Couldn't unlink: ${error}`); return; }
    recordAudit({ action: "project.unlink_repo", entityType: "project", entityId: p!.id, teamId: p!.team_id });
    setGitRemote(null);
    toast("Repository unlinked");
  }

  return (
    <main className="page">
      <button className="btn ghost" style={{ paddingLeft: 0 }} onClick={() => nav("/projects")}>
        <Icon name="back" size={15} />Projects</button>
      <div className="rowhead" style={{ marginTop: 8 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <span className="h1">{p.name}</span>
            {p.status === "hold" ? <span className="hold">ON HOLD</span> : <span className="live-dot" />}
          </div>
          <div className="sub">{p.client}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {canEdit && <button className="btn" onClick={() => setEdit(true)}><Icon name="settings" size={14} />Edit</button>}
          {p.fe_path && <button className="btn" disabled={agentDown} onClick={() => doLaunch("vscode")}><span style={{ color: ACCENT.blue }}><Icon name="code" size={14} /></span>Open UI</button>}
          {p.fe_path && p.sln_path && (
            <button className="btn" onClick={doOpenWorkspace} title="Open frontend and solution together as one VS Code workspace">
              <span style={{ color: ACCENT.blue }}><Icon name="layers" size={14} /></span>Open workspace
            </button>
          )}
          {p.sln_path && <button className="btn" disabled={agentDown} onClick={() => doLaunch("visualstudio")}><span style={{ color: ACCENT.violet }}><Icon name="server" size={14} /></span>Backend</button>}
          <button className="iconbtn" title="Terminal" disabled={agentDown} onClick={() => doLaunch("terminal")}><Icon name="terminal" size={15} /></button>
          <button className="iconbtn" title="Open localhost" disabled={agentDown} onClick={() => doLaunch("browser")}><Icon name="globe" size={15} /></button>
          <button className="btn accent" disabled={agentDown} onClick={() => doLaunch("all")}><Icon name="play" size={13} fill />Open all</button>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => <button key={t} className={"tab" + (tab === t ? " on" : "")} onClick={() => setTab(t)}>
          {t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>

      <div className="tabpane fade">
        {tab === "overview" && (
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 18 }}>
            <div className="card" style={{ padding: 20 }}>
              <div className="eyebrow">About</div>
              <p style={{ marginTop: 10, color: "var(--muted)", lineHeight: 1.6, fontSize: 13.5 }}>{p.description || "No description yet."}</p>
              <div className="chips" style={{ marginTop: 14 }}>{p.stacks?.map((s) => <Chip key={s} name={s} />)}</div>
              <div className="eyebrow" style={{ marginTop: 22 }}>Paths</div>
              {p.fe_path && <PathRow label="Frontend" value={p.fe_path} icon="folder" />}
              {p.sln_path && <PathRow label="Backend .sln" value={p.sln_path} icon="server" />}
              {p.dev_port && <PathRow label="Dev server" value={`http://localhost:${p.dev_port}`} icon="globe" />}
            </div>
            <div>
              <div className="card" style={{ padding: 20 }}>
                <div className="eyebrow">Zoho Sprints link</div>
                {linkedId
                  ? <div style={{ marginTop: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <span style={{ color: ACCENT.mint }}><Icon name="sprint" size={16} /></span>
                        <span style={{ fontFamily: "var(--display)", fontWeight: 600 }}>{linkedName}</span>
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                        <button className="btn accent" onClick={() => nav(`/sprints?project=${linkedId}`)}><Icon name="sprint" size={13} />Open board</button>
                        <button className="btn ghost" onClick={() => linkSprint("")}>Unlink</button>
                      </div>
                    </div>
                  : <div style={{ marginTop: 10 }}>
                      <p style={{ fontSize: 12.5, color: "var(--dim)", marginBottom: 10 }}>Link this project to a Zoho Sprints project to jump straight to its board.</p>
                      <Select full className="field" style={{ fontFamily: "var(--body)", fontSize: 13 }} value="" onChange={(e) => e.target.value && linkSprint(e.target.value)}>
                        <option value="">{sprintProjects.length ? "Select a Sprints project…" : "Loading projects…"}</option>
                        {sprintProjects.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}{sp.key ? ` (${sp.key})` : ""}</option>)}
                      </Select>
                    </div>}
              </div>
              {(owned ? teams.length > 0 : !!teamName) && (
                <div className="card" style={{ padding: 20, marginTop: 18 }}>
                  <div className="eyebrow">Team sharing</div>
                  {owned ? (
                    <>
                      <p style={{ fontSize: 12.5, color: "var(--dim)", margin: "10px 0" }}>
                        {p.team_id ? `Visible to everyone on ${teamName}.` : "Personal — only you can see this project."}
                      </p>
                      <Select full className="field" style={{ fontFamily: "var(--body)", fontSize: 13 }} value={p.team_id ?? ""} onChange={(e) => share(e.target.value)}>
                        <option value="">Personal (not shared)</option>
                        {teams.map((t) => <option key={t.id} value={t.id}>Share with {t.name}</option>)}
                      </Select>
                    </>
                  ) : (
                    <p style={{ fontSize: 12.5, color: "var(--dim)", marginTop: 10, display: "flex", alignItems: "center", gap: 7 }}>
                      <Icon name="users" size={14} />Shared by its owner with {teamName} — you can view it, edits are theirs to make.
                    </p>
                  )}
                </div>
              )}
              <div className="card" style={{ padding: 20, marginTop: 18 }}>
              <div className="eyebrow">Quick actions</div>
              {["Pull latest", "Run tests", "Docker compose up", "Deploy to Netlify"].map((a) => (
                <button key={a} className="btn ghost" style={{ width: "100%", justifyContent: "flex-start", marginTop: 8 }}
                  onClick={() => toast(`${a} · ${p.name}`)}><Icon name="bolt" size={14} />{a}</button>
              ))}
              </div>
            </div>
          </div>
        )}
        {tab === "tasks" && (
          <div className="kanban">
            {(["todo", "doing", "review", "done"] as const).map((col) => (
              <div key={col} className="kcol">
                <h4>{col}<span>{mine.filter((t) => t.status === col).length}</span></h4>
                {mine.filter((t) => t.status === col).map((t) => (
                  <div key={t.id} className="kcard">{t.title}<div className="kt"><span className="prdot" style={{ background: t.priority === "high" ? ACCENT.red : t.priority === "med" ? ACCENT.amber : ACCENT.dim }} /></div></div>
                ))}
              </div>
            ))}
          </div>
        )}
        {tab === "git" && (
          <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div className="eyebrow">Local working tree</div>
                {agentDown
                  ? <span className="pill warn"><Icon name="plug" size={15} />Agent offline<span className="dotled warn" /></span>
                  : <button className="iconbtn" title="Refresh" disabled={gitLocalLoading} onClick={loadLocalGit}><Icon name="refresh" size={14} className={gitLocalLoading ? "spin" : ""} /></button>}
              </div>
              {agentDown ? (
                <p style={{ marginTop: 12, color: "var(--muted)", fontSize: 13 }}>Start the local agent to see this project's real branch, ahead/behind counts and uncommitted files.</p>
              ) : !(p.fe_path || p.sln_path) ? (
                <p style={{ marginTop: 12, color: "var(--muted)", fontSize: 13 }}>No local folder set — add a frontend or backend path in Edit to enable this.</p>
              ) : gitLocalLoading && !gitLocal ? (
                <p style={{ marginTop: 12, color: "var(--dim)", fontSize: 13 }}>Checking…</p>
              ) : gitLocal?.reason === "not_a_repo" ? (
                <p style={{ marginTop: 12, color: "var(--muted)", fontSize: 13 }}>That folder isn't a git repository.</p>
              ) : gitLocal?.ok ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, fontFamily: "var(--mono)", fontSize: 13, color: ACCENT.amber }}>
                    <Icon name="git" size={15} />{gitLocal.branch}
                    {(!!gitLocal.ahead || !!gitLocal.behind) && (
                      <span style={{ fontSize: 11.5, color: "var(--dim)" }}>
                        {gitLocal.ahead ? `↑${gitLocal.ahead}` : ""}{gitLocal.behind ? ` ↓${gitLocal.behind}` : ""}
                      </span>
                    )}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12.5, color: gitLocal.dirty ? ACCENT.amber : "var(--dim)" }}>
                    {gitLocal.dirty ? `${gitLocal.dirty} uncommitted file${gitLocal.dirty === 1 ? "" : "s"}` : "Working tree clean"}
                  </div>
                  {gitLocal.lastCommit && (
                    <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>
                      <span className="mono">{gitLocal.lastCommit.hash.slice(0, 7)}</span> {gitLocal.lastCommit.subject}
                      <div style={{ color: "var(--dim)", marginTop: 2 }}>{gitLocal.lastCommit.author}</div>
                    </div>
                  )}
                  <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
                    <button className="btn" disabled={!gitLocal.upstream || !gitLocal.behind} onClick={doPull}><Icon name="download" size={14} />Pull</button>
                    <button className="btn ghost" disabled={!gitLocal.dirty} onClick={generateCommitMsg}><Icon name="sparkles" size={14} />AI commit message</button>
                  </div>
                </>
              ) : (
                <p style={{ marginTop: 12, color: "var(--amber)", fontSize: 13 }}>{gitLocal?.error || "Couldn't read git status."}</p>
              )}
            </div>

            <div className="card" style={{ padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div className="eyebrow">Remote</div>
                {p.repo_provider && (
                  <button className="btn ghost" onClick={doUnlinkRepo}><Icon name="x" size={13} />Unlink</button>
                )}
              </div>
              {!p.repo_provider ? (
                <>
                  <p style={{ marginTop: 12, color: "var(--muted)", fontSize: 13 }}>Not linked to a repository yet.</p>
                  <button className="btn accent" style={{ marginTop: 12 }} onClick={() => setLinkRepoOpen(true)}><Icon name="link" size={14} />Link a repository</button>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13 }}>
                    <Icon name={p.repo_provider} size={15} /><span className="mono">{p.repo_full_name}</span>
                  </div>
                  {gitRemoteLoading ? (
                    <p style={{ marginTop: 12, color: "var(--dim)", fontSize: 13 }}>Loading…</p>
                  ) : gitRemoteError ? (
                    <p style={{ marginTop: 12, color: "var(--amber)", fontSize: 13 }}>{gitRemoteError}</p>
                  ) : gitRemote ? (
                    <>
                      {gitRemote.runs.length > 0 && (
                        <>
                          <div className="eyebrow" style={{ marginTop: 16 }}>Recent runs</div>
                          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                            {gitRemote.runs.slice(0, 5).map((r) => (
                              <a key={r.id} href={r.url} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 8, color: "inherit", textDecoration: "none" }}>
                                <span className={"pill " + (r.conclusion === "success" ? "live" : r.conclusion ? "warn" : "")}>
                                  <Icon name="activity" size={12} />{r.conclusion || r.status}
                                </span>
                                <span style={{ fontSize: 11.5, color: "var(--muted)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                                <span className="mono" style={{ fontSize: 10.5, color: "var(--dim)", flexShrink: 0 }}>{notifAgo(r.createdAt)}</span>
                              </a>
                            ))}
                          </div>
                        </>
                      )}

                      <div className="eyebrow" style={{ marginTop: 16 }}>{gitRemote.pulls.length} open pull request{gitRemote.pulls.length === 1 ? "" : "s"}</div>
                      {gitRemote.pulls.length > 0 && (
                        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                          {gitRemote.pulls.slice(0, 5).map((pr) => (
                            <div key={pr.number} style={{ fontSize: 12 }}>
                              <a href={pr.url} target="_blank" rel="noreferrer" style={{ color: "var(--text)" }}>#{pr.number} {pr.title}</a>
                              <div style={{ color: "var(--dim)", marginTop: 1 }}>{pr.user} · updated {notifAgo(pr.updatedAt)}</div>
                            </div>
                          ))}
                          {gitRemote.pulls.length > 5 && <div style={{ color: "var(--dim)", fontSize: 11.5 }}>+{gitRemote.pulls.length - 5} more</div>}
                        </div>
                      )}

                      <div className="eyebrow" style={{ marginTop: 16 }}>Recent commits</div>
                      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                        {gitRemote.commits.slice(0, 6).map((c) => (
                          <div key={c.hash} style={{ fontSize: 12 }}>
                            <a href={c.url} target="_blank" rel="noreferrer" className="mono" style={{ color: "var(--muted)" }}>{c.hash.slice(0, 7)}</a> {c.subject}
                            <div style={{ color: "var(--dim)", marginTop: 1 }}>{c.author}</div>
                          </div>
                        ))}
                        {gitRemote.commits.length === 0 && <div style={{ color: "var(--dim)", fontSize: 12 }}>No commits found.</div>}
                      </div>
                    </>
                  ) : null}
                </>
              )}
            </div>
          </div>

          {gitLocal?.ok && (
            <div className="card" style={{ padding: 20, marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <div className="eyebrow">History</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {p.repo_default_branch && selectedBranch && selectedBranch !== p.repo_default_branch && (
                    <button className="btn ghost sm" onClick={generatePrDesc}><Icon name="sparkles" size={13} />AI PR description</button>
                  )}
                  {branches.length > 1 && (
                    <Select value={selectedBranch ?? ""} onChange={(e) => setSelectedBranch(e.target.value)} style={{ minWidth: 180 }}>
                      {branches.map((b) => <option key={b.name} value={b.name}>{b.name}{b.current ? " (current)" : ""}</option>)}
                    </Select>
                  )}
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                {commitsLoading && commits.length === 0 ? (
                  <div style={{ padding: "20px 0" }}><OrbitLoader label="Loading history…" size={22} /></div>
                ) : commitsError ? (
                  <div style={{ color: "var(--amber)", fontSize: 13 }}>{commitsError}</div>
                ) : commits.length === 0 ? (
                  <Empty icon="git" title="No commits" sub="This branch has no history yet." mini />
                ) : (
                  <CommitGraph commits={commits} selectedHash={diffHash} onSelect={setDiffHash} />
                )}
              </div>
            </div>
          )}
          </>
        )}
        {diffHash && (p?.fe_path || p?.sln_path) && (
          <CommitDiffModal path={(p.fe_path || p.sln_path)!} hash={diffHash} onClose={() => setDiffHash(null)} />
        )}
        {linkRepoOpen && <LinkRepoModal onClose={() => setLinkRepoOpen(false)} onSave={doLinkRepo} />}
        {commitAi && (
          <AiWriterModal title="AI commit message" loading={commitAi.loading} text={commitAi.text} error={commitAi.error} onClose={() => setCommitAi(null)} onRegenerate={generateCommitMsg} />
        )}
        {prAi && (
          <AiWriterModal title="AI PR description" loading={prAi.loading} text={prAi.text} error={prAi.error} onClose={() => setPrAi(null)} onRegenerate={generatePrDesc} />
        )}
        {tab === "terminal" && (
          <div className="card" style={{ padding: 20 }}>
            <div className="eyebrow">Terminal</div>
            {agentDown ? (
              <p style={{ marginTop: 12, color: "var(--muted)", fontSize: 13 }}>Start the local agent to run commands in this project's folder.</p>
            ) : !(p.fe_path || p.sln_path) ? (
              <p style={{ marginTop: 12, color: "var(--muted)", fontSize: 13 }}>No local folder set — add a frontend or backend path in Edit to enable this.</p>
            ) : (
              <div style={{ marginTop: 12 }}><ProjectTerminal path={(p.fe_path || p.sln_path)!} /></div>
            )}
          </div>
        )}
        {tab === "environment" && <div className="card" style={{ padding: 20 }}><div className="eyebrow">Environment</div>
          <p style={{ marginTop: 10, color: "var(--muted)", fontSize: 13 }}>Env vars & containers are managed by the local agent and stored encrypted per project.</p></div>}
        {tab === "notes" && <div className="card" style={{ padding: 20 }}><div className="eyebrow">Notes</div>
          <textarea placeholder="Project notes…" style={{ width: "100%", marginTop: 12, minHeight: 160, padding: 12, borderRadius: 11, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 13.5, resize: "vertical" }} /></div>}
      </div>
      {edit && <EditProjectModal p={p} onClose={() => setEdit(false)}
        onSave={async (patch) => { await update(p.id, patch); recordAudit({ action: "project.update", entityType: "project", entityId: p.id, teamId: p.team_id }); setEdit(false); toast("Project updated"); }}
        onDelete={async () => { await remove(p.id); recordAudit({ action: "project.delete", entityType: "project", entityId: p.id, teamId: p.team_id, meta: { name: p.name } }); toast(`Deleted ${p.name}`); nav("/projects"); }} />}
    </main>
  );
}

function EditProjectModal({ p, onClose, onSave, onDelete }: { p: Project; onClose: () => void; onSave: (patch: Partial<Project>) => void; onDelete: () => void }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const [f, setF] = useState({
    name: p.name, client: p.client || "", status: p.status || "active",
    fe_path: p.fe_path || "", sln_path: p.sln_path || "", dev_port: p.dev_port ? String(p.dev_port) : "",
    branch: p.branch || "", stacks: (p.stacks || []).join(", "), description: p.description || "",
  });
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });

  const [mentionCandidates, setMentionCandidates] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    if (!p.team_id) { setMentionCandidates([]); return; }
    listMembers(p.team_id).then((members) => {
      setMentionCandidates(members.filter((m) => m.full_name).map((m) => ({ id: m.user_id, label: m.full_name! })));
    }).catch(() => setMentionCandidates([]));
  }, [p.team_id]);
  return (
    <div className="modal-bg">
      <div className="modal" style={{ width: 520, maxWidth: "94vw" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Edit project</h3>
          <button className="iconbtn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="fld"><label>Name</label><input value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div style={{ display: "flex", gap: 12 }}>
          <div className="fld" style={{ flex: 1 }}><label>Client</label><input value={f.client} onChange={(e) => set("client", e.target.value)} /></div>
          <div className="fld" style={{ flex: 1 }}><label>Status</label>
            <Select full value={f.status} onChange={(e) => set("status", e.target.value)}><option value="active">Active</option><option value="hold">On hold</option><option value="archived">Archived</option></Select></div>
        </div>
        <div className="fld"><label>Frontend path (Open UI)</label><input value={f.fe_path} onChange={(e) => set("fe_path", e.target.value)} placeholder="D:\\projects\\app-web" /></div>
        <div className="fld"><label>Solution / backend path (Backend)</label><input value={f.sln_path} onChange={(e) => set("sln_path", e.target.value)} placeholder="D:\\projects\\app.sln" /></div>
        <div style={{ display: "flex", gap: 12 }}>
          <div className="fld" style={{ flex: 1 }}><label>Dev port</label><input value={f.dev_port} onChange={(e) => set("dev_port", e.target.value.replace(/\D/g, ""))} placeholder="3000" /></div>
          <div className="fld" style={{ flex: 1 }}><label>Branch</label><input value={f.branch} onChange={(e) => set("branch", e.target.value)} placeholder="main" /></div>
        </div>
        <div className="fld"><label>Stack (comma-separated)</label><input value={f.stacks} onChange={(e) => set("stacks", e.target.value)} placeholder="React, .NET, Postgres" /></div>
        <div className="fld">
          <label>About</label>
          {mentionCandidates.length > 0 ? (
            <MentionTextarea value={f.description} candidates={mentionCandidates} rows={3} onChange={(v) => set("description", v)} placeholder="What this project is, key context… type @ to mention a teammate" style={{ resize: "vertical", fontFamily: "var(--body)" }} />
          ) : (
            <textarea value={f.description} rows={3} onChange={(e) => set("description", e.target.value)} placeholder="What this project is, key context…" style={{ resize: "vertical", fontFamily: "var(--body)" }} />
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 20 }}>
          <button className={"btn" + (confirmDel ? " danger" : "")} onClick={() => (confirmDel ? onDelete() : setConfirmDel(true))} onMouseLeave={() => setConfirmDel(false)}>
            <Icon name="x" size={14} />{confirmDel ? "Click again to delete" : "Delete project"}
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={() => onSave({
            name: f.name.trim() || p.name, client: f.client || null, status: f.status,
            fe_path: f.fe_path || null, sln_path: f.sln_path || null,
            dev_port: f.dev_port ? Number(f.dev_port) : null, branch: f.branch || null,
            stacks: f.stacks.split(",").map((s) => s.trim()).filter(Boolean),
            description: f.description || null,
          } as Partial<Project>)}>Save changes</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PathRow({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid var(--border-soft)" }}>
      <span style={{ color: "var(--dim)" }}><Icon name={icon} size={14} /></span>
      <span style={{ fontSize: 11.5, color: "var(--dim)", width: 96 }}>{label}</span>
      <span className="mono" style={{ fontSize: 12, color: "var(--muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}
