/**
 * "AI Mode" (/ai-mode) — an opt-in, AI-native view of your work, reachable
 * from nav alongside Intelligence (see docs/architecture/ai-mode.md). Not
 * the default landing page — /app (Dashboard.tsx) remains that, unchanged.
 * Every section reuses an existing, already-shipped platform capability,
 * nothing new duplicated:
 *
 *   - Active timer   → src/lib/timer.ts (readTimer/stopTimer, as-is)
 *   - My tasks       → src/lib/myWork.ts, over the Knowledge Graph's
 *                       already-synced task entities
 *   - Orbit Insights → src/lib/insights.ts's runInsights(), same InsightRow
 *                       component /intelligence renders
 *   - Quick Answers → the same AskOrbitPanel /intelligence embeds — the
 *                       real experience, not a link out
 *   - Recent activity → src/lib/audit.ts's fetchAuditLog(), as-is
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOrbitRuntime } from "../runtime";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/Toast";
import { useKnowledgeBootstrap } from "../hooks/useKnowledgeBootstrap";
import { runInsights, dismissInsight, undismissInsight, type Insight } from "../lib/insights";
import { myOpenTasks, myOverdueTasks, sortByUrgency } from "../lib/myWork";
import { fetchAuditLog, type AuditEntry } from "../lib/audit";
import { activityMeta } from "../lib/activity";
import { TIMER_EVENT, readTimer, stopTimer, type TimerState } from "../lib/timer";
import type { AskOrbitTurn } from "../lib/askOrbit";
import type { Entity } from "../engines/knowledge";
import { Icon } from "../lib/icons";
import { ACCENT, Empty, OrbitLoader, Stat, prColor } from "../components/ui";
import { InsightRow } from "../components/InsightRow";
import { AskOrbitPanel } from "../components/AskOrbitPanel";

const INSIGHTS_PREVIEW_COUNT = 4;
const ACTIVITY_PREVIEW_COUNT = 5;
// Critical first, then warning, then info — same ordering rule as /intelligence.
const SEVERITY_RANK: Record<Insight["severity"], number> = { critical: 0, warning: 1, info: 2 };
const bySeverity = (a: Insight, b: Insight) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 21 ? "Good evening" : "Working late";
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function actionLabel(action: string): string {
  return action.replace(/[._]/g, " ");
}

/** Live-ticking timer card — same `readTimer`/`stopTimer`/`TIMER_EVENT` primitives Dashboard.tsx and TimeTracking.tsx already use, no new timer state. */
function ActiveTimerCard({ projects, tasks }: { projects: Entity[]; tasks: Entity[] }) {
  const toast = useToast();
  const nav = useNavigate();
  const [timer, setTimer] = useState<TimerState>(() => readTimer());
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    const sync = () => setTimer(readTimer());
    sync();
    window.addEventListener(TIMER_EVENT, sync);
    window.addEventListener("storage", sync);
    const iv = setInterval(sync, 1000);
    return () => { window.removeEventListener(TIMER_EVENT, sync); window.removeEventListener("storage", sync); clearInterval(iv); };
  }, []);

  async function handleStop() {
    setStopping(true);
    try {
      const seconds = await stopTimer();
      toast(`Logged ${Math.floor(seconds / 60)}m ${seconds % 60}s to Orbit hours`);
    } finally {
      setStopping(false);
    }
  }

  const running = timer.startedAt !== null;
  const clock = `${String(Math.floor(timer.seconds / 3600)).padStart(2, "0")}:${String(Math.floor((timer.seconds % 3600) / 60)).padStart(2, "0")}:${String(timer.seconds % 60).padStart(2, "0")}`;
  const projectLabel = timer.projectId ? projects.find((p) => p.ref.id === timer.projectId)?.label ?? null : null;
  const taskLabel = timer.taskId ? tasks.find((t) => t.ref.id === timer.taskId)?.label ?? null : null;

  return (
    <div className="card" style={{ padding: 18, borderLeft: running ? "3px solid var(--mint)" : undefined }}>
      <div className="lab" style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", fontSize: 12.5 }}>
        <span style={{ color: running ? "var(--mint)" : "var(--dim)" }}><Icon name="timer" size={15} /></span>Active timer
      </div>
      {running ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
          <div>
            <div className="mono" style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-.5px" }}>{clock}</div>
            <div style={{ fontSize: 12, color: "var(--dim)", marginTop: 2 }}>
              {projectLabel ?? "No project"}{taskLabel ? ` · ${taskLabel}` : ""}
            </div>
          </div>
          <button className="btn accent sm" disabled={stopping} onClick={handleStop}>
            {stopping ? <Icon name="loader" size={13} className="spin" /> : <Icon name="pause" size={12} fill />}Stop
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 8 }}>
          <div style={{ fontSize: 13, color: "var(--dim)" }}>No timer running right now.</div>
          <button className="btn ghost sm" onClick={() => nav("/time")}>Start a timer<Icon name="chevR" size={11} /></button>
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, overdue }: { task: Entity; overdue: boolean }) {
  const due = task.attributes.dueDate as string | null | undefined;
  const pc = prColor(String(task.attributes.priority ?? "low"));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 4px", borderTop: "1px solid var(--border-soft)" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: pc, flexShrink: 0, boxShadow: `0 0 0 3px color-mix(in srgb, ${pc} 16%, transparent)` }} />
      <span style={{ fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.label}</span>
      {due && (
        <span className="pill" style={{ height: 21, padding: "0 8px", fontSize: 10.5, flexShrink: 0, color: overdue ? "var(--red)" : "var(--dim)", borderColor: overdue ? "color-mix(in srgb, var(--red) 34%, transparent)" : "transparent", background: overdue ? "color-mix(in srgb, var(--red) 10%, transparent)" : "var(--raised)" }}>
          {overdue ? "Overdue" : new Date(due).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </span>
      )}
    </div>
  );
}

export default function AiMode() {
  const { knowledge } = useOrbitRuntime();
  const { user } = useAuth();
  const nav = useNavigate();
  const { ready, projects, tasks } = useKnowledgeBootstrap(knowledge);

  const [detected, setDetected] = useState<Insight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [expandedInsightId, setExpandedInsightId] = useState<string | null>(null);

  const [activity, setActivity] = useState<AuditEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);

  const [turns, setTurns] = useState<AskOrbitTurn[]>([]);

  useEffect(() => {
    if (!ready) return;
    runInsights(knowledge).then((d) => { setDetected(d); setInsightsLoading(false); });
  }, [ready, knowledge]);

  useEffect(() => {
    fetchAuditLog({ pageSize: ACTIVITY_PREVIEW_COUNT }).then((r) => { setActivity(r.rows); setActivityLoading(false); });
  }, []);

  async function handleDismiss(id: string) {
    setDetected((cur) => cur.map((i) => (i.id === id ? { ...i, dismissed: true } : i)));
    await dismissInsight(id);
  }
  async function handleUndismiss(id: string) {
    setDetected((cur) => cur.map((i) => (i.id === id ? { ...i, dismissed: false } : i)));
    await undismissInsight(id);
  }

  const firstName = (user?.full_name || "").split(" ")[0];
  const greet = firstName ? `${greeting(new Date())}, ${firstName}` : greeting(new Date());
  const dateStr = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const openTasks = user ? sortByUrgency(myOpenTasks(tasks, user.id)) : [];
  const overdueIds = new Set(user ? myOverdueTasks(tasks, user.id).map((t) => t.ref.id) : []);
  const activeInsights = detected.filter((i) => !i.dismissed).sort(bySeverity);

  return (
    <main className="page">
      <div>
        <h2 className="h1">{greet}</h2>
        <div className="greet-row">
          <span className="greet-chip"><Icon name="cal" size={14} />{dateStr}</span>
          <span className="greet-sep" />
          <span className="greet-chip"><Icon name="layers" size={14} />{openTasks.length} task{openTasks.length === 1 ? "" : "s"} open</span>
          {overdueIds.size > 0 && <>
            <span className="greet-sep" />
            <span className="greet-chip" style={{ color: "var(--red)" }}><Icon name="alert" size={14} />{overdueIds.size} overdue</span>
          </>}
        </div>
      </div>

      {!ready ? (
        <div className="page-loader"><OrbitLoader label="Building the knowledge graph…" /></div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 20 }}>
            <ActiveTimerCard projects={projects} tasks={tasks} />
            <Stat icon="layers" label="Open tasks" value={String(openTasks.length)} tone={overdueIds.size > 0 ? ACCENT.red : ACCENT.blue} sub={overdueIds.size > 0 ? `${overdueIds.size} overdue` : undefined} />
            <Stat icon="sparkles" label="Insights needing attention" value={String(activeInsights.length)} tone={activeInsights.some((i) => i.severity === "critical") ? ACCENT.red : activeInsights.length > 0 ? ACCENT.amber : ACCENT.mint} />
          </div>

          <div className="card" style={{ marginTop: 20, padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <div className="eyebrow">My tasks</div>
              <button className="btn ghost sm" onClick={() => nav("/tasks")}>View all<Icon name="chevR" size={11} /></button>
            </div>
            {openTasks.length === 0 ? (
              <Empty icon="checkc" title="Nothing open" sub="You're caught up." mini />
            ) : (
              openTasks.slice(0, 8).map((t) => <TaskRow key={t.ref.id} task={t} overdue={overdueIds.has(t.ref.id)} />)
            )}
          </div>

          <div style={{ marginTop: 24 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div className="eyebrow">Orbit Insights</div>
              <button className="btn ghost sm" onClick={() => nav("/intelligence")}>See all in Orbit Intelligence<Icon name="chevR" size={11} /></button>
            </div>
            {insightsLoading ? (
              <div className="page-loader" style={{ minHeight: 100 }}><OrbitLoader label="Scanning the knowledge graph…" size={22} /></div>
            ) : activeInsights.length === 0 ? (
              <Empty icon="checkc" title="All clear" sub="Nothing needs your attention right now — Orbit is watching." mini />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {activeInsights.slice(0, INSIGHTS_PREVIEW_COUNT).map((insight) => (
                  <InsightRow
                    key={insight.id} insight={insight}
                    expanded={expandedInsightId === insight.id}
                    onToggle={() => setExpandedInsightId((cur) => (cur === insight.id ? null : insight.id))}
                    onDismiss={handleDismiss} onUndismiss={handleUndismiss}
                  />
                ))}
              </div>
            )}
          </div>

          <AskOrbitPanel knowledge={knowledge} projects={projects} tasks={tasks} turns={turns} onTurnsChange={setTurns} />

          <div style={{ marginTop: 24 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Recent activity</div>
            {activityLoading ? (
              <div className="page-loader" style={{ minHeight: 100 }}><OrbitLoader label="Loading recent activity…" size={22} /></div>
            ) : activity.length === 0 ? (
              <Empty icon="activity" title="Nothing logged yet" mini />
            ) : (
              <div className="card" style={{ padding: 6 }}>
                {activity.map((a, i) => {
                  const m = activityMeta(a.action);
                  return (
                    <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 10px", borderTop: i === 0 ? "none" : "1px solid var(--border-soft)" }}>
                      <span className="insight-badge" style={{ width: 26, height: 26, background: "color-mix(in srgb, " + m.color + " 14%, transparent)", color: m.color }}>
                        <Icon name={m.icon} size={13} />
                      </span>
                      <span style={{ fontSize: 12.5, textTransform: "capitalize", flex: 1 }}>{actionLabel(a.action)}</span>
                      <span className="mono" style={{ fontSize: 11, color: "var(--dim)", flexShrink: 0 }}>{timeAgo(a.created_at)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {projects.length === 0 && tasks.length === 0 && (
            <div style={{ marginTop: 16 }}>
              <Empty icon="sparkles" title="Nothing synced yet" sub="Add a project or task, then come back — AI Mode fills in as your workspace fills in." />
            </div>
          )}
        </>
      )}
    </main>
  );
}
