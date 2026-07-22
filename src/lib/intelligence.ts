/**
 * Orbit Intelligence — a small, fixed set of curated questions answered
 * directly from the Knowledge Engine's graph, not by forwarding data to an
 * LLM (see docs/architecture/orbit-intelligence.md). Every function here is
 * deterministic: given the same graph, it produces the same answer, and the
 * `entities`/`relationships` it returns ARE the evidence — not something an
 * LLM claims to have looked at.
 *
 * Deliberately not a general free-text Q&A: each function answers exactly
 * one curated question. Answering fewer questions reliably beats answering
 * many unreliably — see the milestone's architecture proposal.
 */
import type { KnowledgeEngine } from "../engines/knowledge";
import type { Entity, Relationship } from "../engines/knowledge";
import { fetchGithubCommits } from "./github";
import { fetchGitlabCommits } from "./gitlab";
import { fetchAzureDevopsCommits } from "./azureDevops";

export interface IntelligenceAnswer {
  summary: string;
  entities: Entity[];
  relationships: Relationship[];
}

const NOT_FOUND = (kind: string): IntelligenceAnswer => ({
  summary: `Couldn't find that ${kind} in Orbit's knowledge graph — try refreshing the sync.`,
  entities: [], relationships: [],
});

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "Explain this project" — the project plus everything that belongs to it. */
export async function explainProject(knowledge: KnowledgeEngine, projectId: string): Promise<IntelligenceAnswer> {
  const project = await knowledge.getEntity({ type: "project", id: projectId });
  if (!project) return NOT_FOUND("project");

  const related = await knowledge.related(project.ref, { direction: "in" });
  const tasks = related.filter((r) => r.entity.ref.type === "task").map((r) => r.entity);
  const tickets = related.filter((r) => r.entity.ref.type === "ticket").map((r) => r.entity);
  const doneTasks = tasks.filter((t) => t.attributes.status === "done").length;
  const openTickets = tickets.filter((t) => !/resolved|closed/i.test(String(t.attributes.status ?? ""))).length;

  const summary = [
    `${project.label} is ${project.attributes.status ?? "active"}${project.attributes.client ? ` for ${project.attributes.client}` : ""}.`,
    tasks.length ? `${plural(tasks.length, "task")} tracked (${doneTasks} done, ${tasks.length - doneTasks} open).` : "No tasks tracked yet.",
    tickets.length ? `${plural(tickets.length, "ticket")} tracked (${openTickets} open).` : "No tickets tracked yet.",
  ].join(" ");

  return { summary, entities: [project, ...tasks, ...tickets], relationships: related.map((r) => r.relationship) };
}

/** "Show everything related to Task #123." */
export async function relatedToTask(knowledge: KnowledgeEngine, taskId: string): Promise<IntelligenceAnswer> {
  const task = await knowledge.getEntity({ type: "task", id: taskId });
  if (!task) return NOT_FOUND("task");

  const outgoing = await knowledge.related(task.ref); // task -> project
  const incoming = await knowledge.related(task.ref, { direction: "in" }); // time entries -> task
  const project = outgoing.find((r) => r.entity.ref.type === "project")?.entity ?? null;
  const timeEntries = incoming.filter((r) => r.entity.ref.type === "time_entry").map((r) => r.entity);
  const totalMinutes = Math.round(timeEntries.reduce((sum, e) => sum + (Number(e.attributes.seconds) || 0), 0) / 60);

  const summary = [
    `${task.label} is ${task.attributes.status ?? "unknown"}${task.attributes.priority ? ` (${task.attributes.priority} priority)` : ""}.`,
    project ? `Belongs to ${project.label}.` : "Not attached to a project.",
    timeEntries.length ? `${totalMinutes} minutes logged across ${plural(timeEntries.length, "time entry").replace("time entrys", "time entries")}.` : "No time logged yet.",
    "Orbit doesn't currently link tickets to individual tasks — only to the shared project, shown above.",
  ].join(" ");

  return {
    summary,
    entities: [task, ...(project ? [project] : []), ...timeEntries],
    relationships: [...outgoing, ...incoming].map((r) => r.relationship),
  };
}

/** "Which integrations are failing?" */
export async function failingIntegrations(knowledge: KnowledgeEngine): Promise<IntelligenceAnswer> {
  const integrations = await knowledge.query({ type: "integration" });
  const failing = integrations.filter((i) => !i.attributes.connected);

  const summary = integrations.length === 0
    ? "No integrations have been checked yet."
    : failing.length === 0
    ? `All ${plural(integrations.length, "checked integration")} ${integrations.length === 1 ? "is" : "are"} connected.`
    : `${plural(failing.length, "integration")} need attention: ${failing.map((i) => `${i.label}${i.attributes.error ? ` (${i.attributes.error})` : ""}`).join(", ")}.`;

  return { summary, entities: integrations, relationships: [] };
}

