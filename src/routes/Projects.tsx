import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { Select } from "../components/Select";
import { Chip, Badge, ACCENT, Empty, OrbitLoader } from "../components/ui";
import { useTable } from "../hooks/useTable";
import { useProjectsGitStatus } from "../hooks/useProjectsGitStatus";
import { useToast } from "../context/Toast";
import { useAgent } from "../context/Agent";
import { pickPath, type GitStatusResult } from "../lib/agent";
import { recordAudit } from "../lib/audit";
import { useOrbitRuntime } from "../runtime";
import type { Project } from "../lib/types";

const FILTERS: [string, string][] = [["all", "All"], ["work", "Client work"], ["personal", "Personal"], ["active", "Active"], ["hold", "On hold"]];

export default function Projects() {
  const nav = useNavigate();
  const { rows, insert, error, loading } = useTable<Project>("projects");
  const { events } = useOrbitRuntime();
  const toast = useToast();
  const { status } = useAgent();
  const { gitByProject, gitLoading, refreshGit } = useProjectsGitStatus(rows, status === "online");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: "", client: "", fe_path: "", sln_path: "", stack: "React" });

  async function browse(field: "fe_path" | "sln_path", kind: "folder" | "file") {
    if (status !== "online") {
      toast(status === "disconnected"
        ? "Agent disconnected — reconnect it from the top bar to browse."
        : "Agent is offline — start it (cd agent && npm start), then it connects automatically.");
      return;
    }
    const p = await pickPath(kind);
    if (p) setForm((f) => ({ ...f, [field]: p }));
    else toast("No path selected");
  }

  const list = rows.filter((p) => {
    const q = query.trim().toLowerCase();
    if (q && !`${p.name} ${p.client || ""} ${(p.stacks || []).join(" ")} ${p.branch || ""}`.toLowerCase().includes(q)) return false;
    if (filter === "all") return true;
    if (filter === "work") return /Obayashi|Salon|Japan/i.test(p.client || "");
    if (filter === "personal") return /Personal/i.test(p.client || "");
    return p.status === filter;
  });

  async function add() {
    const { data } = await insert({
      name: form.name, client: form.client || null, fe_path: form.fe_path || null,
      sln_path: form.sln_path || null, stacks: [form.stack], status: "active", accent: ACCENT.mint,
    } as Partial<Project>);
    recordAudit({ action: "project.create", entityType: "project", meta: { name: form.name } });
    // Fire-and-forget, same principle as recordAudit() — see
    // docs/architecture/event-engine-adoption.md.
    if (data) void events.publish({ source: "project-workflow", type: "created", occurredAt: new Date().toISOString(), teamId: data.team_id ?? null, payload: { projectId: data.id, name: data.name, status: data.status, client: data.client } }).catch(() => {});
    setModal(false); setForm({ name: "", client: "", fe_path: "", sln_path: "", stack: "React" });
  }

  return (
    <main className="page">
      <div className="rowhead">
        <div><div className="h1">Projects</div><div className="sub">Every workspace you launch from — one registry.</div></div>
        <button className="btn accent" onClick={() => setModal(true)}><Icon name="plus" size={15} />New project</button>
      </div>
      {error && (
        <div className="authx-err" style={{ marginTop: 16 }}><Icon name="plug" size={13} />Couldn't load projects: {error}</div>
      )}
      <div className="filters" style={{ marginTop: 22, display: "flex", alignItems: "center", gap: 10 }}>
        {FILTERS.map(([k, l]) => (
          <button key={k} className={"fchip" + (filter === k ? " on" : "")} onClick={() => setFilter(k)}>{l}</button>
        ))}
        <button className="iconbtn" title="Recheck git status" disabled={gitLoading || status !== "online"} onClick={refreshGit} style={{ marginLeft: "auto" }}>
          <Icon name="refresh" size={14} className={gitLoading ? "spin" : ""} />
        </button>
        <div className="bf-search">
          <Icon name="search" size={13} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search projects…" />
          {query && <button className="bf-clear" onClick={() => setQuery("")} style={{ marginLeft: 4 }}>Clear</button>}
        </div>
      </div>
      <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr><th>Project</th><th>Stack</th><th>Status</th><th>Branch</th><th>Port</th><th></th></tr></thead>
        <tbody>
          {loading ? <tr><td colSpan={6}><div className="page-loader"><OrbitLoader label="Loading projects…" /></div></td></tr> : <>
          {list.map((p) => (
            <tr key={p.id} className="prow" onClick={() => nav(`/projects/${p.id}`)}>
              <td><div style={{ fontFamily: "var(--display)", fontWeight: 600 }}>{p.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--dim)", marginTop: 2 }}>{p.client}</div></td>
              <td><div className="chips" style={{ margin: 0 }}>{p.stacks?.map((s) => <Chip key={s} name={s} />)}</div></td>
              <td>{p.status === "hold" ? <Badge text="On hold" color={ACCENT.violet} /> : <Badge text="Active" color={ACCENT.mint} />}</td>
              <td className="mono" style={{ fontSize: 12 }}><GitBranchCell project={p} git={gitByProject[p.id]} /></td>
              <td className="mono" style={{ fontSize: 12, color: "var(--dim)" }}>{p.dev_port || "—"}</td>
              <td style={{ textAlign: "right" }}><Icon name="chevR" size={16} /></td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={6}><Empty icon="boxes" title={rows.length === 0 ? "No projects yet" : "Nothing matches this filter"} sub={rows.length === 0 ? "Add your first project to launch it in one click." : "Try a different filter."} mini /></td></tr>}
          </>}
        </tbody>
      </table>
      </div>

      {modal && (
        <div className="modal-bg">
          <div className="modal">
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <h3>New project</h3>
              <button className="iconbtn" onClick={() => setModal(false)}><Icon name="x" size={16} /></button>
            </div>
            <div className="fld"><label>Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="monoZTrack" /></div>
            <div className="fld"><label>Client</label><input value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} placeholder="Obayashi" /></div>
            <div className="fld">
              <label>Frontend folder</label>
              <div className="input-row">
                <input value={form.fe_path} onChange={(e) => setForm({ ...form, fe_path: e.target.value })} placeholder="C:/dev/.../web" />
                <button className="btn sm" disabled={status !== "online"} onClick={() => browse("fe_path", "folder")}><Icon name="folderOpen" size={15} />Browse</button>
              </div>
            </div>
            <div className="fld">
              <label>Backend .sln</label>
              <div className="input-row">
                <input value={form.sln_path} onChange={(e) => setForm({ ...form, sln_path: e.target.value })} placeholder="C:/dev/.../App.sln" />
                <button className="btn sm" disabled={status !== "online"} onClick={() => browse("sln_path", "file")}><Icon name="folderOpen" size={15} />Browse</button>
              </div>
            </div>
            <div className="fld"><label>Primary stack</label>
              <Select full value={form.stack} onChange={(e) => setForm({ ...form, stack: e.target.value })}>
                <option>React</option><option>.NET</option><option>Next.js</option><option>Python</option>
              </Select></div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 22 }}>
              <button className="btn" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={add} disabled={!form.name}>Add project</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/** Live git status when the agent has it; falls back to the static `branch` column otherwise. */
function GitBranchCell({ project, git }: { project: Project; git?: GitStatusResult }) {
  if (!git?.ok) return <span style={{ color: "var(--muted)" }}>{project.branch || "main"}</span>;
  const dirty = git.dirty ?? 0;
  const arrows = `${git.ahead ? `↑${git.ahead}` : ""}${git.behind ? `↓${git.behind}` : ""}`;
  const title = git.lastCommit ? `${git.lastCommit.subject} — ${git.lastCommit.author}` : undefined;
  return (
    <span title={title} style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <span>
        <span style={{ color: dirty > 0 ? "var(--amber)" : "var(--mint)" }}>{git.branch}</span>
        {arrows && <span style={{ color: "var(--dim)", marginLeft: 6 }}>{arrows}</span>}
      </span>
      {dirty > 0 && <span style={{ fontSize: 10.5, color: "var(--dim)" }}>{dirty} uncommitted</span>}
    </span>
  );
}
