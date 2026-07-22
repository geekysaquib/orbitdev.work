import { describe, it, expect, vi, beforeEach } from "vitest";
import { KnowledgeEngine, createInMemoryKnowledgeStore, type Entity } from "../engines/knowledge";
import { explainProject, relatedToTask, failingIntegrations, summarizeToday, staleActiveProjects } from "./intelligence";

vi.mock("./github", () => ({ fetchGithubCommits: vi.fn() }));
vi.mock("./gitlab", () => ({ fetchGitlabCommits: vi.fn() }));
vi.mock("./azureDevops", () => ({ fetchAzureDevopsCommits: vi.fn() }));
import { fetchGithubCommits } from "./github";

function entity(type: string, id: string, label: string, attributes: Record<string, unknown> = {}): Entity {
  return { ref: { type, id }, label, attributes, updatedAt: "2026-01-01T00:00:00.000Z" };
}

async function seededEngine() {
  const engine = new KnowledgeEngine(createInMemoryKnowledgeStore());
  await engine.upsertEntity(entity("project", "p1", "Orbit", { status: "active", client: "Acme" }));
  await engine.upsertEntity(entity("task", "t1", "Fix bug", { status: "todo", priority: "high" }));
  await engine.upsertEntity(entity("task", "t2", "Write docs", { status: "done" }));
  await engine.upsertEntity(entity("ticket", "k1", "Crash on save", { status: "Open" }));
  await engine.upsertRelationship({ from: { type: "task", id: "t1" }, type: "belongs_to", to: { type: "project", id: "p1" } });
  await engine.upsertRelationship({ from: { type: "task", id: "t2" }, type: "belongs_to", to: { type: "project", id: "p1" } });
  await engine.upsertRelationship({ from: { type: "ticket", id: "k1" }, type: "belongs_to", to: { type: "project", id: "p1" } });
  return engine;
}

