# Release Candidate 1 — Execution Log

Tracks RC1 of the closed-beta Release Plan (see the Beta Readiness Review and Release Plan in the session history this originated from). One section per completed task, appended as each lands — RC1 ships as a sequence of small, independently-verified, independently-revertible changes, not one big release commit.

## 1. Top-level React error boundary

**Problem**: `src/main.tsx` had no error boundary — any render-time throw anywhere in the component tree unmounted the whole app, leaving the user with a blank white screen and no recovery path. Beta Readiness Review, Reliability §10 / Error recovery §4, Critical.

**Change**: `src/components/ErrorBoundary.tsx` (new) — a class component (`componentDidCatch`/`getDerivedStateFromError`; React has no hook equivalent) wrapping `<App/>` in `src/main.tsx`. The fallback UI is deliberately context-free (no `useAuth`/`useToast`/`useOrbitRuntime` — any of those could be what's broken) and reuses existing patterns: the `.center-load` full-viewport-centering class already used by `Login.tsx`/`Landing.tsx`/`OAuthCallback.tsx`, and the existing `btn`/`Icon` primitives. Recovery is a hard reload (`window.location.reload()`), not an in-place retry — safer than risking a re-render into the same broken state. A "Copy error details" button lets a user hand a support request the error message + stack even before Sentry exists.

**Explicitly not done here**: error reporting is `console.error` only. Wiring this boundary's catch to Sentry is RC1's next task, not this one — `componentDidCatch` has a comment marking that boundary so it's obvious where to hook in.

**Side fix**: writing this task's tests surfaced that the project's vitest+`@testing-library/react` setup (added in the Ambient Intelligence milestone) had no RTL cleanup wired between test renders — `vitest.config.ts` had no `test.globals` and no `setupFiles`, so RTL's auto-cleanup detection silently no-ops. Multiple `render()` calls in one test file accumulate DOM across tests and eventually break `getByText`'s uniqueness assumption (this is exactly how `ErrorBoundary.test.tsx`'s 5th test failed on first run). Fixed globally, not just locally, via a new `src/testSetup.ts` (`afterEach(() => cleanup())`) wired through `vitest.config.ts`'s new `setupFiles` entry — a one-line, purely-additive config change that fixes this for every current and future component/hook test, not just this one file.

**Files changed**:
- `src/components/ErrorBoundary.tsx` (new)
- `src/components/ErrorBoundary.test.tsx` (new, 5 tests)
- `src/main.tsx` (wraps `<App/>`)
- `src/testSetup.ts` (new)
- `vitest.config.ts` (`+setupFiles: ["./src/testSetup.ts"]`)

**Verification**: `npx tsc -b` clean. `npx vitest run` — 148/148 (143 prior + 5 new). `npm run build` clean (main chunk +~2KB — the boundary is necessarily part of the eager bundle since it wraps the app root, can't be lazy-loaded).

**Rollback**: Pure code change, no data/schema/config-service involved. `git revert` the commit, or restore the previous Netlify deploy. The `testSetup.ts`/`vitest.config.ts` change is test-only and has zero production runtime effect either way.

**Risk**: Low. The boundary only activates on an already-broken render path — it cannot make a currently-working app misbehave, only change what happens when something was already about to crash.

**Manual smoke test (real `npm run dev` build, real headless Chromium via Playwright — already an installed browser, no new dependency)**: temporarily added `throw new Error(...)` as the first line of `App()`, confirmed via screenshot + DOM assertions that (1) the full-screen fallback renders exactly as designed, (2) "Copy error details" flips to "Copied" and the clipboard genuinely contains the thrown error's message, (3) "Reload Orbit" triggers a real reload and consistently re-shows the fallback while the bug is still present (not a worse/blank screen), (4) after reverting the deliberate throw, a fresh reload boots the app normally (Landing page, zero console errors) — confirming the boundary leaves no residual corruption once whatever tripped it is fixed. The throw and its revert left zero diff in git history; the driver script was a throwaway file outside the repo's tracked tree, deleted after use.

**Deferred to later RC1 tasks**: Sentry initialization + wiring this boundary's `componentDidCatch` to report to it (next task per the Release Plan).

## 2. Initialize Sentry, wire it to the error boundary

**Problem**: `@sentry/react` was already a dependency but never initialized anywhere — zero production error visibility. Beta Readiness Review, Observability §11, Critical.

**Important discovery before writing anything**: `src/lib/sentry.ts` already existed — but it's a completely unrelated, already-shipped feature (Sentry as a per-user *integration*, reading a connected team's own Sentry org issues through `netlify/functions/sentry-api.ts`, surfaced in Settings). Reading it before writing (the Write tool's own guard forced this) caught what would have been a serious mistake — overwriting a real, working feature because of a filename collision with what I was about to build. New code went into `src/lib/errorReporting.ts` instead, with a header comment explicitly cross-referencing the two so a future reader doesn't make the same assumption.

**Change**:
- `src/lib/errorReporting.ts` (new) — `initErrorReporting()`, an explicit function (not an import-time side effect like `supabase.ts`'s client — Sentry's init is inherently a "call once at startup" action, and an explicit function is what makes this directly unit-testable). Reads `VITE_SENTRY_DSN`; warns and no-ops if absent (same convention as `supabase.ts`'s missing-config handling), otherwise calls `Sentry.init({dsn, environment})`. No performance tracing, no session replay, no PII opt-in — pure error capture only.
- `src/main.tsx` calls `initErrorReporting()` before the first render.
- `src/components/ErrorBoundary.tsx`'s `componentDidCatch` now also calls `Sentry.captureException(error, {contexts:{react:{componentStack}}})`, imported directly from `@sentry/react` (not through my wrapper — `captureException` is always safe to call even if `init()` never ran, so `ErrorBoundary` doesn't need to know whether reporting is actually configured). `console.error` stays alongside it, not replaced.
- `.env.example` documents the new `VITE_SENTRY_DSN` var, with a note distinguishing it from the unrelated Settings-page Sentry integration.

**Explicitly not done here**: source-map upload (`@sentry/vite-plugin` + a Sentry auth token, so stack traces resolve to real file/line instead of minified output) — needs real Sentry org credentials this agent doesn't have, and is a separate build-pipeline change. Also not done: enabling `sendDefaultPii`, performance tracing, or session replay — none were asked for, all add bundle weight and data-collection surface beyond "wire up error capture."

**Files changed**:
- `src/lib/errorReporting.ts` (new)
- `src/lib/errorReporting.test.ts` (new, 2 tests)
- `src/components/ErrorBoundary.tsx` (`+Sentry.captureException` in `componentDidCatch`)
- `src/components/ErrorBoundary.test.tsx` (+1 test, asserts `captureException` is called on catch)
- `src/main.tsx` (calls `initErrorReporting()` before render)
- `.env.example` (`+VITE_SENTRY_DSN`)

**Verification**: `npx tsc -b` clean. `npx vitest run` — 151/151 (148 prior + 3 new). `npm run build` clean (main chunk +~12KB gzipped-equivalent — the SDK is necessarily eager since it must initialize before the first render, same reasoning as the boundary itself).

**Rollback**: Pure code change, no data/schema involved. `git revert`, or restore the previous Netlify deploy. Leaving `VITE_SENTRY_DSN` unset in Netlify env is itself a safe "soft disable" — `initErrorReporting()` warns and no-ops rather than breaking anything.

**Risk**: Low. Everything is additive and gated behind a missing-by-default env var; without a DSN configured, this release is behaviorally identical to before it.

**Operational step required, not code**: a real Sentry project + DSN need to exist and `VITE_SENTRY_DSN` needs to be set in Netlify's production env for this to actually report anything — this agent can't create a Sentry account/project. Until that's done, `console.warn("[ORBIT] Missing VITE_SENTRY_DSN...")` will show in every browser console, which is the intended, honest signal that this step is still outstanding.

**Deferred**: source-map upload (see above) — worth revisiting once a Sentry org/token exists to configure it against.

## 3. Staging environment

**Problem**: One Netlify site, one Supabase project, `main`-push = instant full-population production deploy, no way to verify anything against a realistic environment first. Beta Readiness Review, Reliability §10 / Release process §15, Critical.

**Scope reality check, stated up front**: creating an actual Netlify site and an actual Supabase project are dashboard/account-level actions this agent has no credentials for and shouldn't be given. What follows is everything that *is* achievable in code plus a complete, precise runbook for the account-provisioning steps — not a claim that staging already exists.

**Change**:
- `docs/architecture/staging-environment.md` (new) — the full runbook: Supabase project creation, Netlify site creation, a complete environment-variable table (with an explicit "must differ from production" column), first-deploy steps, and a staging verification checklist. Explicitly states migration work (RC1 tasks 4-5) is blocked until every checklist item passes, per the Release Plan's own sequencing.
- `src/lib/appEnv.ts` + `src/lib/appEnv.test.ts` (new) — `nonProductionEnvLabel()`, a small pure function deciding whether to show a "not production" badge, extracted specifically so this logic is unit-testable without needing to render all of `Layout.tsx`'s heavy provider tree.
- `src/components/Layout.tsx` — a small amber badge next to the `ORBIT` wordmark, shown whenever `VITE_APP_ENV` is set to anything other than `production`. Opt-in, not opt-out: unset (today's production) shows nothing, so this task makes zero behavioral change to the current production deploy unless staging's own env vars explicitly turn it on.
- `.env.example` — added `VITE_APP_ENV`, plus two real pre-existing gaps found while compiling the complete env-var inventory: `PUBLIC_SITE_URL` and `AUTH_TOKEN_TTL_DAYS` were read by `netlify/functions/auth.ts`/`teams.ts` but were entirely missing from the example file (README referenced `PUBLIC_SITE_URL`'s existence but the example never had it). Fixed as part of building an accurate staging setup guide — couldn't write a trustworthy runbook off an incomplete template.

**Notable finding while compiling the env-var inventory**: `PUBLIC_SITE_URL` (used to build team-invite email links) is exactly the kind of value that creates real cross-environment risk if staging copies production's — a staging-sent invite email would link to production. Flagged prominently in the runbook's env-var table, not just mentioned in passing.

**Explicitly not done here**: the actual Supabase project, the actual Netlify site, and any real environment-variable values — all require dashboard access outside this agent's tools. Tagging Sentry errors with a distinct `environment` per deploy (vs. today's `MODE`, which is Vite's dev/prod build flag, a different concept from the new `VITE_APP_ENV`) — small follow-up, kept out to keep this task's diff focused.

**Files changed**:
- `docs/architecture/staging-environment.md` (new)
- `src/lib/appEnv.ts` (new)
- `src/lib/appEnv.test.ts` (new, 4 tests)
- `src/components/Layout.tsx` (+environment badge)
- `.env.example` (`+VITE_APP_ENV`, `+PUBLIC_SITE_URL`, `+AUTH_TOKEN_TTL_DAYS`, `+` server-only vars section)

**Verification**: `npx tsc -b` clean. `npx vitest run` — 155/155 (151 prior + 4 new). `npm run build` clean (main chunk unchanged — a few lines of conditional JSX). No dedicated manual/browser smoke test for this task (unlike task 1) — the badge logic is fully covered by `appEnv.test.ts`'s pure-function tests, and the JSX wiring is a trivial, low-risk conditional render.

**Rollback**: Pure code change, no data/schema involved. `git revert`, or restore the previous Netlify deploy. The badge is inert (shows nothing) unless a site explicitly sets `VITE_APP_ENV` to a non-production value, so there's no production behavior to roll back from in the first place.

**Risk**: Low for the code shipped. The real risk in this task is entirely in the manual account-provisioning and verification steps described in the runbook — which is precisely why the runbook includes an explicit checklist and an explicit "don't proceed to migration work until it's all checked off" gate.

**Deferred to the user, not later RC1 tasks**: everything in `staging-environment.md`'s setup steps 1-4 and the verification checklist in §6 — this agent cannot execute those. RC1 tasks 4 and 5 (migration tracking, applying pending migrations) do not start until that checklist is confirmed complete.

**Staging confirmed operational by the user** — separate Netlify deployment, separate Supabase project, separate Sentry environment, separate env vars, environment badge verified, prod/staging data isolation verified, invite emails link to the correct staging URL, deployment successful, smoke tests passed, a real Sentry event received. Task 3's checklist gate is satisfied; proceeding to task 4.

## 4. Migration tracking

**Problem**: `migrations.sql` has always been applied by hand with no record of what any given environment had actually run — the only way to know "is this database fully up to date" was inference (re-reading the file and guessing), not certainty. Beta Readiness Review, Upgrade/migration safety §13, High.

**Design**: A new `public.schema_migrations(version integer primary key, description text, applied_at timestamptz)` table, added identically to both `supabase/migrations.sql` (the upgrade path — appended at the end, its established convention for new additions) and `supabase/schema.sql` (the fresh-install path). No RLS policy is defined for it — same pattern already used for `otp_codes` (RLS enabled, zero policies = reachable only via a direct service-role/superuser SQL connection, never through the app or any Netlify function). No `database.types.ts` entry either, for the same reason `otp_codes` doesn't have one: nothing in `src/` ever queries this table through the browser client — it's a pure operator/ops artifact, checked by hand (`select max(version) from public.schema_migrations;`), not application data.

**Why a single incrementing version number, not one row retroactively backfilled per historical section**: `migrations.sql` has ~25 distinct historical `-- ---------- section ----------` chunks accumulated over the project's life. Splitting all of them into individually-numbered rows now would be a large, purely cosmetic diff — every environment that matters has already applied all of that history, tracking table or not. Instead, everything before this task's addition is marked as a single baseline (`version 1`) in one shot, and every migration added **from this point forward** gets its own incrementing version number and a one-line description, registered via the same `insert ... on conflict (version) do nothing` idempotency pattern every other statement in this file already uses. A comment block (`HOW TO ADD THE NEXT MIGRATION`) is left directly in `migrations.sql`, at the point anyone editing that file next will actually see it, documenting the convention — no separate doc file, no tooling, since the convention itself is three lines of SQL a human writes by hand each time.

**Fresh-install seeding**: `schema.sql`'s copy seeds itself to whatever the current baseline is (currently also `version 1`, since no migration has been added past the baseline yet) — a fresh install already has everything the migration history represents, so it should read as fully up to date immediately, not empty. This needs the same manual-sync discipline already accepted elsewhere in this project for `src/lib/database.types.ts` (hand-written, kept in sync with `schema.sql` by convention, not automation) — flagged explicitly in both files' comments, not silently assumed.

**Attempted, environment-blocked**: tried to validate this SQL against a real Postgres before asking the user to run it anywhere — first considered connecting to whatever local Postgres might already be running (rejected: unknown credentials, and it could be the same instance the app's own Postgres feature manages against real user data, not an appropriate target to probe). Then attempted a fully isolated, throwaway cluster from scratch via `initdb` into a scratch directory on an unused port — `initdb` succeeded, but `pg_ctl start` failed: the sandbox denies binding any TCP/IP socket, including loopback (`could not bind IPv6 address "::1": Permission denied` / same for IPv4). This is a genuine environment restriction, not a shortcut taken — the throwaway cluster was fully torn down after confirming this. Verification is therefore careful manual SQL review (done — checked twice) plus the standing practice this whole session: **run it on staging first**, now that staging is a real, validated target, before it ever touches production.

**Files changed**:
- `supabase/migrations.sql` (+38 lines — table, RLS, baseline seed, convention comment)
- `supabase/schema.sql` (+15 lines — table, baseline seed; `+1` word in the existing RLS-enable loop array; `+1` line in the `otp_codes` comment cross-referencing the same no-policy pattern)

**Verification**: No `src/` changes, so `tsc -b`/`vitest run`/`npm run build` are confirmation-that-nothing-broke rather than tests of new logic — all three clean (155/155 tests, unchanged build output hashes). The actual verification this task needs — applying the SQL and confirming idempotency — is the user's next step, against staging.

**Rollback**: `drop table if exists public.schema_migrations;` — the table is purely additive and inert, tracks nothing that any other table's data or behavior depends on. Dropping it loses only the tracking history itself, not any real application data.

**Risk**: Low. Additive-only, no policy grants to any client-facing role, no foreign keys from or to any existing table.

**Deferred**: Retroactively splitting the ~25 historical sections into individually numbered migrations (explicitly decided against, not an oversight — see Design above). A CI check comparing `schema.sql`'s seed against `migrations.sql`'s highest version (same class of drift risk as the already-accepted `database.types.ts` gap) — RC2 scope per the original Beta Readiness Review, not introduced here to stay minimal.

## 5. Apply pending migrations (staging first) — COMPLETE

**What was pending**: everything appended to `supabase/migrations.sql` since the last time any environment actually ran this file — `projects.notes`, `tickets.converted_task_id` (the Trust Fixes columns backing Project Notes and Ticket→Task, both already implemented in the app and shipped in code, but never yet applied to a live database), the team-logo/user-profile columns and `create_team_with_owner` signature change, and task 4's `schema_migrations` table + baseline seed. None of this was new SQL — it was the first live application of work that had already been sitting in the file.

**Staging (Part 1)**: executed by the user against the staging Supabase project — all six verification items passed (schema objects present via `information_schema`, `schema_migrations` baseline row confirmed, Project Notes round-trips through a reload, Ticket→Task conversion persists across a reload, a `domain_events` row lands with `source: 'task-workflow', type: 'created'` on task creation).

**Production (Part 2)**: documented in `docs/architecture/migration-rollout.md` — preconditions (backup/PITR available, staging proven, no unverified migrations added since, **Trust Fixes UI merged to `main` before or with this deploy** — flagged explicitly since it wasn't yet merged as of Part 2 being written, no maintenance window needed since the batch is purely additive), a 4-step deployment order (deploy app → apply `migrations.sql` → verify `schema_migrations` → run the verification checklist) with an explicit note on the brief, self-healing error window between steps 1 and 2 (Notes/Ticket→Task will honestly error until the migration completes — no other feature affected, and the order can be reversed if that window needs to be zero), a full verification checklist mirroring staging's, a three-tier rollback (redeploy previous app build → drop the new additive objects if truly necessary → full PITR restore as a last resort, with exact SQL for each), and a post-deployment record (migration version, timestamp, operator, checklist completion) to log back into this section once executed.

**This agent's role, same boundary as tasks 3 and 4**: no live Supabase or Netlify access — the actual production execution is the user's step, same as staging was. This agent's contribution is documentation only, per explicit instruction: no application code, schema, migration, test, or CI changes in this task.

**Deferred**: actually executing the production rollout (an operational action, not a code task — this agent writes the runbook, the user runs it) and recording the post-deployment fields above once it happens.

## 6. Review and harden Row-Level Security

**Scope**: audit every table's RLS in `schema.sql` (fresh install) against `migrations.sql` (upgrade path), verify least-privilege, confirm service-role-only tables stay inaccessible to client roles, confirm no anonymous/authenticated role has unintended access, and identify inconsistencies between the two files. Fix only confirmed issues, minimally.

**Method**: read both files in full (both under 900 lines) and traced, for every one of the 25 RLS-enabled tables, what policy each client role (`anon`, `authenticated`) actually ends up with in each file's final executed state — not just what's declared, since several tables are redefined more than once across `migrations.sql`'s history (e.g. tasks/projects' insert/update policies get tightened in a later section). Also traced every `SECURITY DEFINER` function and every function callable via PostgREST's automatic RPC exposure, since Postgres grants `EXECUTE` on new functions to `PUBLIC` by default — a real, separate risk surface from RLS itself, easy to miss if the review only reads policies.

**Four confirmed issues found and fixed** (all additive/corrective SQL, no destructive changes, registered as `schema_migrations` version 2):

1. **`break_logs` was entirely missing from `migrations.sql`.** It exists in `schema.sql`'s fresh-install path, but the upgrade-path file — whose whole stated purpose is "take an old, already-deployed project all the way to current" — never created it. Any environment that only ever ran `migrations.sql` would have no `break_logs` table at all; every write from `BreakView.tsx` would hard-fail with "relation does not exist," not merely an RLS gap. **Fix**: added the table + RLS + `owner all` policy to `migrations.sql`, matching `schema.sql`'s shape exactly.
2. **`integrations.user_id` referenced `auth.users` instead of `public.users`** in `migrations.sql` — a leftover from before this app's custom-auth migration (every other table, and `schema.sql`'s own copy of this table, correctly points at `public.users`; see `schema.sql`'s own header comment on why). `create table if not exists` made this a dormant no-op on any environment that already had the table with the correct reference, but it was a real, functional bug (a broken foreign key) for anyone running the file against a database that didn't already have `integrations`. **Fix**: corrected the reference.
3. **`integrations`' RLS policy had two different names depending on install path**: `"own integrations"` in `migrations.sql` (created via a skip-if-exists idiom that can never update it on a re-run) vs `"owner all"` in `schema.sql` (via the generic per-table policy loop). Same rule, same effective access — but the naming drift means a future policy edit targeting `"owner all"` would silently miss any environment that took the upgrade path. **Fix**: renamed to `"owner all"` in `migrations.sql`, using the same drop-then-create idiom every other table's policy already uses, with an explicit `drop policy if exists "own integrations"` to clean up any environment that already has the old name.
4. **Three functions relied on RLS alone (or nothing) to stay privileged, with no explicit restriction on who can call them directly.** Postgres grants `EXECUTE` on every new function to `PUBLIC` by default; PostgREST exposes any function the querying role can execute as an RPC endpoint.
   - `is_team_member()` is `SECURITY DEFINER` (deliberately, to break a self-referencing-policy recursion — see its own comment) and takes arbitrary `team_id`/`user_id` parameters rather than self-scoping to `auth.uid()`. Without a grant restriction, any authenticated (or, before this fix, even anonymous) caller could invoke it directly as `/rest/v1/rpc/is_team_member` to probe arbitrary team-membership pairs — a real, if minor, information disclosure beyond its intended use inside policies. **Fix**: `revoke execute ... from public; grant execute ... to authenticated;` — `authenticated` still needs the grant for the policies that legitimately call it to evaluate at all; only `anon`/`PUBLIC` access is closed.
   - `create_team_with_owner()` and `transfer_team_ownership()` are `SECURITY INVOKER` (the default — neither specifies `DEFINER`), so a direct call from `authenticated`/`anon` was already blocked by `teams`/`team_members`' own RLS (no insert/update policy grants either role that access) — verified this by tracing exactly which policies each underlying statement would hit. Not currently exploitable, but both functions do zero authorization of their own; they trust that RLS is the only thing standing between them and misuse. **Fix**: added an explicit `revoke ... from public` before each existing `grant ... to service_role`, as defense-in-depth against that RLS layer alone changing in the future — least-privilege should not depend on a single layer holding.

**Also reviewed, no issue found**: `merge_user_settings()`/`orbit_hours()` are `SECURITY INVOKER` and self-scope via `auth.uid()` internally, so the default PUBLIC grant is safe even for `anon` (returns empty/zero, not another user's data) — left as-is, already correctly scoped. No stray `grant ... to anon` or `grant ... to public` found anywhere in either file. `otp_codes` and `schema_migrations` correctly have zero policies (service-role-only, as designed). The `"teammates are visible"` policy on `users` is currently unreachable (grepped `src/` — nothing queries the `users` table via the browser client at all, everything goes through service-role Netlify functions), so it's dead code rather than a live exposure; not changed, since removing an unused-but-correctly-scoped policy isn't a "confirmed issue" and touching it isn't minimal.

**Files changed**:
- `supabase/schema.sql` — revoke/grant hardening for `is_team_member`/`create_team_with_owner`/`transfer_team_ownership`; `schema_migrations` baseline seed bumped to include version 2 (this file has no per-migration granularity, so a fresh install just needs the fixes folded in directly, same convention as task 4).
- `supabase/migrations.sql` — all four fixes above, plus the version-2 `schema_migrations` registration.
- `src/lib/schemaConsistency.test.ts` (new, 5 tests) — static regression guard reading both SQL files as text, asserting: every table RLS-enabled in `schema.sql` (excluding the handful that predate `migrations.sql`'s own existence) has a `create table` in `migrations.sql`; the `auth.users`/`public.users` fix; the `integrations` policy-name fix; the two function-grant fixes. Doesn't replace running the SQL against a real Postgres (no live DB in this sandbox — see task 4's note on the socket-binding restriction), but guards against this exact class of drift recurring.

**Security impact**: closes one real (if minor) unauthenticated information-disclosure path (`is_team_member` RPC), fixes one broken foreign key that would have hard-failed on a specific fresh-install path, fixes one functional gap that would have hard-failed `break_logs` writes on any upgrade-path environment, and removes a naming inconsistency that was a latent risk for future policy edits silently not reaching upgraded environments. No existing legitimate access is narrowed — every fix either closes an unintended path or corrects dead/broken SQL.

**Risk**: Low. Every change is additive or corrective, no `drop table`/`drop column`, no narrowing of any policy real users currently rely on. The `revoke execute ... from public` statements are the only "denial" changes, and each was individually verified against what actually calls that function today (Netlify functions via `service_role`, which is unaffected by revoking `PUBLIC` since it has its own explicit grant).

**Rollback**: `git revert` this commit. Re-running the previous `migrations.sql` is not meaningful as a rollback (nothing here is destructive to revert against) — reverting the commit and re-running the *new* `migrations.sql` version is unnecessary too, since none of these statements produce a state the old file's statements would conflict with; simplest is just not applying this version's new statements on an environment that hasn't yet, or re-granting `execute ... to public` manually on the three functions if a future need for broader access arises (none currently exists).

**Deferred**: the weaker `do $$ ... exception when duplicate_object then null; end $$` idempotency idiom is still used for `user_settings`, `audit_log`, and `domain_events`' policies in `migrations.sql` (vs. the self-healing `drop policy if exists; create policy` idiom everywhere else) — current content matches `schema.sql` exactly for all three, so this is a style/drift-risk observation, not a confirmed active bug, and rewriting every occurrence for consistency alone would be a larger diff than "minimal changes to fix confirmed issues" calls for. Worth a future pass if any of these three policies ever needs to change. Also deferred: the dead 2-arg `create_team_with_owner` overload left in `migrations.sql`'s history (superseded by the 3-arg version added by still-unmerged Trust Fixes work) — harmless (now also has its own `revoke`), cleanup is cosmetic, not a security fix.

## 7. Rate limiting

**Scope**: inspect the current implementation, identify every endpoint capable of abuse, and add the smallest workable rate-limiting mechanism — reusing existing architecture, no new infrastructure unless truly necessary.

**What already existed**: `auth.ts`'s `login` action already has a durable, DB-backed per-account lockout (`failed_login_attempts`/`lockout_until` on `users`, 8 attempts → 15 min lockout). `_lib/otp.ts` already rate-limits OTP issuance per email+purpose (45s resend cooldown, 8/day cap, 5 wrong-code attempts). Both are correct, durable-by-design protections for their specific high-value targets and were left untouched.

**Gap found**: nothing else had any throttling at all — every external-API proxy endpoint, every OAuth token-exchange endpoint, and the auth surface's protection was entirely per-account (nothing stopped one source sweeping across many different accounts, since each account's counters are independent).

**Design**: a new `netlify/functions/_lib/rateLimit.ts` — a small in-memory fixed-window counter (`rateLimit(key, max, windowMs) -> {allowed, retryAfterSec}`), no new infrastructure (no Redis/KV, no new DB table). Explicitly documented as best-effort: a Netlify Function container keeps the module's state across warm invocations, which blunts sustained single-source abuse, but a cold start clears it and concurrent warm instances don't share counters — not a hard distributed guarantee. Accepted trade-off for a closed beta of ~20 teams; a real gateway-level limiter is an RC2+ concern if abuse at scale ever shows up. This mirrors, at a smaller scale, the same "no live Supabase access, in-memory is what's available" reasoning already used elsewhere in RC1.

**Applied to** (all per-`session.userId` after `verifySession`, except where noted):
- **External-API proxies** (60 req/min each): `github-api.ts`, `gitlab-api.ts`, `azuredevops-api.ts`, `msteams-api.ts`, `sentry-api.ts`, `cloud-api.ts`, `zoho-sprints.ts`. These call third-party APIs using the caller's own stored credentials — unthrottled, a compromised or buggy client session could trip the *provider's* rate limits or, for `cloud-api.ts`'s AWS Cost Explorer path specifically, run up a real bill (~$0.01/call, unlike every other mode there which is free) — that path gets an additional, tighter 5-per-5-minutes limit on top of the general one.
- **OAuth exchange endpoints** (5 attempts/5 min each): `github-exchange.ts`, `gitlab-exchange.ts`, `msteams-exchange.ts`, `zoho-exchange.ts`. Rare, one-time-per-connect actions — tight limit is appropriate and doesn't affect legitimate use.
- **`auth.ts`'s unauthenticated actions** (signup/resend/verify/login/forgot/reset — 30 req/5 min per IP, via the existing `clientIp()` helper from `_lib/geo.ts`): the one genuinely public, pre-authentication surface, and the highest-priority gap — an IP-based layer on top of the existing per-email protections, closing the "sweep many different emails from one source" hole neither the lockout nor the OTP caps cover. `update-profile` (session-gated, no email-enumeration/spam surface) is excluded.
- **`teams.ts`'s `invite` action** (20 invites/hour per inviter): the existing `RESEND_COOLDOWN_SEC` only throttles re-inviting the *same* email — nothing capped how many *different* addresses one inviter could send to, which is the actual `sendMail()`-as-spam vector (arbitrary-address spam, deliverability/reputation risk).

**Reviewed, not changed**: `teams.ts`'s `preview-invite` (unauthenticated GET, DB lookup by token) — no side effects, and guessing a specific high-entropy invite token is computationally infeasible regardless of request rate, so it's a lower-value target; left as a noted-but-deferred item rather than added scope. `agent-verify.ts` is deliberately excluded — it's called by the local agent on every request by design (with its own short local cache), so rate-limiting it would break normal legitimate usage, not just abuse. The four scheduled functions (`anomaly-scan.ts`, `daily-brief.ts`, `weekly-digest.ts`, `mail-scheduled-send.ts`) are cron-triggered, not user-facing HTTP endpoints in the same sense — worth a future look at whether they verify Netlify's own scheduled-invocation signature (a distinct authorization question, not a rate-limiting one), but out of this task's scope.

**Files changed**:
- `netlify/functions/_lib/rateLimit.ts` (new) — the shared limiter.
- `netlify/functions/_lib/rateLimit.test.ts` (new, 4 tests) — allow-under-limit, block-at-limit, window-reset, independent-keys.
- `netlify/functions/{github,gitlab,azuredevops,msteams,sentry,cloud}-api.ts`, `netlify/functions/zoho-sprints.ts` — one rate-limit check each after `verifySession` (`cloud-api.ts` also gets the AWS-cost-specific tighter check).
- `netlify/functions/{github,gitlab,msteams,zoho}-exchange.ts` — one rate-limit check each after `verifySession`.
- `netlify/functions/auth.ts` — one IP-based rate-limit check before the action switch.
- `netlify/functions/teams.ts` — one rate-limit check in the `invite` case.

**Verification**: `npx tsc -b` clean. `npx vitest run` — 164/164 (160 prior + 4 new). `npm run build` clean. **Also ran an ad hoc typecheck of `netlify/functions`** (it's covered by neither `tsconfig.app.json` nor `tsconfig.node.json` — `tsc -b` has never actually typechecked this directory; see the recurring gotcha noted earlier in this log for `netlify/functions` import paths) via a throwaway tsconfig, to make sure none of this task's edits introduced a real type error there. It surfaced ~15 pre-existing implicit-`any`/`unknown` errors scattered across `_lib/db.ts`, `_lib/zohoAuth.ts`, `cloud-api.ts`, and the four exchange files — confirmed via `git diff` that every one sits outside every hunk this task touched (two of the flagged files, `_lib/db.ts` and `_lib/zohoAuth.ts`, have zero diff at all). Pre-existing, unrelated to rate limiting, out of scope to fix here — noted under Deferred.

**Rollback**: `git revert` this commit. Every change is a new, purely additive early-return (a 429 before existing logic runs) — reverting drops the checks with zero effect on anything else.

**Risk**: Low. The limiter is in-memory-only (no schema/migration involved, nothing to roll back on the DB side). Limits were chosen generously relative to normal UI usage patterns (status checks, listing PRs/sites, one invite at a time) — a false-positive block on legitimate use is unlikely, and the response is always a clear 429 with a retry time, not a silent failure.

**Deferred**: a real distributed/durable rate limiter (RC2+, only if abuse at scale is actually observed — no evidence of that yet, and it would need new infrastructure this task deliberately avoided). `teams.ts`'s `preview-invite` (low-value target, reasoned above). Whether the four scheduled functions verify Netlify's own invocation signature — a distinct authorization gap, not rate-limiting, surfaced during this task's endpoint survey but out of scope to fix here. The ~15 pre-existing `netlify/functions` type errors this task's ad hoc typecheck surfaced (real, but unrelated) — and, relatedly, that `netlify/functions` has no typecheck coverage in this repo's own tooling at all (`tsc -b` silently skips it); worth a future task adding one, not introduced here to stay minimal.

## 8. Mail observability

**Scope**: inspect the current email pipeline, identify every outbound path, add structured logging and correlation identifiers, capture success/failure metrics — no business-behavior changes, no new mail provider.

**Every outbound email path found**:
1. **ORBIT's own transactional mail** (`_lib/mailer.ts`'s `sendMail()`, a single ORBIT-owned Gmail SMTP account) — 6 call sites: `auth.ts`'s `signup` (verify email), `resend` (verify or reset), `forgot` (reset), and `sendLoginAlert()` (login alert); `teams.ts`'s `invite` and `resend-invite`.
2. **Scheduled user mail** (`mail-scheduled-send.ts`, a 5-minute cron) — sends due `scheduled_emails` rows via the *caller's own* Gmail app password (from `integrations`), not ORBIT's account. Already had success/failure tracked on the row itself (`status`/`error`/`sent_at`) — that per-row durability was correct and untouched; it just had no structured log line or correlation id alongside it.
3. **Immediate "send now" compose mail** (`agent/server.mjs`'s `POST /gmail/send`) — a *third*, distinct execution environment: the local desktop agent process on the user's own machine, not a Netlify function at all. Its logs are inherently local to that user's machine, not centrally aggregated with the other two paths — a fundamentally different observability domain, called out explicitly rather than glossed over.

**Design**: a new `netlify/functions/_lib/mailLog.ts` — `withMailLog(kind, to, send)` wraps a single send attempt: generates a short correlation id, logs a structured `[mail]`-prefixed JSON line for `attempt`/`sent`/`failed` (parseable via Netlify's log search/drain — this codebase's existing convention is a `[tag] message` prefix, e.g. `[auth]`/`[teams]`/`[ai]`; `[mail]` matches that while the JSON payload after it adds real structure), and increments an in-memory per-`kind` sent/failed counter (same trade-off as task 7's rate limiter — no new infrastructure, resets on cold start, best-effort not distributed). Recipient addresses are masked in every log line (`maskEmail()`, the same convention `teams.ts` already used for invite-preview responses — moved into `mailLog.ts` and imported back into `teams.ts` rather than duplicated). Purely additive: `withMailLog` never changes what `send()` does or how its result/error propagates — a caller that previously threw on failure still throws the identical error, just now also logged and counted first.

**Wired in**:
- `_lib/mailer.ts`'s `sendMail()` gained an optional 5th `kind` parameter (defaults to `"unknown"`, backward compatible) and now wraps its actual send in `withMailLog(kind, to, ...)` — instrumenting this single choke point covers all 6 call sites in path 1 at once. Every real call site was updated to pass a specific kind (`"verify"`, `"resend_verify"`/`"resend_reset"`, `"forgot_reset"`, `"login_alert"`, `"team_invite"`, `"team_invite_resend"`) — an `"unknown"` bucket showing up in the metrics would mean a call site was missed, not a deliberate default.
- `mail-scheduled-send.ts` wraps its own transporter call with `withMailLog("scheduled", row.to_addr, ...)`.
- `agent/server.mjs`'s `/gmail/send` gets a hand-written equivalent (can't import from `netlify/functions` — separate deployable, no shared build step) using the identical `[mail]` JSON shape (`event`/`kind`/`correlationId`/`to`/`durationMs`) for consistency, `kind: "compose_send"`, so a future log-processing tool could handle all three paths uniformly even though only paths 1–2 are centrally aggregated today.

**Files changed**:
- `netlify/functions/_lib/mailLog.ts` (new) — `withMailLog`, `maskEmail`, `newCorrelationId`, `getMailMetrics`.
- `netlify/functions/_lib/mailLog.test.ts` (new, 8 tests) — masking, correlation-id uniqueness, sent/failed counting (including per-kind isolation), and the exact structured log shape for both outcomes.
- `netlify/functions/_lib/mailer.ts` — `sendMail()` gains the `kind` param + `withMailLog` wrap.
- `netlify/functions/auth.ts`, `netlify/functions/teams.ts` — each `sendMail()` call site passes its kind; `teams.ts`'s local `maskEmail` removed in favor of the shared one.
- `netlify/functions/mail-scheduled-send.ts` — its send wrapped in `withMailLog("scheduled", ...)`.
- `agent/server.mjs` — `/gmail/send` gets the matching structured log + a local `maskEmail` (duplicated, not shared — see above).

**Verification**: `npx tsc -b` clean. `npx vitest run` — 172/172 (164 prior + 8 new). `npm run build` clean. `node --check agent/server.mjs` clean (this file isn't covered by `tsc`/`vitest` — plain JS, its own deployable, same as before this task). Re-ran the ad hoc `netlify/functions` typecheck established in task 7 (throwaway tsconfig, deleted after use) — it caught 2 real `implicit any` errors in `mailLog.test.ts`'s own filter callbacks (fixed) before confirming the rest of the output matched task 7's already-known, unrelated pre-existing baseline exactly, with nothing new.

**Rollback**: `git revert` this commit. `sendMail()`'s new parameter is optional and additive — nothing about removing it breaks any caller. No schema/DB change to unwind.

**Risk**: Low. Purely additive observability — every wrapped call's success/failure/error/return-value propagation is byte-for-byte the same as before, verified by `withMailLog`'s own tests (returns the value, rethrows the error) and the fact that the actual `sendMail`/`mail-scheduled-send`/`agent` business logic files themselves are otherwise untouched.

**Deferred**: `getMailMetrics()`'s counters are currently read only by its own tests — no health-check endpoint surfaces them yet (out of scope; "capture metrics" was satisfied via the counters + structured logs, a dedicated read path is a new, separate feature). The agent's local `[mail]` logs are genuinely not centrally visible to operators (a distinct, harder problem — shipping logs off a user's own machine — not attempted here). Whether/how to actually consume the structured logs at scale (a Netlify log drain to a real log aggregator) is an RC2+ operational decision, not a code task.

## 9. Backup & PITR verification

**Scope**: audit current backup/recovery assumptions, produce a production-ready verification runbook covering PITR availability, backup cadence, restore procedure, recovery validation, and rollback expectations. Operational hardening only — no feature work, no schema changes, no code.

**Delivered**: `docs/architecture/backup-recovery.md` — a standing runbook (not tied to one deployment event, unlike `migration-rollout.md`; meant to be re-run periodically per its own §7).

**What's verifiable from the codebase** (no live access needed, and no code changes required to establish these — all already true from prior RC1 work):
- The schema is fully reproducible from source control (`supabase/schema.sql`/`migrations.sql`) independent of any backup — only *data* is actually at risk in a total-loss scenario, not structure.
- `schema_migrations` (task 4) gives a durable version marker, directly useful for a fast pre/post-restore sanity check.
- `audit_log`/`domain_events` are both append-only with **no retention/pruning implemented yet** (confirmed — `event-engine.md` lists that as unimplemented future work) — meaning both are currently reliable, unbounded secondary timelines to cross-check a restore's landing point against.
- Migrations are idempotent by established convention, so re-running `migrations.sql` post-restore is always safe and is the correct way to bring a restored database (which only reflects state *up to* its target timestamp) back to fully current.
- **One genuine, app-specific restore side effect found**: this app's custom-auth JWT revocation compares token issue time against `users.password_changed_at` — a restore that rolls a user's row back to before a password reset/lockout event un-revokes any session token issued in the erased window and undoes the lockout. Not generic Postgres knowledge; specific to how `_lib/verifyToken.ts` works, and worth remembering when validating any restore spanning a security event.
- Confirmed this is unrelated to (and shouldn't be confused with) the existing Postgres-explorer "Backup" feature (`Postgres.tsx`/`agent/server.mjs`'s `/pg/backup*`) — that's a `pg_dump` export tool for *externally connected* user databases, not ORBIT's own Supabase project.

**What genuinely requires live Supabase dashboard/account access** (cannot be asserted from this codebase, and is not guessed at in the doc):
- **The single highest-priority open finding**: whether the production Supabase project's plan tier even includes PITR at all — Supabase's Free tier has none. This needs checking before anything else in the runbook is meaningful, and is flagged prominently as a possible hard blocker, not buried.
- The actual configured retention window, backup cadence (continuous PITR vs discrete daily snapshots — these imply very different realistic RPOs), and the exact restore mechanism/UI for this specific project's plan (self-serve dashboard vs support-ticket-initiated has varied by Supabase plan tier over time, so the doc asks to confirm current behavior rather than asserting one).
- Whether a PITR restore is in-place (same connection URL/keys) or produces a new project needing a `.env`/Netlify env cutover — explicitly called out as something that needs confirming *in advance*, not discovered mid-incident.

**Recommendation made, not yet executed**: a real restore drill against a disposable/staging-tier project before GA — "documenting a restore procedure sight-unseen risks the runbook being wrong exactly when it matters" (quoted from the doc itself). This agent cannot perform this — no live Supabase access, consistent with every other RC1 task touching live infrastructure.

**Files changed**:
- `docs/architecture/backup-recovery.md` (new) — the full runbook: audit (§1), PITR availability checklist (§2), backup cadence checklist (§3), restore procedure (§4), recovery validation steps (§5), rollback expectations including RPO/RTO framing and "PITR is all-or-nothing, not surgical, unlike the app/schema rollback tiers already documented" (§6), recommended re-verification cadence (§7).
- `docs/architecture/migration-rollout.md` — one-line cross-reference added to its existing "backup/PITR available" precondition bullet, pointing at the new runbook instead of leaving it as an unexplained checkbox.

**Verification**: docs-only change, no `src/`/`netlify/functions/` files touched — `tsc -b`/`vitest run`/`npm run build` run as confirmation-that-nothing-broke rather than tests of new logic; all three clean.

**Risk**: None from this commit — it's documentation, and it doesn't assert anything about production's actual backup state that could create false confidence (every concrete fact requiring live access is explicitly marked unconfirmed, not guessed at).

**Rollback**: `git revert` — no schema, code, or data touched.

**Deferred**: actually confirming §2/§3's live-access items and filling in real numbers (plan tier, retention window, RPO/RTO) — the user's step, no live Supabase access from this agent. Executing the recommended restore drill (§4) before GA. Branch protection — paired with backup/PITR in the original Beta Readiness Review's task numbering, but not part of this turn's explicit instructions, so treated as out of scope here rather than assumed; worth a separate, explicit RC1/RC2 task if still needed. Revisiting §5's cross-check step if `audit_log`/`domain_events` ever gain a retention policy (already flagged as a dependency in the doc itself).

## 10. Zoho integration refactor — throw → result

**Scope**: the specific Zoho cleanup identified in the Release Plan. Audited `src/lib/zoho.ts` (client), `netlify/functions/_lib/zohoAuth.ts` + `zoho-sprints.ts` (server) — the server side was already solid (a comprehensive top-level try/catch in the handler with a safe-message allowlist, established well before RC1). The client side had a real inconsistency: of `zoho.ts`'s 8 exported functions, 6 threw on failure while 2 (`fetchZohoStatus`, `exchangeZohoCode`) already returned a `{ok/connected, error}`-style result. Every one of the 6 throwing functions' ~15 call sites across 8 files already wrapped it in `.catch()`/`try-catch` — no live bug — but the inconsistency meant a *future* call site could forget to catch, with no type-level guard against it.

**Scope decision, made explicitly with the user before starting**: two options existed — a full conversion (all 6 throwing functions → an explicit `ZohoResult<T>` type, all callers updated) or a narrow cleanup (leave the 6 as-is, just dedupe `fetchZohoStatus`'s internals). Chose full conversion — closes the inconsistency for good rather than leaving 6 of 8 functions on the weaker convention, at the cost of a larger (but still mechanical) diff.

**Design**: `export type ZohoResult<T> = { ok: true; data: T } | { ok: false; error: string };` in `zoho.ts`. The internal `get<T>()` helper now catches everything (non-2xx response, thrown network error) and returns `ZohoResult<T>` instead of throwing. Each of the 6 public functions (`fetchZohoTickets`, `fetchSprintProjects`, `fetchSprintBoard`, `fetchItemDetail`, `fetchThumbs`, `fetchTimesheet`) returns `ZohoResult<...>`, unwrapping their own response envelope on success exactly as before (e.g. `.data ?? []`, `.projects ?? []`). `fetchZohoStatus`/`exchangeZohoCode` were **not** touched — they weren't throwing, so they're outside "throw → result" scope; unifying their shape into `ZohoResult` too would be a separate, not-asked-for change.

**Every call site preserved exactly**, using one of two mechanical patterns depending on shape:
- **Simple `.then(setX).catch(fallback)` chains** (`TimeTracking.tsx`, `Dashboard.tsx` ×2, `ProjectDetail.tsx`, `Sprints.tsx` ×3): rewritten to `.then((r) => setX(r.ok ? r.data : fallback))`, dropping the now-unreachable `.catch()`. `Sprints.tsx`'s board-load specifically preserved its `toast(e.message)` behavior on failure (`else toast(r.error)`).
- **`try { ... } catch { /* skip */ }` blocks with other fallible operations mixed in** (`Tickets.tsx`'s `syncZoho`, `projectHealth.ts`, `BreakView.tsx` ×3): given a one-line `if (!r.ok) throw new Error(r.error);` right after the call, re-entering the exact same catch block the surrounding code already relied on — the safest way to touch a complex multi-statement try block without risking a subtle control-flow change, since everything after that line is untouched.
- `askContext.ts` needed one additional fix: `ZohoSlice`'s `board` field was typed `Awaited<ReturnType<typeof fetchSprintBoard>>`, which after this change would resolve to `ZohoResult<Board>` instead of `Board` — corrected to an explicit `Board` import, since the actual stored value (after unwrapping) is still a plain `Board`.

**Files changed**:
- `src/lib/zoho.ts` — the `ZohoResult<T>` type, `get<T>()`, and all 6 function signatures.
- `src/lib/zoho.test.ts` (new, 5 tests) — success envelope-unwrapping, empty-envelope default, non-2xx → `{ok:false}`, missing-error-field fallback message, and the core property: a thrown network error now resolves to `{ok:false}` instead of rejecting.
- `src/routes/TimeTracking.tsx`, `src/routes/Dashboard.tsx`, `src/routes/ProjectDetail.tsx`, `src/routes/Tickets.tsx`, `src/routes/Sprints.tsx`, `src/lib/askContext.ts`, `src/lib/projectHealth.ts`, `src/components/BreakView.tsx` — every call site updated per the two patterns above.
- `src/lib/projectHealth.test.ts` — existing `fetchSprintBoard` mock reshaped to `{ok:true,data:{...}}`; one new test (`skips sprint-based signals ... when the Zoho fetch fails`) mirroring the existing GitHub-failure test, now exercising `{ok:false}` instead of a rejection.

**Verification**: `npx tsc -b` clean — critically, this is what caught that every call site's unwrap was done correctly; a missed `.data`/`.ok` access anywhere would have been a type error, not a silent runtime bug. `npx vitest run` — 178/178 (172 prior + 6 new: 5 in `zoho.test.ts`, 1 in `projectHealth.test.ts`). `npm run build` clean.

**Risk**: Low. `tsc -b`'s full-project check is unusually strong evidence here specifically because the return type actually changed shape (not just added a field) — any caller still treating the old throwing contract as truthy data would fail to compile, not fail silently at runtime. Every fallback value (`null`, `[]`, `{}`, a toast message) was matched exactly to what each call site did before.

**Rollback**: `git revert` this commit — no schema/infra involved, a pure client-side type/control-flow change.

**Deferred**: unifying `fetchZohoStatus`/`exchangeZohoCode` onto the same `ZohoResult<T>` shape (out of scope — "throw → result," not "one result shape everywhere"; they don't throw today, so there's nothing to fix). Server-side `zohoAuth.ts`/`zoho-sprints.ts` — audited, found already solid, no changes made or needed.
