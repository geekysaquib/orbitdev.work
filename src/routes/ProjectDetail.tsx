import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { Chip, ACCENT } from "../components/ui";
import { useTable } from "../hooks/useTable";
import { useToast } from "../context/Toast";
import { useAgent } from "../context/Agent";
import { launch } from "../lib/agent";
import { fetchSprintProjects, type SprintProject } from "../lib/zoho";
import type { Project, Task } from "../lib/types";

const TABS = ["overview", "tasks", "git", "environment", "notes"];

export default function ProjectDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { status: agentStatus } = useAgent();
  const agentDown = agentStatus !== "online";
  const { rows, update, remove } = useTable<Project>("projects");
  const { rows: tasks } = useTable<Task>("tasks");
  const [tab, setTab] = useState("overview");
  const [sprintProjects, setSprintProjects] = useState<SprintProject[]>([]);
  const [edit, setEdit] = useState(false);
  const p = rows.find((x) => x.id === id);

  useEffect(() => { fetchSprintProjects().then(setSprintProjects).catch(() => {}); }, []);

  if (!p) return <main className="page"><div style={{ color: "var(--dim)" }}>Loading project…</div></main>;
  const accent = p.accent || ACCENT.mint;
  const mine = tasks.filter((t) => t.project_id === p.id);
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

  return (
    <main className="page">
      <button className="btn ghost" style={{ paddingLeft: 0 }} onClick={() => nav("/projects")}>
        <Icon name="back" size={15} />Projects</button>
      <div className="rowhead" style={{ marginTop: 8 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <span className="h1">{p.name}</span>
            {p.status === "hold" || p.status === "released" ? <span className="hold">{p.status === "hold" ? "ON HOLD" : "RELEASED"}</span> : <span className="live-dot" />}
          </div>
          <div className="sub">{p.client}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => setEdit(true)}><Icon name="settings" size={14} />Edit</button>
          {p.fe_path && <button className="btn" disabled={agentDown} onClick={() => doLaunch("vscode")}><span style={{ color: ACCENT.blue }}><Icon name="code" size={14} /></span>Open UI</button>}
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
                      <select className="field" style={{ width: "100%", fontFamily: "var(--body)", fontSize: 13 }} value="" onChange={(e) => e.target.value && linkSprint(e.target.value)}>
                        <option value="">{sprintProjects.length ? "Select a Sprints project…" : "Loading projects…"}</option>
                        {sprintProjects.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}{sp.key ? ` (${sp.key})` : ""}</option>)}
                      </select>
                    </div>}
              </div>
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
        {tab === "git" && <div className="card" style={{ padding: 20 }}><div className="eyebrow">Working tree</div>
          <div style={{ display: "flex", gap: 10, marginTop: 12, fontFamily: "var(--mono)", fontSize: 13, color: ACCENT.amber }}>
            <Icon name="git" size={15} />{p.branch || "main"}</div>
          <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
            {["Pull", "Commit", "Push"].map((a) => <button key={a} className="btn" onClick={() => toast(`${a} · ${p.name}`)}>{a}</button>)}</div></div>}
        {tab === "environment" && <div className="card" style={{ padding: 20 }}><div className="eyebrow">Environment</div>
          <p style={{ marginTop: 10, color: "var(--muted)", fontSize: 13 }}>Env vars & containers are managed by the local agent and stored encrypted per project.</p></div>}
        {tab === "notes" && <div className="card" style={{ padding: 20 }}><div className="eyebrow">Notes</div>
          <textarea placeholder="Project notes…" style={{ width: "100%", marginTop: 12, minHeight: 160, padding: 12, borderRadius: 11, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 13.5, resize: "vertical" }} /></div>}
      </div>
      {edit && <EditProjectModal p={p} onClose={() => setEdit(false)}
        onSave={async (patch) => { await update(p.id, patch); setEdit(false); toast("Project updated"); }}
        onDelete={async () => { await remove(p.id); toast(`Deleted ${p.name}`); nav("/projects"); }} />}
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
            <select value={f.status} onChange={(e) => set("status", e.target.value)}><option value="active">Active</option><option value="hold">On hold</option><option value="archived">Archived</option><option value="released">Released</option></select></div>
        </div>
        <div className="fld"><label>Frontend path (Open UI)</label><input value={f.fe_path} onChange={(e) => set("fe_path", e.target.value)} placeholder="D:\\projects\\app-web" /></div>
        <div className="fld"><label>Solution / backend path (Backend)</label><input value={f.sln_path} onChange={(e) => set("sln_path", e.target.value)} placeholder="D:\\projects\\app.sln" /></div>
        <div style={{ display: "flex", gap: 12 }}>
          <div className="fld" style={{ flex: 1 }}><label>Dev port</label><input value={f.dev_port} onChange={(e) => set("dev_port", e.target.value.replace(/\D/g, ""))} placeholder="3000" /></div>
          <div className="fld" style={{ flex: 1 }}><label>Branch</label><input value={f.branch} onChange={(e) => set("branch", e.target.value)} placeholder="main" /></div>
        </div>
        <div className="fld"><label>Stack (comma-separated)</label><input value={f.stacks} onChange={(e) => set("stacks", e.target.value)} placeholder="React, .NET, Postgres" /></div>
        <div className="fld"><label>About</label><textarea value={f.description} rows={3} onChange={(e) => set("description", e.target.value)} placeholder="What this project is, key context…" style={{ resize: "vertical", fontFamily: "var(--body)" }} /></div>
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
