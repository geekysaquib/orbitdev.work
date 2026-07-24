import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import type { KnowledgeEngine } from "../engines/knowledge";
import { runInsights, type Insight } from "../lib/insights";
import { useKnowledgeBootstrap } from "./useKnowledgeBootstrap";

export interface OrbitInsightsContext {
  insights: Insight[];
  insightsLoading: boolean;
}

/**
 * Obtains and exposes the current, non-dismissed `Insight[]` — nothing more.
 * Deliberately does no page-specific filtering (by detector id, by subject,
 * by count) — that's each consuming page's own decision, made on the plain
 * `Insight[]` this returns. See src/routes/{Dashboard,TimeTracking,Teams}.tsx
 * for how each one slices it differently.
 *
 * Meant to be called once, at `Layout.tsx`'s level, and shared down to routed
 * pages via `<Outlet context={...}>` — not once per page — so visiting
 * Dashboard, Time Tracking, and Teams in the same session doesn't re-run the
 * Knowledge Graph bootstrap (`useKnowledgeBootstrap`'s `syncTimeEntries`/
 * `syncIntegrationStatus`) three separate times. See docs/architecture/
 * ambient-intelligence.md.
 *
 * TEMPORARY SYNCHRONIZATION MECHANISM: the bootstrap (the expensive part —
 * network syncs) runs once, on mount. `runInsights()` (cheap — an in-memory
 * detector pass over already-synced graph data) re-runs on every route
 * change, keyed off `location.pathname`, purely so a dismissal made on
 * `/intelligence` or `/ai-mode` shows up here within one navigation instead
 * of staying stale for the rest of the session. This is a stopgap, not the
 * intended long-term design — the correct fix is to recompute when the
 * Knowledge Engine's underlying data changes or a `domain_events` insight-
 * relevant event fires (i.e. driven by the Knowledge Engine / Event Engine,
 * not by React Router's location object, which has nothing to do with why
 * the data went stale). Revisit once there's a cheap way to know "the graph
 * changed" without polling on every navigation.
 */
export function useOrbitInsights(knowledge: KnowledgeEngine): OrbitInsightsContext {
  const { ready } = useKnowledgeBootstrap(knowledge);
  const location = useLocation();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    runInsights(knowledge).then((all) => {
      if (cancelled) return;
      setInsights(all.filter((i) => !i.dismissed));
      setInsightsLoading(false);
    });
    return () => { cancelled = true; };
  }, [ready, knowledge, location.pathname]);

  return { insights, insightsLoading };
}
