import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Project } from "./types";

const fetchGithubPulls = vi.fn();
const fetchGithubCommits = vi.fn();
const fetchSprintBoard = vi.fn();

vi.mock("./github", () => ({ fetchGithubPulls: (...a: unknown[]) => fetchGithubPulls(...a), fetchGithubCommits: (...a: unknown[]) => fetchGithubCommits(...a) }));
vi.mock("./gitlab", () => ({ fetchGitlabPulls: vi.fn(), fetchGitlabCommits: vi.fn() }));
vi.mock("./azureDevops", () => ({ fetchAzureDevopsPulls: vi.fn(), fetchAzureDevopsCommits: vi.fn() }));
vi.mock("./zoho", async () => {
  const actual = await vi.importActual<typeof import("./zoho")>("./zoho");
  return { ...actual, fetchSprintBoard: (...a: unknown[]) => fetchSprintBoard(...a) };
});

const { computeProjectHealth } = await import("./projectHealth");

function project(over: Partial<Project> = {}): Project {
  return {
    id: "p1", user_id: "u1", team_id: null, name: "Proj", client: null,
    stacks: [], status: "active", accent: null,
    fe_path: null, sln_path: null, dev_port: null, branch: null, description: null,
    sprint_project_id: null, sprint_project_name: null,
    repo_provider: null, repo_full_name: null, repo_id: null, repo_default_branch: null,
    created_at: new Date().toISOString(),
    ...over,
  };
}

beforeEach(() => { fetchGithubPulls.mockReset(); fetchGithubCommits.mockReset(); fetchSprintBoard.mockReset(); });

describe("computeProjectHealth", () => {
  it("returns null score / unknown state with no linked repo or sprint", async () => {
    const h = await computeProjectHealth(project());
    expect(h).toEqual({ projectId: "p1", score: null, state: "unknown", signals: [] });
  });

  it("scores 100 (ok) for a repo with no open PRs and a commit today", async () => {
    fetchGithubPulls.mockResolvedValue([]);
    fetchGithubCommits.mockResolvedValue([{ date: new Date().toISOString() }]);
    const h = await computeProjectHealth(project({ repo_provider: "github", repo_full_name: "o/r" }));
    expect(h.state).toBe("ok");
    expect(h.signals.map((s) => s.key).sort()).toEqual(["prAge", "staleness"]);
  });

  it("degrades to warn/unknown for old PRs and stale commits", async () => {
    const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
    fetchGithubPulls.mockResolvedValue([{ createdAt: old }]);
    fetchGithubCommits.mockResolvedValue([{ date: old }]);
    const h = await computeProjectHealth(project({ repo_provider: "github", repo_full_name: "o/r" }));
    expect(h.score).toBeLessThan(45);
    expect(h.state).toBe("unknown");
  });

  it("skips repo-based signals (not a thrown error) when the provider fetch fails", async () => {
    fetchGithubPulls.mockRejectedValue(new Error("network"));
    fetchGithubCommits.mockRejectedValue(new Error("network"));
    const h = await computeProjectHealth(project({ repo_provider: "github", repo_full_name: "o/r" }));
    expect(h.signals).toEqual([]);
    expect(h.score).toBeNull();
  });

  it("scores bugs from the linked sprint board", async () => {
    const openBug = (n: number) => ({ id: `i${n}`, ticketNumber: String(n), subject: "bug", status: "Open", priority: "high", type: "Bug" });
    fetchSprintBoard.mockResolvedValue({
      sprints: [{ id: "s1", name: "S1", status: "active", startDate: "", endDate: "", items: [openBug(1), openBug(2), openBug(3)] }],
    });
    const h = await computeProjectHealth(project({ sprint_project_id: "sp1" }));
    const bugs = h.signals.find((s) => s.key === "bugs");
    expect(bugs?.detail).toBe("3 open bugs");
    expect(bugs?.state).toBe("warn"); // 3 open bugs -> score 50 -> warn bucket (45-74)
  });
});
