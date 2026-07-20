/**
 * Weekly auto-retrospective ("where did my week go") — aggregates the last 7
 * days of time_entries by project, tasks marked done in that window (via
 * tasks.completed_at, stamped by the DB trigger in supabase/schema.sql), and
 * commits/PRs opened on every repo-linked active project. Commits/PRs are
 * fetched live from the same provider proxies projectHealth.ts already uses
 * (no local git/PR history is stored), so a provider outage just drops that
 * project's numbers rather than failing the whole retro.
 */
import { supabase } from "./supabase";
import type { Project, Task } from "./types";
import { fetchGithubCommits, fetchGithubPulls } from "./github";
import { fetchGitlabCommits, fetchGitlabPulls } from "./gitlab";
import { fetchAzureDevopsCommits, fetchAzureDevopsPulls } from "./azureDevops";

export interface ProjectCount { projectId: string | null; projectName: string; count: number }

export interface WeeklyRetro {
  weekStart: string;
  hoursByProject: (ProjectCount & { hours: number })[];
  totalHours: number;
  tasksCompleted: { id: string; title: string; projectId: string | null; projectName: string }[];
  commitsByProject: ProjectCount[];
  totalCommits: number;
  pullsByProject: ProjectCount[];
  totalPullsOpened: number;
}

async function fetchProjectCommitsAndPulls(p: Project, weekStart: Date) {
  const branch = p.repo_default_branch || undefined;
  const repo = p.repo_full_name!;
  const [commits, pulls] = p.repo_provider === "github"
    ? await Promise.all([fetchGithubCommits(repo, branch), fetchGithubPulls(repo)])
    : p.repo_provider === "gitlab"
    ? await Promise.all([fetchGitlabCommits(repo, branch), fetchGitlabPulls(repo)])
    : await Promise.all([fetchAzureDevopsCommits(repo, branch), fetchAzureDevopsPulls(repo)]);
  return {
    commitCount: commits.filter((c) => new Date(c.date) >= weekStart).length,
    pullCount: pulls.filter((pr) => new Date(pr.createdAt) >= weekStart).length,
  };
}

export async function computeWeeklyRetro(projects: Project[], tasks: Task[]): Promise<WeeklyRetro> {
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);

  const projName = Object.fromEntries(projects.map((p) => [p.id, p.name]));

  const { data: entries, error } = await supabase
    .from("time_entries")
    .select("project_id, seconds")
    .gte("started_at", weekStart.toISOString());
  if (error) throw new Error(error.message);

  const secByProject: Record<string, number> = {};
  for (const row of entries ?? []) {
    const key = row.project_id ?? "__none";
    secByProject[key] = (secByProject[key] ?? 0) + row.seconds;
  }
  const hoursByProject = Object.entries(secByProject)
    .map(([key, sec]) => ({
      projectId: key === "__none" ? null : key,
      projectName: key === "__none" ? "No project" : (projName[key] ?? "Unknown project"),
      count: 0,
      hours: +(sec / 3600).toFixed(1),
    }))
    .sort((a, b) => b.hours - a.hours);
  const totalHours = +hoursByProject.reduce((sum, r) => sum + r.hours, 0).toFixed(1);

  const tasksCompleted = tasks
    .filter((t) => t.completed_at && new Date(t.completed_at) >= weekStart)
    .map((t) => ({ id: t.id, title: t.title, projectId: t.project_id, projectName: t.project_id ? (projName[t.project_id] ?? "Unknown project") : "No project" }))
    .sort((a, b) => a.title.localeCompare(b.title));

  const linked = projects.filter((p) => p.repo_provider && p.repo_full_name);
  const perRepo = await Promise.all(
    linked.map(async (p) => {
      try {
        const { commitCount, pullCount } = await fetchProjectCommitsAndPulls(p, weekStart);
        return { projectId: p.id, projectName: p.name, commitCount, pullCount };
      } catch {
        return { projectId: p.id, projectName: p.name, commitCount: 0, pullCount: 0 };
      }
    }),
  );
  const commitsByProject = perRepo.filter((r) => r.commitCount > 0)
    .map((r) => ({ projectId: r.projectId, projectName: r.projectName, count: r.commitCount }))
    .sort((a, b) => b.count - a.count);
  const pullsByProject = perRepo.filter((r) => r.pullCount > 0)
    .map((r) => ({ projectId: r.projectId, projectName: r.projectName, count: r.pullCount }))
    .sort((a, b) => b.count - a.count);

  return {
    weekStart: weekStart.toISOString(),
    hoursByProject, totalHours,
    tasksCompleted,
    commitsByProject, totalCommits: commitsByProject.reduce((sum, r) => sum + r.count, 0),
    pullsByProject, totalPullsOpened: pullsByProject.reduce((sum, r) => sum + r.count, 0),
  };
}