function isSameLocalDay(iso: string | null | undefined, reference: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === reference.getFullYear() && d.getMonth() === reference.getMonth() && d.getDate() === reference.getDate();
}

/** "Summarize today's work" — tasks completed today, plus time logged today. */
export async function summarizeToday(knowledge: KnowledgeEngine): Promise<IntelligenceAnswer> {
  const now = new Date();
  const [tasks, timeEntries] = await Promise.all([
    knowledge.query({ type: "task" }),
    knowledge.query({ type: "time_entry" }),
  ]);

  const completedToday = tasks.filter((t) => isSameLocalDay(t.attributes.completedAt as string | null, now));
  const todaysEntries = timeEntries.filter((e) => isSameLocalDay(e.attributes.startedAt as string | undefined, now));
  const totalMinutes = Math.round(todaysEntries.reduce((sum, e) => sum + (Number(e.attributes.seconds) || 0), 0) / 60);

  const summary = [
    completedToday.length ? `Completed ${plural(completedToday.length, "task")} today: ${completedToday.map((t) => t.label).join(", ")}.` : "No tasks completed today yet.",
    todaysEntries.length ? `Logged ${totalMinutes} minutes across ${plural(todaysEntries.length, "time entry").replace("time entrys", "time entries")}.` : "No time logged today yet.",
  ].join(" ");

  return { summary, entities: [...completedToday, ...todaysEntries], relationships: [] };
}

const COMMIT_FETCHERS: Record<string, (repo: string, branch?: string) => Promise<{ date: string }[]>> = {
  github: fetchGithubCommits, gitlab: fetchGitlabCommits, azuredevops: fetchAzureDevopsCommits,
};
const STALE_DAYS = 7;

/**
 * "Which tasks have no commits?" — narrowed to what's actually knowable:
 * Orbit doesn't link individual commits to individual tasks (no commit-
 * message-to-task-id matching exists anywhere), so this instead flags
 * repo-linked projects with in-progress tasks but no commit activity in the
 * last week. Commit history isn't graph data (no CI/CD or commit entities
 * exist in the Knowledge Engine yet) — this is a genuinely transitional
 * direct read against the live provider proxies (fetchGithubCommits etc.,
 * the same calls src/lib/projectHealth.ts already makes), not a shortcut
 * around the graph.
 */
export async function staleActiveProjects(knowledge: KnowledgeEngine): Promise<IntelligenceAnswer> {
  const projects = await knowledge.query({ type: "project" });
  const linked = projects.filter((p) => p.attributes.repoProvider && p.attributes.repoFullName);

  const flagged: Entity[] = [];
  const notes: string[] = [];
  await Promise.all(linked.map(async (project) => {
    const provider = String(project.attributes.repoProvider);
    const repo = String(project.attributes.repoFullName);
    const branch = (project.attributes.repoDefaultBranch as string | null) || undefined;
    const fetcher = COMMIT_FETCHERS[provider];
    if (!fetcher) return;

    const inProgress = (await knowledge.related(project.ref, { direction: "in" }))
      .filter((r) => r.entity.ref.type === "task" && r.entity.attributes.status !== "done");
    if (inProgress.length === 0) return;

    try {
      const commits = await fetcher(repo, branch);
      const lastCommit = commits.reduce((max, c) => Math.max(max, new Date(c.date).getTime()), 0);
      const days = lastCommit ? (Date.now() - lastCommit) / 86_400_000 : Infinity;
      if (days >= STALE_DAYS) {
        flagged.push(project);
        notes.push(`${project.label} (${plural(inProgress.length, "in-progress task")}, ${lastCommit ? `last commit ${Math.round(days)}d ago` : "no commits found"})`);
      }
    } catch { /* provider unreachable — skip rather than report a false positive */ }
  }));

  const summary = linked.length === 0
    ? "No projects are linked to a repository yet."
    : flagged.length === 0
    ? `All ${plural(linked.length, "repo-linked project")} with active tasks have recent commit activity.`
    : `${plural(flagged.length, "project")} have active tasks but no commits in the last ${STALE_DAYS} days: ${notes.join("; ")}.`;

  return { summary, entities: flagged, relationships: [] };
}
