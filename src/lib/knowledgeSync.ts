import { supabase } from "./supabase";
import type { KnowledgeEngine } from "../engines/knowledge";
import type { Project, Task, Ticket, TimeEntry } from "./types";
import { fetchGithubStatus } from "./github";
import { fetchGitlabStatus } from "./gitlab";
import { fetchAzureDevopsStatus } from "./azureDevops";

/**
 * Direct-synchronization half of the Knowledge Engine's hybrid population
 * model (see docs/architecture/knowledge-engine.md's Transitional
 * architecture section) — the primary way the graph gets populated today,
 * since the Event Engine doesn't yet carry Orbit's actual domain mutations
 * (task/ticket/project create-update-delete). Reads the same tables
 * `src/lib/askContext.ts` already reads, via a separate, parallel path —
 * askContext.ts is untouched by this engine.
 */
export async function syncFromSupabase(engine: KnowledgeEngine): Promise<void> {
  const [{ data: projects }, { data: tasks }, { data: tickets }] = await Promise.all([
    supabase.from("projects").select("*"),
    supabase.from("tasks").select("*"),
    supabase.from("tickets").select("*"),
  ]);

  for (const p of (projects ?? []) as Project[]) {
    await engine.upsertEntity({
      ref: { type: "project", id: p.id },
      label: p.name,
      attributes: {
        status: p.status, client: p.client, teamId: p.team_id,
        repoProvider: p.repo_provider, repoFullName: p.repo_full_name, repoDefaultBranch: p.repo_default_branch,
      },
      updatedAt: p.created_at,
    });
  }

  for (const t of (tasks ?? []) as Task[]) {
    await engine.upsertEntity({
      ref: { type: "task", id: t.id },
      label: t.title,
      // userId/teamId: added for src/lib/insights.ts's overloaded-developer/
      // team-no-updates detectors — RLS already returns team-shared teammates'
      // tasks here (see docs/architecture/orbit-insights.md), this just makes
      // "whose task" and "which team" queryable in the graph.
      attributes: { status: t.status, priority: t.priority, dueDate: t.due_date, completedAt: t.completed_at, userId: t.user_id, teamId: t.team_id },
      updatedAt: t.created_at,
    });
    if (t.project_id) {
      await engine.upsertRelationship({ from: { type: "task", id: t.id }, type: "belongs_to", to: { type: "project", id: t.project_id } });
    }
  }

  for (const tk of (tickets ?? []) as Ticket[]) {
    await engine.upsertEntity({
      ref: { type: "ticket", id: tk.id },
      label: tk.title,
      attributes: { status: tk.status, priority: tk.priority },
      updatedAt: tk.created_at,
    });
    if (tk.project_id) {
      await engine.upsertRelationship({ from: { type: "ticket", id: tk.id }, type: "belongs_to", to: { type: "project", id: tk.project_id } });
    }
  }
}

/**
 * Sibling to `syncFromSupabase` (not a change to it — a separate, additive
 * sync for Orbit Intelligence's "everything related to a task" / "summarize
 * today" questions, see docs/architecture/orbit-intelligence.md) — time
 * entries as entities, linked to their task and/or project.
 */
export async function syncTimeEntries(engine: KnowledgeEngine): Promise<void> {
  const { data: entries } = await supabase.from("time_entries").select("*");
  for (const e of (entries ?? []) as TimeEntry[]) {
    await engine.upsertEntity({
      ref: { type: "time_entry", id: e.id },
      label: `${Math.round(e.seconds / 60)}m`,
      attributes: { seconds: e.seconds, startedAt: e.started_at, endedAt: e.ended_at },
      updatedAt: e.created_at,
    });
    if (e.project_id) {
      await engine.upsertRelationship({ from: { type: "time_entry", id: e.id }, type: "belongs_to", to: { type: "project", id: e.project_id } });
    }
    if (e.task_id) {
      await engine.upsertRelationship({ from: { type: "time_entry", id: e.id }, type: "belongs_to", to: { type: "task", id: e.task_id } });
    }
  }
}

/**
 * Transitional direct-read population for integration status — see
 * docs/architecture/orbit-intelligence.md's "Which integrations are
 * failing?" section. The Integration Engine's `integrationEventMapper`
 * already covers this via real domain events, but that path is only
 * populated when (a) the `domain_events` migration has been applied live and
 * (b) a status check has actually run recently — neither is guaranteed yet.
 * This calls the same browser-side status helpers Settings' setup panels
 * already use (`fetchGithubStatus` etc.) and upserts the same shape
 * `integrationEventMapper` produces, so a caller reading `type: "integration"`
 * entities can't tell which path populated them. Documented as a stopgap:
 * remove once the event-sourced path is reliably live.
 */
export async function syncIntegrationStatus(engine: KnowledgeEngine): Promise<void> {
  const checks: [string, () => Promise<{ connected: boolean; account: string | null; error?: string }>][] = [
    ["github", fetchGithubStatus],
    ["gitlab", fetchGitlabStatus],
    ["azuredevops", fetchAzureDevopsStatus],
  ];
  await Promise.all(checks.map(async ([id, check]) => {
    const status = await check().catch((e: Error) => ({ connected: false, account: null, error: e.message }));
    await engine.upsertEntity({
      ref: { type: "integration", id },
      label: id,
      attributes: { connected: status.connected, status: status.connected ? "connected" : "disconnected", account: status.account, error: status.error ?? null },
      updatedAt: new Date().toISOString(),
    });
  }));
}
