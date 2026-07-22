import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KnowledgeEngine, createInMemoryKnowledgeStore, type Entity, type KnowledgeStore } from "../engines/knowledge";
import { runInsights, dismissInsight, undismissInsight, loadDismissedIds } from "./insights";

vi.mock("./settings", () => ({ fetchSettings: vi.fn(), saveSettings: vi.fn() }));
import { fetchSettings, saveSettings } from "./settings";

vi.mock("./github", () => ({ fetchGithubCommits: vi.fn() }));
vi.mock("./gitlab", () => ({ fetchGitlabCommits: vi.fn() }));
vi.mock("./azureDevops", () => ({ fetchAzureDevopsCommits: vi.fn() }));
import { fetchGithubCommits } from "./github";

function entity(type: string, id: string, label: string, attributes: Record<string, unknown> = {}, updatedAt = "2026-01-01T00:00:00.000Z"): Entity {
  return { ref: { type, id }, label, attributes, updatedAt };
}

const NOW = new Date(2026, 5, 15, 15, 0, 0); // local 3pm — past the missing-daily-work gate
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.mocked(fetchSettings).mockReset().mockResolvedValue({});
  vi.mocked(saveSettings).mockReset().mockResolvedValue(undefined);
  vi.mocked(fetchGithubCommits).mockReset();
});
afterEach(() => { vi.useRealTimers(); });

function engineWith(entities: Entity[], relationships: { from: Entity["ref"]; type: string; to: Entity["ref"] }[] = []) {
  const engine = new KnowledgeEngine(createInMemoryKnowledgeStore());
  return (async () => {
    for (const e of entities) await engine.upsertEntity(e);
    for (const r of relationships) await engine.upsertRelationship(r);
    return engine;
  })();
}

describe("broken-integration", () => {
  it("flags disconnected integrations only", async () => {
    const engine = await engineWith([
      entity("integration", "github", "github", { connected: true }),
      entity("integration", "gitlab", "gitlab", { connected: false, error: "bad token" }),
    ]);
    const insights = (await runInsights(engine)).filter((i) => i.detectorId === "broken-integration");
    expect(insights).toHaveLength(1);
    expect(insights[0]).toMatchObject({ severity: "warning", subject: { type: "integration", id: "gitlab" } });
    expect(insights[0].summary).toContain("bad token");
  });
});

describe("idle-repository", () => {
  it("flags a repo-linked project with in-progress tasks and no recent commits", async () => {
    const engine = await engineWith(
      [
        entity("project", "p1", "Orbit", { status: "active", repoProvider: "github", repoFullName: "org/orbit" }),
        entity("task", "t1", "In progress", { status: "doing" }),
      ],
      [{ from: { type: "task", id: "t1" }, type: "belongs_to", to: { type: "project", id: "p1" } }],
    );
    vi.mocked(fetchGithubCommits).mockResolvedValue([{ date: daysAgo(20) } as any]);
    const insights = (await runInsights(engine)).filter((i) => i.detectorId === "idle-repository");
    expect(insights).toHaveLength(1);
    expect(insights[0].subject).toEqual({ type: "project", id: "p1" });
  });
});

describe("missing-daily-work", () => {
  it("does not fire before local midday", async () => {
    vi.setSystemTime(new Date(2026, 5, 15, 8, 0, 0));
    const engine = await engineWith([]);
    const insights = (await runInsights(engine)).filter((i) => i.detectorId === "missing-daily-work");
    expect(insights).toHaveLength(0);
  });

  it("fires after midday when nothing was done today", async () => {
    const engine = await engineWith([]);
    const insights = (await runInsights(engine)).filter((i) => i.detectorId === "missing-daily-work");
    expect(insights).toHaveLength(1);
    expect(insights[0].severity).toBe("info");
  });

  it("does not fire when a task was completed today", async () => {
    const engine = await engineWith([entity("task", "t1", "Done today", { status: "done", completedAt: NOW.toISOString() })]);
    const insights = (await runInsights(engine)).filter((i) => i.detectorId === "missing-daily-work");
    expect(insights).toHaveLength(0);
  });
});

