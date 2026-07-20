/**
 * Project health score — a single 0-100 number per project, combining
 * whatever live signals are actually available for it (linked repo and/or
 * linked Zoho sprint board). Nothing here is persisted: it's recomputed from
 * the same provider proxies ProjectDetail.tsx already calls (fetchXPulls/
 * fetchXCommits/fetchSprintBoard), just fanned out across every project at
 * once for src/routes/Insights.tsx.
 */
import type { Project } from "./types";
import { fetchGithubPulls, fetchGithubCommits, type GithubPull, type GithubCommit } from "./github";
import { fetchGitlabPulls, fetchGitlabCommits } from "./gitlab";
import { fetchAzureDevopsPulls, fetchAzureDevopsCommits } from "./azureDevops";
import { fetchSprintBoard, isOpenBug, type BoardSprint } from "./zoho";
import { computeVelocity, velocityMetric } from "./velocity";

export type HealthState = "ok" | "warn" | "unknown";

export interface HealthSignal {
  key: "prAge" | "staleness" | "bugs" | "velocity";
  label: string;
  score: number; // 0-100
  state: HealthState;
  detail: string;
}

export interface ProjectHealth {
  projectId: string;
  score: number | null; // null when no signal could be computed at all
  state: HealthState;
  signals: HealthSignal[];
}

const DAY = 86_400_000;

function bucket(score: number): HealthState {
  return score >= 75 ? "ok" : score >= 45 ? "warn" : "unknown";
}

function prAgeSignal(pulls: Pick<GithubPull, "createdAt">[]): HealthSignal {
  if (pulls.length === 0) return { key: "prAge", label: "Open PR age", score: 100, state: "ok", detail: "No open PRs" };
  const now = Date.now();
  const ageDays = pulls.map((p) => Math.max(0, (now - new Date(p.createdAt).getTime()) / DAY));
  const avg = ageDays.reduce((a, b) => a + b, 0) / ageDays.length;
  const score = avg <= 2 ? 100 : avg <= 5 ? 75 : avg <= 10 ? 45 : 15;
  return {
    key: "prAge", label: "Open PR age", score, state: bucket(score),
    detail: `${pulls.length} open PR${pulls.length === 1 ? "" : "s"}, avg ${avg < 1 ? "<1" : Math.round(avg)}d old`,
  };
}

function stalenessSignal(commits: Pick<GithubCommit, "date">[]): HealthSignal | null {
  if (commits.length === 0) return null;
  const last = commits.reduce((max, c) => Math.max(max, new Date(c.date).getTime()), 0);
  if (!last) return null;
  const days = Math.max(0, (Date.now() - last) / DAY);
  const score = days <= 1 ? 100 : days <= 3 ? 85 : days <= 7 ? 60 : days <= 14 ? 35 : 15;
  const detail = days < 1 ? "Committed today" : `Last commit ${Math.round(days)}d ago`;
  return { key: "staleness", label: "Staleness", score, state: bucket(score), detail };
}

function bugsSignal(sprints: BoardSprint[]): HealthSignal {
  const open = sprints.flatMap((s) => s.items).filter(isOpenBug).length;
  const score = open === 0 ? 100 : open <= 2 ? 80 : open <= 5 ? 50 : open <= 10 ? 25 : 10;
  return { key: "bugs", label: "Open bugs", score, state: bucket(score), detail: `${open} open bug${open === 1 ? "" : "s"}` };
}

function velocitySignal(sprints: BoardSprint[]): HealthSignal | null {
  const sorted = [...sprints].filter((s) => s.startDate).sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (sorted.length < 2) return null;
  const { values, label } = velocityMetric(computeVelocity(sorted));
  const prev = values[values.length - 2];
  const last = values[values.length - 1];
  if (prev === 0 && last === 0) return null;
  const ratio = prev === 0 ? 1 : last / prev;
  const score = ratio >= 0.9 ? 90 : ratio >= 0.5 ? 55 : 20;
  const pct = prev === 0 ? null : Math.round((ratio - 1) * 100);
  const detail = `Velocity: ${prev} → ${last} ${label}${pct === null ? "" : ` (${pct >= 0 ? "+" : ""}${pct}%)`}`;
  return { key: "velocity", label: "Velocity trend", score, state: bucket(score), detail };
}

function overall(signals: HealthSignal[]): { score: number | null; state: HealthState } {
  if (signals.length === 0) return { score: null, state: "unknown" };
  const score = Math.round(signals.reduce((sum, s) => sum + s.score, 0) / signals.length);
  return { score, state: bucket(score) };
}

/** Best-effort per-project fetch — a provider outage or unlinked repo/sprint just means fewer signals, never a thrown error for the whole grid. */
export async function computeProjectHealth(project: Project): Promise<ProjectHealth> {
  const signals: HealthSignal[] = [];

  if (project.repo_provider && project.repo_full_name) {
    try {
      const branch = project.repo_default_branch || undefined;
      const [pulls, commits] = project.repo_provider === "github"
        ? await Promise.all([fetchGithubPulls(project.repo_full_name), fetchGithubCommits(project.repo_full_name, branch)])
        : project.repo_provider === "gitlab"
        ? await Promise.all([fetchGitlabPulls(project.repo_full_name), fetchGitlabCommits(project.repo_full_name, branch)])
        : await Promise.all([fetchAzureDevopsPulls(project.repo_full_name), fetchAzureDevopsCommits(project.repo_full_name, branch)]);
      signals.push(prAgeSignal(pulls));
      const staleness = stalenessSignal(commits);
      if (staleness) signals.push(staleness);
    } catch { /* provider not connected / reachable — skip repo-based signals */ }
  }

  if (project.sprint_project_id) {
    try {
      const board = await fetchSprintBoard(project.sprint_project_id);
      signals.push(bugsSignal(board.sprints));
      const velocity = velocitySignal(board.sprints);
      if (velocity) signals.push(velocity);
    } catch { /* Zoho not connected / reachable — skip sprint-based signals */ }
  }

  const { score, state } = overall(signals);
  return { projectId: project.id, score, state, signals };
}
