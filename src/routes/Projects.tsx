import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { Chip, Badge, ACCENT, Empty } from "../components/ui";
import { useTable } from "../hooks/useTable";
import { useToast } from "../context/Toast";
import { useAgent } from "../context/Agent";
import { pickPath } from "../lib/agent";
import type { Project } from "../lib/types";

const FILTERS: [string, string][] = [["all", "All"], ["work", "Client work"], ["personal", "Personal"], ["active", "Active"], ["hold", "On hold"]];

export default function Projects() {
  const nav = useNavigate();
  const { rows, insert } = useTable<Project>("projects");
  const toast = useToast();
  const { status } = useAgent();
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
    await insert({
      name: form.name, client: form.client || null, fe_path: form.fe_path || null,
      sln_path: form.sln_path || null, stacks: [form.stack], status: "active", accent: ACCENT.mint,
    } as Partial<Project>);
    setModal(false); setForm({ name: "", client: "", fe_path: "", sln_path: "", stack: "React" });
  }

  return (
    <main className="page">
      <div className="rowhead">
        <div><div className="h1">Projects</div><div className="sub">Every workspace you launch from — one registry.</div></div>
        <button className="btn accent" onClick={() => setModal(true)}><Icon name="plus" size={15} />New project</button>
      </div>
      <div className="filters" style={{ marginTop: 22, display: "flex", alignItems: "center", gap: 10 }}>
        {FILTERS.map(([k, l]) => (
          <button key={k} className={"fchip" + (filter === k ? " on" : "")} onClick={() => setFilter(k)}>{l}</button>
        ))}
        <div className="bf-search" style={{ marginLeft: "auto" }}>
          <Icon name="search" size={13} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search projects…" />
          {query && <button className="bf-clear" onClick={() => setQuery("")} style={{ marginLeft: 4 }}>Clear</button>}
        </div>
      </div>
      <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr><th>Project</th><th>Stack</th><th>Status</th><th>Branch</th><th>Port</th><th></th></tr></thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.id} className="prow" onClick={() => nav(`/projects/${p.id}`)}>
              <td><div style={{ fontFamily: "var(--display)", fontWeight: 600 }}>{p.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--dim)", marginTop: 2 }}>{p.client}</div></td>
              <td><div className="chips" style={{ margin: 0 }}>{p.stacks?.map((s) => <Chip key={s} name={s} />)}</div></td>
              <td>{p.status === "hold" ? <Badge text="On hold" color={ACCENT.violet} /> : <Badge text="Active" color={ACCENT.mint} />}</td>
              <td className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{p.branch || "main"}</td>
              <td className="mono" style={{ fontSize: 12, color: "var(--dim)" }}>{p.dev_port || "—"}</td>
              <td style={{ textAlign: "right" }}><Icon name="chevR" size={16} /></td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={6}><Empty icon="boxes" title={rows.length === 0 ? "No projects yet" : "Nothing matches this filter"} sub={rows.length === 0 ? "Add your first project to launch it in one click." : "Try a different filter."} mini /></td></tr>}
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
              <select value={form.stack} onChange={(e) => setForm({ ...form, stack: e.target.value })}>
                <option>React</option><option>.NET</option><option>Next.js</option><option>Python</option>
              </select></div>
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
