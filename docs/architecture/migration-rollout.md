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

**Not written yet.** Once every item in Part 1 is confirmed on staging (including any issues found and how they were resolved), this section gets filled in with the exact production procedure — expected to closely mirror Part 1's step 1 (run the same idempotent `migrations.sql` against production) plus a pre/post checklist scoped to production's specific risk (real user data, no throwaway test rows, a rollback plan for each of the columns/table above). Report Part 1's results and this section will be completed next.
