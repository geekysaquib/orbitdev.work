import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { Empty, OrbitLoader } from "../components/ui";
import { useTable } from "../hooks/useTable";
import { computeProjectHealth, type ProjectHealth, type HealthState } from "../lib/projectHealth";
import { computeWeeklyRetro, type WeeklyRetro } from "../lib/retrospective";
import { fetchEstimateAccuracy, type EstimateRow } from "../lib/estimateAccuracy";
import { computeFocusAnalytics, type FocusAnalytics } from "../lib/focusAnalytics";
import type { Project, Task } from "../lib/types";

const TABS = ["health", "retro", "estimates", "focus"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { health: "Health", retro: "Weekly retro", estimates: "Estimates", focus: "Focus" };

const STATE_LABEL: Record<HealthState, string> = { ok: "Healthy", warn: "Needs attention", unknown: "Not enough data" };
const STATE_COLOR: Record<HealthState, string> = { ok: "var(--mint)", warn: "var(--amber)", unknown: "var(--dim)" };
const STATE_PILL: Record<HealthState, string> = { ok: "pill live", warn: "pill warn", unknown: "pill" };

const fmtMin = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`);

function StatTile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div className="ds">{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: color ?? "var(--text)" }}>{value}</div>
    </div>
  );
}

/** Plain proportional-width bar row — matches the app's existing lightweight-table look (TimeTracking's hours-by-project) rather than pulling in a chart lib for a handful of rows. */
function BarRow({ label, value, valueLabel, max, color }: { label: string; value: number; valueLabel: string; max: number; color: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 64px", alignItems: "center", gap: 10, fontSize: 12.5 }}>
      <span style={{ color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ background: "var(--border-soft)", borderRadius: 4, height: 8, overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%`, background: color, borderRadius: 4 }} />
      </span>
      <span className="mono" style={{ color: "var(--dim)", textAlign: "right" }}>{valueLabel}</span>
    </div>
  );
}

function ProjectHealthCard({ project, health, loading }: { project: Project; health: ProjectHealth | null; loading: boolean }) {
  const nav = useNavigate();
  const state = health?.state ?? "unknown";
  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.name}</div>
          {project.client && <div className="ds" style={{ marginTop: 2 }}>{project.client}</div>}
        </div>
        {loading ? (
          <Icon name="loader" size={16} className="spin" />
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {health?.score !== null && health?.score !== undefined && (
              <span style={{ fontSize: 20, fontWeight: 700, color: STATE_COLOR[state] }}>{health.score}</span>
            )}
            <span className={STATE_PILL[state]}>
              <span className={"dotled" + (state === "warn" ? " warn" : "")} />
              {STATE_LABEL[state]}
            </span>
          </div>
        )}
      </div>

      {!loading && health && health.signals.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {health.signals.map((s) => (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: STATE_COLOR[s.state], flexShrink: 0 }} />
              <span style={{ color: "var(--dim)", flexShrink: 0 }}>{s.label}:</span>
              <span style={{ color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.detail}</span>
            </div>
          ))}
        </div>
      )}

      {!loading && (!health || health.signals.length === 0) && (
        <div className="ds" style={{ marginTop: 10 }}>
          {project.repo_provider || project.sprint_project_id
            ? "Couldn't reach the linked repo or sprint board."
            : "Link a repo or a Zoho sprint board to score this project."}
        </div>
      )}

      <button className="btn ghost" style={{ marginTop: 12 }} onClick={() => nav(`/projects/${project.id}`)}>
        <Icon name="chevR" size={14} />Open project
      </button>
    </div>
  );
}

function HealthTab({ projects }: { projects: Project[] }) {
  const active = projects.filter((p) => p.status === "active");
  const [health, setHealth] = useState<Record<string, ProjectHealth>>({});
  const [computing, setComputing] = useState(false);

  async function refresh() {
    if (active.length === 0) return;
    setComputing(true);
    const results = await Promise.all(active.map((p) => computeProjectHealth(p)));
    const byId: Record<string, ProjectHealth> = {};
    results.forEach((h) => { byId[h.projectId] = h; });
    setHealth(byId);
    setComputing(false);
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projects.length]);

  const scored = active.map((p) => health[p.id]).filter((h): h is ProjectHealth => !!h && h.score !== null);
  const atRisk = scored.filter((h) => h.state === "warn").length;

  return (
    <>
      <div className="rowhead" style={{ marginTop: 0 }}>
        <div className="sub">A project health score computed from open PR age, commit staleness, open bugs and velocity trend.</div>
        <button className="btn ghost" disabled={computing} onClick={refresh}>
          <Icon name="refresh" size={15} />{computing ? "Scoring…" : "Recheck all"}
        </button>
      </div>

      {scored.length > 0 && atRisk > 0 && (
        <div className="zoho-alert" style={{ borderRadius: 10, marginTop: 16 }}>
          <Icon name="alert" size={15} />
          <span>{atRisk} project{atRisk === 1 ? "" : "s"} need{atRisk === 1 ? "s" : ""} attention.</span>
        </div>
      )}

      {active.length === 0 ? (
        <Empty icon="gauge" title="No active projects" sub="Add a project and link a repo or sprint board to see its health score here." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12, marginTop: 20 }}>
          {active.map((p) => (
            <ProjectHealthCard key={p.id} project={p} health={health[p.id] ?? null} loading={computing && !health[p.id]} />
          ))}
        </div>
      )}
    </>
  );
}

