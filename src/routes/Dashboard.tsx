import { useEffect, useState, type ReactNode } from "react";
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
      {onBreak && <BreakView onEnd={endBreak} timerPaused={timerPaused} startedAt={breakStartedAt} />}
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

/* ============================ Coffee / tea break ============================ *
 * Redesigned break view — "Brew Sync". While you step away the agent keeps
 * clearing your queue; the cup fills as work ships, a live feed streams what it
 * did, and a "while you were away" digest sums it up when you come back.        */

type Tone = "add" | "ok" | "info" | "dim";
interface FeedTask {
  icon: "commit" | "test" | "deploy" | "pr" | "deps" | "ci" | "docs";
  title: string; meta: string; delta: string; tone: Tone;
  add: number; del: number; tests: number; files: number;
  isPr?: boolean; isDeploy?: boolean; at?: number;
}

const AGENT_TASKS: FeedTask[] = [
  { icon: "commit", title: "Guard null session in auth middleware", meta: "core-api · main", delta: "+18 −4", tone: "add", add: 18, del: 4, tests: 0, files: 1 },
  { icon: "test", title: "Suite green: 104 passed, 0 failed", meta: "api-gateway", delta: "104 ✓", tone: "ok", add: 0, del: 0, tests: 104, files: 0 },
  { icon: "commit", title: "Extract useBrewTimer hook", meta: "web · feat/brew-sync", delta: "+96 −140", tone: "add", add: 96, del: 140, tests: 0, files: 4 },
  { icon: "deps", title: "Bumped 3 deps · 0 advisories", meta: "web", delta: "3 ↑", tone: "dim", add: 0, del: 0, tests: 0, files: 1 },
  { icon: "ci", title: "Pipeline #482 green in 2m14s", meta: "orbit/ci", delta: "2m14s", tone: "ok", add: 0, del: 0, tests: 0, files: 0 },
  { icon: "pr", title: "Opened PR #219 · ready for review", meta: "feat/brew-sync", delta: "#219", tone: "info", add: 0, del: 0, tests: 0, files: 0, isPr: true },
  { icon: "deploy", title: "Preview deploy is live", meta: "orbit-pr-219.vercel.app", delta: "↑ live", tone: "info", add: 0, del: 0, tests: 0, files: 0, isDeploy: true },
  { icon: "docs", title: "Updated brew-sync docs", meta: "docs · main", delta: "+42 −3", tone: "add", add: 42, del: 3, tests: 0, files: 2 },
  { icon: "test", title: "Snapshot tests refreshed", meta: "web", delta: "12 ✓", tone: "ok", add: 0, del: 0, tests: 12, files: 3 },
  { icon: "commit", title: "Fix flaky timer test w/ fake clock", meta: "web · main", delta: "+22 −9", tone: "add", add: 22, del: 9, tests: 0, files: 2 },
];

const TONE_COLOR: Record<Tone, string> = { add: "var(--mint)", ok: "var(--mint)", info: "var(--blue)", dim: "var(--muted)" };
const TONE_BG: Record<Tone, string> = { add: "rgba(55,223,160,.10)", ok: "rgba(55,223,160,.10)", info: "rgba(91,141,239,.12)", dim: "rgba(139,146,160,.10)" };

const COFFEE_STEPS = ["First drip", "Brewing", "Getting strong", "Almost full", "Full pour"];
const TEA_STEPS = ["First steep", "Steeping", "Getting strong", "Almost full", "Full cup"];

function feedIcon(kind: FeedTask["icon"], color: string) {
  const P = (d: string) => <path d={d} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />;
  const C = (cx: number, cy: number, r: number) => <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={1.8} />;
  const wrap = (kids: ReactNode) => <svg width={15} height={15} viewBox="0 0 24 24">{kids}</svg>;
  switch (kind) {
    case "commit": return wrap(<>{C(12, 12, 3)}{P("M3 12h6")}{P("M15 12h6")}</>);
    case "test": return wrap(P("M20 6 9 17l-5-5"));
    case "deploy": return wrap(<>{P("M12 20V5")}{P("M6 11l6-6 6 6")}</>);
    case "pr": return wrap(<>{C(6, 18, 2.4)}{C(6, 6, 2.4)}{C(18, 6, 2.4)}{P("M6 8.5v7")}{P("M18 8.5c0 4-3.5 6-8 6")}</>);
    case "deps": return wrap(<>{P("M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z")}{P("M3.3 7 12 12l8.7-5")}{P("M12 22V12")}</>);
    case "ci": return wrap(P("M13 2 3 14h9l-1 8 10-12h-9z"));
    case "docs": return wrap(<>{P("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z")}{P("M14 2v6h6")}</>);
    default: return wrap(C(12, 12, 3));
  }
}

