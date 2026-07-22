# Orbit Insights

## Purpose

Everything built through Orbit Intelligence answers questions when asked. This milestone makes Orbit notice things on its own: a background analysis pass over the Knowledge Graph that surfaces a deterministic, evidenced, dismissible, severity-ranked list of things worth a look — with **no new engine, no new table, no new infrastructure**. `src/lib/insights.ts` is a module, not an engine, on the same footing as `src/lib/intelligence.ts` — three of its nine detectors wrap that file's functions directly rather than reimplementing them.

See the milestone's architecture proposal (session plan history) for the full reuse survey this was scoped from. This doc records what was actually built.

## Two findings that shape every detector's design

1. **`Entity.updatedAt` is not a reliable "last activity" signal.** `syncFromSupabase` (`src/lib/knowledgeSync.ts`) sets it to `created_at` for both projects and tasks — not last-modified. It only becomes accurate for a task once a `task-workflow` event has touched it since the Event Engine Adoption milestone. Every detector below computes recency from **real domain timestamps on real attributes** (`time_entry.startedAt`, `task.completedAt`) via a shared `lastProjectActivity()` helper — never from the entity envelope's `updatedAt` — the same discipline `staleActiveProjects()` and `summarizeToday()` already use. The one deliberate exception is `stuck-task`, which does use `updatedAt` — see its entry below.
2. **The Knowledge Graph already contains RLS-visible teammate data, just not attributed.** `tasks`/`projects`' RLS policy (`select: owner or team member`, `supabase/schema.sql`) means `syncFromSupabase`'s plain `select("*")` already returns teammates' team-shared tasks/projects, not just the signed-in user's own. Neither `user_id` nor `team_id` was captured as a graph attribute before this milestone, so "whose task is this" and "which team does this belong to" weren't queryable. Private (non-team-shared) tasks of teammates correctly stay invisible — that's the privacy boundary working as intended, not a gap this milestone closes or needs to.

## The one small additive sync extension

`syncFromSupabase` (`src/lib/knowledgeSync.ts`) gained two attribute fields, same non-breaking pattern as prior milestones' enrichments — nothing read these before, so nothing could regress:
- Task entity attributes: `userId: t.user_id`, `teamId: t.team_id`.
- Project entity attributes: `teamId: p.team_id`.

This unlocks per-developer and per-team grouping for `overloaded-developer` and `team-no-updates`. Every other detector needed zero backend change.

## Core module (`src/lib/insights.ts`)

```ts
export type InsightSeverity = "info" | "warning" | "critical";

export interface Insight {
  id: string;                 // deterministic: `${detectorId}:${subject.type}:${subject.id}` — stable across re-runs, what dismissal keys on
  detectorId: string;
  severity: InsightSeverity;
  title: string;
  summary: string;
  subject: EntityRef;         // primary entity this is about — navigation + dismissal key basis
  entities: Entity[];         // evidence, same shape IntelligenceAnswer already uses
  relationships: Relationship[];
  detectedAt: string;
  explanation?: string;       // reserved for a future AI Engine pass — unpopulated this milestone
  dismissed?: boolean;        // filled in by runInsights() from the caller's dismissal state, never set by a detector
}

export interface InsightDetector { id: string; run(knowledge: KnowledgeEngine): Promise<Insight[]>; }

export async function runInsights(knowledge: KnowledgeEngine): Promise<Insight[]>;
export async function dismissInsight(id: string): Promise<void>;
export async function undismissInsight(id: string): Promise<void>;
export async function loadDismissedIds(): Promise<Set<string>>;
```

`runInsights()` runs all nine detectors via `Promise.allSettled` — one detector throwing never blocks the others — tags every result with the caller's current dismissal state, and sorts by severity then recency. It always returns the full set, dismissed included, so a caller can offer a "show dismissed" view without a second query.

`OrbitSettings` (`src/lib/settings.ts`) gained `dismissed_insight_ids?: string[]` — reusing the already-durable, already-atomic, cross-device `user_settings` blob (`fetchSettings`/`saveSettings`, server-side merge via `merge_user_settings`). No new table or migration. Dismissal is permanent until manually undone — no auto-expiry in v1, a deliberate simplification, not an oversight.

