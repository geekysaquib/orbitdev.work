# Migration Rollout — RC1 Task 5

Two parts, strictly sequential. **Do not start Part 2 until every item in Part 1 passes on staging.** This mirrors the same discipline already used for every other RC1 task: staging first, production only after staging proves clean.

Part 1 is executable now. Part 2 is intentionally not written yet — it gets filled in once Part 1's results are reported back, per the RC1 instruction to treat production rollout "as an operational procedure rather than a code task," documented only after staging confirms the exact procedure is safe.

## What's being applied

Everything currently sitting at the tail of `supabase/migrations.sql`, never yet run against any live database:

1. `projects.notes` (text, nullable) — backs the Project Notes tab (`ProjectDetail.tsx`).
2. `tickets.converted_task_id` (uuid, FK → `tasks.id`, `on delete set null`) — backs the Ticket→Task "View task" link (`Tickets.tsx`).
3. `teams.logo_data_url`, `users.avatar_data_url`, `users.phone`, `users.job_title` — unrelated profile/branding columns that happen to sit between the two migrations above and RC1's own addition, same file region.
4. `create_team_with_owner(...)` — updated function signature (adds `p_logo_data_url`).
5. `public.schema_migrations` — RC1 Task 4's tracking table, plus the baseline seed row (`version 1`).

All of it is idempotent (`add column if not exists`, `create or replace function`, `on conflict do nothing`) — re-running the full file is always safe regardless of staging's current state, so there's no need to hand-pick statements.

## Part 1 — Staging verification (do this now)

### 1. Apply migrations to staging

In the **staging** Supabase project's SQL editor, paste and run the entire contents of `supabase/migrations.sql` top to bottom. Confirm it completes with no errors. Because the file is fully idempotent, this is safe even if some of these statements were already applied in a prior partial run.

### 2. Verify every new schema object

Run each of these in the staging SQL editor:

```sql
-- schema_migrations exists with the right shape
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'schema_migrations'
order by ordinal_position;
-- expect: version (integer, NO), description (text, NO), applied_at (timestamp with time zone, NO)

-- RLS is on, no policies (locked to service-role/superuser only, same as otp_codes)
select relrowsecurity from pg_class where relname = 'schema_migrations';
-- expect: t
select count(*) from pg_policies where tablename = 'schema_migrations';
-- expect: 0

-- projects.notes exists
select column_name, data_type from information_schema.columns
where table_name = 'projects' and column_name = 'notes';
-- expect: notes | text

-- tickets.converted_task_id exists, with its FK
select column_name, data_type from information_schema.columns
where table_name = 'tickets' and column_name = 'converted_task_id';
-- expect: converted_task_id | uuid
select constraint_name from information_schema.table_constraints
where table_name = 'tickets' and constraint_type = 'FOREIGN KEY';
-- expect a row referencing tasks(id) among the results
```

### 3. Confirm `schema_migrations` baseline entry

```sql
select * from public.schema_migrations order by version;
```
Expect exactly one row: `version = 1`, `description = 'baseline — everything above this line, before migration tracking existed'`.

### 4. Verify Project Notes end-to-end

In the staging **app** (not SQL editor): sign in → open any project → **Notes** tab → type something → **Save**. Confirm the save succeeds (no error toast) and the Save button disables (nothing left to save). Reload the page. Confirm the text is still there.

Then confirm it actually landed in the database:
```sql
select id, name, notes from public.projects where notes is not null;
```

### 5. Verify Ticket → Task conversion end-to-end

In the staging app: **Tickets** → pick a ticket that hasn't been converted yet (button reads "To task") → click it. Confirm a real toast with the created task's title appears, the button switches to "View task", and clicking "View task" navigates to `/tasks` where the new task is visible.

If staging has no tickets yet (no Zoho connection configured there), either connect Zoho on staging first, or insert one throwaway ticket row directly for the test and delete it afterward:
```sql
insert into public.tickets (team_id, title, priority, status)
values ('<a real staging team_id>', 'RC1 task 5 test ticket', 'med', 'open')
returning id;
```

Then confirm the link persisted:
```sql
select t.id, t.title, t.converted_task_id, tk.id as task_id, tk.title as task_title
from public.tickets t join public.tasks tk on tk.id = t.converted_task_id
where t.converted_task_id is not null;
```
Refresh the Tickets page and confirm the button still reads "View task" after reload (this is the part that was previously fake — session-only state that vanished on refresh; it must now survive it).

### 6. Verify Event Engine writes to `domain_events`

