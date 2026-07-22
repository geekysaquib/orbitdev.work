# Orbit Intelligence

## Purpose

The first end-to-end feature built on the platform (AI Engine, Integration Engine, Event Engine, Knowledge Engine, Orbit Runtime) rather than adding another piece of infrastructure. A user can ask a small, fixed set of questions about their workspace, and Orbit answers **directly from the Knowledge Engine's graph** — deterministic queries, not an LLM guessing over forwarded data. Every answer shows the actual entities/relationships it was computed from as evidence.

See the milestone's architecture proposal (in the session's plan history) for the full what-exists/what's-missing/risk analysis this was scoped from. This doc records what was actually built.

## Why five questions, not ten, and not free text

The full example question list mixes questions with very different infrastructure dependencies. Some ("Explain this project," "which integrations are failing") are answerable today with real evidence; others ("why is Sprint 23 delayed," "what changed yesterday") need change-history events that don't exist yet — nothing in Orbit publishes a domain event when a task or ticket is created or updated. Answering those now would mean silently guessing, which is exactly what this architecture exists to prevent. So v1 ships five curated questions, each backed by a dedicated, hand-written query function — not a general free-text classifier. **No open text box exists in this UI** — every question is a fixed template, deliberately, so nothing implies a broader capability than what's actually reliable.

## The five questions (`src/lib/intelligence.ts`)

| Question | Function | Data source |
|---|---|---|
| Explain this project | `explainProject(knowledge, projectId)` | Graph only — `getEntity` + `related(direction:"in")` |
| Show everything related to a task | `relatedToTask(knowledge, taskId)` | Graph only — `related()` both directions |
| Which integrations are failing? | `failingIntegrations(knowledge)` | Graph only — `query({type:"integration"})` |
| Summarize today's work | `summarizeToday(knowledge)` | Graph only — `query()` filtered to today (local day) |
| Active projects with no recent commits | `staleActiveProjects(knowledge)` | Graph (projects/tasks) + one transitional live call per repo-linked project |

Every function is **deterministic**: same graph in, same answer out. Four of the five never leave the Knowledge Engine at query time — no LLM call, no network request, no risk of a wrong "supporting fact." The fifth (`staleActiveProjects`) is the one place this milestone genuinely needs to look outside the graph — see Transitional reads below.

**"Which tasks have no commits?" was narrowed.** Orbit has no commit-to-task linkage anywhere (no commit-message-to-task-id matching exists) — a literal answer isn't knowable with current data. `staleActiveProjects` instead flags repo-linked projects that have in-progress tasks but no commit activity in the last 7 days — a real, honest, useful signal (the same shape as `projectHealth.ts`'s existing "staleness" score), not a claim about individual tasks.

## Evidence, not citation

Every `IntelligenceAnswer` carries `{ summary, entities, relationships }`. The UI (`src/routes/Intelligence.tsx`) always renders the `entities` list beneath the summary, grouped by type, with their key attributes — this is the literal data the summary was built from, not an LLM's after-the-fact claim about what it consulted (compare to Ask AI's `orbit-actions` fence + `ActionIndex` validation, a different but analogous "don't trust unvalidated model output" mechanism — see `src/lib/askActions.ts`, untouched by this milestone). Since nothing here is LLM-generated, there's nothing to hallucinate or validate against an index — the evidence *is* the answer's derivation.

## Knowledge Engine population

`src/lib/knowledgeSync.ts`:
- `syncFromSupabase()` (existing, from the Knowledge Engine milestone) — **enriched, not replaced**: project entities now also carry `repoProvider`/`repoFullName`/`repoDefaultBranch`; task entities now also carry `completedAt`. Both are additive attribute-bag fields (attributes are typed as an open `Record<string, unknown>` by design) — nothing consumed this data before this milestone, so there is no existing behavior to break. This is what lets `summarizeToday` and `staleActiveProjects` work purely from the graph instead of each reaching past it with its own direct read.
- `syncTimeEntries()` (new, additive sibling function) — time entries as entities, `belongs_to` project and/or task.
- `syncIntegrationStatus()` (new) — see Transitional reads below.

Both new sync functions run **lazily, once, when `Intelligence.tsx` mounts** — not folded into Orbit Runtime's global `start()` sync, which stays exactly as scoped in the Runtime milestone (projects/tasks/tickets only). This keeps every other authenticated page's load cost unchanged; only visiting `/intelligence` pays for the extra sync.

## Transitional direct reads (both explicitly scoped, both documented in code comments at their definition)

1. **`syncIntegrationStatus()`** calls the same browser-side `fetchGithubStatus()`/`fetchGitlabStatus()`/`fetchAzureDevopsStatus()` helpers Settings' setup panels already use, and upserts entities in the exact same shape `integrationEventMapper` (Knowledge Engine milestone) produces. This exists because the event-sourced path depends on two things that aren't guaranteed yet: the `domain_events` migration being applied live, and a status check having actually run recently server-side. A caller reading `type: "integration"` entities can't tell which path populated them — that's intentional. Remove this function once the event-sourced path is reliably live; it's a stopgap, not a second source of truth.
2. **`staleActiveProjects()`** calls `fetchGithubCommits`/`fetchGitlabCommits`/`fetchAzureDevopsCommits` directly (the same calls `src/lib/projectHealth.ts` already makes for its own "staleness" signal) because commit history isn't graph data — no commit entities or CI/CD capability exists in the Knowledge Engine yet (see `docs/architecture/integration-engine.md`'s migration strategy, which already named this as future work before this milestone).

## What this milestone did not touch

- `src/lib/askContext.ts`, `src/lib/askActions.ts`, `src/components/AskAiModal.tsx` — today's Ask AI, unchanged.
- `daily-brief.ts`, `anomaly-scan.ts`, ticket auto-triage — the existing proactive-AI layer, unrelated and unchanged.
- Any of the five engines' public APIs — `KnowledgeEngine`, `EventEngine`, `IntegrationRegistry`, `AIRouter`, `OrbitRuntime` are used exactly as they already were; nothing here required a new method or a signature change.
- Task/project/ticket mutation call sites — still don't publish domain events. That's the next milestone, not this one (see below).

## Known limitations (by design, not oversight)

- Deferred from v1 entirely: "why is Sprint 23 delayed," "what changed yesterday," "what happened while I was away," "what changed since the last deployment" (need change-history events or deployment entities that don't exist), and "which developer is blocked" (Orbit's task model has an owner, not a distinct assignee — a real product decision, not assumed here).
- "Everything related to a task" does not include tickets, even though tickets and tasks can share a project — confirmed via schema that `tickets.project_id` exists but there is no `tickets.task_id`; the two are siblings under a project, not linked to each other. The UI reflects this precisely rather than implying a connection that isn't real.
- The Knowledge Engine remains in-memory, per browser tab (see the Knowledge Engine doc) — a reload re-runs the sync.

## Migration strategy

Unchanged from the architecture proposal: the next real unlock is publishing domain events from Orbit's own task/ticket/project mutations (its own dedicated milestone — touches many call sites), which is what actually enables the deferred "what changed" questions and lets `syncIntegrationStatus`'s direct-read stopgap be retired in favor of the event-sourced path alone.
