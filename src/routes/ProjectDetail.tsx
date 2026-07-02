import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { Chip, ACCENT } from "../components/ui";
import { useTable } from "../hooks/useTable";
import { useToast } from "../context/Toast";
import { launch } from "../lib/agent";
import type { Project, Task } from "../lib/types";

const TABS = ["overview", "tasks", "git", "environment", "notes"];

export default function ProjectDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { rows } = useTable<Project>("projects");
  const { rows: tasks } = useTable<Task>("tasks");
  const [tab, setTab] = useState("overview");
  const p = rows.find((x) => x.id === id);

  if (!p) return <main className="page"><div style={{ color: "var(--dim)" }}>Loading project…</div></main>;
  const accent = p.accent || ACCENT.mint;
  const mine = tasks.filter((t) => t.project_id === p.id);

  async function doLaunch(kind: "vscode" | "visualstudio" | "terminal" | "browser" | "all") {
    const res = await launch(kind, { fe_path: p!.fe_path, sln_path: p!.sln_path, dev_port: p!.dev_port, name: p!.name });
    toast(res.ok ? `${kind} launching · ${p!.name}` : "Local agent offline — run the ORBIT agent");
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
          {p.fe_path && <button className="btn" onClick={() => doLaunch("vscode")}><span style={{ color: ACCENT.blue }}><Icon name="code" size={14} /></span>Open UI</button>}
          {p.sln_path && <button className="btn" onClick={() => doLaunch("visualstudio")}><span style={{ color: ACCENT.violet }}><Icon name="server" size={14} /></span>Backend</button>}
          <button className="iconbtn" title="Terminal" onClick={() => doLaunch("terminal")}><Icon name="terminal" size={15} /></button>
          <button className="iconbtn" title="Open localhost" onClick={() => doLaunch("browser")}><Icon name="globe" size={15} /></button>
          <button className="btn accent" onClick={() => doLaunch("all")}><Icon name="play" size={13} fill />Open all</button>
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
            <div className="card" style={{ padding: 20 }}>
              <div className="eyebrow">Quick actions</div>
              {["Pull latest", "Run tests", "Docker compose up", "Deploy to Netlify"].map((a) => (
                <button key={a} className="btn ghost" style={{ width: "100%", justifyContent: "flex-start", marginTop: 8 }}
                  onClick={() => toast(`${a} · ${p.name}`)}><Icon name="bolt" size={14} />{a}</button>
              ))}
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
    </main>
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
