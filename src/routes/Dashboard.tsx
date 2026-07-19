import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { Chip, Stat, Eyebrow, ACCENT, alpha, prColor, Empty, OrbitLoader } from "../components/ui";
import { Select } from "../components/Select";
import { BreakView } from "../components/BreakView";
import { Modal } from "../components/Modal";
import { AiThinking, formatDuration } from "../components/AiThinking";
import { useTable } from "../hooks/useTable";
import { useDashboardLayout } from "../hooks/useDashboardLayout";
import { useIntegrationHealth, type HealthState } from "../hooks/useIntegrationHealth";
import { useProjectsGitStatus } from "../hooks/useProjectsGitStatus";
import { allowedSizesOf, type TileSize } from "../lib/dashboardLayout";
import { useToast } from "../context/Toast";
import { useAuth } from "../context/AuthContext";
import { useZoho } from "../context/Zoho";
import { useTimezone, tzHour, tzDate } from "../context/Timezone";
import { useBreak } from "../context/Break";
import { useWeather } from "../hooks/useWeather";
import { useAgent } from "../context/Agent";
import { launch, fetchDocker, type DockerContainer } from "../lib/agent";
import { fetchZohoTickets, fetchTimesheet, fetchSprintBoard, type Board, type ZohoItem } from "../lib/zoho";
import { fetchOrbitHours, type OrbitHours } from "../lib/orbitHours";
import { readTimer } from "../lib/timer";
import { fetchIntegrations } from "../lib/integrations";
import { ask, type AiSource } from "../lib/ai";
import { supabase } from "../lib/supabase";
import type { Project, Ticket, Task, Notification } from "../lib/types";

const STANDUP_SYSTEM = `You write short daily standup updates for a solo developer. Given raw task/ticket/hours data,
write a concise standup in three short sections: "Done", "In progress", "Blockers/notes" — each 1-4 bullet points,
plain text bullets starting with "-", no markdown headers, no preamble.`;

/** Mirrors Sprints.tsx's local `typeStyle` — kept small and duplicated rather than exported cross-route. */
const itemTypeStyle = (name: string): { color: string; icon: string } => {
  const n = (name || "").toLowerCase();
  if (n.includes("bug")) return { color: ACCENT.red, icon: "bolt" };
  if (n.includes("story")) return { color: ACCENT.mint, icon: "book" };
  return { color: ACCENT.blue, icon: "check2" };
};