## The nine detectors

| Detector | Reuses | Reframing (if any) | Severity |
|---|---|---|---|
| `broken-integration` | wraps `failingIntegrations()` directly | none | warning |
| `idle-repository` | wraps `staleActiveProjects()` directly (same live-commit-check logic) | none | warning |
| `missing-daily-work` | reuses `summarizeToday()`'s data shape | Gated to fire only after local midday, to avoid a false "nothing done" at 8am. Subject is synthetic (`{type:"day", id: today}`), so each day gets its own dismissal id | info |
| `stale-project` | new — `lastProjectActivity()` helper | none | warning |
| `declining-project-activity` | new — compares this-week vs. last-week `time_entry` totals per active project | none | info |
| `stuck-task` ("blocked tasks") | none | No "blocked" status exists in Orbit's task model (`todo`/`doing`/`review`/`done` only). Reframed to non-`done` tasks with no recorded update (via `Entity.updatedAt`, the one detector that deliberately uses it) in 10+ days — accuracy improves over time as more `task-workflow.status_changed` events accumulate | warning (30+ days → critical) |
| `long-running-time-entry` ("stale timers") | none | Whether a timer is *currently running* is browser-local (`localStorage`) state, never synced anywhere — not knowable from the graph at all. Reframed to its only computable proxy: an already-logged `time_entry` of 6+ hours, which often means a timer was left running instead of stopped. Flagged as a proxy, not a claim of certainty | info |
| `overloaded-developer` | new — groups open tasks by `userId` (needs the sync extension above) | "Developer" = task owner across tasks *visible to the signed-in user* (own + team-shared, per RLS) — explicitly not a full-org view | warning |
| `team-no-updates` | new — groups projects by `teamId` (needs the sync extension above), reuses `lastProjectActivity()` | Only teams with at least one team-shared project are evaluable — a team with none isn't flagged, not because it's healthy, but because there's nothing to measure | warning |

## UI integration (`src/routes/Intelligence.tsx`)

The old hardcoded 3-card row (Integrations / Project risk / Today) is **superseded, not duplicated** — `broken-integration`/`idle-repository`/`missing-daily-work` already cover that exact ground as three of the nine detectors. `runInsights()` now runs once on mount (alongside the existing lazy `syncTimeEntries`/`syncIntegrationStatus`), rendering one `InsightRow` per returned `Insight`, sorted by severity then recency. Each row expands into the same `EvidenceDisclosure` component `AnswerDetail` already used — `Insight` is a superset of the `{summary, entities}` shape that component operates on, so no new rendering logic was needed — plus a **Dismiss**/**Restore** button and a **"Show N dismissed"** toggle. The "Ask Orbit" prompt bar and conversation thread (`src/lib/intelligence.ts`'s five curated questions) are unchanged.

## What this milestone did not touch

- No new engine — `insights.ts` sits next to `intelligence.ts` as a module, same footing.
- No new tables or migrations — dismissal reuses `user_settings`, already provisioned.
- `src/engines/*`, `src/runtime/*`, the Event Engine's mappers — untouched.
- `syncFromSupabase`'s existing behavior for every current consumer — unaffected; the new attributes are additive.
- `src/lib/askContext.ts`, `src/lib/askActions.ts`, `src/components/AskAiModal.tsx` — today's Ask AI, unrelated and unchanged.

## Known limitations (by design, not oversight)

- No live "is a timer running right now" detection — see `long-running-time-entry`'s reframing above.
- No literal "blocked" task status — see `stuck-task`'s reframing above.
- `overloaded-developer`/`team-no-updates` only see what RLS already exposes to the signed-in user — not a full-org admin view. Building that would need a real cross-user query surface, which is out of scope here.
- `explanation` on `Insight` is defined but never populated — reserved for a future AI Engine pass that turns a detected insight into a written explanation, same "defined, not implemented" posture as the Knowledge Engine's `EmbeddingProvider`/`SearchProvider`.
- No live click-through testing available to this agent (same standing limitation as every prior UI milestone) — the user should verify dismissal persists across a reload once deployed.
