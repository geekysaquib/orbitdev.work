/**
 * Orbit Intelligence — Orbit's flagship AI surface: proactive insight cards
 * on load, a "Quick Answers" prompt bar (labeled that way, not "Ask Orbit",
 * to avoid reading as the same thing as Ask AI — see
 * docs/architecture/trust-fixes.md), and a running conversation thread.
 * Every answer still comes from the exact same five deterministic
 * Knowledge-Engine-backed functions in `src/lib/intelligence.ts` — this file
 * is a presentation-layer redesign only (see docs/architecture/
 * orbit-intelligence.md and the UX-redesign proposal in this session's plan
 * history). Deliberately separate from Ask AI (components/AskAiModal.tsx +
 * lib/askContext.ts): that flow is untouched.
 *
 * The Quick Answers bar/thread, `InsightRow`, and the Knowledge Graph
 * bootstrap effect are shared with the `/ai-mode` AI Mode module — see
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
import { ACCENT, Empty, OrbitLoader, Stat } from "../components/ui";
import { InsightRow } from "../components/InsightRow";
import { AskOrbitPanel } from "../components/AskOrbitPanel";

// Critical first, then warning, then info — the point of the page is "what
// needs a look," so the most urgent thing should never be the fifth row down.
const SEVERITY_RANK: Record<Insight["severity"], number> = { critical: 0, warning: 1, info: 2 };
const bySeverity = (a: Insight, b: Insight) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];

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

  const active = detected.filter((i) => !i.dismissed).sort(bySeverity);
  const dismissed = detected.filter((i) => i.dismissed);
  const critical = active.filter((i) => i.severity === "critical").length;
  const warning = active.filter((i) => i.severity === "warning").length;
  const info = active.filter((i) => i.severity === "info").length;
  const attentionTone = critical > 0 ? ACCENT.red : warning > 0 ? ACCENT.amber : ACCENT.mint;

  return (
    <main className="page">
      <div className="rowhead">
        <div>
          <div className="h1" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="insight-badge" style={{ background: "color-mix(in srgb, var(--mint) 14%, transparent)", color: "var(--mint)", width: 30, height: 30 }}>
              <Icon name="sparkles" size={16} />
            </span>
            Orbit Intelligence
          </div>
          <div className="sub">Orbit already knows what's happening across your work — every answer is computed from your own data, not forwarded to an LLM.</div>
        </div>
      </div>

      {!ready ? (
        <div className="page-loader"><OrbitLoader label="Building the knowledge graph…" /></div>
      ) : (
        <>
          {!insightsLoading && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginTop: 20 }}>
              <Stat icon="alert" label="Needs attention" value={String(critical + warning)} tone={attentionTone} sub={critical > 0 ? `${critical} critical` : undefined} />
              <Stat icon="sparkles" label="Informational" value={String(info)} tone={ACCENT.mint} />
              <Stat icon="eyeOff" label="Dismissed" value={String(dismissed.length)} tone={ACCENT.dim} />
            </div>
          )}

          <div style={{ marginTop: 24 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Insights</div>
            {insightsLoading ? (
              <div className="page-loader" style={{ minHeight: 160 }}><OrbitLoader label="Scanning the knowledge graph for anything worth a look…" /></div>
            ) : active.length === 0 ? (
              <Empty icon="checkc" title="All clear" sub="Nothing needs your attention right now — Orbit is watching." mini />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {active.map((insight) => (
                  <InsightRow
                    key={insight.id} insight={insight}
                    expanded={expandedInsightId === insight.id}
                    onToggle={() => setExpandedInsightId((cur) => (cur === insight.id ? null : insight.id))}
                    onDismiss={handleDismiss} onUndismiss={handleUndismiss}
                  />
                ))}
              </div>
            )}

            {dismissed.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <button className="btn ghost sm" onClick={() => setShowDismissed((s) => !s)}>
                  <Icon name={showDismissed ? "chevD" : "chevR"} size={12} />
                  {showDismissed ? "Hide" : "Show"} {dismissed.length} dismissed
                </button>
                {showDismissed && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
                    {dismissed.map((insight) => (
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
          </div>

          <AskOrbitPanel knowledge={knowledge} projects={projects} tasks={tasks} turns={turns} onTurnsChange={setTurns} />

          {projects.length === 0 && tasks.length === 0 && turns.length === 0 && (
            <div style={{ marginTop: 16 }}>
              <Empty icon="sparkles" title="Nothing synced yet" sub="Add a project or task, then come back — Orbit Intelligence answers from what's actually in your workspace." />
            </div>
          )}
        </>
      )}
    </main>
  );
}
