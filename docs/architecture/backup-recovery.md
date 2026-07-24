# Backup & Point-in-Time Recovery — RC1 Task 9

Standing operational verification, not tied to one deployment event — unlike `migration-rollout.md` (a one-time procedure for one specific migration batch), this covers production's backup/recovery posture for the whole life of the beta. Re-run the checklist in §2 periodically (§7), not just once.

## 1. Audit — what's true from the code vs what needs live confirmation

**Verifiable from the codebase, no live access needed:**

- **The full schema is reproducible from source control independent of any backup.** `supabase/schema.sql` recreates every table/policy/function from nothing; `supabase/migrations.sql` brings an existing database fully current. In a total-loss scenario where a backup itself is unavailable, the *schema* is never actually at risk — only *data* is. That distinction matters for how urgent this task really is: it's about protecting data, not structure.
- **`schema_migrations` (RC1 task 4) gives a durable, queryable version marker.** `select max(version) from public.schema_migrations;` says exactly how current a database's schema is. This is the fastest way to sanity-check a restore: compare the value before and after — a mismatch means the restore landed at an unexpected point in time.
- **`audit_log` and `domain_events` are both append-only with no retention/pruning today** (confirmed — no delete path exists for either, and `docs/architecture/event-engine.md` explicitly lists "a retention policy" as unimplemented future work). That means both are reliable, independent secondary timelines to cross-check a restore against: e.g. "the restored database's last `audit_log` row is timestamped 14:32, matching the PITR target time" is a real, checkable fact, not a guess.
- **Migrations are idempotent by convention** (`if not exists` / `on conflict do nothing` throughout `migrations.sql`, established since RC1 task 4). After any restore, it's always safe to re-run the full file to guarantee the restored database is fully current — never a risk of double-applying something.
- **One real, app-specific restore side effect**: this app's custom auth revokes JWTs by comparing the token's issue time against `users.password_changed_at` (`netlify/functions/_lib/verifyToken.ts`). If a restore rolls a user's row back to *before* a password reset or lockout event, any session token issued in the now-erased window becomes valid again post-restore, and any lockout state is undone. This is a genuine, non-obvious consequence of restoring this specific app's data — not generic Postgres/Supabase knowledge — and worth remembering when validating a restore that spans a security-relevant event.
- **No application code currently assumes point-in-time backups exist.** Nothing in `src/` or `netlify/functions/` reads or depends on backup state — a restore is purely an infrastructure operation from the app's perspective, with the one auth caveat above.
- **This is unrelated to the Postgres-explorer "Backup" button** (`src/routes/Postgres.tsx`, `agent/server.mjs`'s `/pg/backup*` routes) — that's a `pg_dump`-based, user-triggered, restore-less export feature for *externally connected* Postgres servers a user has added via Settings (their own databases, not ORBIT's). Do not confuse the two: that feature backs up other people's databases; this document is about ORBIT's own Supabase project.

**Requires live Supabase dashboard/account access — cannot be verified or asserted from this codebase:**

- Which Supabase plan the production project is actually on, and whether PITR is enabled at all (see §2 — this is the single most important unknown, and possibly a hard blocker).
- The actual configured PITR retention window (how far back a restore can target).
- Whether base/daily backups are separately enabled from PITR.
- Netlify's deploy-history retention (how many previous builds stay available to roll back to).

## 2. PITR availability — how to confirm

This is genuinely unknown from the code and needs to be checked directly, first:

- [ ] **Confirm the production Supabase project's plan tier.** Supabase's Free tier does not include point-in-time recovery at all — only daily backups on paid tiers, with PITR itself typically a Pro-tier-and-above add-on. If production is still on Free tier, **there is currently no PITR, full stop** — this is the highest-priority finding this task can surface, and it needs a plan upgrade before anything below is meaningful.
- [ ] **Confirm PITR is explicitly enabled** for this project (Supabase project dashboard → Database → Backups). Being on an eligible plan does not automatically mean it's turned on.
- [ ] **Record the configured retention window** (e.g. 7 days, 14 days — whatever the dashboard shows). This bounds how far back a restore can target; write the actual number down here once confirmed, don't leave it as a guess.
- [ ] **Confirm this matches staging too**, or explicitly note that staging intentionally has weaker/no PITR (acceptable — staging holds no real user data — but should be a deliberate choice, not an unexamined default).

## 3. Backup cadence — what to confirm

- [ ] **Record whether backups/WAL archiving are continuous (true PITR) or discrete snapshots** (e.g. once-daily). This changes the realistic RPO (recovery point objective) — continuous PITR can typically restore to within seconds/minutes of an incident; daily-only snapshots mean up to ~24h of data loss in the worst case. Write down which one production actually has.
- [ ] **Record the snapshot/archive time(s) if daily** (what time of day, what timezone) — relevant when reasoning about "how much would we lose if something happened right before the next snapshot."

## 4. Restore procedure

- [ ] **Locate the actual restore control** in the Supabase dashboard (Database → Backups → Point in Time Recovery, or Support-ticket-initiated, depending on plan — record which one applies to this project; Supabase's self-serve vs support-assisted restore path has varied by plan tier, so confirm current behavior for this specific project rather than assuming).
- [ ] **Confirm what a restore actually does**: Supabase PITR restores create/replace the project's database to the chosen timestamp — record whether this is in-place (same project, same connection URL/keys) or produces a new project requiring a cutover (different URL/keys, needing `.env`/Netlify env updates). This materially changes the runbook below and needs to be confirmed once, in advance, not discovered mid-incident.
- [ ] **Restore drill (recommended before GA, not just documented)**: perform an actual test restore against a disposable/staging-tier project (not production) to observe firsthand what the process looks like, how long it takes, and what the "same URL" vs "new project" question above actually resolves to for this account. Documenting a restore procedure sight-unseen risks the runbook being wrong exactly when it matters.

## 5. Recovery validation

After any restore (drill or real), before declaring it successful:

1. **Schema version check**: `select max(version) from public.schema_migrations;` — compare against what was expected for the restore's target timestamp. A lower-than-expected version means the restore landed earlier than intended; investigate before proceeding.
2. **Re-run `supabase/migrations.sql` in full** — idempotent, safe regardless of the restored state, guarantees the schema is fully current after the restore (a PITR restore only returns the database to its state *at* that timestamp; any migrations applied *after* that timestamp need to be reapplied by hand, exactly like a fresh environment catching up).
3. **Cross-check against `audit_log`/`domain_events`**: `select max(created_at) from public.audit_log;` and `select max(occurred_at) from public.domain_events;` — both should land at or just before the restore's target timestamp. A significant mismatch (either table's last row is much earlier or later than expected) is a signal the restore didn't land where intended.
4. **Spot-check real data**: pick 2-3 known records (a team, a handful of tasks) and confirm they look as expected for that point in time — the queries above confirm *timing*, not correctness of the actual restored rows.
5. **Auth-specific check** (see §1's caveat): if the restore spans a password reset or account lockout for any user, confirm whether that's expected/acceptable for this specific recovery scenario — it may mean deliberately forcing a password reset for affected users post-restore.
6. **Application smoke test**: sign in, load the dashboard, confirm no errors — the same baseline smoke test already used for staging validation (`docs/architecture/staging-environment.md` §6).

## 6. Rollback expectations

- **What PITR covers**: only the Supabase Postgres database. It does **not** cover the deployed application code (Netlify's own deploy history is the rollback mechanism there — see `migration-rollout.md`'s three-tier rollback for the pattern of "app rollback and DB rollback are independent, decide separately"), and does not cover anything outside Supabase (local agent state, any third-party integration's own data).
- **A PITR restore is all-or-nothing for the database as a whole** — it cannot selectively roll back one table or one row while leaving others current. Restoring always means accepting the loss of *every* write across *every* table since the target timestamp, not just the problematic one. This is why `migration-rollout.md`'s rollback procedure treats full PITR restore as the last resort, after "redeploy the app" and "drop the specific new objects" — both of those are surgical; PITR is not.
- **RPO/RTO should be stated in plain terms once §2/§3 are confirmed**, not left implicit: e.g. "we can lose up to N minutes of data (RPO) and a restore takes approximately M minutes once initiated (RTO)." Fill in real numbers here once known — this document intentionally does not guess at them.
- **A restore does not fix an application bug** — if data was corrupted by a bug still present in the deployed code, restoring and then immediately re-running the same code reproduces the same corruption. Fix-forward (deploy the bug fix) generally has to happen before or alongside any data restore, not after.

## 7. Recommended cadence

- Re-verify §2 (PITR still enabled, retention window unchanged) after any Supabase plan change.
- Re-run a restore drill (§4) at least once before GA, and periodically after — a runbook that's never been executed is unverified, not just theoretical.
- Revisit this whole document if `audit_log`/`domain_events` ever gain a retention/pruning policy (deferred in `event-engine.md`) — §5's cross-check step depends on them currently being unbounded.
