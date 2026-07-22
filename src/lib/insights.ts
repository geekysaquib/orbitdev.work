/**
 * Orbit Insights — proactive analysis over the Knowledge Graph. Nine
 * deterministic detectors, each a pure function over `KnowledgeEngine` reads
 * (see docs/architecture/orbit-insights.md for the full design, including
 * two findings that shape every detector: `Entity.updatedAt` isn't a
 * reliable "last activity" signal today — it's set to creation time by
 * `knowledgeSync.ts`'s bootstrap sync — so recency here always comes from
 * real domain timestamps (`time_entry.startedAt`, `task.completedAt`), never
 * the entity envelope; and the graph already contains RLS-visible
 * team-shared teammates' data, just not attributed to a user/team until this
 * milestone's small `knowledgeSync.ts` addition).
 *
 * A module, not an engine — same footing as `src/lib/intelligence.ts`,
 * which three of these detectors wrap directly rather than reimplementing.
 */
import type { KnowledgeEngine, Entity, EntityRef, Relationship } from "../engines/knowledge";
import { failingIntegrations, staleActiveProjects, summarizeToday } from "./intelligence";
import { fetchSettings, saveSettings } from "./settings";

export type InsightSeverity = "info" | "warning" | "critical";

export interface Insight {
  id: string;
  detectorId: string;
  severity: InsightSeverity;
  title: string;
  summary: string;
  /** The entity (real or synthetic — see e.g. overloaded-developer's `{type:"user"}` ref) this insight is primarily about. Used for navigation and as the dismissal key's basis. */
  subject: EntityRef;
  /** Evidence — same shape `IntelligenceAnswer` already uses. */
  entities: Entity[];
  relationships: Relationship[];
  detectedAt: string;
  /** Reserved for a future AI Engine pass — deliberately unpopulated this milestone, same "defined, not implemented" posture as the Knowledge Engine's EmbeddingProvider/SearchProvider. */
  explanation?: string;
  /** Filled in by `runInsights()` from the caller's dismissal state — never set by a detector itself. */
  dismissed?: boolean;
}

export interface InsightDetector {
  id: string;
  run(knowledge: KnowledgeEngine): Promise<Insight[]>;
}

const DAY_MS = 86_400_000;

function insightId(detectorId: string, subject: EntityRef): string {
  return `${detectorId}:${subject.type}:${subject.id}`;
}