function BrewCup({ variant, fill, pourKey }: { variant: "coffee" | "tea"; fill: number; pourKey: number }) {
  const isTea = variant === "tea";
  const body = isTea ? "#5f8f39" : "#8a4a24";
  const crema = isTea ? "#a9d873" : "#c9813f";
  const liquidY = 244 - fill * 110;            // 244 empty → 134 full
  const liquidH = 256 - liquidY;
  const ringC = 2 * Math.PI * 150;
  const ringOffset = ringC * (1 - fill);
  return (
    <div className="bs-cupwrap">
      {pourKey > 0 && <span key={pourKey} className="bs-pour" aria-hidden />}
      <svg viewBox="0 0 360 360" className="bs-cup">
        <defs>
          <clipPath id="bsCupClip"><path d="M132 130 L132 236 Q132 256 152 256 L208 256 Q228 256 228 236 L228 130 Z" /></clipPath>
        </defs>
        <g className="bs-ring">
          <circle cx="180" cy="180" r="150" fill="none" stroke="rgba(55,223,160,.12)" strokeWidth="2" />
          <circle cx="180" cy="180" r="150" fill="none" stroke="var(--mint)" strokeWidth="4" strokeLinecap="round"
            strokeDasharray={ringC} strokeDashoffset={ringOffset} transform="rotate(-90 180 180)" style={{ transition: "stroke-dashoffset .9s cubic-bezier(.34,.1,.2,1)" }} />
        </g>
        <g className="steam" style={{ opacity: 0.9 }}>
          <path d="M164 112 q-8 -10 0 -20 q8 -10 0 -20" />
          <path d="M182 108 q-8 -10 0 -20 q8 -10 0 -20" />
          <path d="M198 112 q-8 -10 0 -20 q8 -10 0 -20" />
        </g>
        <ellipse cx="180" cy="266" rx="54" ry="8" fill="rgba(0,0,0,.4)" />
        <g clipPath="url(#bsCupClip)">
          <rect x="130" y={liquidY} width="100" height={liquidH} fill={body} style={{ transition: "y .9s cubic-bezier(.34,.1,.2,1),height .9s cubic-bezier(.34,.1,.2,1)" }} />
          <ellipse cx="180" cy={liquidY} rx="48" ry="7" fill={crema} style={{ transition: "cy .9s cubic-bezier(.34,.1,.2,1)" }} />
        </g>
        <path d="M132 130 L132 236 Q132 256 152 256 L208 256 Q228 256 228 236 L228 130" fill="none" stroke="#9fb0b6" strokeWidth="3" strokeLinejoin="round" opacity="0.6" />
        <path d="M228 148 C266 150 266 200 228 202" fill="none" stroke="#9fb0b6" strokeWidth="9" strokeLinecap="round" opacity="0.55" />
        <ellipse cx="180" cy="130" rx="48" ry="11" fill="none" stroke="#9fb0b6" strokeWidth="3" opacity="0.7" />
        <ellipse cx="180" cy="130" rx="42" ry="8" fill="rgba(0,0,0,.35)" />
      </svg>
    </div>
  );
}

