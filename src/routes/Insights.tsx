import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { Empty, OrbitLoader } from "../components/ui";
import { useTable } from "../hooks/useTable";
import { computeProjectHealth, type ProjectHealth, type HealthState } from "../lib/projectHealth";
import type { Project } from "../lib/types";

const STATE_LABEL: Record<HealthState, string> = { ok: "Healthy", warn: "Needs attention", unknown: "Not enough data" };
const STATE_COLOR: Record<HealthState, string> = { ok: "var(--mint)", warn: "var(--amber)", unknown: "var(--dim)" };
const STATE_PILL: Record<HealthState, string> = { ok: "pill live", warn: "pill warn", unknown: "pill" };

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

export default function Insights() {
  const { rows: projects, loading: loadingProjects } = useTable<Project>("projects");
  const [health, setHealth] = useState<Record<string, ProjectHealth>>({});
  const [computing, setComputing] = useState(false);

  const active = projects.filter((p) => p.status === "active");

  async function refresh() {
    if (active.length === 0) return;
    setComputing(true);
    const results = await Promise.all(active.map((p) => computeProjectHealth(p)));
    const byId: Record<string, ProjectHealth> = {};
    results.forEach((h) => { byId[h.projectId] = h; });
    setHealth(byId);
    setComputing(false);
  }

  useEffect(() => {
    if (!loadingProjects) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingProjects, projects.length]);

  const scored = active.map((p) => health[p.id]).filter((h): h is ProjectHealth => !!h && h.score !== null);
  const atRisk = scored.filter((h) => h.state === "warn").length;

  return (
    <main className="page">
      <div className="rowhead">
        <div>
          <div className="h1">Insights</div>
          <div className="sub">A project health score computed from open PR age, commit staleness, open bugs and velocity trend.</div>
        </div>
        <button className="btn ghost" disabled={computing || loadingProjects} onClick={refresh}>
          <Icon name="refresh" size={15} />{computing ? "Scoring…" : "Recheck all"}
        </button>
      </div>

      {!loadingProjects && scored.length > 0 && atRisk > 0 && (
        <div className="zoho-alert" style={{ borderRadius: 10, marginTop: 16 }}>
          <Icon name="alert" size={15} />
          <span>{atRisk} project{atRisk === 1 ? "" : "s"} need{atRisk === 1 ? "s" : ""} attention.</span>
        </div>
      )}

      {loadingProjects ? (
        <div className="page-loader"><OrbitLoader label="Loading projects…" /></div>
      ) : active.length === 0 ? (
        <Empty icon="gauge" title="No active projects" sub="Add a project and link a repo or sprint board to see its health score here." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12, marginTop: 20 }}>
          {active.map((p) => (
            <ProjectHealthCard key={p.id} project={p} health={health[p.id] ?? null} loading={computing && !health[p.id]} />
          ))}
        </div>
      )}
    </main>
  );
}
