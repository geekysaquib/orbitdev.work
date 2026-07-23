# Staging Environment — Setup Runbook

RC1 task 3 (Release Plan). Beta Readiness Review, Reliability §10 / Release process §15, Critical: today there is exactly one environment — one Netlify site, one Supabase project — and every merge to `main` is an instant, full-population production deploy. This doc is the complete, step-by-step instruction set for standing up a second, fully independent environment.

**What this agent could and couldn't do**: creating an actual Netlify site, an actual Supabase project, and setting real environment-variable values are dashboard/account-level actions requiring credentials this agent doesn't have and shouldn't be given. Everything below that *is* achievable in code — a visible "not production" safety badge, a complete and corrected environment-variable inventory, and this runbook + checklist — is done. The account-provisioning steps are written precisely enough to execute directly, but they are **for you to run**, not something already done.

## 1. Create the Supabase project (separate from production)

1. Create a new project at supabase.com — a **different** project from whatever backs production today. Note its Project URL and anon key (Settings → API) as you go; you'll need them in step 3.
2. SQL Editor → New query → paste the full contents of `supabase/schema.sql` → Run. This is the fresh-install path — it creates every table, RLS policy, and function in one pass, already fully up to date (confirmed: `schema.sql` and `migrations.sql` are in sync as of this task — see `docs/architecture/rc1-release.md` task 4/5, not yet done as of this writing).
3. Settings → API → note the **Project URL**, **anon key**, **service_role key**, and Settings → API → JWT Settings → **Legacy JWT Secret**. All four are needed in step 3 below.
4. Optional but recommended: name the project something unmistakable, e.g. `orbit-staging` — and if Supabase supports project-level color/labels in your org, use a different one than production's. This is exactly the kind of low-tech safeguard that prevents "I was looking at the wrong dashboard tab" mistakes.

## 2. Create the Netlify site (separate from production)