Trigger an event-publishing action — creating a task is the simplest (either directly, or as a side effect of step 5's ticket conversion, which also calls `publishTaskEvent("created", ...)`). Then:
```sql
select id, source, type, occurred_at, team_id, payload
from public.domain_events
order by occurred_at desc
limit 5;
```
Expect a row with `source = 'task-workflow'`, `type = 'created'`, and a `payload` containing the `taskId`/`title` you just created.

## Part 2 — Production rollout procedure

Staging rollout succeeded and every Part 1 item passed. This is the production procedure, scoped to the same migration batch — additive only (new columns, one new table, one function signature change), nothing destructive, nothing that drops or renames existing data.

### Preconditions

Confirm all of these before starting. Any unchecked item stops the rollout.

- [ ] **Production backup/PITR is available.** Confirm the current point-in-time-recovery window covers "now" (i.e., you could restore to a point after this rollout starts if needed). This is a standing Supabase project setting, not something this rollout creates — just confirm it's on before touching production. See `docs/architecture/backup-recovery.md` (RC1 task 9) for the full verification checklist, restore procedure, and recovery validation steps — this bullet is a quick gate, that document is the actual runbook.
- [ ] **Staging rollout succeeded.** All six Part 1 items passed, with no unresolved errors. If anything in Part 1 needed a workaround, note it here before proceeding, and confirm the workaround doesn't apply to production's actual data (e.g., the throwaway test-ticket insert in step 5 is a staging-only convenience — production almost certainly already has real tickets to test against instead).
- [ ] **No pending RC1 database changes remain.** `supabase/migrations.sql` on `main` is the exact file that was just proven on staging — nobody has appended a newer, unverified migration to it since. Diff staging's applied state against `main`'s current file if there's any doubt.
- [ ] **Application code for the features this migration backs is merged to `main` and ready to deploy.** As of this writing, the Trust Fixes UI (`Tickets.tsx`'s Ticket→Task, `ProjectDetail.tsx`'s Notes tab) is implemented but not yet committed — it must land on `main` before or as part of this rollout's app deploy, otherwise step 1 below deploys nothing new and the columns sit unused. Confirm this explicitly; don't assume it's already merged.
- [ ] **Maintenance window**: not required for this batch. Every change is additive (new columns default to `null`, new table, `create or replace function` with a new optional parameter that has a default) — existing reads/writes on `projects`, `tickets`, `teams`, `users`, `tasks` are unaffected before, during, and after. Re-confirm this holds if any migration is added to the file between now and the actual rollout — a destructive change (drop/rename/type change) would need a window and a different procedure.

### Deployment order

1. **Deploy application.** Ship the `main` build containing the Trust Fixes UI to production via the normal Netlify flow.
2. **Apply `migrations.sql`.** In the **production** Supabase project's SQL editor, paste and run the entire contents of `supabase/migrations.sql`, same as Part 1 step 1. Confirm no errors.
3. **Verify `schema_migrations`.** Same query as Part 1 step 3, run against production: `select * from public.schema_migrations order by version;` — expect the `version = 1` baseline row.
4. **Run the production verification checklist** (below).

**Expected transient behavior between steps 1 and 2**: between the app deploy and the migration completing, Notes saves and Ticket→Task conversions will fail with an honest "column does not exist" error toast (not a crash, not silent data loss — `ProjectDetail.tsx` and `Tickets.tsx` both surface the real Postgres error). This window is normally seconds, matching how long the SQL editor takes to run the file. No other feature is affected. If this window needs to be zero, reverse the order (migrate first, then deploy) — both orders are safe with this specific migration batch since it's purely additive; the order above is the one specified for this rollout.

### Verification checklist

Run against **production** after step 3 above:

- [ ] `schema_migrations` contains the expected baseline entry (`version = 1`) — confirmed in deployment step 3.
- [ ] `projects.notes` works: open a real project, save a note, reload, confirm it persists.
- [ ] Ticket → Task conversion works: convert a real ticket, confirm a task is created.
- [ ] `converted_task_id` persists after reload: refresh the Tickets page, confirm the button still reads "View task" for the ticket just converted (not reverted to "To task").
- [ ] `domain_events` entries are created: `select * from public.domain_events where source = 'task-workflow' order by occurred_at desc limit 5;` — confirm a fresh row matching the task just created.
- [ ] No application errors: check the Netlify function logs and browser console for the few minutes surrounding the rollout — expect nothing beyond the transient window noted above, and nothing after step 2 completes.
- [ ] Sentry shows no unexpected migration-related errors: check the production Sentry project for the rollout window — expect either nothing, or only the expected transient "column does not exist" events timestamped between steps 1 and 2, none after.

### Rollback procedure

**When to stop immediately**: any verification item fails *after* the expected transient window (i.e., persists once the migration has completed), or the migration step itself errors out partway through.

- **Application rollback**: redeploy the previous production build via Netlify's deploy history ("Publish deploy" on the last known-good deploy). This is independent of the database state — the previous app build never referenced `notes`/`converted_task_id`/`schema_migrations`, so it runs fine whether or not the migration applied.
- **Database rollback**: this migration batch is additive-only, so the default rollback is to leave the schema as-is (extra unused columns/table are harmless) and only redeploy the previous app build. Only drop the new objects if something about their mere presence is causing a problem (unlikely, but the exact statements):
  ```sql
  alter table public.projects drop column if exists notes;
  alter table public.tickets drop column if exists converted_task_id;
  alter table public.teams drop column if exists logo_data_url;
  alter table public.users drop column if exists avatar_data_url, drop column if exists phone, drop column if exists job_title;
  drop table if exists public.schema_migrations;
  ```
  Dropping `converted_task_id` on a production table with real linked tasks loses that linkage (the tasks themselves are untouched — `on delete set null` only ever governed the reverse case). Confirm this tradeoff is actually necessary before running it; it usually isn't, since leaving unused additive columns in place is the lower-risk default.
- **Full PITR restore**: only if something beyond this migration's own scope went wrong (e.g., an operator error while in the SQL editor touched unrelated data). Use the Supabase project's point-in-time recovery to a timestamp just before step 2 began. This is a last resort — it rolls back *everything* written to the database since that point, not just this migration, so exhaust the two options above first.
- **Before retrying anything**: record the exact error message/stack trace, which step it occurred at, the production timestamp, and the operator running the rollout. Do not re-run `migrations.sql` a second time until the cause is understood — it's idempotent so a retry itself is safe, but retrying blind risks masking the actual root cause.

### Post-deployment

Record, in `docs/architecture/rc1-release.md`'s Task 5 section:

- [ ] Migration version applied (`schema_migrations.version` after this rollout — expected `1`, the baseline, since no migration has been added past it yet).
- [ ] Deployment timestamp (production).
- [ ] Operator (who ran it).
- [ ] Verification checklist completion (all items above, checked off, with a link/reference to the actual Netlify deploy and Supabase migration run if available).
