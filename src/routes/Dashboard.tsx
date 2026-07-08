import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { Chip, Stat, Eyebrow, ACCENT, prColor, Empty, OrbitLoader } from "../components/ui";
import { useTable } from "../hooks/useTable";
import { useToast } from "../context/Toast";
import { useAuth } from "../context/AuthContext";
import { useZoho } from "../context/Zoho";
import { useTimezone, tzHour, tzDate } from "../context/Timezone";
import { useBreak } from "../context/Break";
import { useWeather } from "../hooks/useWeather";
import { useAgent } from "../context/Agent";
import { launch, fetchDocker, type DockerContainer } from "../lib/agent";
import { fetchZohoTickets, fetchTimesheet, fetchSprintBoard, type ZohoItem } from "../lib/zoho";
import { fetchOrbitHours, type OrbitHours } from "../lib/orbitHours";
import { supabase } from "../lib/supabase";
import type { Project, Ticket, Task, Notification } from "../lib/types";

interface BugRow { item: ZohoItem; project: string; spid: string; }
const isOpenBug = (it: ZohoItem) =>
  (it.type || "").toLowerCase().includes("bug") && !/done|closed|resolved|complete/i.test(it.status || "");

const TIMER_KEY = "orbit.timerStart";

export default function Dashboard() {
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const zoho = useZoho();
  const { tz } = useTimezone();
  const { onBreak, timerPaused, startBreak, endBreak } = useBreak();
  const weather = useWeather();
  const { rows: projects } = useTable<Project>("projects");
  const { rows: tickets } = useTable<Ticket>("tickets");
  const { rows: tasks } = useTable<Task>("tasks");
  const [bugs, setBugs] = useState<number | null>(null);
  const [hoursToday, setHoursToday] = useState<number | null>(null);
  const [orbit, setOrbit] = useState<OrbitHours>({ todayH: 0, totalH: 0 });
  const [containers, setContainers] = useState<DockerContainer[] | null>(null);
  const [latestBugs, setLatestBugs] = useState<BugRow[] | null>(null);
  const [bugsLoading, setBugsLoading] = useState(false);
  const [flash, setFlash] = useState<Notification | null>(null);
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

  // Latest open bugs pulled from the sprints of active, Zoho-linked projects.
  useEffect(() => {
    if (zoho.status !== "connected") { setLatestBugs(null); setBugsLoading(false); return; }
    const linked = projects.filter((p) => p.status === "active" && p.sprint_project_id);
    if (linked.length === 0) { setLatestBugs([]); setBugsLoading(false); return; }
    let cancelled = false;
    setBugsLoading(true);
    (async () => {
      const rows: BugRow[] = [];
      await Promise.all(linked.slice(0, 4).map(async (p) => {
        try {
          const board = await fetchSprintBoard(p.sprint_project_id!);
          for (const s of board.sprints)
            for (const it of s.items)
              if (isOpenBug(it)) rows.push({ item: it, project: p.name, spid: p.sprint_project_id! });
        } catch { /* skip this project */ }
      }));
      if (cancelled) return;
      rows.sort((a, b) => (b.item.modifiedTime || "").localeCompare(a.item.modifiedTime || ""));
      setLatestBugs(rows.slice(0, 7));
      setBugsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [zoho.status, projects]);

  // Flash the most recent unread notification when the dashboard opens.
  useEffect(() => {
    supabase.from("notifications").select("*").eq("read", false)
      .order("created_at", { ascending: false }).limit(1)
      .then(({ data }) => { if (data && data[0]) setFlash(data[0] as Notification); });
  }, []);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 6500);
    return () => clearTimeout(t);
  }, [flash]);

  // live timer: if a session is running (started in Time module), tick it here too
  const startRaw = typeof localStorage !== "undefined" ? localStorage.getItem(TIMER_KEY) : null;
  const running = !!startRaw && Number(startRaw) > 0;
  const liveSec = running ? Math.max(0, Math.floor((tick - Number(startRaw)) / 1000)) : 0;
  const liveClock = `${String(Math.floor(liveSec / 3600)).padStart(2, "0")}:${String(Math.floor((liveSec % 3600) / 60)).padStart(2, "0")}:${String(liveSec % 60).padStart(2, "0")}`;
  const orbitTodayLive = +(orbit.todayH + liveSec / 3600).toFixed(2);

  const hh = tzHour(tz);
  const word = hh < 5 ? "Working late" : hh < 12 ? "Good morning" : hh < 17 ? "Good afternoon" : hh < 21 ? "Good evening" : "Working late";
  const firstName = ((user?.user_metadata?.full_name as string | undefined) || "").split(" ")[0];
  const greet = firstName ? `${word}, ${firstName}` : word;
  const dateStr = tzDate(tz);
  const active = projects.filter((p) => p.status === "active");
  const todo = tasks.filter((t) => t.status !== "done").length;

  async function doLaunch(kind: "vscode" | "visualstudio" | "all", p: Project) {
    const res = await launch(kind, { fe_path: p.fe_path, sln_path: p.sln_path, dev_port: p.dev_port, name: p.name });
    toast(res.ok ? `Opening ${res.opened?.join(", ") || kind} · ${p.name}` : (res.error === "agent offline" ? "Local agent offline — start it to launch apps" : res.error || "Couldn't launch"));
  }

  return (
    <>
      {onBreak && <BreakView onEnd={endBreak} timerPaused={timerPaused} />}
      <main className="page">
        {flash && (
          <div className="dash-flash">
            <span className="df-ic"><Icon name="bell" size={17} /></span>
            <div className="df-body" onClick={() => nav("/notifications")}>
              <div className="df-title">{flash.title}</div>
              {flash.body && <div className="df-sub">{flash.body}</div>}
            </div>
            <button className="df-x" onClick={() => setFlash(null)} title="Dismiss"><Icon name="x" size={15} /></button>
          </div>
        )}
        <div className="fade dash-greet">
          <div style={{ minWidth: 0 }}>
            <div className="h1">{greet}</div>
            <div className="greet-row">
              <span className="greet-chip"><Icon name="cal" size={14} />{dateStr}</span>
              {weather && <><span className="greet-sep" /><span className="greet-chip"><span className="gc-em">{weather.emoji}</span>{weather.tempC}°C · {weather.label}</span></>}
              <span className="greet-sep" /><span className="greet-chip"><Icon name="layers" size={14} />{todo} task{todo === 1 ? "" : "s"} to do</span>
              {bugs !== null && <><span className="greet-sep" /><span className="greet-chip" style={{ color: bugs > 0 ? "var(--red)" : "var(--muted)" }}><Icon name="bolt" size={14} />{bugs} open bug{bugs === 1 ? "" : "s"}</span></>}
            </div>
          </div>
          <button className="break-btn" onClick={startBreak} title="Take a break"><span className="bb-cup">☕</span>Take a break</button>
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
                      {held ? <span className="hold">ON HOLD</span> : <span className="live-dot" />}
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
        <div className="rowhead" style={{ marginBottom: 12 }}>
          <Eyebrow>Latest bugs</Eyebrow>
          {latestBugs && latestBugs.length > 0 && (
            <span className="badge" style={{ color: ACCENT.red, background: ACCENT.red + "16", border: `1px solid ${ACCENT.red}30` }}>{latestBugs.length}</span>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 9, margin: "0 0 26px" }}>
          {bugsLoading ? (
            <div style={{ padding: "20px 0" }}><OrbitLoader label="Scanning sprints for bugs…" size={22} /></div>
          ) : latestBugs === null ? (
            <Empty icon="bolt" title="Connect Zoho Sprints" sub="Link a project to Zoho to surface its open bugs here." mini />
          ) : latestBugs.length === 0 ? (
            <Empty icon="bolt" title="No open bugs" sub="Active linked sprints are clear right now." mini />
          ) : latestBugs.map(({ item, project, spid }) => (
            <button key={item.id} className="trow" onClick={() => nav(`/sprints?project=${encodeURIComponent(spid)}`)}>
              <div className="meta">
                <span className="prdot" style={{ background: prColor(item.priority) }} />
                <span className="id">{item.ticketNumber || `#${item.id}`}</span>
                <span className="age">{item.status}</span>
              </div>
              <div className="title">{item.subject}</div>
              <div style={{ fontSize: 11, color: "var(--dim)", marginTop: 4, display: "flex", alignItems: "center", gap: 5 }}>
                <Icon name="sprint" size={11} />{project}
              </div>
            </button>
          ))}
        </div>

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

const BREAK_LINES = [
  "Step away from the keyboard for a minute.",
  "Stretch, breathe, let the tests run.",
  "The bugs will still be here. Sip slowly.",
  "Rest your eyes — look at something far away.",
  "You've earned this cup.",
  "Roll your shoulders back. Unclench your jaw.",
];

function Cup({ variant }: { variant: "coffee" | "tea" }) {
  const liquid = variant === "coffee" ? "#7b4b28" : "#8bd4a6";
  const rim = variant === "coffee" ? "#3a2418" : "#3a6b4f";
  return (
    <svg className="break-cup" viewBox="0 0 140 150" width="150" height="160" aria-hidden>
      <g className="steam">
        <path d="M55 34 C48 24 62 20 55 8" /><path d="M70 32 C63 22 77 18 70 4" /><path d="M85 34 C78 24 92 20 85 8" />
      </g>
      <ellipse cx="70" cy="140" rx="46" ry="7" fill="rgba(0,0,0,.28)" />
      <path d="M30 62 h72 v34 a36 36 0 0 1 -72 0 z" fill="var(--raised2)" stroke="var(--border2)" strokeWidth="2.5" />
      <path d="M32 64 h68 v6 a34 34 0 0 1 -68 0 z" fill={liquid} />
      <ellipse cx="66" cy="64" rx="36" ry="8" fill={liquid} stroke={rim} strokeWidth="2" />
      <path d="M102 66 q26 2 24 22 q-2 18 -26 16" fill="none" stroke="var(--border2)" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

function BreakView({ onEnd, timerPaused }: { onEnd: () => void; timerPaused: boolean }) {
  const [variant, setVariant] = useState<"coffee" | "tea">("coffee");
  const [line, setLine] = useState(() => BREAK_LINES[Math.floor(Math.random() * BREAK_LINES.length)]);
  const [start] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [phase, setPhase] = useState<"in" | "hold" | "out">("in");

  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    const l = setInterval(() => setLine(BREAK_LINES[Math.floor(Math.random() * BREAK_LINES.length)]), 9000);
    return () => { clearInterval(t); clearInterval(l); };
  }, [start]);
  // 4s in · 2s hold · 4s out breathing guide
  useEffect(() => {
    const seq: ["in" | "hold" | "out", number][] = [["in", 4000], ["hold", 2000], ["out", 4000]];
    let i = 0;
    let to: ReturnType<typeof setTimeout>;
    const step = () => { setPhase(seq[i][0]); to = setTimeout(() => { i = (i + 1) % seq.length; step(); }, seq[i][1]); };
    step();
    return () => clearTimeout(to);
  }, []);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const breatheText = phase === "in" ? "Breathe in…" : phase === "hold" ? "Hold…" : "Breathe out…";

  return (
    <div className="break-view">
      <div className="break-bg" aria-hidden>
        {Array.from({ length: 9 }).map((_, i) => <span key={i} className="bean" style={{ left: `${8 + i * 10}%`, animationDelay: `${i * 1.3}s`, animationDuration: `${9 + (i % 4) * 2}s` }}>{i % 2 ? "🍃" : "☕"}</span>)}
      </div>
      <div className="break-inner">
        <div className={"breathe-ring " + phase}><Cup variant={variant} /></div>
        <div className="breathe-text">{breatheText}</div>
        <h2>Break time · {mm}:{ss}</h2>
        <p>{line}</p>
        {timerPaused && <div className="break-paused"><span className="pausedot" />Orbit timer paused — it resumes when you're back</div>}
        <div className="break-actions">
          <button className="cup-toggle" onClick={() => setVariant((v) => (v === "coffee" ? "tea" : "coffee"))} title="Switch brew">
            {variant === "coffee" ? "🍵 Switch to tea" : "☕ Switch to coffee"}
          </button>
          <button className="btn accent" onClick={onEnd}><Icon name="check" size={15} />I'm refreshed</button>
        </div>
      </div>
    </div>
  );
}