function fmtHours(seconds: number): string {
  const h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

/** Most recent real activity timestamp under a project — task completion or logged time — never `Entity.updatedAt` (see file header). */
async function lastProjectActivity(knowledge: KnowledgeEngine, projectRef: EntityRef): Promise<string | null> {
  const related = await knowledge.related(projectRef, { direction: "in" });
  let latest: string | null = null;
  for (const { entity } of related) {
    const candidates: unknown[] = entity.ref.type === "task"
      ? [entity.attributes.completedAt]
      : entity.ref.type === "time_entry"
      ? [entity.attributes.startedAt, entity.attributes.endedAt]
      : [];
    for (const c of candidates) {
      if (typeof c === "string" && (!latest || c > latest)) latest = c;
    }
  }
  return latest;
}

// ---- Dismissal (durable, cross-device, via the existing user_settings blob — no new table) ----

export async function loadDismissedIds(): Promise<Set<string>> {
  const settings = await fetchSettings();
  return new Set(settings.dismissed_insight_ids ?? []);
}

export async function dismissInsight(id: string): Promise<void> {
  const dismissed = await loadDismissedIds();
  dismissed.add(id);
  await saveSettings({ dismissed_insight_ids: [...dismissed] });
}

export async function undismissInsight(id: string): Promise<void> {
  const dismissed = await loadDismissedIds();
  dismissed.delete(id);
  await saveSettings({ dismissed_insight_ids: [...dismissed] });
}

// ---- Detectors ----

/** Wraps `failingIntegrations()` — near-direct reuse, no reimplementation. */
const brokenIntegration: InsightDetector = {
  id: "broken-integration",
  async run(knowledge) {
    const answer = await failingIntegrations(knowledge);
    return answer.entities.filter((e) => !e.attributes.connected).map((integration): Insight => ({
      id: insightId("broken-integration", integration.ref),
      detectorId: "broken-integration",
      severity: "warning",
      title: `${integration.label} is disconnected`,
      summary: integration.attributes.error ? `${integration.label}: ${integration.attributes.error}` : `${integration.label} needs to be reconnected.`,
      subject: integration.ref,
      entities: [integration],
      relationships: [],
      detectedAt: new Date().toISOString(),
    }));
  },
};

/** Wraps `staleActiveProjects()` directly — same live-commit-check logic, not reimplemented. */
const idleRepository: InsightDetector = {
  id: "idle-repository",
  async run(knowledge) {
    const answer = await staleActiveProjects(knowledge);
    return answer.entities.map((project): Insight => ({
      id: insightId("idle-repository", project.ref),
      detectorId: "idle-repository",
      severity: "warning",
      title: `${project.label} has no recent commits`,
      summary: `${project.label} has in-progress tasks but no commit activity in the last week.`,
      subject: project.ref,
      entities: [project],
      relationships: [],
      detectedAt: new Date().toISOString(),
    }));
  },
};

/**
 * Gated to fire only after local midday, to avoid a false "nothing done" at
 * 8am. Subject is synthetic (`{type:"day", id: <today's date>}`, not a real
 * graph entity) so dismissing today's instance doesn't dismiss tomorrow's —
 * each day gets its own id.
 */
const missingDailyWork: InsightDetector = {
  id: "missing-daily-work",
  async run(knowledge) {
    const now = new Date();
    if (now.getHours() < 13) return [];
    const answer = await summarizeToday(knowledge);
    if (answer.entities.length > 0) return [];
    const subject: EntityRef = { type: "day", id: now.toISOString().slice(0, 10) };
    return [{
      id: insightId("missing-daily-work", subject),
      detectorId: "missing-daily-work",
      severity: "info",
      title: "No work logged today yet",
      summary: "No tasks completed and no time logged so far today.",
      subject,
      entities: [],
      relationships: [],
      detectedAt: now.toISOString(),
    }];
  },
};

const STALE_PROJECT_DAYS = 14;

const staleProject: InsightDetector = {
  id: "stale-project",
  async run(knowledge) {
    const projects = await knowledge.query({ type: "project" });
    const cutoff = Date.now() - STALE_PROJECT_DAYS * DAY_MS;
    const insights: Insight[] = [];
    for (const project of projects) {
      if (project.attributes.status !== "active") continue;
      const last = await lastProjectActivity(knowledge, project.ref);
      if (last && new Date(last).getTime() >= cutoff) continue;
      insights.push({
        id: insightId("stale-project", project.ref),
        detectorId: "stale-project",
        severity: "warning",
        title: `${project.label} has gone quiet`,
        summary: last
          ? `No time logged or tasks completed on ${project.label} in over ${STALE_PROJECT_DAYS} days.`
          : `${project.label} has no logged activity yet.`,
        subject: project.ref,
        entities: [project],
        relationships: [],
        detectedAt: new Date().toISOString(),
      });
    }
    return insights;
  },
};

const DECLINE_MIN_PRIOR_SECONDS = 3600; // at least an hour last week, or a "decline" from near-zero is just noise
const DECLINE_RATIO = 0.5;

function sumSecondsInWindow(entries: Entity[], from: number, to: number): number {
  let total = 0;
  for (const e of entries) {
    const started = e.attributes.startedAt as string | undefined;
    if (!started) continue;
    const t = new Date(started).getTime();
    if (t >= from && t < to) total += Number(e.attributes.seconds) || 0;
  }
  return total;
}

const decliningProjectActivity: InsightDetector = {
  id: "declining-project-activity",
  async run(knowledge) {
    const projects = await knowledge.query({ type: "project" });
    const now = Date.now();
    const insights: Insight[] = [];
    for (const project of projects) {
      if (project.attributes.status !== "active") continue;
      const related = await knowledge.related(project.ref, { direction: "in" });
      const entries = related.filter((r) => r.entity.ref.type === "time_entry").map((r) => r.entity);
      const thisWeek = sumSecondsInWindow(entries, now - 7 * DAY_MS, now);
      const lastWeek = sumSecondsInWindow(entries, now - 14 * DAY_MS, now - 7 * DAY_MS);
      if (lastWeek < DECLINE_MIN_PRIOR_SECONDS || thisWeek >= lastWeek * DECLINE_RATIO) continue;
      insights.push({
        id: insightId("declining-project-activity", project.ref),
        detectorId: "declining-project-activity",
        severity: "info",
        title: `${project.label}'s activity is slowing down`,
        summary: `Time logged dropped from ${fmtHours(lastWeek)} last week to ${fmtHours(thisWeek)} this week.`,
        subject: project.ref,
        entities: [project, ...entries],
        relationships: [],
        detectedAt: new Date().toISOString(),
      });
    }
    return insights;
  },
};

const STUCK_TASK_DAYS = 10;
const STUCK_TASK_CRITICAL_DAYS = 30;

/**
 * No "blocked" status exists in Orbit's task model (todo/doing/review/done
 * only) — reframed to "no recorded update in N+ days." Uses `Entity.updatedAt`
 * deliberately here (the one detector that does): for a task that's had a
 * `task-workflow.status_changed` event since the Event Engine milestone,
 * this is accurate; for one that hasn't, it falls back to creation time,
 * which — while not literally "when did status change" — still correctly
 * signals "nothing recorded has happened to this task," a fair proxy that
 * gets more accurate over time as more events accumulate.
 */
const stuckTask: InsightDetector = {
  id: "stuck-task",
  async run(knowledge) {
    const tasks = await knowledge.query({ type: "task" });
    const now = Date.now();
    const insights: Insight[] = [];
    for (const task of tasks) {
      if (task.attributes.status === "done") continue;
      const days = (now - new Date(task.updatedAt).getTime()) / DAY_MS;
      if (days < STUCK_TASK_DAYS) continue;
      insights.push({
        id: insightId("stuck-task", task.ref),
        detectorId: "stuck-task",
        severity: days >= STUCK_TASK_CRITICAL_DAYS ? "critical" : "warning",
        title: `${task.label} hasn't moved in ${Math.round(days)} days`,
        summary: `Still ${task.attributes.status}, with no recorded update in over ${Math.round(days)} days.`,
        subject: task.ref,
        entities: [task],
        relationships: [],
        detectedAt: new Date().toISOString(),
      });
    }
    return insights;
  },
};

const LONG_ENTRY_SECONDS = 6 * 3600;

/**
 * "Stale timers" reframed: whether a timer is *currently* running is
 * browser-local (`localStorage`) state, never synced anywhere — not
 * knowable from the graph at all. The only computable proxy is an
 * already-logged time entry that's unusually long, which often means a
 * timer was left running instead of stopped. Flagged as a proxy, not a
 * claim of certainty.
 */
const longRunningTimeEntry: InsightDetector = {
  id: "long-running-time-entry",
  async run(knowledge) {
    const entries = await knowledge.query({ type: "time_entry" });
    return entries.filter((e) => (Number(e.attributes.seconds) || 0) >= LONG_ENTRY_SECONDS).map((entry): Insight => ({
      id: insightId("long-running-time-entry", entry.ref),
      detectorId: "long-running-time-entry",
      severity: "info",
      title: `A ${fmtHours(Number(entry.attributes.seconds))} time entry looks unusual`,
      summary: "This might mean a timer was left running instead of stopped — worth a check.",
      subject: entry.ref,
      entities: [entry],
      relationships: [],
      detectedAt: new Date().toISOString(),
    }));
  },
};

const OVERLOAD_MIN_TASKS = 8;
const OVERLOAD_RATIO = 2;

/**
 * "Developer" = task owner (`task.attributes.userId`, added to the sync in
 * this milestone). Only counts tasks visible to the signed-in user (their
 * own, plus teammates' team-shared tasks — RLS already allows this, see
 * docs/architecture/orbit-insights.md) — not a full-org view, and private
 * tasks of teammates correctly stay invisible.
 */
const overloadedDeveloper: InsightDetector = {
  id: "overloaded-developer",
  async run(knowledge) {
    const tasks = await knowledge.query({ type: "task" });
    const byUser = new Map<string, Entity[]>();
    for (const t of tasks) {
      if (t.attributes.status === "done") continue;
      const uid = t.attributes.userId as string | null | undefined;
      if (!uid) continue;
      const list = byUser.get(uid) ?? [];
      list.push(t);
      byUser.set(uid, list);
    }
    if (byUser.size < 2) return [];
    const counts = [...byUser.values()].map((l) => l.length);
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    const insights: Insight[] = [];
    for (const [uid, list] of byUser) {
      if (list.length < OVERLOAD_MIN_TASKS || list.length < avg * OVERLOAD_RATIO) continue;
      const subject: EntityRef = { type: "user", id: uid };
      insights.push({
        id: insightId("overloaded-developer", subject),
        detectorId: "overloaded-developer",
        severity: "warning",
        title: `One teammate has ${list.length} open tasks`,
        summary: `${list.length} open tasks — well above the visible team average of ${Math.round(avg)}. Based only on tasks visible to you (your own, plus team-shared).`,
        subject,
        entities: list,
        relationships: [],
        detectedAt: new Date().toISOString(),
      });
    }
    return insights;
  },
};

const TEAM_STALE_DAYS = 14;

/** Only teams with at least one team-shared project are evaluable — a team with none isn't flagged, not because it's healthy, but because there's nothing to measure. */
const teamNoUpdates: InsightDetector = {
  id: "team-no-updates",
  async run(knowledge) {
    const projects = await knowledge.query({ type: "project" });
    const byTeam = new Map<string, Entity[]>();
    for (const p of projects) {
      const tid = p.attributes.teamId as string | null | undefined;
      if (!tid) continue;
      const list = byTeam.get(tid) ?? [];
      list.push(p);
      byTeam.set(tid, list);
    }
    const cutoff = Date.now() - TEAM_STALE_DAYS * DAY_MS;
    const insights: Insight[] = [];
    for (const [tid, teamProjects] of byTeam) {
      let latest: string | null = null;
      for (const p of teamProjects) {
        const last = await lastProjectActivity(knowledge, p.ref);
        if (last && (!latest || last > latest)) latest = last;
      }
      if (latest && new Date(latest).getTime() >= cutoff) continue;
      const subject: EntityRef = { type: "team", id: tid };
      insights.push({
        id: insightId("team-no-updates", subject),
        detectorId: "team-no-updates",
        severity: "warning",
        title: "A team has gone quiet",
        summary: latest
          ? `No activity across this team's shared projects in over ${TEAM_STALE_DAYS} days.`
          : "This team's shared projects have no logged activity yet.",
        subject,
        entities: teamProjects,
        relationships: [],
        detectedAt: new Date().toISOString(),
      });
    }
    return insights;
  },
};

const DETECTORS: InsightDetector[] = [
  brokenIntegration, idleRepository, missingDailyWork,
  staleProject, decliningProjectActivity,
  stuckTask, longRunningTimeEntry,
  overloadedDeveloper, teamNoUpdates,
];

const SEVERITY_RANK: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2 };
function bySeverityThenDate(a: Insight, b: Insight): number {
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.detectedAt.localeCompare(a.detectedAt);
}

/**
 * Runs every detector, tags each result with the caller's current dismissal
 * state, and sorts by severity then recency. One detector throwing never
 * blocks the others (`Promise.allSettled`) — always returns the *full* set,
 * dismissed included, so a caller can offer a "show dismissed" view without
 * a second query; filter on `.dismissed` for the default view.
 */
export async function runInsights(knowledge: KnowledgeEngine): Promise<Insight[]> {
  const dismissedIds = await loadDismissedIds();
  const results = await Promise.allSettled(DETECTORS.map((d) => d.run(knowledge)));
  const all = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return all.map((insight) => ({ ...insight, dismissed: dismissedIds.has(insight.id) })).sort(bySeverityThenDate);
}