describe("explainProject", () => {
  it("summarizes a project's task/ticket counts, with evidence", async () => {
    const engine = await seededEngine();
    const r = await explainProject(engine, "p1");
    expect(r.summary).toContain("Orbit is active for Acme");
    expect(r.summary).toContain("2 tasks tracked (1 done, 1 open)");
    expect(r.summary).toContain("1 ticket tracked (1 open)");
    expect(r.entities.map((e) => e.ref.id).sort()).toEqual(["k1", "p1", "t1", "t2"]);
  });

  it("reports not-found rather than guessing", async () => {
    const engine = new KnowledgeEngine(createInMemoryKnowledgeStore());
    const r = await explainProject(engine, "nope");
    expect(r.summary).toMatch(/couldn't find/i);
    expect(r.entities).toEqual([]);
  });
});

describe("relatedToTask", () => {
  it("includes the task's project and logged time, and is explicit about the ticket-linkage gap", async () => {
    const engine = await seededEngine();
    await engine.upsertEntity(entity("time_entry", "te1", "30m", { seconds: 1800, startedAt: "2026-01-01T00:00:00.000Z" }));
    await engine.upsertRelationship({ from: { type: "time_entry", id: "te1" }, type: "belongs_to", to: { type: "task", id: "t1" } });

    const r = await relatedToTask(engine, "t1");
    expect(r.summary).toContain("Fix bug is todo (high priority)");
    expect(r.summary).toContain("Belongs to Orbit");
    expect(r.summary).toContain("30 minutes logged across 1 time entry");
    expect(r.summary).toMatch(/doesn't currently link tickets/i);
    expect(r.entities.map((e) => e.ref.id).sort()).toEqual(["p1", "t1", "te1"]);
  });
});

describe("failingIntegrations", () => {
  it("lists only the disconnected/failing ones", async () => {
    const engine = new KnowledgeEngine(createInMemoryKnowledgeStore());
    await engine.upsertEntity(entity("integration", "github", "github", { connected: true }));
    await engine.upsertEntity(entity("integration", "gitlab", "gitlab", { connected: false, error: "bad token" }));

    const r = await failingIntegrations(engine);
    expect(r.summary).toContain("1 integration need attention: gitlab (bad token)");
    expect(r.entities.map((e) => e.ref.id)).toEqual(["github", "gitlab"]);
  });

  it("reports all-clear when everything is connected", async () => {
    const engine = new KnowledgeEngine(createInMemoryKnowledgeStore());
    await engine.upsertEntity(entity("integration", "github", "github", { connected: true }));
    const r = await failingIntegrations(engine);
    expect(r.summary).toBe("All 1 checked integration is connected.");
  });
});

describe("summarizeToday", () => {
  it("only counts tasks/time entries from today", async () => {
    const engine = new KnowledgeEngine(createInMemoryKnowledgeStore());
    const today = new Date().toISOString();
    const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await engine.upsertEntity(entity("task", "t1", "Done today", { status: "done", completedAt: today }));
    await engine.upsertEntity(entity("task", "t2", "Done earlier", { status: "done", completedAt: yesterday }));
    await engine.upsertEntity(entity("time_entry", "te1", "1h", { seconds: 3600, startedAt: today }));
    await engine.upsertEntity(entity("time_entry", "te2", "1h", { seconds: 3600, startedAt: yesterday }));

    const r = await summarizeToday(engine);
    expect(r.summary).toContain("Completed 1 task today: Done today");
    expect(r.summary).toContain("Logged 60 minutes across 1 time entry");
    expect(r.entities.map((e) => e.ref.id).sort()).toEqual(["t1", "te1"]);
  });
});

describe("staleActiveProjects", () => {
  beforeEach(() => { vi.mocked(fetchGithubCommits).mockReset(); });

  it("flags a repo-linked project with in-progress tasks and no recent commits", async () => {
    const engine = new KnowledgeEngine(createInMemoryKnowledgeStore());
    await engine.upsertEntity(entity("project", "p1", "Orbit", { repoProvider: "github", repoFullName: "org/orbit" }));
    await engine.upsertEntity(entity("task", "t1", "In progress task", { status: "in_progress" }));
    await engine.upsertRelationship({ from: { type: "task", id: "t1" }, type: "belongs_to", to: { type: "project", id: "p1" } });
    vi.mocked(fetchGithubCommits).mockResolvedValue([{ date: new Date(Date.now() - 20 * 86_400_000).toISOString() } as any]);

    const r = await staleActiveProjects(engine);
    expect(r.summary).toMatch(/Orbit \(1 in-progress task, last commit 20d ago\)/);
    expect(r.entities.map((e) => e.ref.id)).toEqual(["p1"]);
  });

  it("does not flag a project with recent commits", async () => {
    const engine = new KnowledgeEngine(createInMemoryKnowledgeStore());
    await engine.upsertEntity(entity("project", "p1", "Orbit", { repoProvider: "github", repoFullName: "org/orbit" }));
    await engine.upsertEntity(entity("task", "t1", "In progress task", { status: "in_progress" }));
    await engine.upsertRelationship({ from: { type: "task", id: "t1" }, type: "belongs_to", to: { type: "project", id: "p1" } });
    vi.mocked(fetchGithubCommits).mockResolvedValue([{ date: new Date().toISOString() } as any]);

    const r = await staleActiveProjects(engine);
    expect(r.entities).toEqual([]);
    expect(r.summary).toMatch(/recent commit activity/);
  });

  it("skips projects with no in-progress tasks, without calling the provider", async () => {
    const engine = new KnowledgeEngine(createInMemoryKnowledgeStore());
    await engine.upsertEntity(entity("project", "p1", "Orbit", { repoProvider: "github", repoFullName: "org/orbit" }));
    await engine.upsertEntity(entity("task", "t1", "Done task", { status: "done" }));
    await engine.upsertRelationship({ from: { type: "task", id: "t1" }, type: "belongs_to", to: { type: "project", id: "p1" } });

    const r = await staleActiveProjects(engine);
    expect(r.entities).toEqual([]);
    expect(fetchGithubCommits).not.toHaveBeenCalled();
  });

  it("skips a provider failure rather than reporting a false positive", async () => {
    const engine = new KnowledgeEngine(createInMemoryKnowledgeStore());
    await engine.upsertEntity(entity("project", "p1", "Orbit", { repoProvider: "github", repoFullName: "org/orbit" }));
    await engine.upsertEntity(entity("task", "t1", "In progress task", { status: "in_progress" }));
    await engine.upsertRelationship({ from: { type: "task", id: "t1" }, type: "belongs_to", to: { type: "project", id: "p1" } });
    vi.mocked(fetchGithubCommits).mockRejectedValue(new Error("network down"));

    const r = await staleActiveProjects(engine);
    expect(r.entities).toEqual([]);
  });
});
