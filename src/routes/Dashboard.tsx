import { useEffect, useRef, useState } from "react";
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
import { launch, fetchDocker, fetchDockerImages, gitPull, devRunning, npmOutdated, npmAudit, dockerDf, dockerPrune, portsMap, gmailUnread, agentEvents, type DockerContainer } from "../lib/agent";
import { pgServers, pgHealth } from "../lib/pg";
import { cachedChores, loadChores, type ChoreSettings, type ChoreId } from "../lib/chores";
import { saveBreakLog, notify } from "../lib/breakLog";
import { fetchZohoTickets, fetchTimesheet, fetchSprintBoard, fetchSprintProjects, type ZohoItem } from "../lib/zoho";
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
  const { onBreak, timerPaused, breakStartedAt, startBreak, endBreak } = useBreak();
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

  // Surface the most recent unread notification. It stays put until dismissed —
  // a break digest shouldn't evaporate before it's been read.
  const loadFlash = () => {
    supabase.from("notifications").select("*").eq("read", false)
      .order("created_at", { ascending: false }).limit(1)
      .then(({ data }) => setFlash(data && data[0] ? (data[0] as Notification) : null));
  };
  useEffect(() => { loadFlash(); }, []);
  // A break writes its digest on the way out — pick it up as soon as the break ends.
  useEffect(() => { if (!onBreak) loadFlash(); }, [onBreak]);

  async function dismissFlash() {
    if (!flash) return;
    const id = flash.id;
    setFlash(null);
    await supabase.from("notifications").update({ read: true } as never).eq("id", id);
  }

  // live timer: if a session is running (started in Time module), tick it here too
  const startRaw = typeof localStorage !== "undefined" ? localStorage.getItem(TIMER_KEY) : null;
  const running = !!startRaw && Number(startRaw) > 0;
  const liveSec = running ? Math.max(0, Math.floor((tick - Number(startRaw)) / 1000)) : 0;
  const liveClock = `${String(Math.floor(liveSec / 3600)).padStart(2, "0")}:${String(Math.floor((liveSec % 3600) / 60)).padStart(2, "0")}:${String(liveSec % 60).padStart(2, "0")}`;
  const orbitTodayLive = +(orbit.todayH + liveSec / 3600).toFixed(2);

  const hh = tzHour(tz);
  const word = hh < 5 ? "Working late" : hh < 12 ? "Good morning" : hh < 17 ? "Good afternoon" : hh < 21 ? "Good evening" : "Working late";
  const firstName = (user?.full_name || "").split(" ")[0];
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
      {onBreak && <BreakView onEnd={endBreak} timerPaused={timerPaused} startedAt={breakStartedAt} projects={active} tasks={tasks} zohoConnected={zoho.status === "connected"} agentOnline={agentStatus === "online"} />}
      <main className="page">
        {flash && (
          <div className="dash-flash">
            <span className="df-ic"><Icon name="bell" size={17} /></span>
            <div className="df-body" onClick={() => nav("/notifications")}>
              <div className="df-title">{flash.title}</div>
              {flash.body && <div className="df-sub">{flash.body}</div>}
            </div>
            <button className="df-x" onClick={dismissFlash} title="Mark as read"><Icon name="x" size={15} /></button>
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

// ---- Coffee/tea break: brew-sync + simulated agent feed ----
type Tone = "add" | "ok" | "dim" | "info" | "warn";
interface AgentTask {
  icon: string; title: string; meta: string; delta: string; tone: Tone;
  add: number; del: number; tests: number; files: number; isPr?: boolean; isDeploy?: boolean;
}
const AGENT_TASKS: AgentTask[] = [
  { icon: "co", title: "Guard null session in auth middleware", meta: "core-api · main", delta: "+18 −4", tone: "add", add: 18, del: 4, tests: 0, files: 1 },
  { icon: "✓", title: "Suite green: 104 passed, 0 failed", meta: "api-gateway", delta: "104 ✓", tone: "ok", add: 0, del: 0, tests: 104, files: 0 },
  { icon: "co", title: "Extract useBrewTimer hook", meta: "web · feat/brew-sync", delta: "+96 −140", tone: "add", add: 96, del: 140, tests: 0, files: 4 },
  { icon: "↑", title: "Bumped 3 deps · 0 advisories", meta: "web", delta: "3 ↑", tone: "dim", add: 0, del: 0, tests: 0, files: 1 },
  { icon: "ci", title: "Pipeline #482 green in 2m14s", meta: "orbit/ci", delta: "2m14s", tone: "ok", add: 0, del: 0, tests: 0, files: 0 },
  { icon: "pr", title: "Opened PR #219 · ready for review", meta: "feat/brew-sync", delta: "#219", tone: "info", add: 0, del: 0, tests: 0, files: 0, isPr: true },
  { icon: "↗", title: "Preview deploy is live", meta: "orbit-pr-219.netlify.app", delta: "↑ live", tone: "info", add: 0, del: 0, tests: 0, files: 0, isDeploy: true },
  { icon: "dc", title: "Updated brew-sync docs", meta: "docs · main", delta: "+42 −3", tone: "add", add: 42, del: 3, tests: 0, files: 2 },
  { icon: "✓", title: "Snapshot tests refreshed", meta: "web", delta: "12 ✓", tone: "ok", add: 0, del: 0, tests: 12, files: 3 },
  { icon: "co", title: "Cache brew levels in localStorage", meta: "web · feat/brew-sync", delta: "+31 −6", tone: "add", add: 31, del: 6, tests: 0, files: 2 },
  { icon: "co", title: "Fix flaky timezone rollover test", meta: "core-api", delta: "+9 −22", tone: "add", add: 9, del: 22, tests: 0, files: 1 },
  { icon: "pr", title: "Opened PR #221 · dependency bumps", meta: "chore/deps", delta: "#221", tone: "info", add: 0, del: 0, tests: 0, files: 0, isPr: true },
];
const SHIP_EVERY = 6.5; // seconds between simulated ships
const BREW_TARGET = 480; // seconds to a full brew

const BEV: Record<"coffee" | "tea", { body: string; crema: string; label: string; other: string }> = {
  coffee: { body: "#6f4326", crema: "#8a5a34", label: "Coffee", other: "Switch to tea" },
  tea: { body: "#7fbf8f", crema: "#a6d8b5", label: "Tea", other: "Switch to coffee" },
};
const TONE_COLOR: Record<Tone, string> = { add: "#3fe08b", ok: "#43e392", dim: "#8a908a", info: "#7aa6ff", warn: "#e2a24a" };
const TONE_BG: Record<Tone, string> = { add: "rgba(63,224,139,.10)", ok: "rgba(63,224,139,.10)", dim: "rgba(140,150,140,.10)", info: "rgba(122,166,255,.12)", warn: "rgba(226,162,74,.12)" };

// A real chore the agent runs during a break
interface LiveRow { key: number; icon: string; title: string; meta: string; delta: string; tone: Tone; at: number; href?: string; }

const fmtDur = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
const strengthLabel = (pct: number) =>
  pct >= 100 ? "Fully brewed" : pct >= 88 ? "Strong" : pct >= 66 ? "Bold brew" : pct >= 42 ? "Medium roast" : pct >= 18 ? "Light roast" : "Warming up";

function BrewCup({ pct, variant }: { pct: number; variant: "coffee" | "tea" }) {
  const bev = BEV[variant];
  const C = 2 * Math.PI * 150;
  const offset = C * (1 - pct / 100);
  const liquidY = 250 - 112 * (pct / 100);
  const liquidH = Math.max(0, 252 - liquidY);
  return (
    <svg width="100%" height="100%" viewBox="0 0 360 360" style={{ display: "block" }} aria-hidden>
      <defs><clipPath id="bvCupClip"><path d="M132 130 L132 236 Q132 256 152 256 L208 256 Q228 256 228 236 L228 130 Z" /></clipPath></defs>
      <g className="bv-ring">
        <circle cx="180" cy="180" r="150" fill="none" stroke="rgba(63,224,139,.12)" strokeWidth="2" />
        <circle cx="180" cy="180" r="150" fill="none" stroke="#3fe08b" strokeWidth="4" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={offset} transform="rotate(-90 180 180)"
          style={{ transition: "stroke-dashoffset .9s cubic-bezier(.34,.1,.2,1)" }} />
      </g>
      <g style={{ opacity: 0.9 }}>
        <path d="M164 112 q-8 -10 0 -20 q8 -10 0 -20" fill="none" stroke="rgba(190,215,200,.5)" strokeWidth="3" strokeLinecap="round" style={{ animation: "bvSteam 3.2s ease-in-out infinite" }} />
        <path d="M182 108 q-8 -10 0 -20 q8 -10 0 -20" fill="none" stroke="rgba(190,215,200,.5)" strokeWidth="3" strokeLinecap="round" style={{ animation: "bvSteam 3.2s ease-in-out infinite 1s" }} />
        <path d="M198 112 q-8 -10 0 -20 q8 -10 0 -20" fill="none" stroke="rgba(190,215,200,.5)" strokeWidth="3" strokeLinecap="round" style={{ animation: "bvSteam 3.2s ease-in-out infinite 2s" }} />
      </g>
      <ellipse cx="180" cy="266" rx="54" ry="8" fill="rgba(0,0,0,.4)" />
      <g clipPath="url(#bvCupClip)">
        <rect x="130" y={liquidY} width="100" height={liquidH} fill={bev.body} style={{ transition: "y .9s cubic-bezier(.34,.1,.2,1),height .9s cubic-bezier(.34,.1,.2,1)" }} />
        <ellipse cx="180" cy={liquidY} rx="48" ry="7" fill={bev.crema} style={{ transition: "cy .9s cubic-bezier(.34,.1,.2,1)" }} />
      </g>
      <path d="M132 130 L132 236 Q132 256 152 256 L208 256 Q228 256 228 236 L228 130" fill="none" stroke="#9fb0b6" strokeWidth="3" strokeLinejoin="round" opacity="0.6" />
      <path d="M228 148 C266 150 266 200 228 202" fill="none" stroke="#9fb0b6" strokeWidth="9" strokeLinecap="round" opacity="0.55" />
      <ellipse cx="180" cy="130" rx="48" ry="11" fill="none" stroke="#9fb0b6" strokeWidth="3" opacity="0.7" />
      <ellipse cx="180" cy="130" rx="42" ry="8" fill="rgba(0,0,0,.35)" />
    </svg>
  );
}

interface Stats { shipped: number; commits: number; tests: number; prs: number; deploys: number; add: number; del: number; files: number; }
function foldStats(log: AgentTask[]): Stats {
  return log.reduce<Stats>((a, t) => ({
    shipped: a.shipped + 1,
    commits: a.commits + (t.icon === "co" ? 1 : 0),
    tests: a.tests + t.tests,
    prs: a.prs + (t.isPr ? 1 : 0),
    deploys: a.deploys + (t.isDeploy ? 1 : 0),
    add: a.add + t.add, del: a.del + t.del, files: a.files + t.files,
  }), { shipped: 0, commits: 0, tests: 0, prs: 0, deploys: 0, add: 0, del: 0, files: 0 });
}
const dueCount = (elapsedSec: number) => Math.min(AGENT_TASKS.length * 3, Math.floor(elapsedSec / SHIP_EVERY));
const buildLog = (n: number) => Array.from({ length: n }, (_, i) => AGENT_TASKS[i % AGENT_TASKS.length]);

function BreakView({ onEnd, timerPaused, startedAt, projects, tasks, zohoConnected, agentOnline }:
  { onEnd: () => void; timerPaused: boolean; startedAt: number | null; projects: Project[]; tasks: Task[]; zohoConnected: boolean; agentOnline: boolean }) {
  const nav = useNavigate();
  const [variant, setVariant] = useState<"coffee" | "tea">("coffee");
  const [line, setLine] = useState(() => BREAK_LINES[Math.floor(Math.random() * BREAK_LINES.length)]);
  const start = startedAt ?? Date.now();
  const [elapsed, setElapsed] = useState(Math.max(0, Math.floor((Date.now() - start) / 1000)));
  const [count, setCount] = useState(() => dueCount(Math.max(0, Math.floor((Date.now() - start) / 1000))));
  const [pourKey, setPourKey] = useState(0);
  const [mode, setMode] = useState<"live" | "digest">("live");
  const [feed, setFeed] = useState<LiveRow[]>([]);
  const [lastCheck, setLastCheck] = useState<number | null>(null);
  const [bugTotal, setBugTotal] = useState(0);
  const [cfg, setCfg] = useState<ChoreSettings>(() => cachedChores());

  const runnable = projects.filter((p) => !!p.fe_path);
  const real = agentOnline && (runnable.length > 0 || zohoConnected);
  const ctxRef = useRef({ projects, tasks, zohoConnected, cfg });
  ctxRef.current = { projects, tasks, zohoConnected, cfg };
  const feedRef = useRef<LiveRow[]>([]);
  feedRef.current = feed;
  // These must outlive an effect re-mount (React StrictMode runs effects twice
  // in dev), otherwise each run gets a fresh map and every row posts again.
  const sigsRef = useRef(new Map<string, string>());
  const notifiedRef = useRef(new Set<string>());
  const runningRef = useRef(false);

  useEffect(() => { loadChores().then(setCfg); }, []);

  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000))), 1000);
    const l = setInterval(() => setLine(BREAK_LINES[Math.floor(Math.random() * BREAK_LINES.length)]), 11000);
    return () => { clearInterval(t); clearInterval(l); };
  }, [start]);

  // simulated ships (only when we can't run real chores)
  useEffect(() => {
    if (real) return;
    const due = dueCount(elapsed);
    if (due > count) { setCount(due); setPourKey((k) => k + 1); }
  }, [elapsed, count, real]);

  // ---- REAL chores. Registry-driven, de-duplicated, re-run on an interval
  // and immediately when the agent pushes a change over the websocket.
  useEffect(() => {
    if (!real) return;
    let alive = true; let k = 0;
    const sigs = sigsRef.current;
    const notified = notifiedRef.current;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const push = (id: string, sig: string, r: Omit<LiveRow, "key" | "at">) => {
      if (!alive || sigs.get(id) === sig) return;
      const first = !sigs.has(id);
      sigs.set(id, sig);
      k += 1;
      setFeed((f) => [...f, { ...r, key: Date.now() + k, at: Date.now() }]);
      if (!first) setPourKey((p) => p + 1);
      // escalate warnings so they outlive the break screen
      if (r.tone === "warn" && ctxRef.current.cfg.notifyWarnings && !notified.has(id)) {
        notified.add(id);
        notify("chore", r.title, r.meta);
      }
    };
    const on = (id: ChoreId) => ctxRef.current.cfg.enabled[id];

    async function cycle() {
      if (runningRef.current) return;   // a cycle is already in flight
      runningRef.current = true;
      try {
        const { projects: projs, tasks: tks, zohoConnected: zc } = ctxRef.current;
        const withPath = projs.filter((p) => p.fe_path);

        // 1) git: fetch + fast-forward
        if (on("git.pull")) for (const p of withPath) {
          if (!alive) return;
          const r = await gitPull(p.fe_path as string);
          if (!alive) return;
          const br = r.branch || p.branch || "main";
          const href = `/projects/${p.id}`;
          const dirty = r.dirty ? ` · ${r.dirty} uncommitted` : "";
          if (r.ok && r.reason === "updated")
            push(`git:${p.id}`, `u${r.behind}`, { icon: "co", title: `${p.name}: pulled ${r.behind} commit${r.behind === 1 ? "" : "s"}`, meta: `${br} · ${r.files || 0} files${dirty}`, delta: `+${r.behind}`, tone: "add", href });
          else if (r.ok && r.reason === "up_to_date")
            push(`git:${p.id}`, `ok${r.ahead}${r.dirty}`, { icon: "co", title: `${p.name}: already up to date`, meta: `${br}${r.ahead ? ` · ${r.ahead} ahead` : ""}${dirty}`, delta: "no-op", tone: "dim", href });
          else if (r.reason === "no_upstream")
            push(`git:${p.id}`, "noup", { icon: "co", title: `${p.name}: no upstream branch`, meta: `${br} · nothing to pull`, delta: "skipped", tone: "dim", href });
          else if (r.reason === "conflict")
            push(`git:${p.id}`, "conf", { icon: "co", title: `${p.name}: needs a manual merge`, meta: `${br} · diverged from remote`, delta: "conflict", tone: "warn", href });
          else if (r.reason === "auth")
            push(`git:${p.id}`, "auth", { icon: "co", title: `${p.name}: git needs credentials`, meta: "fetch blocked — no prompt allowed", delta: "auth", tone: "warn", href });
          else if (r.reason === "not_a_repo")
            push(`git:${p.id}`, "norepo", { icon: "co", title: `${p.name}: path isn't a git repo`, meta: (p.fe_path || "").slice(-38), delta: "skipped", tone: "dim", href });
          else
            push(`git:${p.id}`, `e${r.error}`, { icon: "co", title: `${p.name}: pull failed`, meta: (r.error || "git error").slice(0, 44), delta: "error", tone: "warn", href });
          await sleep(700);
        }

        // 2) npm outdated / audit (slow, opt-in)
        if (on("npm.outdated")) for (const p of withPath) {
          if (!alive) return;
          const o = await npmOutdated(p.fe_path as string);
          if (!alive) return;
          if (o.ok) push(`npm.o:${p.id}`, `${o.total}/${o.major}`, {
            icon: "np", title: o.total ? `${p.name}: ${o.total} package${o.total === 1 ? "" : "s"} behind${o.major ? ` · ${o.major} major` : ""}` : `${p.name}: dependencies current`,
            meta: o.packages.slice(0, 3).map((x) => x.name).join(", ") || "npm outdated",
            delta: o.total ? `${o.total} old` : "current", tone: o.major ? "warn" : o.total ? "info" : "ok", href: `/projects/${p.id}`,
          });
          await sleep(700);
        }
        if (on("npm.audit")) for (const p of withPath) {
          if (!alive) return;
          const a = await npmAudit(p.fe_path as string);
          if (!alive) return;
          const bad = a.critical + a.high;
          if (a.ok) push(`npm.a:${p.id}`, `${a.total}/${bad}`, {
            icon: "np", title: a.total ? `${p.name}: ${a.total} advisor${a.total === 1 ? "y" : "ies"}${bad ? ` · ${bad} high/critical` : ""}` : `${p.name}: no known vulnerabilities`,
            meta: "npm audit", delta: bad ? `${bad} severe` : a.total ? `${a.total} low` : "clean",
            tone: bad ? "warn" : a.total ? "info" : "ok", href: `/projects/${p.id}`,
          });
          await sleep(700);
        }

        // 3) Zoho: bugs, burndown, review, blocked
        if (alive && zc) {
          // Prefer projects explicitly linked in Orbit. If none are linked, ask Zoho
          // what projects exist — otherwise this scans an empty list and reports "0 of 0".
          let linked: { id: string; name: string }[] = projs
            .filter((p) => p.sprint_project_id)
            .map((p) => ({ id: p.sprint_project_id as string, name: p.name }));
          let fromZoho = false;
          if (!linked.length) {
            try {
              const sp = await fetchSprintProjects();
              linked = sp
                .filter((x) => !/complet|closed|archiv/i.test(x.status || ""))
                .slice(0, 8)
                .map((x) => ({ id: x.id, name: x.name }));
              fromZoho = true;
            } catch { /* zoho unreachable this cycle */ }
          }
          if (!alive) return;
          if (!linked.length) {
            push("zoho:none", "empty", { icon: "sp", title: "No sprint projects found", meta: "check the Zoho connection in Settings", delta: "none", tone: "dim", href: "/settings" });
          }

          let bugs = 0, open = 0, review = 0, blocked = 0, fresh = 0;
          let soonest: { name: string; days: number; open: number } | null = null;
          for (const p of linked) {
            try {
              const board = await fetchSprintBoard(p.id);
              for (const sp of board.sprints) {
                const active = /active|current|progress/i.test(sp.status || "");
                let spOpen = 0;
                for (const it of sp.items) {
                  const done = /done|closed|resolved|complete/i.test(it.status || "");
                  if (isOpenBug(it)) bugs += 1;
                  if (!done) { open += 1; spOpen += 1; }
                  if (/review|qa|testing/i.test(it.status || "")) review += 1;
                  if (/block|hold|impede/i.test(it.status || "")) blocked += 1;
                  const touched = Date.parse(it.modifiedTime || "");
                  if (touched && touched > start) fresh += 1;
                }
                if (active && sp.endDate) {
                  const days = Math.ceil((Date.parse(sp.endDate) - Date.now()) / 86400000);
                  if (!Number.isNaN(days) && (!soonest || days < soonest.days)) soonest = { name: sp.name, days, open: spOpen };
                }
              }
            } catch { /* skip this project this cycle */ }
          }
          if (!alive) return;
          setBugTotal(bugs);
          if (on("zoho.bugs"))
            push("zoho:bugs", `b${bugs}/${linked.length}`, { icon: "bg", title: `${bugs} open bug${bugs === 1 ? "" : "s"} across ${linked.length} project${linked.length === 1 ? "" : "s"}`, meta: fromZoho ? "zoho sprints · all projects" : "zoho sprints · linked projects", delta: bugs ? `${bugs} to fix` : "clear", tone: bugs ? "warn" : "ok", href: "/sprints" });
          if (on("zoho.sprint") && soonest)
            push("zoho:burn", `s${soonest.days}/${soonest.open}`, {
              icon: "sp", title: soonest.days < 0 ? `${soonest.name} overran · ${soonest.open} still open` : `${soonest.name} ends in ${soonest.days} day${soonest.days === 1 ? "" : "s"} · ${soonest.open} open`,
              meta: "sprint burndown", delta: `${soonest.open} left`, tone: soonest.days <= 2 && soonest.open ? "warn" : "info", href: "/sprints",
            });
          if (on("zoho.review"))
            push("zoho:review", `r${review}`, { icon: "sp", title: review ? `${review} item${review === 1 ? "" : "s"} waiting in review` : "Nothing waiting in review", meta: "needs your eyes", delta: `${review} review`, tone: review ? "info" : "dim", href: "/sprints" });
          if (on("zoho.blocked") && blocked)
            push("zoho:blocked", `k${blocked}`, { icon: "bg", title: `${blocked} item${blocked === 1 ? "" : "s"} blocked`, meta: "zoho sprints", delta: "blocked", tone: "warn", href: "/sprints" });
          if (fresh)
            push("zoho:new", `n${fresh}`, { icon: "sp", title: `${fresh} item${fresh === 1 ? "" : "s"} updated since your break started`, meta: "sprint activity", delta: `+${fresh}`, tone: "add", href: "/sprints" });

          // 4) timesheet drift — Orbit hours vs Zoho logged hours
          if (on("timesheet.drift")) {
            try {
              const [oh, ts] = await Promise.all([fetchOrbitHours(), fetchTimesheet()]);
              const todayKey = new Date().toISOString().slice(0, 10);
              const zohoToday = ts.byDate?.[todayKey] ?? 0;
              const drift = +(oh.todayH - zohoToday).toFixed(2);
              const hm = (h: number) => `${Math.floor(Math.abs(h))}h${String(Math.round((Math.abs(h) % 1) * 60)).padStart(2, "0")}m`;
              if (alive) push("ts:drift", `d${drift}`, {
                icon: "ts",
                title: Math.abs(drift) < 0.25 ? "Timesheet matches Orbit hours" : drift > 0 ? `${hm(drift)} unlogged in Zoho` : `Zoho has ${hm(drift)} more than Orbit`,
                meta: `orbit ${hm(oh.todayH)} · zoho ${hm(zohoToday)}`,
                delta: Math.abs(drift) < 0.25 ? "in sync" : `${drift > 0 ? "+" : "−"}${hm(drift)}`,
                tone: drift >= 0.5 ? "warn" : Math.abs(drift) < 0.25 ? "ok" : "info", href: "/time",
              });
            } catch { /* zoho timesheet unavailable */ }
          }
          await sleep(700);
        }

        // 5) Orbit tasks
        if (alive && on("tasks.backlog")) {
          const todo = tks.filter((t) => t.status !== "done").length;
          const today = new Date().toISOString().slice(0, 10);
          const overdue = tks.filter((t) => t.status !== "done" && t.due_date && t.due_date < today).length;
          push("tasks", `t${todo}/${overdue}`, { icon: "tk", title: overdue ? `${overdue} task${overdue === 1 ? "" : "s"} overdue · ${todo} in backlog` : `${todo} task${todo === 1 ? "" : "s"} in your backlog`, meta: "orbit tasks", delta: overdue ? `${overdue} late` : `${todo} todo`, tone: overdue ? "warn" : "dim", href: "/tasks" });
        }

        // 6) unread mail
        if (alive && on("mail.unread")) {
          const m = await gmailUnread();
          if (alive && m.ok) push("mail", `m${m.unread}`, { icon: "ml", title: m.unread ? `${m.unread} unread message${m.unread === 1 ? "" : "s"}` : "Inbox is clear", meta: "gmail · inbox", delta: m.unread ? `${m.unread} unread` : "clear", tone: m.unread ? "info" : "ok", href: "/mail" });
          await sleep(600);
        }

        // 7) Docker: containers, latest image, disk
        if (alive && on("docker.ps")) {
          const d = await fetchDocker();
          if (alive && d.available) {
            const up = d.containers.filter((c) => /up|running/i.test(c.status)).length;
            push("docker:ps", `c${up}/${d.containers.length}`, { icon: "dk", title: `Docker · ${up} container${up === 1 ? "" : "s"} running`, meta: "docker ps", delta: `${d.containers.length} total`, tone: up ? "ok" : "dim", href: "/docker" });
          }
        }
        if (alive && on("docker.images")) {
          const im = await fetchDockerImages();
          if (alive && im.available && im.images.length) {
            const n = im.images[0];
            push("docker:img", `i${im.images.length}:${n.id}`, { icon: "im", title: `Latest image · ${n.repository}:${n.tag}`, meta: `${n.size} · built ${n.created}`, delta: `${im.images.length} images`, tone: "info", href: "/docker" });
          }
        }
        if (alive && on("docker.df")) {
          const df = await dockerDf();
          if (alive && df.available) {
            push("docker:df", `f${df.dangling}:${df.reclaimable}`, { icon: "dk", title: df.dangling ? `${df.dangling} dangling image${df.dangling === 1 ? "" : "s"} · ${df.reclaimable} reclaimable` : `Docker disk clean · ${df.reclaimable} reclaimable`, meta: "docker system df", delta: df.reclaimable, tone: df.dangling ? "info" : "dim", href: "/docker" });
            // destructive — strictly opt-in
            if (df.dangling > 0 && ctxRef.current.cfg.allowDockerPrune) {
              const pr = await dockerPrune();
              if (alive && pr.ok) push("docker:prune", `p${Date.now()}`, { icon: "dk", title: `Pruned ${df.dangling} dangling image${df.dangling === 1 ? "" : "s"}`, meta: `reclaimed ${df.reclaimable}`, delta: "pruned", tone: "add", href: "/docker" });
            }
          }
          await sleep(600);
        }

        // 8) Postgres health
        if (alive && on("pg.health")) {
          const srv = await pgServers();
          for (const s of (srv.servers || []).slice(0, 3)) {
            if (!alive) return;
            const h = await pgHealth(s.id);
            if (!alive) return;
            if (h.ok) push(`pg:${s.id}`, `h${h.connections}/${h.longestSec}/${h.size}`, {
              icon: "pg", title: `${h.name} · ${h.connections} connection${h.connections === 1 ? "" : "s"} · ${h.size}`,
              meta: h.longestSec > 60 ? `longest query ${Math.floor(h.longestSec / 60)}m` : `longest query ${h.longestSec}s`,
              delta: h.longestSec > 300 ? "slow query" : "healthy", tone: h.longestSec > 300 ? "warn" : "ok", href: "/postgres",
            });
            else push(`pg:${s.id}`, `x${h.error}`, { icon: "pg", title: `${h.name}: unreachable`, meta: (h.error || "").slice(0, 44), delta: "down", tone: "warn", href: "/postgres" });
            await sleep(500);
          }
        }

        // 9) port map
        if (alive && on("ports.map")) {
          const ports = [...new Set(projs.map((p) => p.dev_port).filter(Boolean) as number[])];
          if (ports.length) {
            const pm = await portsMap(ports);
            const busy = pm.filter((x) => x.inUse);
            const foreign = busy.filter((x) => !x.orbit);
            if (alive) push("ports", `p${busy.length}/${foreign.length}`, {
              icon: "pt", title: busy.length ? `${busy.length} of ${ports.length} dev port${ports.length === 1 ? "" : "s"} busy` : `All ${ports.length} dev port${ports.length === 1 ? "" : "s"} free`,
              meta: busy.map((x) => `${x.port}${x.ownedBy ? `→${x.ownedBy}` : ""}`).join(", ") || "nothing listening",
              delta: foreign.length ? `${foreign.length} foreign` : `${busy.length} busy`, tone: foreign.length ? "info" : "dim",
            });
          }
        }

        // 10) dev servers
        if (alive && on("dev.servers")) {
          const servers = await devRunning();
          if (!alive) return;
          push("dev", `d${servers.length}`, { icon: "sv", title: `Dev servers · ${servers.length} up`, meta: servers.map((s) => s.project || `:${s.port}`).slice(0, 3).join(", ") || "none running", delta: `${servers.length} up`, tone: servers.length ? "info" : "dim", href: "/time" });
        }
        if (alive) setLastCheck(Date.now());
      } finally { runningRef.current = false; }
    }

    cycle();
    const iv = setInterval(cycle, Math.max(15, cfg.intervalSec) * 1000);
    // agent pushes: re-run right away instead of waiting for the interval
    const off = agentEvents((ev) => { if (ev === "dev:changed" || ev === "docker:changed") cycle(); });
    return () => { alive = false; clearInterval(iv); off(); };
  }, [real, cfg.intervalSec]);

  // Ending a break: persist the digest and leave a summary notification behind.
  const finish = () => {
    const rows = feedRef.current;
    if (real && rows.length) {
      const pulled = rows.filter((r) => r.icon === "co" && r.tone === "add").length;
      const issues = rows.filter((r) => r.tone === "warn").length;
      const summary = { chores: rows.length, pulled, bugs: bugTotal, issues };
      saveBreakLog({
        startedAt: start, seconds: elapsed, beverage: variant,
        rows: rows.map((r) => ({ icon: r.icon, title: r.title, meta: r.meta, delta: r.delta, tone: r.tone, href: r.href ?? null })),
        summary,
      });
      const bits = [`${rows.length} chores`, pulled ? `${pulled} pulled` : "", bugTotal ? `${bugTotal} bugs open` : "", issues ? `${issues} need attention` : ""].filter(Boolean);
      notify("break", `Break digest · ${fmtDur(elapsed)}`, bits.join(" · "));
    }
    onEnd();
  };

  const brewPct = Math.min(100, Math.round((elapsed / BREW_TARGET) * 100));
  const bev = BEV[variant];
  const relAge = (at: number) => {
    const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
    return s < 5 ? "just now" : s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
  };
  const simAge = (i: number) => {
    const age = Math.max(0, elapsed - Math.floor(i * SHIP_EVERY));
    return age < 5 ? "just now" : age < 60 ? `${age}s ago` : `${Math.floor(age / 60)}m ago`;
  };

  // unified feed rows + stats (real chores vs simulated)
  const simLog = buildLog(count);
  type Row = { icon: string; title: string; meta: string; delta: string; tone: Tone; age: string; href?: string };
  const rows: Row[] = real
    ? feed.slice(-12).reverse().map((r) => ({ icon: r.icon, title: r.title, meta: r.meta, delta: r.delta, tone: r.tone, age: relAge(r.at), href: r.href }))
    : simLog.map((t, i) => ({ icon: t.icon, title: t.title, meta: t.meta, delta: t.delta, tone: t.tone, age: simAge(i) }));

  const agentSub = real ? "running your chores" : "clearing your queue";
  const typingText = real
    ? (lastCheck ? `all checked · re-running in a minute` : `checking your projects…`)
    : "working on the next one…";

  let cells: { n: number; label: string; color?: string }[];
  let deltaRow: { add: number; del: number; files: number } | null;
  let foot: { v: string; label: string; color?: string }[];
  let digestCount: string;
  let hiList: { text: string; href?: string }[];

  if (real) {
    const updated = feed.filter((r) => r.icon === "co" && r.tone === "add").length;
    const issues = feed.filter((r) => r.tone === "warn").length;
    cells = [
      { n: feed.length, label: "chores run" },
      { n: updated, label: "repos updated", color: "#43e392" },
      { n: bugTotal, label: "bugs to fix", color: bugTotal ? "#e2a24a" : "#eaf0ea" },
      { n: issues, label: "need attention", color: issues ? "#e2a24a" : "#eaf0ea" },
    ];
    deltaRow = null;
    foot = [
      { v: String(feed.length), label: "CHORES" },
      { v: String(updated), label: "PULLED", color: "#43e392" },
      { v: String(bugTotal), label: "BUGS", color: bugTotal ? "#e2a24a" : "#eaf0ea" },
    ];
    digestCount = `${feed.length} chore${feed.length === 1 ? "" : "s"} run`;
    const src = [...feed].reverse();
    const hi = src.filter((r) => r.tone !== "dim").slice(0, 4);
    hiList = (hi.length ? hi : src.slice(0, 4)).map((r) => ({ text: r.title, href: r.href }));
  } else {
    const st = foldStats(simLog);
    cells = [
      { n: st.commits, label: "commits pushed" },
      { n: st.tests, label: "tests green", color: "#43e392" },
      { n: st.prs, label: "PRs opened" },
      { n: st.deploys, label: "preview deploys" },
    ];
    deltaRow = { add: st.add, del: st.del, files: st.files };
    foot = [
      { v: String(st.shipped), label: "SHIPPED" },
      { v: String(st.tests), label: "GREEN", color: "#43e392" },
      { v: `+${st.add}`, label: "LINES" },
    ];
    digestCount = `${st.shipped} task${st.shipped === 1 ? "" : "s"} shipped`;
    const h = [...simLog].reverse().filter((t) => t.isPr || t.isDeploy || t.tone === "ok").slice(0, 3).map((t) => t.title);
    hiList = (h.length ? h : simLog.slice(-3).reverse().map((t) => t.title)).map((text) => ({ text }));
  }

  return (
    <div className="break-view" style={{ display: "flex", placeItems: "stretch", padding: 0, background: "radial-gradient(120% 90% at 50% 40%, #14170f 0%, #0c0e0b 46%, #08090a 100%)" }}>
      {/* ambient bits */}
      <span className="bv-bit" style={{ left: "12%", top: "70%", animationDelay: "0s" }} />
      <span className="bv-bit mint" style={{ left: "22%", top: "84%", animationDelay: "2s" }} />
      <span className="bv-bit" style={{ right: "18%", top: "78%", animationDelay: "1s" }} />

      {/* HERO */}
      <section className="bv-hero">
        <div className="bv-eyebrow">BREW SYNC · {bev.label.toUpperCase()} BREAK</div>
        <div style={{ position: "relative", width: "min(360px, 78vw)", height: "min(360px, 78vw)", margin: "2px 0 4px" }}>
          {pourKey > 0 && <span key={pourKey} className="bv-pour" style={{ background: bev.body }} />}
          <BrewCup pct={brewPct} variant={variant} />
          <div style={{ position: "absolute", left: "50%", bottom: 44, transform: "translateX(-50%)", textAlign: "center", pointerEvents: "none" }}>
            <div style={{ fontFamily: "var(--mono, 'JetBrains Mono', monospace)", fontSize: 12, letterSpacing: 2, color: "#3fe08b", textTransform: "uppercase" }}>{strengthLabel(brewPct)}</div>
          </div>
        </div>

        <div className="bv-chip">
          <span style={{ width: 7, height: 7, borderRadius: 2, background: "#e2a24a" }} />
          <span style={{ fontFamily: "var(--mono, 'JetBrains Mono', monospace)", fontSize: 13, letterSpacing: 1, color: "#c7cec7" }}>BREAK · {fmtDur(elapsed)}</span>
          <span style={{ fontFamily: "var(--mono, 'JetBrains Mono', monospace)", fontSize: 13, color: "#565c56" }}>/ {brewPct}% brewed</span>
        </div>

        <h1 className="bv-title">Take a breather.</h1>
        <p className="bv-sub">{line}</p>
        {timerPaused && (
          <div className="bv-paused">
            <span style={{ width: 8, height: 8, borderRadius: 2, background: "#e2a24a" }} />
            Break timer paused — the agent keeps shipping while you sip.
          </div>
        )}
        <div className="bv-actions">
          <button className="bv-btn" onClick={() => setVariant((v) => (v === "coffee" ? "tea" : "coffee"))}>☕ {bev.other}</button>
          <button className="bv-btn" onClick={() => setMode((m) => (m === "live" ? "digest" : "live"))}>
            {mode === "live" ? "See what the agent did" : "Back to live feed"}
          </button>
          <button className="bv-btn primary" onClick={finish}><Icon name="check" size={15} />I'm refreshed</button>
        </div>
      </section>

      {/* FEED / DIGEST */}
      <aside className="bv-panel">
        {mode === "digest" ? (
          <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            <div style={{ flex: "0 0 auto", padding: "20px 22px 16px", borderBottom: "1px solid rgba(140,150,140,.10)" }}>
              <button className="bv-back" onClick={() => setMode("live")}>← BACK TO LIVE</button>
              <div className="bv-kicker">WHILE YOU WERE AWAY</div>
              <div style={{ fontSize: 22, fontWeight: 600 }}>{digestCount} · {fmtDur(elapsed)}</div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
                {cells.map((c, i) => <DigestStat key={i} n={c.n} label={c.label} color={c.color} />)}
              </div>
              {deltaRow && (
                <div style={{ padding: 14, border: "1px solid rgba(140,150,140,.12)", borderRadius: 12, background: "rgba(255,255,255,.02)", marginBottom: 22, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <DeltaStat v={`+${deltaRow.add}`} label="added" color="#43e392" />
                  <div style={{ width: 1, height: 34, background: "rgba(140,150,140,.14)" }} />
                  <DeltaStat v={`−${deltaRow.del}`} label="removed" color="#d98b6a" />
                  <div style={{ width: 1, height: 34, background: "rgba(140,150,140,.14)" }} />
                  <DeltaStat v={String(deltaRow.files)} label="files touched" color="#c7cec7" />
                </div>
              )}
              <div className="bv-kicker" style={{ marginBottom: 12 }}>HIGHLIGHTS</div>
              {hiList.map((h, i) => (
                <div key={i} className={"bv-hi" + (h.href ? " act" : "")} onClick={h.href ? () => nav(h.href as string) : undefined}>
                  <span style={{ flex: "0 0 18px", width: 18, height: 18, borderRadius: "50%", background: "rgba(63,224,139,.14)", display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1, color: "#43e392", fontSize: 11 }}>✓</span>
                  <span style={{ fontSize: 13.5, color: "#c7cec7", lineHeight: 1.45 }}>{h.text}</span>
                  {h.href && <span className="bv-go"><Icon name="chevR" size={13} /></span>}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            <div style={{ flex: "0 0 auto", padding: "18px 22px", borderBottom: "1px solid rgba(140,150,140,.10)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 26, height: 26, borderRadius: 7, background: "rgba(63,224,139,.10)", border: "1px solid rgba(63,224,139,.24)", display: "flex", alignItems: "center", justifyContent: "center", color: "#3fe08b" }}><Icon name="zap" size={14} fill /></div>
                <div>
                  <div style={{ fontFamily: "var(--mono, 'JetBrains Mono', monospace)", fontSize: 12, letterSpacing: 1.5, color: "#eaf0ea" }}>AGENT</div>
                  <div style={{ fontSize: 11, color: "#7c847c" }}>{agentSub}</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 9px", borderRadius: 999, border: "1px solid rgba(63,224,139,.24)", background: "rgba(63,224,139,.06)" }}>
                <span className="bv-blink" style={{ width: 6, height: 6, borderRadius: "50%", background: "#3fe08b" }} />
                <span style={{ fontFamily: "var(--mono, 'JetBrains Mono', monospace)", fontSize: 10, letterSpacing: 1, color: "#3fe08b" }}>LIVE</span>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
              {rows.map((r, i) => (
                <div key={i} className={"bv-row" + (r.href ? " act" : "")} role={r.href ? "button" : undefined} tabIndex={r.href ? 0 : undefined}
                  onClick={r.href ? () => nav(r.href as string) : undefined}
                  onKeyDown={r.href ? (e) => { if (e.key === "Enter") nav(r.href as string); } : undefined}
                  title={r.href ? "Open" : undefined}>
                  <span className="bv-ic">{r.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, color: "#dfe6df", lineHeight: 1.35, marginBottom: 3 }}>{r.title}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="bv-meta">{r.meta}</span>
                      <span style={{ flex: "0 0 auto", fontFamily: "var(--mono, 'JetBrains Mono', monospace)", fontSize: 11, color: "#565c56", marginLeft: "auto" }}>{r.age}</span>
                    </div>
                  </div>
                  <span style={{ flex: "0 0 auto", alignSelf: "flex-start", fontFamily: "var(--mono, 'JetBrains Mono', monospace)", fontSize: 11, padding: "2px 8px", borderRadius: 6, background: TONE_BG[r.tone], color: TONE_COLOR[r.tone], whiteSpace: "nowrap" }}>{r.delta}</span>
                  {r.href && <span className="bv-go"><Icon name="chevR" size={14} /></span>}
                </div>
              ))}
              {real && rows.length === 0 && (
                <div style={{ padding: "18px 12px", fontSize: 13, color: "#7c847c", lineHeight: 1.5 }}>Starting chores — fetching {runnable.length} repo{runnable.length === 1 ? "" : "s"}, sprints, tasks and Docker…</div>
              )}
              <div style={{ flex: 1 }} />
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", opacity: 0.5 }}>
                <span className="bv-blink" style={{ width: 5, height: 5, borderRadius: "50%", background: "#7c847c" }} />
                <span className="bv-blink" style={{ width: 5, height: 5, borderRadius: "50%", background: "#7c847c", animationDelay: ".2s" }} />
                <span className="bv-blink" style={{ width: 5, height: 5, borderRadius: "50%", background: "#7c847c", animationDelay: ".4s" }} />
                <span style={{ fontFamily: "var(--mono, 'JetBrains Mono', monospace)", fontSize: 11, color: "#565c56", marginLeft: 4 }}>{typingText}</span>
              </div>
            </div>

            <div style={{ flex: "0 0 auto", padding: "14px 22px", borderTop: "1px solid rgba(140,150,140,.10)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              {foot.map((f, i) => <FootStat key={i} v={f.v} label={f.label} color={f.color} />)}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function DigestStat({ n, label, color = "#eaf0ea" }: { n: number; label: string; color?: string }) {
  return (
    <div style={{ padding: 14, border: "1px solid rgba(140,150,140,.12)", borderRadius: 12, background: "rgba(255,255,255,.02)" }}>
      <div style={{ fontSize: 26, fontWeight: 600, color }}>{n}</div>
      <div style={{ fontSize: 12, color: "#7c847c", marginTop: 2 }}>{label}</div>
    </div>
  );
}
function DeltaStat({ v, label, color }: { v: string; label: string; color: string }) {
  return (
    <div>
      <div style={{ fontFamily: "var(--mono, 'JetBrains Mono', monospace)", fontSize: 18, fontWeight: 600, color }}>{v}</div>
      <div style={{ fontSize: 11, color: "#7c847c" }}>{label}</div>
    </div>
  );
}
function FootStat({ v, label, color = "#eaf0ea" }: { v: string; label: string; color?: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontFamily: "var(--mono, 'JetBrains Mono', monospace)", fontSize: 16, fontWeight: 600, color }}>{v}</div>
      <div style={{ fontSize: 10, color: "#7c847c", letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
}