1. Netlify dashboard → **Add new site** → import the same Git repository production uses.
2. Pick a branch for staging to track. Two reasonable options — either works, pick based on your workflow:
   - Track a dedicated `staging` branch (merge to it deliberately, independent of `main`).
   - Track `main` (staging always mirrors what's about to go to production — good for "does this actually work before it's live" verification, since it deploys on the same trigger).
3. Build settings are already correct without any changes — `netlify.toml`'s `[build]` block (`command = "npm run build"`, `publish = "dist"`) is environment-agnostic; both sites read the same file from whichever branch they track. **Nothing in this repo needs to change for a second site to build correctly.**
4. Give the new site its own name/subdomain (e.g. `orbit-staging.netlify.app`), distinct from production's.

## 3. Set staging's environment variables — independently, from scratch

Do **not** copy production's env vars over. Set every one of these on the new site, in Netlify's own dashboard (Site settings → Environment variables), using **staging's own values** — most critically the four marked "MUST differ from production" below, since those are the ones that create real cross-environment risk if copied verbatim.

| Variable | Required | Must differ from prod? |
|---|---|---|
| `VITE_SUPABASE_URL` | Yes | **Yes** — staging's own Supabase project URL (step 1) |
| `VITE_SUPABASE_ANON_KEY` | Yes | **Yes** — staging's own anon key |
| `SUPABASE_JWT_SECRET` | Yes | **Yes** — staging's own JWT secret. If this ever matched production's, a staging-issued session token would authenticate against production — this is the single most important value to get right. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | **Yes** — staging's own service role key |
| `PUBLIC_SITE_URL` | Yes | **Yes** — staging's own site URL, no trailing slash. Team-invite emails embed this directly (`${PUBLIC_SITE_URL}/invite/<token>`) — if this were left as production's value, a staging invite email would link to production. **This was found undocumented in `.env.example` before this task** (README referenced it but the example file didn't have it) — fixed as part of this task. |
| `VITE_APP_ENV` | Recommended | Set to `staging`. Drives the visible header badge (§5) — the one thing that makes misconfiguration visible to a human at a glance. |
| `VITE_AGENT_URL` | Yes | No — this is user-local (each person's own desktop agent), not environment-specific. Same default (`http://localhost:47600`) is fine on both. |
| `MAIL_USER` / `MAIL_APP_PASSWORD` / `MAIL_FROM` | Yes | Can share with production if you accept that staging and prod emails come from the same sender address — no data leaks either way, just a minor "which environment sent this" ambiguity in your inbox. Use a separate mail account if you'd rather avoid that. |
| `VITE_SENTRY_DSN` | Recommended | Should differ — either a separate Sentry project, or the same project with `environment` (already sent as `import.meta.env.MODE`/set via `VITE_APP_ENV` if you extend `errorReporting.ts` to read it — not done in this pass, see Deferred) tagging staging errors apart from production's. |
| `AUTH_TOKEN_TTL_DAYS` | No | No — optional, defaults to 30 either way |
| `ZOHO_*` (all optional) | No | No — leave blank on both; Zoho is configured per-user in-app, not via env vars (see README §6) |

The full, corrected list with inline documentation now lives in `.env.example` (this task fixed two real gaps found while compiling it: `PUBLIC_SITE_URL` and `AUTH_TOKEN_TTL_DAYS` were used by `netlify/functions/auth.ts`/`teams.ts` but were missing from the example file entirely).

## 4. First deploy

Trigger a deploy (push to the tracked branch, or "Trigger deploy" in Netlify's UI). Confirm the build succeeds — it uses the exact same `npm run build` production uses, so a green build here is a genuine signal, not a staging-only pass.

## 5. The code-level safety net: the environment badge

`src/lib/appEnv.ts` (`nonProductionEnvLabel`) + a small addition to `Layout.tsx`'s header: when `VITE_APP_ENV` is set to anything other than `production` (including unset — wait, unset shows nothing, see below), a small amber "STAGING" (or whatever the value is) badge appears next to the `ORBIT` wordmark, on every single page, impossible to miss.

**Deliberately opt-in, not opt-out**: if `VITE_APP_ENV` is unset, nothing shows — today's production, unchanged, with zero required action. The badge only appears once staging explicitly sets `VITE_APP_ENV=staging` (step 3). This means production's current deployment flow is **not** touched by this task at all unless you choose to also set `VITE_APP_ENV=production` there (optional — purely to be explicit; behavior is identical either way since "unset" and "production" both suppress the badge).

This is a **visibility** aid, not a **prevention** mechanism — it cannot stop a misconfigured staging site from pointing at production's Supabase project, because this agent has no access to production's real credentials to check against. What it does is make the active environment unmistakable to any human looking at the screen, which is the realistic, achievable version of "verify staging cannot accidentally point to production resources."

## 6. Staging verification checklist

Run through this once the site is live, before any migration work begins (see §7):

- [ ] Staging URL loads, and the amber environment badge is visible next to the ORBIT wordmark on every page.
- [ ] Side-by-side, in two browser tabs (Netlify dashboard for each site's env vars), confirm `VITE_SUPABASE_URL` differs between staging and production. This is the actual "cannot accidentally point to production" check — do it manually, since nothing in code can do it for you.
- [ ] Confirm `SUPABASE_JWT_SECRET` differs between the two sites (you won't be able to see the value again after saving it in Netlify's UI in most cases — compare against what you generated in step 1, or regenerate on either side if unsure).
- [ ] Sign up a brand-new test account on staging. Confirm the verification email arrives, and **its link points to the staging domain**, not production's (tests `PUBLIC_SITE_URL` end to end).
- [ ] Create a team on staging, invite a second test address, confirm the invite email also links to the staging domain.
- [ ] Create a test project/task on staging. Log into **production** (a real account) and confirm it does **not** appear there — proves the two Supabase projects are genuinely isolated, not the same database.
- [ ] If `VITE_SENTRY_DSN` is configured, trigger a test error (same technique as RC1 task 1's manual smoke test — a temporary deliberate throw) and confirm it lands in Sentry tagged as staging, not mixed into production's error stream.
- [ ] Confirm `npm run build`'s output and the deployed staging site match — no stale cache, no leftover production asset.

## 7. What this unblocks — and what it doesn't yet

Per the Release Plan's explicit sequencing: **migration work (RC1 tasks 4 and 5) does not begin until every item in §6 is checked off.** This document and the code changes in this task are necessary but not sufficient — the actual account creation and verification is a manual step for you to complete before the next RC1 task starts.

## Deferred

- Tagging Sentry errors with `environment: staging` vs `production` distinctly (currently `errorReporting.ts` only sends `MODE`, which is Vite's dev/prod build flag, not this new `VITE_APP_ENV` concept) — small follow-up, not done in this pass to keep this task's diff focused on what was asked.
- A staging-specific Netlify `[context]` block was deliberately *not* added to `netlify.toml` — the two sites are fully separate Netlify sites (as required), not one site with multiple deploy contexts, so no such block is needed or appropriate here.
