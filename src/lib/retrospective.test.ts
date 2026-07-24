import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Project, Task } from "./types";

const gteMock = vi.fn();
vi.mock("./supabase", () => ({
  supabase: { from: () => ({ select: () => ({ gte: (...a: unknown[]) => gteMock(...a) }) }) },
}));
vi.mock("./github", () => ({ fetchGithubCommits: vi.fn().mockResolvedValue([]), fetchGithubPulls: vi.fn().mockResolvedValue([]) }));
vi.mock("./gitlab", () => ({ fetchGitlabCommits: vi.fn(), fetchGitlabPulls: vi.fn() }));
vi.mock("./azureDevops", () => ({ fetchAzureDevopsCommits: vi.fn(), fetchAzureDevopsPulls: vi.fn() }));

const { computeWeeklyRetro } = await import("./retrospective");

function project(over: Partial<Project> = {}): Project {
  return {
    id: "p1", user_id: "u1", team_id: null, name: "Proj", client: null,
    stacks: [], status: "active", accent: null,
    fe_path: null, sln_path: null, dev_port: null, branch: null, description: null, notes: null,
    sprint_project_id: null, sprint_project_name: null,
    repo_provider: null, repo_full_name: null, repo_id: null, repo_default_branch: null,
    created_at: new Date().toISOString(),
    ...over,
  };
}
function task(over: Partial<Task> = {}): Task {
  return {
    id: "t1", user_id: "u1", project_id: null, team_id: null, title: "Task",
    status: "done", priority: "med", due_date: null, estimate_minutes: null,
    completed_at: null, created_at: new Date().toISOString(),
    ...over,
  };
}

beforeEach(() => { gteMock.mockReset(); });

describe("computeWeeklyRetro", () => {
  it("buckets time entries by project and sorts descending by hours", async () => {
    gteMock.mockResolvedValue({
      data: [
        { project_id: "p1", seconds: 3600 },
        { project_id: "p2", seconds: 7200 },
        { project_id: null, seconds: 1800 },
      ],
      error: null,
    });
    const r = await computeWeeklyRetro([project({ id: "p1", name: "Alpha" }), project({ id: "p2", name: "Beta" })], []);
    expect(r.totalHours).toBe(3.5);
    expect(r.hoursByProject.map((h) => h.projectName)).toEqual(["Beta", "Alpha", "No project"]);
    expect(r.hoursByProject[0].hours).toBe(2);
  });

  it("labels a project not in the passed-in list as Unknown project", async () => {
    gteMock.mockResolvedValue({ data: [{ project_id: "ghost", seconds: 3600 }], error: null });
    const r = await computeWeeklyRetro([], []);
    expect(r.hoursByProject[0].projectName).toBe("Unknown project");
  });

  it("only includes tasks completed within the week window", async () => {
    gteMock.mockResolvedValue({ data: [], error: null });
    const inWindow = task({ id: "a", title: "A", completed_at: new Date().toISOString() });
    const outOfWindow = task({ id: "b", title: "B", completed_at: new Date(Date.now() - 30 * 86_400_000).toISOString() });
    const notDone = task({ id: "c", title: "C", completed_at: null });
    const r = await computeWeeklyRetro([], [inWindow, outOfWindow, notDone]);
    expect(r.tasksCompleted.map((t) => t.id)).toEqual(["a"]);
  });

  it("throws when the time_entries query errors", async () => {
    gteMock.mockResolvedValue({ data: null, error: { message: "db down" } });
    await expect(computeWeeklyRetro([], [])).rejects.toThrow("db down");
  });

  it("returns zeroed commit/PR totals when no project has a linked repo", async () => {
    gteMock.mockResolvedValue({ data: [], error: null });
    const r = await computeWeeklyRetro([project({ repo_provider: null })], []);
    expect(r.totalCommits).toBe(0);
    expect(r.totalPullsOpened).toBe(0);
  });
});
