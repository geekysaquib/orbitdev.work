import { useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { Chip, Stat, Eyebrow, ACCENT, prColor } from "../components/ui";
import { useTable } from "../hooks/useTable";
import { useToast } from "../context/Toast";
import { launch } from "../lib/agent";
import type { Project, Ticket } from "../lib/types";

export default function Dashboard() {
  const nav = useNavigate();
  const toast = useToast();
  const { rows: projects } = useTable<Project>("projects");
  const { rows: tickets } = useTable<Ticket>("tickets");

  const hh = new Date().getHours();
  const greet = hh < 12 ? "Good morning" : hh < 18 ? "Good afternoon" : "Working late";
  const active = projects.filter((p) => p.status === "active");
  const openT = tickets.filter((t) => t.status !== "Resolved");

  async function doLaunch(kind: "vscode" | "visualstudio" | "all", p: Project) {
    const res = await launch(kind, { fe_path: p.fe_path, sln_path: p.sln_path, dev_port: p.dev_port, name: p.name });
    toast(res.ok ? `${kind} launching · ${p.name}` : "Local agent offline — run the ORBIT agent to launch apps");
  }

  return (
    <>
      <main className="page">
        <div className="fade">
          <div className="h1">{greet}</div>
          <div className="sub">{active.length} active projects · <span style={{ color: "var(--amber)" }}>{openT.length} open tickets</span></div>
        </div>
        <div className="grid-stats">
          <Stat icon="activity" label="Active projects" value={String(active.length)} tone={ACCENT.mint} />
          <Stat icon="ticket" label="Open tickets" value={String(openT.length)} tone={ACCENT.amber}
            sub={`${openT.filter((t) => t.priority === "high").length} high priority`} />
          <Stat icon="clock" label="Focused today" value="3h 42m" tone={ACCENT.blue} />
          <Stat icon="cpu" label="Containers up" value="2" tone={ACCENT.violet} />
        </div>
        <Eyebrow>Project bays</Eyebrow>
        <div className="bays">
          {projects.map((p, i) => {
            const accent = p.accent || ACCENT.mint;
            const held = p.status === "hold";
            return (
              <div key={p.id} className="bay fade" style={{ animationDelay: `${i * 0.05}s` }}
                onClick={() => nav(`/projects/${p.id}`)}>
                <div className="accentline" style={{ background: `linear-gradient(90deg,${accent},transparent)` }} />
                <div className="top">
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <span className="nm">{p.name}</span>
                      {held ? <span className="hold">ON HOLD</span> : <span className="live-dot" />}
                    </div>
                    <div className="cl">{p.client}</div>
                  </div>
                </div>
                <div className="chips">{p.stacks?.map((s) => <Chip key={s} name={s} />)}</div>
                <div className="instruments">
                  <span className="inst" style={{ color: p.branch ? ACCENT.amber : ACCENT.muted }}>
                    <Icon name="git" size={13} />{p.branch || "main"}</span>
                  <span className="inst" style={{ color: ACCENT.dim }}><Icon name="clock" size={13} />{p.dev_port ? `:${p.dev_port}` : "—"}</span>
                </div>
                <div className="launch-row" onClick={(e) => e.stopPropagation()}>
                  {p.fe_path && <button className="lbtn" onClick={() => doLaunch("vscode", p)}>
                    <span style={{ color: ACCENT.blue }}><Icon name="code" size={14} /></span>Open UI</button>}
                  {p.sln_path && <button className="lbtn" onClick={() => doLaunch("visualstudio", p)}>
                    <span style={{ color: ACCENT.violet }}><Icon name="server" size={14} /></span>Backend</button>}
                  <button className="lbtn" style={{ marginLeft: "auto", borderColor: accent + "45", background: accent + "14", color: accent }}
                    onClick={() => doLaunch("all", p)}><Icon name="play" size={12} fill />All</button>
                </div>
              </div>
            );
          })}
          {projects.length === 0 && <div style={{ color: "var(--dim)", padding: 20 }}>No projects yet — add one from the Projects tab.</div>}
        </div>
      </main>
      <aside className="aside">
        <Eyebrow>Zoho — assigned to me</Eyebrow>
        <div style={{ display: "flex", flexDirection: "column", gap: 9, margin: "12px 0 26px" }}>
          {tickets.slice(0, 6).map((t) => (
            <button key={t.id} className="trow" onClick={() => nav("/tickets")}>
              <div className="meta"><span className="prdot" style={{ background: prColor(t.priority) }} />
                <span className="id">{t.zoho_id || "—"}</span><span className="age">{t.status}</span></div>
              <div className="title">{t.title}</div>
            </button>
          ))}
        </div>
      </aside>
    </>
  );
}