export default function Dashboard() {
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const zoho = useZoho();
  const { tz } = useTimezone();
  const { onBreak, timerPaused, breakStartedAt, startBreak, endBreak } = useBreak();
  const weather = useWeather();
  const { rows: projects, loading: projectsLoading } = useTable<Project>("projects");
  const { rows: tickets } = useTable<Ticket>("tickets");
  const { rows: tasks } = useTable<Task>("tasks");
  const [bugs, setBugs] = useState<number | null>(null);
  const [hoursToday, setHoursToday] = useState<number | null>(null);
  const [orbit, setOrbit] = useState<OrbitHours>({ todayH: 0, totalH: 0 });
  const [containers, setContainers] = useState<DockerContainer[] | null>(null);
  const [boardProjectId, setBoardProjectId] = useState<string | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);
  const [flash, setFlash] = useState<Notification | null>(null);
  const [tick, setTick] = useState(Date.now());
  const { status: agentStatus } = useAgent();
  const agentDown = agentStatus !== "online";
  const { gitByProject } = useProjectsGitStatus(projects, agentStatus === "online");
  const { health } = useIntegrationHealth();
  const [aiApiKey, setAiApiKey] = useState<string | null>(null);
  const [standup, setStandup] = useState<string | null>(null);
  const [standupSource, setStandupSource] = useState<AiSource | null>(null);
  const [standupDurationMs, setStandupDurationMs] = useState(0);
  const [standupBusy, setStandupBusy] = useState(false);
  const { layout, move, toggleHidden, setSize, cycleTileSize, reset, isDefault: layoutIsDefault } = useDashboardLayout();
  const [editingLayout, setEditingLayout] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Sprint board's kanban content can be arbitrarily tall (more items = more
  // height); System health can't (a fixed 10 checks). Rather than growing
  // Health to match whatever height Sprint board happens to be, cap Sprint
  // board to Health's own natural height and let its content scroll inside
  // that instead — measured live so it keeps tracking Health's real size
  // (theme/density changes, window resizes) rather than a guessed constant.
  const healthCardRef = useRef<HTMLDivElement>(null);
  const [sprintMaxH, setSprintMaxH] = useState<number | null>(null);
  useEffect(() => {
    const el = healthCardRef.current;
    if (!el) return;
    // getBoundingClientRect(), not ResizeObserver's own contentRect — the
    // border-box (padding+border included) is what a border-box max-height
    // needs to match; contentRect is content-only and came out ~38px short
    // (this card's own padding+border), undershooting Health's real height.
    const ro = new ResizeObserver(() => setSprintMaxH(el.getBoundingClientRect().height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Drag-to-resize: hold the handle on a tile's right border and drag to snap
  // between its allowed widths. The live preview is done by mutating the
  // tile's own classList directly (NOT React state) — Dashboard renders a lot
  // (project bays, sprint board, health widget...), so routing every pixel of
  // drag movement through setState here forced a full re-render on each tick
  // (verified via a `pointermove handler took ~200ms` DevTools violation),
  // which made the drag feel like it wasn't working at all. React only gets
  // touched once, on release, to persist the final size.
  function beginResize(e: React.PointerEvent<HTMLDivElement>, id: string, currentSize: TileSize) {
    e.preventDefault();
    e.stopPropagation();
    const grid = gridRef.current;
    const tileEl = e.currentTarget.parentElement;
    if (!grid || !tileEl) return;
    const rect = grid.getBoundingClientRect();
    const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").length || 4;
    const gap = parseFloat(getComputedStyle(grid).columnGap) || 14;
    const colWidth = (rect.width - (cols - 1) * gap) / cols;
    const allowed = allowedSizesOf(id);
    const startX = e.clientX;
    let moved = false;
    let preview: TileSize = currentSize;
    tileEl.classList.add("resizing");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    // Tracked on window rather than the 20px handle itself (and without relying
    // on setPointerCapture) — the pointer moves far outside that sliver the
    // instant a real drag starts, so the listener has to keep hearing it
    // regardless of what's under the cursor.
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      const target = currentSize + dx / (colWidth + gap);
      let snapped = allowed[0];
      let bestDist = Infinity;
      for (const s of allowed) {
        const d = Math.abs(s - target);
        if (d < bestDist) { bestDist = d; snapped = s; }
      }
      if (snapped !== preview) {
        preview = snapped;
        tileEl.classList.remove("s1", "s2", "s4");
        tileEl.classList.add("s" + snapped);
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      tileEl.classList.remove("resizing");
      if (moved) { if (preview !== currentSize) setSize(id, preview); }
      else cycleTileSize(id);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  useEffect(() => { fetchIntegrations().then((i) => setAiApiKey(i?.anthropic_api_key || null)); }, []);

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

  // The Sprints board for a chosen Zoho-linked project. `linkedProjects` is
  // recomputed fresh each render (cheap) — the effect below depends on the
  // stable `projects`/`zoho.status` values, not this derived array, so it
  // doesn't refire on every unrelated re-render (e.g. the 1s timer tick).
  const linkedProjects = projects.filter((p) => p.status === "active" && p.sprint_project_id);

  // Default to the first linked project, and fall back to it if the chosen
  // one stops being linked (e.g. unlinked from Zoho, or put on hold).
  useEffect(() => {
    if (linkedProjects.length === 0) { setBoardProjectId(null); return; }
    setBoardProjectId((cur) => (cur && linkedProjects.some((p) => p.id === cur) ? cur : linkedProjects[0].id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoho.status, projects]);

  useEffect(() => {
    const p = boardProjectId ? projects.find((x) => x.id === boardProjectId) : null;
    if (!p?.sprint_project_id) { setBoard(null); return; }
    let cancelled = false;
    setBoardLoading(true);
    fetchSprintBoard(p.sprint_project_id)
      .then((b) => { if (!cancelled) setBoard(b); })
      .catch(() => { if (!cancelled) setBoard(null); })
      .finally(() => { if (!cancelled) setBoardLoading(false); });
    return () => { cancelled = true; };
  }, [boardProjectId, projects]);

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
    await supabase.from("notifications").update({ read: true }).eq("id", id);
  }

  // live timer: if a session is running (started in Time module, or by Ask AI), tick it here too.
  // `tick` isn't read directly — it's the 1s re-render that makes this re-read the timer.
  void tick;
  const { startedAt, seconds: liveSec } = readTimer();
  const running = startedAt !== null;
  const liveClock = `${String(Math.floor(liveSec / 3600)).padStart(2, "0")}:${String(Math.floor((liveSec % 3600) / 60)).padStart(2, "0")}:${String(liveSec % 60).padStart(2, "0")}`;
  const orbitTodayLive = +(orbit.todayH + liveSec / 3600).toFixed(2);

  const hh = tzHour(tz);
  const word = hh < 5 ? "Working late" : hh < 12 ? "Good morning" : hh < 17 ? "Good afternoon" : hh < 21 ? "Good evening" : "Working late";
  const firstName = (user?.full_name || "").split(" ")[0];
  const greet = firstName ? `${word}, ${firstName}` : word;
  const dateStr = tzDate(tz);
  const active = projects.filter((p) => p.status === "active");
  const todo = tasks.filter((t) => t.status !== "done").length;

  // The board's first sprint, grouped into its columns — same idiom as Sprints.tsx.
  const boardSprint = board?.sprints[0];
  const boardColumns = board?.columns ?? [];
  const boardGrouped: Record<string, ZohoItem[]> = {};
  for (const c of boardColumns) boardGrouped[c.id] = [];
  const boardExtra: ZohoItem[] = [];
  for (const it of boardSprint?.items ?? []) {
    if (it.statusId && boardGrouped[it.statusId]) boardGrouped[it.statusId].push(it);
    else boardExtra.push(it);
  }
  const boardChosenProject = boardProjectId ? projects.find((p) => p.id === boardProjectId) : undefined;

  async function doLaunch(kind: "vscode" | "visualstudio" | "all", p: Project) {
    const res = await launch(kind, { fe_path: p.fe_path, sln_path: p.sln_path, dev_port: p.dev_port, name: p.name });
    toast(res.ok ? `Opening ${res.opened?.join(", ") || kind} · ${p.name}` : (res.error === "agent offline" ? "Local agent offline — start it to launch apps" : res.error || "Couldn't launch"));
  }

  function buildWorkContext(): string {
    const done = tasks.filter((t) => t.status === "done").map((t) => t.title);
    const inProgress = tasks.filter((t) => t.status !== "done").map((t) => `${t.title} (${t.status})`);
    const openTickets = tickets.filter((t) => !/resolved|closed/i.test(t.status)).map((t) => `${t.title} — ${t.status}`);
    return [
      `Active projects: ${active.length ? active.map((p) => p.name).join(", ") : "none"}`,
      `Orbit hours today: ${orbitTodayLive}h (${orbit.totalH}h all-time)`,
      `Open bugs across linked sprints: ${bugs ?? "unknown"}`,
      `Done tasks: ${done.length ? done.join("; ") : "none"}`,
      `Tasks in progress / to do: ${inProgress.length ? inProgress.join("; ") : "none"}`,
      `Open tickets: ${openTickets.length ? openTickets.join("; ") : "none"}`,
    ].join("\n");
  }

  async function generateStandup() {
    if (standupBusy) return;
    setStandupBusy(true); setStandup(null);
    const started = Date.now();
    const r = await ask(buildWorkContext(), STANDUP_SYSTEM, aiApiKey);
    setStandupBusy(false);
    setStandupSource(r.source);
    setStandupDurationMs(Date.now() - started);
    if (!r.ok) { toast(`Couldn't generate standup: ${r.error}${r.source === "local" ? " — set up local AI in Settings, or add an Anthropic key" : ""}`); return; }
    setStandup(r.text || "");
  }

  // Every integration the full Health page tracks (src/routes/Health.tsx),
  // condensed to one line each — same useIntegrationHealth() source of truth,
  // so this widget and that page can't silently disagree. "Local AI" is the
  // one Health-page tile left out: it's a manual on-demand test button with no
  // persisted state to plot, not a connection status.
  const cloudProviders = [health.providers.netlify, health.providers.vercel, health.providers.aws];
  const cloudOkCount = cloudProviders.filter((p) => p.state === "ok").length;
  const cloudState: HealthState = cloudOkCount > 0 ? "ok" : cloudProviders.every((p) => p.state === "unknown") ? "unknown" : "warn";
  const healthRows: { id: string; icon: string; label: string; state: HealthState; status: string }[] = [
    { id: "agent", icon: "plug", label: "Local agent", state: health.agent.state, status: health.agent.label },
    { id: "zoho", icon: "sprint", label: "Zoho Sprints", state: health.zoho.state, status: health.zoho.label },
    { id: "gmail", icon: "mail", label: "Gmail", state: health.gmail.state, status: health.gmail.configured ? "Configured" : "Not set up" },
    { id: "github", icon: "github", label: "GitHub", state: health.providers.github.state, status: health.providers.github.label },
    { id: "gitlab", icon: "gitlab", label: "GitLab", state: health.providers.gitlab.state, status: health.providers.gitlab.label },
    { id: "azuredevops", icon: "azuredevops", label: "Azure DevOps", state: health.providers.azuredevops.state, status: health.providers.azuredevops.label },
    { id: "msteams", icon: "msteams", label: "Microsoft Teams", state: health.providers.msteams.state, status: health.providers.msteams.label },
    { id: "sentry", icon: "alert", label: "Sentry", state: health.providers.sentry.state, status: health.providers.sentry.label },
    { id: "cloud", icon: "cloud", label: "Cloud", state: cloudState, status: cloudOkCount > 0 ? `${cloudOkCount}/3 connected` : cloudState === "unknown" ? "Not set up" : "Disconnected" },
    { id: "docker", icon: "container", label: "Docker", state: health.docker.state, status: agentDown ? "Agent offline" : health.docker.available ? `${health.docker.count} running` : "Not detected" },
    { id: "postgres", icon: "db", label: "Postgres", state: health.postgres.state, status: health.postgres.servers.length === 0 ? "No servers" : `${health.postgres.servers.filter((s) => s.ok).length}/${health.postgres.servers.length} reachable` },
    { id: "anthropic", icon: "key", label: "Anthropic key", state: health.anthropic.state, status: health.anthropic.state === "ok" ? "Set" : "Not set" },
  ];
  const healthWarnCount = healthRows.filter((r) => r.state === "warn").length;
  const healthOkCount = healthRows.filter((r) => r.state === "ok").length;
  // Each check gets its own equal-sized donut slice, colored by its own status
  // (never by magnitude — this is identity/part-to-whole, not a comparison of
  // close values). A small angular gap between slices stands in for the usual
  // 2px surface gap between touching stacked segments.
  const HEALTH_CX = 50, HEALTH_CY = 50, HEALTH_OUTER_R = 42, HEALTH_INNER_R = 27, HEALTH_GAP_DEG = 3;
  const HEALTH_STATE_COLOR: Record<HealthState, string> = { ok: ACCENT.mint, warn: ACCENT.red, unknown: ACCENT.dim };
  const donutSlices = healthRows.map((r, i) => {
    const step = 360 / healthRows.length;
    return { ...r, start: i * step + HEALTH_GAP_DEG / 2, end: (i + 1) * step - HEALTH_GAP_DEG / 2 };
  });
  function healthPolar(r: number, deg: number) {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: HEALTH_CX + r * Math.cos(rad), y: HEALTH_CY + r * Math.sin(rad) };
  }
  function healthSlicePath(startDeg: number, endDeg: number) {
    const o1 = healthPolar(HEALTH_OUTER_R, startDeg);
    const o2 = healthPolar(HEALTH_OUTER_R, endDeg);
    const i1 = healthPolar(HEALTH_INNER_R, endDeg);
    const i2 = healthPolar(HEALTH_INNER_R, startDeg);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${o1.x} ${o1.y} A ${HEALTH_OUTER_R} ${HEALTH_OUTER_R} 0 ${large} 1 ${o2.x} ${o2.y} L ${i1.x} ${i1.y} A ${HEALTH_INNER_R} ${HEALTH_INNER_R} 0 ${large} 0 ${i2.x} ${i2.y} Z`;
  }

  // Tile bodies, keyed by the ids in DASH_TILES. The dashboard renders these in
  // the user's saved order rather than the order written here.
  const TILES: Record<string, ReactNode> = {
    projects: <Stat icon="activity" label="Active projects" value={String(active.length)} sub={`${projects.length} total`} tone={ACCENT.mint} />,
    // Orbit hours — ticks live when a timer is running in the Time module
    orbit: (
      <div className="card stat fade orbit-stat" onClick={() => !editingLayout && nav("/time")} style={{ cursor: editingLayout ? "inherit" : "pointer" }}>
        <div className="lab"><span style={{ color: ACCENT.mint }}><Icon name="orbit" size={15} /></span>Orbit hours{running && <span className="rec-dot" title="Timer running" />}</div>
        <div className="val">{running ? liveClock : `${orbit.todayH}h`}</div>
        <div className="subv">{running ? `recording · ${orbit.totalH}h all-time` : `${orbit.totalH}h all-time`}</div>
      </div>
    ),
    zoho: <Stat icon="clock" label="Zoho hours today" value={hoursToday !== null ? `${hoursToday}h` : "—"} sub={hoursToday !== null ? "logged in Sprints" : "connect Zoho"} tone={ACCENT.blue} />,
    containers: (
      <Stat icon="cpu" label="Containers up"
        value={containers === null ? "—" : String(containers.length)}
        sub={containers === null ? "agent offline" : containers.length ? containers.map((c) => c.name).slice(0, 2).join(", ") : "none running"}
        tone={ACCENT.violet} />
    ),
    bays: (
      <div className="widget-panel">
        <Eyebrow>Project bays</Eyebrow>
        {projectsLoading ? <div className="page-loader"><OrbitLoader label="Loading projects…" /></div> : <div className="bays">
          {projects.map((p, i) => {
            // Always the live theme accent, not p.accent — that field is only ever
            // written once at project-creation time (Projects.tsx) and there's no
            // UI to actually customize it per project, so it just silently freezes
            // whatever the accent color was back then instead of tracking changes.
            const bayAccent = ACCENT.mint;
            const held = p.status === "hold";
            return (
              <div
                key={p.id} className="bay fade" style={{ animationDelay: `${i * 0.05}s` }} onClick={() => !editingLayout && nav(`/projects/${p.id}`)}
                role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); nav(`/projects/${p.id}`); } }}
              >
                <div className="accentline" style={{ background: `linear-gradient(90deg,${bayAccent},transparent)` }} />
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
                  {(() => {
                    const git = gitByProject[p.id];
                    const live = git?.ok;
                    const dirty = (git?.dirty ?? 0) > 0;
                    const color = live ? (dirty ? ACCENT.amber : ACCENT.mint) : (p.branch ? ACCENT.amber : ACCENT.muted);
                    const title = live && git?.lastCommit ? `${git.lastCommit.subject} — ${git.lastCommit.author}` : undefined;
                    return <span className="inst" style={{ color }} title={title}><Icon name="git" size={13} />{(live ? git?.branch : null) || p.branch || "main"}</span>;
                  })()}
                  <span className="inst" style={{ color: ACCENT.dim }}><Icon name="clock" size={13} />{p.dev_port ? `:${p.dev_port}` : "—"}</span>
                </div>
                <div className="launch-row" onClick={(e) => e.stopPropagation()}>
                  {p.fe_path && <button className="lbtn" disabled={agentDown} onClick={() => doLaunch("vscode", p)}><span style={{ color: ACCENT.blue }}><Icon name="code" size={14} /></span>Open UI</button>}
                  {p.sln_path && <button className="lbtn" disabled={agentDown} onClick={() => doLaunch("visualstudio", p)}><span style={{ color: ACCENT.violet }}><Icon name="server" size={14} /></span>Backend</button>}
                  <button className="lbtn" disabled={agentDown} style={{ marginLeft: "auto", borderColor: alpha(bayAccent, 27), background: alpha(bayAccent, 8), color: bayAccent }} onClick={() => doLaunch("all", p)}><Icon name="play" size={12} fill />All</button>
                </div>
              </div>
            );
          })}
        </div>}
        {!projectsLoading && projects.length === 0 && <Empty icon="boxes" title="No projects yet" sub="Add your first project from the Projects tab to launch it in one click." />}
      </div>
    ),
    openItems: (
      <div
        className="card widget-panel"
        style={sprintMaxH ? { maxHeight: sprintMaxH, display: "flex", flexDirection: "column", overflow: "hidden" } : undefined}
      >
        <div className="rowhead" style={{ marginBottom: 12, flexShrink: 0 }}>
          <Eyebrow>Sprint board</Eyebrow>
          {linkedProjects.length > 0 && (
            <Select
              value={boardProjectId ?? ""}
              onChange={(e) => setBoardProjectId(e.target.value)}
              style={{ minWidth: 160 }}
              onClick={(e) => e.stopPropagation()}
            >
              {linkedProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          )}
        </div>
        {linkedProjects.length === 0 ? (
          <Empty icon="sprint" title="Connect Zoho Sprints" sub="Link a project to Zoho to show its board here." mini />
        ) : boardLoading ? (
          <div style={{ padding: "20px 0" }}><OrbitLoader label="Loading board…" size={22} /></div>
        ) : !boardSprint ? (
          <Empty icon="sprint" title="No sprints" sub={`${boardChosenProject?.name || "This project"} has no sprints in scope.`} mini />
        ) : (
          <div className="dboard" style={sprintMaxH ? { overflowY: "auto", minHeight: 0 } : undefined} onClick={(e) => e.stopPropagation()}>
            {boardColumns.map((c) => {
              const items = boardGrouped[c.id] ?? [];
              return (
                <div key={c.id} className="dcol">
                  <div className="dcolhead">
                    <span className="zcoldot" style={{ background: c.color }} />
                    <span className="zcolname">{c.name}</span>
                    <span className="cnt">{items.length}</span>
                  </div>
                  <div className="dcards">
                    {items.map((it) => {
                      const ty = itemTypeStyle(it.type || "");
                      return (
                        <div key={it.id} className="zcard" style={{ borderLeftColor: ty.color }}
                          onClick={() => !editingLayout && boardChosenProject?.sprint_project_id && nav(`/sprints?project=${encodeURIComponent(boardChosenProject.sprint_project_id)}&sprint=${encodeURIComponent(boardSprint.id)}&item=${encodeURIComponent(it.id)}`)}>
                          <div className="zt">
                            <span className="ztype" style={{ color: ty.color, background: alpha(ty.color, 12) }}><Icon name={ty.icon} size={11} />{it.type || "Item"}</span>
                            <span className="znum mono" style={{ marginLeft: "auto" }}>{it.ticketNumber || `#${it.id}`}</span>
                          </div>
                          <div className="zsub">{it.subject}</div>
                          <div className="zfoot"><span className="prdot" style={{ background: prColor(it.priority) }} /></div>
                        </div>
                      );
                    })}
                    {items.length === 0 && <div className="zempty">No items</div>}
                  </div>
                </div>
              );
            })}
            {boardExtra.length > 0 && (
              <div className="dcol">
                <div className="dcolhead"><span className="zcoldot" style={{ background: ACCENT.dim }} /><span className="zcolname">Other</span><span className="cnt">{boardExtra.length}</span></div>
                <div className="dcards">
                  {boardExtra.map((it) => (
                    <div key={it.id} className="zcard"
                      onClick={() => !editingLayout && boardChosenProject?.sprint_project_id && nav(`/sprints?project=${encodeURIComponent(boardChosenProject.sprint_project_id)}&sprint=${encodeURIComponent(boardSprint.id)}&item=${encodeURIComponent(it.id)}`)}>
                      <div className="zsub">{it.subject}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    ),
    health: (
      <div className="card widget-panel" ref={healthCardRef}>
        <div className="rowhead" style={{ marginBottom: 4 }}>
          <Eyebrow>System health</Eyebrow>
          <button className="dash-more" onClick={(e) => { e.stopPropagation(); if (!editingLayout) nav("/health"); }}>View all<Icon name="chevR" size={12} /></button>
        </div>
        <div className="health-orbit">
          <div className="health-meter">
            <svg viewBox="0 0 100 100">
              {donutSlices.map((s) => (
                <path
                  key={s.id}
                  className="hm-slice"
                  d={healthSlicePath(s.start, s.end)}
                  fill={HEALTH_STATE_COLOR[s.state]}
                  onClick={() => !editingLayout && nav("/health")}
                >
                  <title>{s.label}: {s.status}</title>
                </path>
              ))}
              <text x="50" y="50" textAnchor="middle" dominantBaseline="central" className="hm-val">{healthOkCount}/{healthRows.length}</text>
            </svg>
          </div>
          <div className="hgrid">
            {healthRows.map((r) => (
              <div key={r.id} className="hchip" onClick={() => !editingLayout && nav("/health")} title={r.status}>
                <span className="hc-ic" style={{ color: HEALTH_STATE_COLOR[r.state] }}><Icon name={r.icon} size={14} /></span>
                <div className="hc-body">
                  <div className="hc-label">{r.label}</div>
                  <div className="hc-status">{r.status}</div>
                </div>
                {r.state !== "unknown" && <span className={"sn-dot " + r.state} />}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
  };
  // Hidden tiles stay on screen (dimmed) while editing, so they can be brought back.
  const visibleTiles = layout.order.filter((id) => editingLayout || !layout.hidden.includes(id));

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
          <div style={{ display: "flex", gap: 8 }}>
            {editingLayout ? (
              <>
                {!layoutIsDefault && <button className="btn ghost" onClick={() => { reset(); toast("Layout reset"); }}><Icon name="refresh" size={14} />Reset</button>}
                <button className="btn accent" onClick={() => setEditingLayout(false)}><Icon name="check" size={14} />Done</button>
              </>
            ) : (
              <button className="btn ghost" onClick={() => setEditingLayout(true)} title="Rearrange or hide dashboard tiles"><Icon name="grip" size={14} />Customise</button>
            )}
            <button className="btn ghost" disabled={standupBusy} onClick={generateStandup}>
              {standupBusy ? <><Icon name="loader" size={14} className="spin" />Generating…</> : <><Icon name="sparkles" size={14} />Standup summary</>}
            </button>
            <button className="break-btn" onClick={startBreak} title="Take a break"><span className="bb-cup">☕</span>Take a break</button>
          </div>
        </div>

        <div className="grid-stats" ref={gridRef}>
          {visibleTiles.map((id) => {
            const size = layout.sizes[id] ?? 1;
            const resizable = allowedSizesOf(id).length > 1;
            return (
              <div
                key={id}
                className={"tile s" + size + (editingLayout ? " editing" : "") + (dragId === id ? " dragging" : "") + (overId === id && dragId !== id ? " over" : "") + (layout.hidden.includes(id) ? " off" : "")}
                draggable={editingLayout}
                onDragStart={(e) => {
                  setDragId(id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", id); // Firefox won't start a drag without it
                }}
                onDragEnd={() => { setDragId(null); setOverId(null); }}
                onDragOver={(e) => { if (!editingLayout || !dragId) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOverId(id); }}
                onDragLeave={() => setOverId((o) => (o === id ? null : o))}
                onDrop={(e) => { e.preventDefault(); if (dragId) move(dragId, id); setDragId(null); setOverId(null); }}
              >
                {editingLayout && (
                  <div className="tile-bar">
                    <span className="tile-grip" title="Drag to rearrange"><Icon name="grip" size={13} /></span>
                    <button className="tile-eye" title={layout.hidden.includes(id) ? "Show tile" : "Hide tile"} onClick={() => toggleHidden(id)}>
                      <Icon name={layout.hidden.includes(id) ? "eyeOff" : "eye"} size={13} />
                    </button>
                  </div>
                )}
                {resizable && (
                  <div
                    className="tile-resize-handle"
                    title={`Width ${size}/4 — drag to resize, click to cycle`}
                    draggable={false}
                    onPointerDown={(e) => beginResize(e, id, size)}
                  />
                )}
                {TILES[id]}
              </div>
            );
          })}
        </div>
      </main>

      {(standupBusy || standup !== null) && (
        <Modal onClose={() => setStandup(null)} style={{ width: 520 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ display: "flex", alignItems: "center", gap: 9 }}><span style={{ color: "var(--mint)" }}><Icon name="sparkles" size={18} /></span>Standup summary</h3>
            <button className="iconbtn" onClick={() => setStandup(null)}><Icon name="x" size={16} /></button>
          </div>
          {standupBusy ? (
            <AiThinking active={standupBusy} />
          ) : (
            <>
              <div className="ai-answer">{standup}</div>
              <div className="ai-source">
                <span>via {standupSource === "local" ? "local model (free)" : "Claude"} · {formatDuration(standupDurationMs)}</span>
                <button className="btn ghost sm" onClick={() => { navigator.clipboard.writeText(standup || ""); toast("Copied"); }}><Icon name="copy" size={12} />Copy</button>
              </div>
            </>
          )}
        </Modal>
      )}

    </>
  );
}

