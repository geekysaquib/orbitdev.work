import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { Chip, Badge, ACCENT } from "../components/ui";
import { useTable } from "../hooks/useTable";
import type { Project } from "../lib/types";

const FILTERS: [string, string][] = [["all", "All"], ["work", "Client work"], ["personal", "Personal"], ["active", "Active"], ["hold", "On hold"]];

export default function Projects() {
  const nav = useNavigate();
  const { rows, insert } = useTable<Project>("projects");
  const [filter, setFilter] = useState("all");
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: "", client: "", fe_path: "", sln_path: "", stack: "React" });

  const list = rows.filter((p) => {
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
      <div className="filters" style={{ marginTop: 22 }}>
        {FILTERS.map(([k, l]) => (
          <button key={k} className={"fchip" + (filter === k ? " on" : "")} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
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
          {list.length === 0 && <tr><td colSpan={6} style={{ color: "var(--dim)" }}>No projects match this filter.</td></tr>}
        </tbody>
      </table>

      {modal && (
        <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && setModal(false)}>
          <div className="modal">
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <h3>New project</h3>
              <button className="iconbtn" onClick={() => setModal(false)}><Icon name="x" size={16} /></button>
            </div>
            <div className="fld"><label>Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="monoZTrack" /></div>
            <div className="fld"><label>Client</label><input value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} placeholder="Obayashi" /></div>
            <div style={{ display: "flex", gap: 12 }}>
              <div className="fld" style={{ flex: 1 }}><label>Frontend folder</label><input value={form.fe_path} onChange={(e) => setForm({ ...form, fe_path: e.target.value })} placeholder="C:/dev/.../web" /></div>
              <div className="fld" style={{ flex: 1 }}><label>Backend .sln</label><input value={form.sln_path} onChange={(e) => setForm({ ...form, sln_path: e.target.value })} placeholder="C:/dev/.../App.sln" /></div>
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