describe("stale-project", () => {
  it("flags an active project with no activity in 14+ days", async () => {
    const engine = await engineWith(
      [
        entity("project", "p1", "Quiet", { status: "active" }),
        entity("time_entry", "te1", "1h", { seconds: 3600, startedAt: daysAgo(20) }),
      ],
      [{ from: { type: "time_entry", id: "te1" }, type: "belongs_to", to: { type: "project", id: "p1" } }],
    );
    const insights = (await runInsights(engine)).filter((i) => i.detectorId === "stale-project");
    expect(insights).toHaveLength(1);
  });

  it("does not flag a recently active project", async () => {
    const engine = await engineWith(
      [
        entity("project", "p1", "Active", { status: "active" }),
        entity("time_entry", "te1", "1h", { seconds: 3600, startedAt: daysAgo(1) }),
      ],
      [{ from: { type: "time_entry", id: "te1" }, type: "belongs_to", to: { type: "project", id: "p1" } }],
    );
    const insights = (await runInsights(engine)).filter((i) => i.detectorId === "stale-project");
    expect(insights).toHaveLength(0);
  });

  it("does not flag a non-active project", async () => {
    const engine = await engineWith([entity("project", "p1", "Archived", { status: "hold" })]);
    const insights = (await runInsights(engine)).filter((i) => i.detectorId === "stale-project");
    expect(insights).toHaveLength(0);
  });
});

describe("declining-project-activity", () => {
  it("flags a project whose logged time dropped by more than half", async () => {
    const engine = await engineWith(
      [
        entity("project", "p1", "Slowing", { status: "active" }),
        entity("time_entry", "te-old", "4h", { seconds: 14400, startedAt: daysAgo(10) }), // last week
        entity("time_entry", "te-new", "1h", { seconds: 3600, startedAt: daysAgo(2) }),   // this week
      ],
      [
        { from: { type: "time_entry", id: "te-old" }, type: "belongs_to", to: { type: "project", id: "p1" } },
        { from: { type: "time_entry", id: "te-new" }, type: "belongs_to", to: { type: "project", id: "p1" } },
      ],
    );
    const insights = (await runInsights(engine)).filter((i) => i.detectorId === "declining-project-activity");
    expect(insights).toHaveLength(1);
    expect(insights[0].summary).toContain("4h");
  });

  it("does not flag a project with too little prior activity to call it a decline", async () => {
    const engine = await engineWith(
      [
        entity("project", "p1", "New", { status: "active" }),
        entity("time_entry", "te-old", "5m", { seconds: 300, startedAt: daysAgo(10) }),
      ],
      [{ from: { type: "time_entry", id: "te-old" }, type: "belongs_to", to: { type: "project", id: "p1" } }],
    );
    const insights = (await runInsights(engine)).filter((i) => i.detectorId === "declining-project-activity");
    expect(insights).toHaveLength(0);
  });
});

describe("stuck-task", () => {
  it("flags a non-done task with no recorded update in 10+ days, escalating to critical past 30", async () => {
    const engine = await engineWith([
      entity("task", "t1", "Warning-level", { status: "doing" }, daysAgo(15)),
      entity("task", "t2", "Critical-level", { status: "todo" }, daysAgo(40)),
      entity("task", "t3", "Fresh", { status: "doing" }, daysAgo(1)),
      entity("task", "t4", "Old but done", { status: "done" }, daysAgo(40)),
    ]);
    const insights = (await runInsights(engine)).filter((i) => i.detectorId === "stuck-task");
    expect(insights.map((i) => i.subject.id).sort()).toEqual(["t1", "t2"]);
    expect(insights.find((i) => i.subject.id === "t1")?.severity).toBe("warning");
    expect(insights.find((i) => i.subject.id === "t2")?.severity).toBe("critical");
  });
});

describe("long-running-time-entry", () => {
  it("flags an entry of 6+ hours", async () => {
    const engine = await engineWith([
      entity("time_entry", "te1", "7h", { seconds: 7 * 3600, startedAt: daysAgo(1) }),
      entity("time_entry", "te2", "2h", { seconds: 2 * 3600, startedAt: daysAgo(1) }),
    ]);
    const insights = (await runInsights(engine)).filter((i) => i.detectorId === "long-running-time-entry");
    expect(insights.map((i) => i.subject.id)).toEqual(["te1"]);
  });
});