function RetroTab({ projects, tasks }: { projects: Project[]; tasks: Task[] }) {
  const [retro, setRetro] = useState<WeeklyRetro | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    computeWeeklyRetro(projects, tasks)
      .then((r) => { setRetro(r); setErr(null); })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.length, tasks.length]);

  if (loading) return <div className="page-loader"><OrbitLoader label="Building this week's retrospective…" /></div>;
  if (err) return <div className="authx-err" style={{ marginTop: 12 }}><Icon name="plug" size={13} />Couldn't build the retrospective: {err}</div>;
  if (!retro) return null;

  const maxHours = Math.max(1, ...retro.hoursByProject.map((r) => r.hours));
  const maxCommits = Math.max(1, ...retro.commitsByProject.map((r) => r.count));
  const maxPulls = Math.max(1, ...retro.pullsByProject.map((r) => r.count));

  return (
    <>
      <div className="sub" style={{ marginTop: 0 }}>Where your week went, since {new Date(retro.weekStart).toLocaleDateString(undefined, { month: "short", day: "numeric" })}.</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginTop: 16 }}>
        <StatTile label="Hours logged" value={`${retro.totalHours}h`} color="var(--mint)" />
        <StatTile label="Tasks completed" value={String(retro.tasksCompleted.length)} />
        <StatTile label="Commits" value={String(retro.totalCommits)} />
        <StatTile label="PRs opened" value={String(retro.totalPullsOpened)} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 20 }}>
        <div className="card" style={{ padding: 18 }}>
          <div className="eyebrow" style={{ marginTop: 0 }}>Hours by project</div>
          {retro.hoursByProject.length === 0 ? <div className="ds" style={{ marginTop: 8 }}>No time logged this week.</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
              {retro.hoursByProject.map((r) => (
                <BarRow key={r.projectId ?? "none"} label={r.projectName} value={r.hours} valueLabel={`${r.hours}h`} max={maxHours} color="var(--mint)" />
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 18 }}>
          <div className="eyebrow" style={{ marginTop: 0 }}>Tasks completed</div>
          {retro.tasksCompleted.length === 0 ? <div className="ds" style={{ marginTop: 8 }}>No tasks marked done this week.</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10, maxHeight: 180, overflowY: "auto" }}>
              {retro.tasksCompleted.map((t) => (
                <div key={t.id} style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "baseline" }}>
                  <Icon name="check" size={11} />
                  <span style={{ color: "var(--text)" }}>{t.title}</span>
                  <span className="ds" style={{ marginLeft: "auto", flexShrink: 0 }}>{t.projectName}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 18 }}>
          <div className="eyebrow" style={{ marginTop: 0 }}>Commits by project</div>
          {retro.commitsByProject.length === 0 ? <div className="ds" style={{ marginTop: 8 }}>No commits this week on linked repos.</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
              {retro.commitsByProject.map((r) => (
                <BarRow key={r.projectId} label={r.projectName} value={r.count} valueLabel={String(r.count)} max={maxCommits} color="var(--blue)" />
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 18 }}>
          <div className="eyebrow" style={{ marginTop: 0 }}>PRs opened by project</div>
          {retro.pullsByProject.length === 0 ? <div className="ds" style={{ marginTop: 8 }}>No PRs opened this week on linked repos.</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
              {retro.pullsByProject.map((r) => (
                <BarRow key={r.projectId} label={r.projectName} value={r.count} valueLabel={String(r.count)} max={maxPulls} color="var(--violet)" />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function EstimatesTab({ tasks }: { tasks: Task[] }) {
  const [rows, setRows] = useState<EstimateRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    fetchEstimateAccuracy(tasks).then(setRows).catch((e) => setErr((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.length]);

  if (err) return <div className="authx-err" style={{ marginTop: 12 }}><Icon name="plug" size={13} />Couldn't load estimate accuracy: {err}</div>;
  if (rows === null) return <div className="page-loader"><OrbitLoader label="Comparing estimates to logged time…" /></div>;
  if (rows.length === 0) return <Empty icon="timer" title="No estimates yet" sub="Set an estimate (in minutes) on a task's card in Tasks to see planned vs. actual here." />;

  return (
    <>
      <div className="sub" style={{ marginTop: 0 }}>Planned effort vs. time actually logged against each estimated task.</div>
      <table className="tbl" style={{ marginTop: 16 }}>
        <thead><tr><th>Task</th><th>Estimated</th><th>Actual</th><th>Variance</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const over = r.variancePct !== null && r.variancePct > 20;
            const under = r.variancePct !== null && r.variancePct < -20;
            const color = over ? "var(--red)" : under ? "var(--mint)" : "var(--muted)";
            return (
              <tr key={r.taskId} className="prow" onClick={() => nav("/tasks")}>
                <td style={{ fontFamily: "var(--display)", fontWeight: 600 }}>{r.title}</td>
                <td className="mono" style={{ color: "var(--dim)" }}>{fmtMin(r.estimateMinutes)}</td>
                <td className="mono" style={{ color: "var(--dim)" }}>{fmtMin(r.actualMinutes)}</td>
                <td className="mono" style={{ color }}>
                  {r.actualMinutes === 0 ? "not started" : `${r.varianceMinutes >= 0 ? "+" : ""}${fmtMin(r.varianceMinutes)}${r.variancePct !== null ? ` (${r.variancePct >= 0 ? "+" : ""}${r.variancePct}%)` : ""}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function FocusTab() {
  const [a, setA] = useState<FocusAnalytics | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { computeFocusAnalytics().then(setA).catch((e) => setErr((e as Error).message)); }, []);

  if (err) return <div className="authx-err" style={{ marginTop: 12 }}><Icon name="plug" size={13} />Couldn't load focus analytics: {err}</div>;
  if (a === null) return <div className="page-loader"><OrbitLoader label="Crunching focus events…" /></div>;
  if (!a.hasData) return <Empty icon="bolt" title="Not enough data yet" sub="ORBIT logs idle/resume and route changes automatically as you work — check back after a few active days." />;

  const maxHour = Math.max(1, ...a.hourHistogram.map((h) => h.interruptions));
  const maxDayInterrupt = Math.max(1, ...a.days.map((d) => d.interruptions));

  return (
    <>
      <div className="sub" style={{ marginTop: 0 }}>Context-switching cost and deep-work trends from the last two weeks.</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 16 }}>
        <StatTile label="Interruptions" value={String(a.totalInterruptions)} />
        <StatTile label="Interrupted time" value={fmtMin(a.totalInterruptedMinutes)} color="var(--amber)" />
        <StatTile label="Route/section changes" value={String(a.totalRouteChanges)} />
        <StatTile label="Avg. longest streak" value={a.avgLongestFocusMinutes ? fmtMin(a.avgLongestFocusMinutes) : "—"} color="var(--mint)" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 20 }}>
        <div className="card" style={{ padding: 18 }}>
          <div className="eyebrow" style={{ marginTop: 0 }}>
            Most-interrupted hours
            {a.peakInterruptedHour !== null && <span className="ds" style={{ marginLeft: 8 }}>peak {a.peakInterruptedHour}:00–{a.peakInterruptedHour + 1}:00</span>}
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 90, marginTop: 14 }}>
            {a.hourHistogram.map((h) => (
              <div key={h.hour} title={`${h.hour}:00 — ${h.interruptions} interruption${h.interruptions === 1 ? "" : "s"}`}
                style={{ flex: 1, height: `${Math.max(2, (h.interruptions / maxHour) * 100)}%`, background: h.hour === a.peakInterruptedHour ? "var(--amber)" : "var(--border-soft)", borderRadius: 2 }} />
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--dim)", marginTop: 4 }}>
            <span>12am</span><span>12pm</span><span>11pm</span>
          </div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <div className="eyebrow" style={{ marginTop: 0 }}>Interruptions per day</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10, maxHeight: 180, overflowY: "auto" }}>
            {a.days.map((d) => (
              <BarRow key={d.dateKey} label={d.label} value={d.interruptions} valueLabel={String(d.interruptions)} max={maxDayInterrupt} color="var(--amber)" />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export default function Insights() {
  const { rows: projects, loading: loadingProjects } = useTable<Project>("projects");
  const { rows: tasks, loading: loadingTasks } = useTable<Task>("tasks");
  const [tab, setTab] = useState<Tab>("health");

  const loading = loadingProjects || loadingTasks;

  return (
    <main className="page">
      <div className="rowhead">
        <div className="h1">Insights</div>
      </div>

      <div className="tabs">
        {TABS.map((t) => <button key={t} className={"tab" + (tab === t ? " on" : "")} onClick={() => setTab(t)}>{TAB_LABEL[t]}</button>)}
      </div>

      <div className="tabpane fade">
        {loading ? (
          <div className="page-loader"><OrbitLoader label="Loading…" /></div>
        ) : (
          <>
            {tab === "health" && <HealthTab projects={projects} />}
            {tab === "retro" && <RetroTab projects={projects} tasks={tasks} />}
            {tab === "estimates" && <EstimatesTab tasks={tasks} />}
            {tab === "focus" && <FocusTab />}
          </>
        )}
      </div>
    </main>
  );
}
