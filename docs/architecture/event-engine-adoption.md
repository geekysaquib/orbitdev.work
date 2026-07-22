# Event Engine Adoption

## Purpose

Before this work, the only thing that ever published a real `DomainEvent` was the Integration Engine's `checkStatus()`. Every actual business mutation in Orbit — creating a task, changing its status, linking a repo, starting a timer, joining a team — went straight from a React component (or a Netlify function) to Supabase, invisible to the Event Engine and therefore to the Knowledge Engine. This work closes that gap: six workflows now publish real domain events, three new Knowledge Engine mappers keep the graph incrementally current, and the Integration Engine's own `EventEntityMapper` contract gained one small, backward-compatible extension (entity deletion) to make `task.deleted` possible.

The full research and design tradeoffs are recorded in the architecture proposal that preceded this implementation (this session's plan history) — this doc records what was actually built, and is the reference every new publish call site's code comments point back to.

## Two findings that reshaped the original example event list

1. **Sprints are 100% read-only from Zoho** — `Sprints.tsx` never creates, starts, or completes a sprint; every call is a GET. "Sprint Created/Started/Completed" aren't things Orbit's own code can author from a mutation the way every other event here is — they'd need a poller diffing Zoho's `status` field, a fundamentally different mechanism. **Deferred entirely, not built.**
2. **"Developer Joined/Left Project" isn't a real concept** — there's no `project_members` table; a project has one owner plus an optional `team_id` for all-or-nothing team sharing, with access derived from `team_members`. Built as `team-workflow` events instead, scoped to teams, not projects.

## Naming convention

Every new event follows the Integration Engine's already-live precedent: `source: "<aggregate>-workflow"` (e.g. `"task-workflow"`), bare-word `type` (e.g. `"created"`, `"status_changed"`). A mapper branches on `event.source` exactly like `integrationEventMapper` already does.

## The critical payload rule: snapshots, not diffs

`KnowledgeStore.upsertEntity()` **fully replaces** an entity — there is no partial merge. This means every publish call site whose event feeds a mapper had to be written to carry every graph-relevant field of the entity, not just what changed, or a mapper upserting from a partial payload would silently drop fields the event didn't mention. Concretely: `task-workflow.status_changed` carries `priority`/`dueDate`/`completedAt` alongside `status`, even though only `status` changed — because a mapper reading that payload builds the *entire* entity from it. This is why several payloads below look more complete than their event name implies; it's deliberate, not scope creep. Every call site that does this has a code comment pointing back here.

Events whose payload can't practically carry the full entity state, or whose changed field isn't modeled in the graph at all (e.g. `task-workflow.shared`, `project-workflow.sprint_linked`), are published for audit/history value but their mapper intentionally ignores them — see each mapper's own doc comment.

## Event catalog (what's actually live)

| Source | Types | Published from |
|---|---|---|
| `task-workflow` | `created`, `status_changed`, `deleted`, `shared` | `Tasks.tsx` (primary UI), `automation.ts`'s `create_task`/`set_task_status` actions, `useVscodeBridge.ts`'s `task:create`/`task:status` |
| `project-workflow` | `created`, `updated`, `deleted`, `repo_linked`, `repo_unlinked`, `sprint_linked`, `sprint_unlinked`, `shared` | `Projects.tsx`, `ProjectDetail.tsx` |
| `ticket-workflow` | `created`, `status_changed`, `updated` | `Tickets.tsx` (`syncZoho()`, `setTicketStatus()`, `applyTriageResult()` — shared by manual and auto-triage), `Mail.tsx`'s ticket-from-email |
| `timer-workflow` | `started`, `stopped` | `src/lib/timer.ts`'s `startTimer()`/`stopTimer()` **themselves** — every current and future call site (`TimeTracking.tsx`, Ask AI's `start_timer` action, the VS Code bridge, automation's `start_timer` action) gets this for free |
| `break-workflow` | `started`, `ended` | `src/context/Break.tsx`'s `startBreak()`/`endBreak()` (not `pauseForIdle`/`resumeFromIdle` — idle-pause is explicitly a different thing from a real break) |
| `team-workflow` | `member_joined`, `member_left`, `member_role_changed` | `netlify/functions/teams.ts` (server-side, via `serverEventEngine`) — `create`/`accept-invite`/`remove-member`/`leave`/`change-role` |

No `sprint-*` events exist — deferred per the finding above.

## Where the `EventEngine` instance comes from

- **React components** (`Tasks.tsx`, `ProjectDetail.tsx`, `Projects.tsx`, `Tickets.tsx`, `Mail.tsx`, `Break.tsx`) use `useOrbitRuntime().events`.
- **Plain lib files with no React context** (`src/lib/timer.ts`, `src/lib/automation.ts`, `src/hooks/useVscodeBridge.ts` — the latter is a hook, but uses the module singleton directly to avoid closure-staleness inside its event-subscription callback) import `orbitRuntime` from `src/runtime` directly — the module-level singleton, usable outside React by design (see `docs/architecture/orbit-runtime.md`).
- **Server-side** (`netlify/functions/teams.ts`) uses `serverEventEngine` from `netlify/functions/_lib/serverEvents.ts` — the same instance the `*-api.ts` proxies already use for Integration Engine events.

All publishing is **fire-and-forget** — `void events.publish(...).catch(() => {})` — never awaited inline, never able to throw into the caller. Same principle `recordAudit()` already documents for itself.

## `DomainEvent.userId` / `.teamId` — envelope, not payload

`domain_events`' RLS grants select to the row's owner (`user_id = auth.uid()`) or a team member (`team_id` match). `task-workflow`/`project-workflow` events set the envelope's `teamId` from the mutated task/project's own `team_id`, so a shared task or project's events are automatically visible to teammates — no new RLS policy needed. `userId` is left unset at most browser call sites (the browser `EventStore` defaults it to the signed-in user, see `src/lib/eventsStore.ts`); `team-workflow` events set it explicitly server-side to the *subject* of the membership change (who joined/left/was re-roled), not necessarily the admin who triggered it — so the affected person can find this in their own event history later via the owner-select policy, even after leaving the team. Tickets have no `team_id` column at all, so `ticket-workflow` events never set one.

## Knowledge Engine changes

- **`EventEntityMapper`** (`src/engines/knowledge/types.ts`) gained an optional `deleteRef?: EntityRef` alongside its existing `entity`/`relationships` — backward compatible, `integrationEventMapper` needed no change.
- **`KnowledgeEngine`** gained a public `deleteEntity()` (thin pass-through to the store, which already had one) and `ingest()` gained one new branch: if a mapper result has `deleteRef`, delete that entity.
- **Three new mappers**, same shape as `integrationEventMapper`: `taskEventMapper`, `projectEventMapper`, `ticketEventMapper` (`src/engines/knowledge/mappers/`). Each documents exactly which event types it acts on and which it deliberately ignores (see each file).
- **`OrbitRuntime.start()`** now subscribes a `MAPPERS` array (four mappers: integration, task, project, ticket) to both local and realtime event delivery, instead of one hardcoded mapper — `unsubscribeLocal` became an array of unsubscribe functions. Adding a future workflow's mapper is a one-line addition to `MAPPERS`; nothing else in `OrbitRuntime` changes.

## Audit gaps closed alongside this work (not a separate pass)

Two mutation moments had no `recordAudit()` call before, discovered while wiring their events: `ProjectDetail.tsx`'s `linkSprint()` (sprint link/unlink) and `Teams.tsx`'s `handleChangeRole()`/`handleLeaveTeam()`. Both now record audit entries (`project.update` with `sprint_link_change: true`, and new `team.change_role`/`team.leave` actions added to `AuditAction`) at the same moment their new events publish.

## What was deliberately left unchanged

- `recordAudit()`, `fireAsync()` (automation's own trigger system), and the Postgres `notify_team_task_activity` trigger — all three keep working exactly as before. New event-publish calls were added *next to* them, never replacing or rewiring them.
- `useTable.ts` — not touched. It's a generic hook shared by 16 files across tables with no clear event story (`notifications`, calendar `events`, `pg_servers`, ...); event publishing lives at the specific Tasks/ProjectDetail/Tickets call sites instead.
- `break_logs` / `BreakView.tsx`'s chore-logging flow — a separate mechanism from the `startBreak`/`endBreak` state machine instrumented here.
- Sprint viewing/velocity (`Sprints.tsx`, `velocity.ts`) — no mutation to hook into; sprint events are deferred, not built.
- All five engines' existing public APIs, beyond the one additive `EventEntityMapper`/`KnowledgeEngine` extension above.

## Verification

`npx vitest run`, `npx tsc -b`, ad hoc `netlify/functions/**` typecheck (for `teams.ts`/`serverEvents.ts`), `npm run build` — the same four-step verification every prior milestone in this session has used. New tests: `taskEvents.test.ts`, `projectEvents.test.ts`, `ticketEvents.test.ts` (mapper behavior, including the "ignores partial-payload event types" cases), plus `OrbitRuntime.test.ts`'s existing coverage extended implicitly by the multi-mapper refactor (its DI-based tests don't need new cases to exercise the array change — they already assert wiring/unwiring behavior generically).

## What's still not covered (future work)

- Sprint events (needs a diff-based watcher, not a mutation hook).
- Commit/PR/deployment-level events (no such entities exist in the Knowledge Engine yet).
- A real "assignee" concept distinct from task ownership.
- Extending `team-workflow` (or any other new source) with a Knowledge Engine mapper — none exists yet because no current Intelligence question needs team/member data in the graph.