describe("overloaded-developer", () => {
  it("flags a user with well-above-average open tasks", async () => {
    const heavy = Array.from({ length: 10 }, (_, i) => entity("task", `heavy-${i}`, `Task ${i}`, { status: "todo", userId: "u1" }));
    const light1 = entity("task", "light-1", "Light 1", { status: "todo", userId: "u2" });
    const light2 = entity("task", "light-2", "Light 2", { status: "todo", userId: "u3" });
    const engine = await engineWith([...heavy, light1, light2]);
    const insights = (await runInsights(engine)).filter((i) => i.detectorId === "overloaded-developer");
    expect(insights).toHaveLength(1);
    expect(insights[0].subject).toEqual({ type: "user", id: "u1" });
  });

  it("does not fire with fewer than two comparable users", async () => {
    const many = Array.from({ length: 10 }, (_, i) => entity("task", `heavy-${i}`, `Task ${i}`, { status: "todo", userId: "u1" }));
    const engine = await engineWith(many);
    const insights = (await runInsights(engine)).filter((i) => i.detectorId === "overloaded-developer");
    expect(insights).toHaveLength(0);
  });
});

describe("team-no-updates", () => {
  it("flags a team whose shared projects have no recent activity", async () => {
    const engine = await engineWith(
      [
        entity("project", "p1", "Team project", { status: "active", teamId: "team1" }),
        entity("time_entry", "te1", "1h", { seconds: 3600, startedAt: daysAgo(30) }),
      ],
      [{ from: { type: "time_entry", id: "te1" }, type: "belongs_to", to: { type: "project", id: "p1" } }],
    );
    const insights = (await runInsights(engine)).filter((i) => i.detectorId === "team-no-updates");
    expect(insights).toHaveLength(1);
    expect(insights[0].subject).toEqual({ type: "team", id: "team1" });
  });

  it("does not flag a project with no team", async () => {
    const engine = await engineWith([entity("project", "p1", "Personal", { status: "active" })]);
    const insights = (await runInsights(engine)).filter((i) => i.detectorId === "team-no-updates");
    expect(insights).toHaveLength(0);
  });
});

describe("runInsights resilience and dismissal", () => {
  it("one detector's store failure doesn't stop the others from returning", async () => {
    const base = createInMemoryKnowledgeStore();
    const failingStore: KnowledgeStore = {
      ...base,
      search: (async (q) => { if (q.type === "integration") throw new Error("boom"); return base.search(q); }) as KnowledgeStore["search"],
    };
    const engine = new KnowledgeEngine(failingStore);
    await engine.upsertEntity(entity("task", "t1", "Old", { status: "todo" }, daysAgo(15)));
    const insights = await runInsights(engine);
    expect(insights.some((i) => i.detectorId === "stuck-task")).toBe(true);
    expect(insights.some((i) => i.detectorId === "broken-integration")).toBe(false);
  });

  it("tags each insight with the caller's current dismissal state", async () => {
    const engine = await engineWith([entity("integration", "github", "github", { connected: false })]);
    vi.mocked(fetchSettings).mockResolvedValue({ dismissed_insight_ids: ["broken-integration:integration:github"] });
    const insights = await runInsights(engine);
    const gh = insights.find((i) => i.detectorId === "broken-integration");
    expect(gh?.dismissed).toBe(true);
  });
});

describe("dismissInsight / undismissInsight / loadDismissedIds", () => {
  it("loadDismissedIds reads the settings blob", async () => {
    vi.mocked(fetchSettings).mockResolvedValue({ dismissed_insight_ids: ["a", "b"] });
    expect(await loadDismissedIds()).toEqual(new Set(["a", "b"]));
  });

  it("dismissInsight adds to the existing set", async () => {
    vi.mocked(fetchSettings).mockResolvedValue({ dismissed_insight_ids: ["a"] });
    await dismissInsight("b");
    expect(saveSettings).toHaveBeenCalledWith({ dismissed_insight_ids: ["a", "b"] });
  });

  it("undismissInsight removes from the set", async () => {
    vi.mocked(fetchSettings).mockResolvedValue({ dismissed_insight_ids: ["a", "b"] });
    await undismissInsight("a");
    expect(saveSettings).toHaveBeenCalledWith({ dismissed_insight_ids: ["b"] });
  });
});