function BreakView({ onEnd, timerPaused, startedAt }: { onEnd: () => void; timerPaused: boolean; startedAt: number | null }) {
  const [variant, setVariant] = useState<"coffee" | "tea">("coffee");
  const [view, setView] = useState<"break" | "done">("break");
  const [panel, setPanel] = useState<"live" | "digest">("live");
  const [log, setLog] = useState<FeedTask[]>([]);
  const [pourKey, setPourKey] = useState(0);
  const start = startedAt ?? Date.now();
  const [elapsed, setElapsed] = useState(Math.max(0, Math.floor((Date.now() - start) / 1000)));

  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000))), 1000);
    return () => clearInterval(t);
  }, [start]);

  // Stream the agent's activity in while you're away.
  useEffect(() => {
    if (view === "done") return;
    const push = () => setLog((prev) => {
      if (prev.length >= AGENT_TASKS.length) return prev;
      setPourKey((k) => k + 1);
      const at = Math.max(0, Math.floor((Date.now() - start) / 1000));
      return [{ ...AGENT_TASKS[prev.length], at }, ...prev];
    });
    const first = setTimeout(push, 600);
    const iv = setInterval(push, 2600);
    return () => { clearTimeout(first); clearInterval(iv); };
  }, [view]);

  const shipped = log.length;
  const fill = Math.min(1, shipped / AGENT_TASKS.length);
  const fillPct = Math.round(fill * 100);
  const isTea = variant === "tea";
  const steps = isTea ? TEA_STEPS : COFFEE_STEPS;
  const si = fillPct >= 100 ? 4 : fillPct >= 75 ? 3 : fillPct >= 45 ? 2 : fillPct >= 15 ? 1 : 0;

  const sums = log.reduce((a, t) => {
    a.add += t.add; a.del += t.del; a.tests += t.tests; a.files += t.files;
    if (t.icon === "commit") a.commits++; if (t.isPr) a.prs++; if (t.isDeploy) a.deploys++;
    return a;
  }, { add: 0, del: 0, tests: 0, files: 0, commits: 0, prs: 0, deploys: 0 });

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const breakStr = `${mm}:${ss}`;
  const rel = (at: number) => { const d = elapsed - at; return d <= 1 ? "just now" : d < 60 ? `${d}s ago` : `${Math.floor(d / 60)}m ago`; };
  const highlights = [
    "Shipped the auth null-guard from your review notes",
    "PR #219 is green and waiting on you",
    "Preview is live at orbit-pr-219.vercel.app",
  ];

  return (
    <div className="break-view bs">
      <div className="bs-amb" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => <span key={i} style={{ left: `${10 + i * 15}%`, top: `${70 + (i % 3) * 8}%`, animationDelay: `${i * 1.7}s`, animationDuration: `${11 + (i % 4) * 2}s` }} />)}
      </div>

      {/* ---- Hero ---- */}
      <section className="bs-hero">
        <div className="bs-eyebrow">Brew sync · {isTea ? "tea" : "coffee"} break</div>
        <BrewCup variant={variant} fill={fill} pourKey={pourKey} />
        <div className="bs-strength">{steps[si]}</div>

        <div className="bs-timer">
          <span className="bs-tdot" />
          <span className="mono">Break · {breakStr}</span>
          <span className="mono bs-tpct">/ {fillPct}% brewed</span>
        </div>

        {view === "break" ? (
          <div className="bs-copy">
            <h2 className="bs-title">{isTea ? "Steep while it ships." : "Sip while it ships."}</h2>
            <p className="bs-sub">The bugs will still be here. {isTea ? "Steep" : "Sip"} slowly — the agent is clearing your queue while you rest.</p>
            {timerPaused && (
              <div className="bs-pause"><span className="bs-pausedot" />Break timer paused — the agent keeps shipping while you sip.</div>
            )}
            <div className="bs-actions">
              <button className="bs-btn" onClick={() => setVariant((v) => (v === "coffee" ? "tea" : "coffee"))}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}><path d="M17 8h1a4 4 0 1 1 0 8h-1" /><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" /><path d="M6 2v2M10 2v2M14 2v2" /></svg>
                {isTea ? "Switch to coffee" : "Switch to tea"}
              </button>
              <button className="bs-btn" onClick={() => setPanel("digest")}>
                <Icon name="book" size={16} />See what the agent did
              </button>
              <button className="bs-btn primary" onClick={() => { setPanel("live"); setView("done"); }}>
                <Icon name="check" size={16} />I'm refreshed
              </button>
            </div>
          </div>
        ) : (
          <div className="bs-copy">
            <div className="bs-check"><Icon name="check" size={22} /></div>
            <h2 className="bs-title">Welcome back.</h2>
            <p className="bs-sub">Batch merged while you {isTea ? "steeped" : "sipped"} — {shipped} shipped, {sums.tests} tests green.</p>
            <div className="bs-actions">
              <button className="bs-btn" onClick={() => setPanel("digest")}>See the digest</button>
              <button className="bs-btn primary" onClick={onEnd}>Resume work <span aria-hidden style={{ fontSize: 16 }}>→</span></button>
            </div>
          </div>
        )}
      </section>

      {/* ---- Right panel: live feed or digest ---- */}
      <aside className="bs-panel">
        {panel === "digest" ? (
          <div className="bs-pcol">
            <div className="bs-phead">
              <button className="bs-back" onClick={() => setPanel("live")}>← Back to live</button>
              <div className="bs-plabel">While you were away</div>
              <div className="bs-ptitle">{shipped} tasks shipped · {breakStr}</div>
            </div>
            <div className="bs-pbody">
              <div className="bs-grid">
                <div className="bs-cell"><div className="bs-cnum">{sums.commits}</div><div className="bs-clab">commits pushed</div></div>
                <div className="bs-cell"><div className="bs-cnum mint">{sums.tests}</div><div className="bs-clab">tests green</div></div>
                <div className="bs-cell"><div className="bs-cnum">{sums.prs}</div><div className="bs-clab">PRs opened</div></div>
                <div className="bs-cell"><div className="bs-cnum">{sums.deploys}</div><div className="bs-clab">preview deploys</div></div>
              </div>
              <div className="bs-diff">
                <div><div className="bs-dnum mono mint">+{sums.add}</div><div className="bs-dlab">added</div></div>
                <span className="bs-dsep" />
                <div><div className="bs-dnum mono warm">−{sums.del}</div><div className="bs-dlab">removed</div></div>
                <span className="bs-dsep" />
                <div><div className="bs-dnum mono">{sums.files}</div><div className="bs-dlab">files touched</div></div>
              </div>
              <div className="bs-hlabel">Highlights</div>
              {highlights.map((h, i) => (
                <div key={i} className="bs-hl">
                  <span className="bs-hlmark"><Icon name="check" size={11} /></span>
                  <span>{h}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="bs-pcol">
            <div className="bs-fhead">
              <div className="bs-fbrand">
                <span className="bs-fic"><Icon name="bolt" size={14} /></span>
                <div>
                  <div className="bs-fname mono">AGENT</div>
                  <div className="bs-fdesc">clearing your queue</div>
                </div>
              </div>
              <div className="bs-flive"><span className="bs-blink" /><span className="mono">LIVE</span></div>
            </div>
            <div className="bs-feed">
              {log.slice(0, 6).map((t, i) => (
                <div key={`${t.title}-${i}`} className="bs-row">
                  <span className="bs-ricon">{feedIcon(t.icon, TONE_COLOR[t.tone])}</span>
                  <div className="bs-rmid">
                    <div className="bs-rtitle">{t.title}</div>
                    <div className="bs-rmeta">
                      <span className="mono bs-rsrc">{t.meta}</span>
                      <span className="mono bs-rtime">{rel(t.at ?? elapsed)}</span>
                    </div>
                  </div>
                  <span className="mono bs-rdelta" style={{ background: TONE_BG[t.tone], color: TONE_COLOR[t.tone] }}>{t.delta}</span>
                </div>
              ))}
              <div className="bs-spacer" />
              <div className="bs-typing">
                <span /><span /><span />
                <span className="mono bs-tstat">{shipped >= AGENT_TASKS.length ? "queue cleared" : "working on next task…"}</span>
              </div>
            </div>
            <div className="bs-ffoot">
              <div><div className="mono bs-fnum">{shipped}</div><div className="bs-flab">SHIPPED</div></div>
              <div><div className="mono bs-fnum mint">{sums.tests}</div><div className="bs-flab">GREEN</div></div>
              <div><div className="mono bs-fnum">+{sums.add}</div><div className="bs-flab">LINES</div></div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
