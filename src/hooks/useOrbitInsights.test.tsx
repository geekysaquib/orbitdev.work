// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { KnowledgeEngine, createInMemoryKnowledgeStore, type Entity } from "../engines/knowledge";
import type { Insight } from "../lib/insights";
import { useOrbitInsights, type OrbitInsightsContext } from "./useOrbitInsights";

const syncTimeEntries = vi.fn().mockResolvedValue(undefined);
const syncIntegrationStatus = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/knowledgeSync", () => ({
  syncTimeEntries: (...a: unknown[]) => syncTimeEntries(...a),
  syncIntegrationStatus: (...a: unknown[]) => syncIntegrationStatus(...a),
}));

const runInsights = vi.fn();
vi.mock("../lib/insights", () => ({ runInsights: (...a: unknown[]) => runInsights(...a) }));

function insight(id: string, dismissed: boolean): Insight {
  return {
    id, detectorId: "stale-project", severity: "warning", title: id, summary: id,
    subject: { type: "project", id }, entities: [] as Entity[], relationships: [],
    detectedAt: "2026-01-01T00:00:00.000Z", dismissed,
  };
}

function Harness({ onRender }: { onRender: (ctx: OrbitInsightsContext) => void }) {
  const knowledge = harnessKnowledge;
  const ctx = useOrbitInsights(knowledge);
  onRender(ctx);
  return null;
}

let harnessKnowledge: KnowledgeEngine;

function renderAt(path: string, onRender: (ctx: OrbitInsightsContext) => void) {
  const router = createMemoryRouter(
    [{ path: "*", element: <Harness onRender={onRender} /> }],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  harnessKnowledge = new KnowledgeEngine(createInMemoryKnowledgeStore());
  syncTimeEntries.mockClear();
  syncIntegrationStatus.mockClear();
  runInsights.mockReset();
  runInsights.mockResolvedValue([]);
});

describe("useOrbitInsights", () => {
  it("filters out dismissed insights", async () => {
    runInsights.mockResolvedValue([insight("a", false), insight("b", true), insight("c", false)]);
    const renders: OrbitInsightsContext[] = [];
    renderAt("/app", (ctx) => renders.push(ctx));

    await waitFor(() => expect(renders.at(-1)?.insightsLoading).toBe(false));
    expect(renders.at(-1)?.insights.map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("runs the Knowledge Graph bootstrap exactly once, even across navigation", async () => {
    runInsights.mockResolvedValue([]);
    const renders: OrbitInsightsContext[] = [];
    const router = renderAt("/app", (ctx) => renders.push(ctx));

    await waitFor(() => expect(renders.at(-1)?.insightsLoading).toBe(false));
    expect(syncTimeEntries).toHaveBeenCalledTimes(1);
    expect(syncIntegrationStatus).toHaveBeenCalledTimes(1);

    await act(async () => { await router.navigate("/tasks"); });
    await act(async () => { await router.navigate("/teams"); });

    expect(syncTimeEntries).toHaveBeenCalledTimes(1);
    expect(syncIntegrationStatus).toHaveBeenCalledTimes(1);
  });

  it("recomputes insights on navigation, independent of the one-time bootstrap", async () => {
    runInsights.mockResolvedValue([]);
    const renders: OrbitInsightsContext[] = [];
    const router = renderAt("/app", (ctx) => renders.push(ctx));

    await waitFor(() => expect(runInsights).toHaveBeenCalledTimes(1));

    await act(async () => { await router.navigate("/tasks"); });
    await waitFor(() => expect(runInsights).toHaveBeenCalledTimes(2));

    await act(async () => { await router.navigate("/teams"); });
    await waitFor(() => expect(runInsights).toHaveBeenCalledTimes(3));

    // The expensive sync never re-ran, only the cheap in-memory detector pass did.
    expect(syncTimeEntries).toHaveBeenCalledTimes(1);
  });
});
