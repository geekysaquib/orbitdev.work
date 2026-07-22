# AI Mode

## Purpose

An opt-in, AI-native view of your work at `/ai-mode`, reachable from nav alongside Intelligence. What's running, what's due, what Orbit noticed on its own, and a direct line to ask it anything — without a single new engine or duplicated query.

**This is not the default landing page.** An earlier pass of this milestone built it as `/home` and made it the post-login default, replacing `/app`'s redirect target. That was reverted: `/app` (`Dashboard.tsx`, the existing ops/launcher dashboard — Zoho hours, Docker, project "bays") remains the default landing page, unchanged, exactly as it was before this milestone. AI Mode ships instead as a secondary, opt-in module — the same footing as Orbit Intelligence — not a replacement for the primary landing experience.

## What's reused vs. what's new

| Section | Powered by | Reuse |
|---|---|---|
| Active timer | `readTimer()`/`stopTimer()`/`TIMER_EVENT` (`src/lib/timer.ts`) | as-is, same primitives `Dashboard.tsx`/`TimeTracking.tsx` already use |
| My tasks | `src/lib/myWork.ts`, over `knowledge.query({type:"task"})` | new pure module — no "my tasks" query existed anywhere before this |
| Orbit Insights | `runInsights()` (`src/lib/insights.ts`) | as-is, condensed to the top 4 |
| Ask Orbit | `AskOrbitPanel` (shared component) | extracted-for-reuse, not duplicated |
| Recent activity | `fetchAuditLog()` (`src/lib/audit.ts`) | as-is |

No new engine, no new table, no new Supabase reads that bypass the Knowledge Engine where the graph already had the answer.

## The extraction: `/intelligence`'s pieces became shared components

This part of the original plan stands regardless of where the new page lives. The mission was explicit that this shouldn't duplicate logic already in `Intelligence.tsx`, and that it should feel like a natural home of Orbit Intelligence — ruling out linking out to `/intelligence` for the Ask Orbit experience. `InsightRow`, `EvidenceDisclosure`, `AnswerDetail`, and the Ask Orbit bar+thread were extracted, verbatim, out of `Intelligence.tsx` with zero behavior change there:

- **`src/lib/askOrbit.ts`** — `QuestionId`, `PromptDef`, `AskOrbitTurn`, `PROMPTS`, `runPrompt()`, `matchPrompt()`, `deriveRecommendation()`.
- **`src/components/EvidenceDisclosure.tsx`** — the collapsed-by-default evidence list + `attrList()` formatter.
- **`src/components/AnswerDetail.tsx`** — one answered turn's summary + CTA + evidence.
- **`src/components/InsightRow.tsx`** — one proactive insight's row, plus `SEVERITY_COLOR`/`SEVERITY_LABEL`.
- **`src/components/AskOrbitPanel.tsx`** — the stateful bar/chips/param-select/conversation-thread, taking `{knowledge, projects, tasks, turns, onTurnsChange}`.
- **`src/hooks/useKnowledgeBootstrap.ts`** — the mount-time sync effect (`syncTimeEntries`/`syncIntegrationStatus`, then load `project`/`task` entities), shared by `Intelligence.tsx` and `AiMode.tsx`.

`Intelligence.tsx` is a thin composition of `<InsightRow>`/`<AskOrbitPanel>` — not rewritten, just no longer the sole owner of logic `AiMode.tsx` also needs.

`src/routes/Insights.tsx` (`StatTile`/`ProjectHealthCard`, the project-health-score page — distinct from `src/lib/insights.ts`) needed no changes.

## `src/lib/myWork.ts`

```ts
myOpenTasks(tasks, userId)        // attributes.userId === userId && status !== "done"
myOverdueTasks(tasks, userId, now?)
sortByUrgency(tasks)              // overdue first, then soonest-due, undated last
```

Operates on `attributes.userId`/`.dueDate`/`.status`, already synced by `syncFromSupabase()` since the Orbit Insights milestone. Overdue semantics (`days < 0`) match `Tasks.tsx`'s existing `dueLabel()`.

## `/ai-mode` page structure (`src/routes/AiMode.tsx`)

Greeting header (name, date, quick open/overdue counts) → active timer + insight-count stat → My tasks (combined list, overdue sorted to the top) → Orbit Insights (top 4, "See all in Orbit Intelligence" link for the rest) → Ask Orbit, embedded in full → Recent activity (last 5 audit entries).

## Routing & nav (current state, post-revert)

- `/app` → `Dashboard.tsx`, the default landing page, **unchanged** — nav label back to "Dashboard", primary rail position.
- `/ai-mode` → `AiMode.tsx`, a secondary nav entry (icon `cpu`) in the "Time & more" group, next to "Intelligence" (icon `sparkles`).
- The signup/login/verify/onboarding redirect chain (`Login.tsx`, `VerifyEmail.tsx`, `Onboarding.tsx`, `GetStarted.tsx`) defaults to `/app`, as it always did.
- `CommandPalette.tsx`/`Presence.tsx` reflect the same: "Dashboard" (`/app`) + "AI Mode" (`/ai-mode`).

## What this milestone did not touch

- No new engine, no new table/migration.
- `src/engines/*`, `src/runtime/*` — untouched.
- `/app`/`Dashboard.tsx` — completely unchanged, including as the default landing page.
- `src/routes/Insights.tsx` (project health), `src/lib/askContext.ts`/Ask AI — unrelated, unchanged.

## Deferred, with reasons

- **Recent commits/PRs feed** — no cross-project aggregator exists anywhere in the codebase (only per-repo fetchers).
- **Workspace health tile** — already visible in three places (Dashboard's donut, `/health`, and indirectly via the `broken-integration` insight).
- **"Suggested next actions" as a standalone section** — `deriveRecommendation()` already surfaces a contextual CTA per answered question for free.

## Verification

`src/lib/myWork.test.ts` (9 tests). No new tests for the verbatim extractions — their correctness is that `/intelligence`'s existing behavior is unchanged, guarded by the full existing suite (140 tests total) plus `tsc -b` catching any prop-shape drift. `npm run build` confirms both `/intelligence` and `/ai-mode`'s lazy chunks share the extracted code rather than duplicating it.

No click-through/browser verification available in this session — `/intelligence` should be manually smoke-tested and `/ai-mode` exercised (timer stop button, embedded Ask Orbit flow, nav) before treating this as done.
