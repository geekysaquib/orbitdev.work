import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { Chip, Stat, Eyebrow, ACCENT, prColor, Empty } from "../components/ui";
import { useTable } from "../hooks/useTable";
import { useToast } from "../context/Toast";
import { useAuth } from "../context/AuthContext";
import { useZoho } from "../context/Zoho";
import { useWeather } from "../hooks/useWeather";
import { useAgent } from "../context/Agent";
import { launch, fetchDocker, type DockerContainer } from "../lib/agent";
import { fetchZohoTickets, fetchTimesheet } from "../lib/zoho";
import { fetchOrbitHours, type OrbitHours } from "../lib/orbitHours";
import type { Project, Ticket, Task } from "../lib/types";

const TIMER_KEY = "orbit.timerStart";

export default function Dashboard() {
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const zoho = useZoho();
  const weather = useWeather();
  const { rows: projects } = useTable<Project>("projects");
  const { rows: tickets } = useTable<Ticket>("tickets");
  const { rows: tasks } = useTable<Task>("tasks");
  const [bugs, setBugs] = useState<number | null>(null);
  const [hoursToday, setHoursToday] = useState<number | null>(null);
  const [orbit, setOrbit] = useState<OrbitHours>({ todayH: 0, totalH: 0 });
  const [containers, setContainers] = useState<DockerContainer[] | null>(null);
  const [tick, setTick] = useState(Date.now());
  const { status: agentStatus } = useAgent();
  const agentDown = agentStatus !== "online";

  // 1s tick drives the live Orbit timer
  useEffect(() => { const t = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { fetchOrbitHours().then(setOrbit).catch(() => {}); }, []);
  useEffect(() => {
    if (agentStatus !== "online") { setContainers(null); return; }
    fetchDocker().then((d) => setContainers(d.available ? d.containers : [])).catch(() => setContainers(null));
  }, [agentStatus]);
  useEffect(() => {
    if (zoho.status !== "connected") { setBugs(null); setHoursToday(null); return; }
    fetchZohoTickets().then((items) => setBugs(items.filter((i) => (i.type || "").toLowerCase() === "bug" && !/done|closed|resolved/i.test(i.status)).length)).catch(() => setBugs(null));
    fetchTimesheet().then((t) => { const k = new Date().toISOString().slice(0, 10); setHoursToday(t.byDate[k] ?? 0); }).catch(() => setHoursToday(null));
  }, [zoho.status]);

  // live timer: if a session is running (started in Time module), tick it here too
  const startRaw = typeof localStorage !== "undefined" ? localStorage.getItem(TIMER_KEY) : null;
  const running = !!startRaw && Number(startRaw) > 0;
  const liveSec = running ? Math.max(0, Math.floor((tick - Number(startRaw)) / 1000)) : 0;
  const liveClock = `${String(Math.floor(liveSec / 3600)).padStart(2, "0")}:${String(Math.floor((liveSec % 3600) / 60)).padStart(2, "0")}:${String(liveSec % 60).padStart(2, "0")}`;
  const orbitTodayLive = +(orbit.todayH + liveSec / 3600).toFixed(2);

  const hh = new Date().getHours();
  const word = hh < 5 ? "Working late" : hh < 12 ? "Good morning" : hh < 17 ? "Good afternoon" : hh < 21 ? "Good evening" : "Working late";
  const firstName = ((user?.user_metadata?.full_name as string | undefined) || "").split(" ")[0];
  const greet = firstName ? `${word}, ${firstName}` : word;
  const dateStr = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const active = projects.filter((p) => p.status === "active");
  const todo = tasks.filter((t) => t.status !== "done").length;

  async function doLaunch(kind: "vscode" | "visualstudio" | "all", p: Project) {
    const res = await launch(kind, { fe_path: p.fe_path, sln_path: p.sln_path, dev_port: p.dev_port, name: p.name });
    toast(res.ok ? `Opening ${res.opened?.join(", ") || kind} · ${p.name}` : (res.error === "agent offline" ? "Local agent offline — start it to launch apps" : res.error || "Couldn't launch"));
  }

  return (
    <>
      <main className="page">
        <div className="fade">
          <div className="h1">{greet}</div>
          <div className="greet-row">
            <span className="greet-chip"><Icon name="cal" size={14} />{dateStr}</span>
            {weather && <><span className="greet-sep" /><span className="greet-chip"><span className="gc-em">{weather.emoji}</span>{weather.tempC}°C · {weather.label}</span></>}
            <span className="greet-sep" /><span className="greet-chip"><Icon name="layers" size={14} />{todo} task{todo === 1 ? "" : "s"} to do</span>
            {bugs !== null && <><span className="greet-sep" /><span className="greet-chip" style={{ color: bugs > 0 ? "var(--red)" : "var(--muted)" }}><Icon name="bolt" size={14} />{bugs} open bug{bugs === 1 ? "" : "s"}</span></>}
          </div>
        </div>

        <div className="grid-stats">
          <Stat icon="activity" label="Active projects" value={String(active.length)} sub={`${projects.length} total`} tone={ACCENT.mint} />
          {/* Orbit hours — ticks live when a timer is running in the Time module */}
          <div className="card stat fade orbit-stat" onClick={() => nav("/time")} style={{ cursor: "pointer" }}>
            <div className="lab"><span style={{ color: ACCENT.mint }}><Icon name="orbit" size={15} /></span>Orbit hours{running && <span className="rec-dot" title="Timer running" />}</div>
            <div className="val">{running ? liveClock : `${orbit.todayH}h`}</div>
            <div className="subv">{running ? `recording · ${orbit.totalH}h all-time` : `${orbit.totalH}h all-time`}</div>
          </div>
          <Stat icon="clock" label="Zoho hours today" value={hoursToday !== null ? `${hoursToday}h` : "—"} sub={hoursToday !== null ? "logged in Sprints" : "connect Zoho"} tone={ACCENT.blue} />
          <Stat icon="cpu" label="Containers up"
            value={containers === null ? "—" : String(containers.length)}
            sub={containers === null ? "agent offline" : containers.length ? containers.map((c) => c.name).slice(0, 2).join(", ") : "none running"}
            tone={ACCENT.violet} />
        </div>

        <Eyebrow>Project bays</Eyebrow>
        <div className="bays">
          {projects.map((p, i) => {
            const accent = p.accent || ACCENT.mint;
            const held = p.status === "hold";
            return (
              <div key={p.id} className="bay fade" style={{ animationDelay: `${i * 0.05}s` }} onClick={() => nav(`/projects/${p.id}`)}>
                <div className="accentline" style={{ background: `linear-gradient(90deg,${accent},transparent)` }} />
                <div className="top">
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <span className="nm">{p.name}</span>
                      {p.status === "hold" || p.status === "released" ? <span className="hold">{p.status === "hold" ? "ON HOLD" : "RELEASED"}</span> : <span className="live-dot" />}
                    </div>
                    <div className="cl">{p.client}</div>
                  </div>
                  {p.sprint_project_id && <span style={{ color: ACCENT.mint, opacity: .8 }} title="Linked to Zoho Sprints"><Icon name="sprint" size={14} /></span>}
                </div>
                <div className="chips">{p.stacks?.map((s) => <Chip key={s} name={s} />)}</div>
                <div className="instruments">
                  <span className="inst" style={{ color: p.branch ? ACCENT.amber : ACCENT.muted }}><Icon name="git" size={13} />{p.branch || "main"}</span>
                  <span className="inst" style={{ color: ACCENT.dim }}><Icon name="clock" size={13} />{p.dev_port ? `:${p.dev_port}` : "—"}</span>
                </div>
                <div className="launch-row" onClick={(e) => e.stopPropagation()}>
                  {p.fe_path && <button className="lbtn" disabled={agentDown} onClick={() => doLaunch("vscode", p)}><span style={{ color: ACCENT.blue }}><Icon name="code" size={14} /></span>Open UI</button>}
                  {p.sln_path && <button className="lbtn" disabled={agentDown} onClick={() => doLaunch("visualstudio", p)}><span style={{ color: ACCENT.violet }}><Icon name="server" size={14} /></span>Backend</button>}
                  <button className="lbtn" disabled={agentDown} style={{ marginLeft: "auto", borderColor: accent + "45", background: accent + "14", color: accent }} onClick={() => doLaunch("all", p)}><Icon name="play" size={12} fill />All</button>
                </div>
              </div>
            );
          })}
        </div>
        {projects.length === 0 && <Empty icon="boxes" title="No projects yet" sub="Add your first project from the Projects tab to launch it in one click." />}
      </main>

      <aside className="aside">
        <Eyebrow>Zoho — assigned to me</Eyebrow>
        <div style={{ display: "flex", flexDirection: "column", gap: 9, margin: "12px 0 26px" }}>
          {tickets.slice(0, 6).map((t) => (
            <button key={t.id} className="trow" onClick={() => nav("/sprints")}>
              <div className="meta"><span className="prdot" style={{ background: prColor(t.priority) }} />
                <span className="id">{t.zoho_id || "—"}</span><span className="age">{t.status}</span></div>
              <div className="title">{t.title}</div>
            </button>
          ))}
          {tickets.length === 0 && <Empty icon="ticket" title="No work items" sub="Sync your Zoho Sprints items from the Sprints screen." mini />}
        </div>
      </aside>
    </>
  );
}
