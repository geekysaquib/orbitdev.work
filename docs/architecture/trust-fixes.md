# Trust Fixes — Eliminating Fake User-Facing Features

## Purpose

A product audit flagged rebuilding user trust as the highest priority before public beta: several actions in the app showed success without doing anything. This milestone fixes five specific items. No new engine, no architectural rewrite — every fix reuses an existing function, hook, or established pattern.

## 1. Ticket → Task (`src/routes/Tickets.tsx`)

Was: `onClick={() => toast("Task created from item")}` — did nothing.

Now: `convertToTask()` inserts a real row into `tasks` (via `useTable<Task>("tasks").insert()`, same call shape `Tasks.tsx` uses for task creation), records an audit entry, publishes a `task-workflow.created` event, and persists the link back on `tickets.converted_task_id`. The button becomes "View task" once that column is set — read from the persisted column, not local state, so it survives a reload.

**Why a persistent column, not session-only state:** checked every existing place that creates a task from another entity — `src/lib/automation.ts`'s `create_task` action already does this for ticket-triggered rules and stores no back-reference at all. No reusable linkage mechanism existed anywhere. A single nullable FK is the same shape and risk as every other additive migration already in this codebase (e.g. `projects.sprint_project_id`), so it was implemented for real rather than falling back to a temporary in-memory dedupe.

## 2. Project Quick Actions (`src/routes/ProjectDetail.tsx`)

Was: four buttons, all `toast(`${a} · ${p.name}`)`.

- **"Pull latest"** now calls `doPull()` — the same function already backing the Git tab's real pull button. Pure de-duplication of an already-working action.
- **"Run tests"** now calls `runInProject(p.fe_path, "npm test")` (`src/lib/agent.ts`), the same primitive `ProjectTerminal.tsx` already uses, following the "assume npm at `fe_path`" convention `npmAudit`/`npmOutdated` already use elsewhere (`BreakView.tsx`). Real stdout/exit code shown via toast, gated on the agent being online and `fe_path` being set.
- **"Docker compose up"** and **"Deploy to Netlify"** are now disabled buttons with an explanatory tooltip. Neither has project-scoped data to act on (no compose-file or Netlify-site field exists on `Project`), and adding one would be new feature work, not a fake-button fix.

## 3. Project Notes (`src/routes/ProjectDetail.tsx`)

Was: a bare `<textarea>` with no `value`/`onChange` — typed content vanished on tab switch.

Now: buffered local state (`notesDraft`, resynced on `p.id` change so switching projects can't leave a stale draft, or clobber the newly-loaded project's notes, sitting in the box) + an explicit **Save** button, calling `update(p.id, { notes })` + `recordAudit` + a real toast — the same buffer-then-explicit-save pattern `EditProjectModal`'s "About" field already uses, not a new convention.

**Investigated before adding the column:** searched every architecture doc and the product-vision/backlog notes for any stated plan for project documentation. Found none — `src/routes/Docs.tsx` is Orbit's own in-app product help content, unrelated to per-project notes. Proceeding as a lightweight `text` column, not designed for future rich-documentation needs.

## 4. Ask AI vs "Ask Orbit" naming (`src/components/AskOrbitPanel.tsx`, `AnswerDetail.tsx`)

"Ask AI" (global header, a real LLM) and what was labeled "Ask Orbit" (embedded in `/intelligence` and `/ai-mode`, client-side keyword matching over 5 fixed questions — `src/lib/askOrbit.ts`'s own header comment says so) shared the same sparkle icon and an "Ask ___" naming pattern, with no capability disclosure at the point of use.

Scoped narrowly to copy/branding — the underlying module (`askOrbit.ts`) and component (`AskOrbitPanel`) names are unchanged, and this doesn't touch Intelligence/Insights/AI Mode's broader nav IA (a larger, separate concern flagged in the audit):
- User-facing label: "Ask Orbit" → **"Quick Answers"**.
- Icon: `sparkles` (this app's "real AI" signal everywhere else — Ask AI, the Intelligence nav item) → `zap`, in both the panel header and each answered turn's icon (`AnswerDetail.tsx`).
- One inline disclosure line added inside `AskOrbitPanel.tsx` itself — *"Instant answers to 5 common questions, computed from your data — not an AI model."* — so it appears automatically everywhere the panel is embedded, without duplicating copy across `Intelligence.tsx` and `AiMode.tsx`.

## 5. CI pipeline (`.github/workflows/ci.yml`)

Was: no `.github` directory, no PR-time gate at all. Netlify's own build does run `tsc -b && vite build` on deploy, but only post-merge on `main`, and never runs the test suite.

Now: a workflow running on every push/PR — `npm ci` → `tsc -b` → `vitest run` → `npm run build`. No secrets needed: `src/lib/supabase.ts` only warns on missing env vars, it doesn't throw. Scoped to typecheck + unit tests + build only, not Playwright e2e (bigger, needs browser installs and a running server) or ESLint (no config exists yet — separate follow-up).

## Migration

Two additive columns, appended to `supabase/migrations.sql` and added to the corresponding `create table` blocks in `supabase/schema.sql`:
```sql
alter table public.projects add column if not exists notes text;
alter table public.tickets add column if not exists converted_task_id uuid references public.tasks(id) on delete set null;
```
Also added to `Project`/`Ticket` in `src/lib/types.ts` and to the hand-written `src/lib/database.types.ts`.

**Standing constraint, not new to this change:** this agent has no live Supabase access (see `docs/architecture/event-engine.md` for the earlier precedent) — the user needs to run this migration against the live database. Until then, saves touching `notes` or `converted_task_id` fail with a real Postgres "column does not exist" error, surfaced as an honest error toast rather than silently failing or corrupting data.

## What this milestone did not touch

- `src/engines/*`, `src/runtime/*` — untouched, no new engine.
- The broader AI-surface IA (Insights/Intelligence/AI Mode nav differentiation) — flagged in the audit as separate, larger work.
- ESLint, Playwright e2e in CI — flagged as natural follow-ups, out of this mission's five items.

## Verification

`npx tsc -b`, `npx vitest run` (140/140), `npm run build` — all clean. Two pre-existing test fixtures (`projectHealth.test.ts`, `retrospective.test.ts`) needed a one-line `notes: null` addition to their `Project` builder functions after the type gained the new field.

No live-Supabase click-through available to this agent — after running the migration, the user should verify: Ticket→Task creates a real task and the button persists as "View task" across a refresh; Project Notes saves and survives a reload; the disabled Quick Action buttons show their tooltip; "Run tests"/"Pull latest" produce real output.
