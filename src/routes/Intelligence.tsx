/**
 * Orbit Intelligence — Orbit's flagship AI surface: proactive insight cards
 * on load, an "Ask Orbit" prompt bar, and a running conversation thread.
 * Every answer still comes from the exact same five deterministic
 * Knowledge-Engine-backed functions in `src/lib/intelligence.ts` — this file
 * is a presentation-layer redesign only (see docs/architecture/
 * orbit-intelligence.md and the UX-redesign proposal in this session's plan
 * history). Deliberately separate from Ask AI (components/AskAiModal.tsx +
 * lib/askContext.ts): that flow is untouched.
 *
 * The Ask Orbit bar/thread, `InsightRow`, and the Knowledge Graph bootstrap
 * effect are shared with the `/home` "My Work" dashboard — see
 * `src/components/AskOrbitPanel.tsx`, `src/components/InsightRow.tsx`, and
 * `src/hooks/useKnowledgeBootstrap.ts`. This page composes them rather than
 * owning that logic itself.
 */
import { useEffect, useState } from "react";
import { useOrbitRuntime } from "../runtime";
import { useKnowledgeBootstrap } from "../hooks/useKnowledgeBootstrap";
import { runInsights, dismissInsight, undismissInsight, type Insight } from "../lib/insights";
import type { AskOrbitTurn } from "../lib/askOrbit";
import { Icon } from "../lib/icons";
import { Empty, OrbitLoader } from "../components/ui";
import { InsightRow } from "../components/InsightRow";
import { AskOrbitPanel } from "../components/AskOrbitPanel";

export default function Intelligence() {
  const { knowledge } = useOrbitRuntime();
  const { ready, projects, tasks } = useKnowledgeBootstrap(knowledge);

  const [detected, setDetected] = useState<Insight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [expandedInsightId, setExpandedInsightId] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

  const [turns, setTurns] = useState<AskOrbitTurn[]>([]);

  useEffect(() => {
    if (!ready) return;
    runInsights(knowledge).then((d) => { setDetected(d); setInsightsLoading(false); });
  }, [ready, knowledge]);

  async function handleDismiss(id: string) {
    setDetected((cur) => cur.map((i) => (i.id === id ? { ...i, dismissed: true } : i)));
    await dismissInsight(id);
  }
  async function handleUndismiss(id: string) {
    setDetected((cur) => cur.map((i) => (i.id === id ? { ...i, dismissed: false } : i)));
    await undismissInsight(id);
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2 style={{ display: "flex", alignItems: "center", gap: 9 }}><span style={{ color: "var(--mint)" }}><Icon name="sparkles" size={18} /></span>Orbit Intelligence</h2>
        <p style={{ fontSize: 13, marginTop: 2 }}>Orbit already knows what's happening across your work.</p>
        <p style={{ color: "var(--dim)", fontSize: 11, marginTop: 2 }}>Every answer is computed from your own workspace data, not forwarded to an LLM.</p>
      </div>

      {!ready ? (
        <OrbitLoader label="Building the knowledge graph…" />
      ) : (
        <>
          {insightsLoading ? (
            <OrbitLoader label="Scanning the knowledge graph for anything worth a look…" />
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                {detected.filter((i) => !i.dismissed).length === 0 ? (
                  <div className="card" style={{ padding: 14 }}>
                    <div style={{ fontSize: 13, color: "var(--dim)" }}>Nothing needs your attention right now — Orbit is watching.</div>
                  </div>
                ) : (
                  detected.filter((i) => !i.dismissed).map((insight) => (
                    <InsightRow
                      key={insight.id} insight={insight}
                      expanded={expandedInsightId === insight.id}
                      onToggle={() => setExpandedInsightId((cur) => (cur === insight.id ? null : insight.id))}
                      onDismiss={handleDismiss} onUndismiss={handleUndismiss}
                    />
                  ))
                )}
              </div>

              {detected.some((i) => i.dismissed) && (
                <div style={{ marginTop: 8 }}>
                  <button className="btn ghost sm" onClick={() => setShowDismissed((s) => !s)}>
                    {showDismissed ? "Hide" : "Show"} {detected.filter((i) => i.dismissed).length} dismissed
                  </button>
                  {showDismissed && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                      {detected.filter((i) => i.dismissed).map((insight) => (
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
              )}
            </>
          )}

          <AskOrbitPanel knowledge={knowledge} projects={projects} tasks={tasks} turns={turns} onTurnsChange={setTurns} />

          {projects.length === 0 && tasks.length === 0 && turns.length === 0 && (
            <div style={{ marginTop: 16 }}>
              <Empty icon="sparkles" title="Nothing synced yet" sub="Add a project or task, then come back — Orbit Intelligence answers from what's actually in your workspace." />
            </div>
          )}
        </>
      )}
    </div>
  );
}
