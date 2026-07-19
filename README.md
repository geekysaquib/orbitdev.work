# ORBIT

Your personal developer command center — one place to launch every project, track
tickets/tasks/time, run your Start-Work macro, and see it all in a control-room UI.

- **Stack:** React 19 + Vite 7 + TypeScript, React Router 7
- **Data:** Supabase Postgres, row-level security
- **Auth:** custom, OTP-based (not Supabase Auth) — signup, email verification,
  login and forgot-password all run through `netlify/functions/auth.ts` and send
  ORBIT's own branded emails. See [§3](#3-auth--mail-otp-signup-verification-forgot-password).
- **Native launches:** a small local agent (Node) that opens VS Code / Visual Studio
- **Zoho:** pulled through a Netlify function so secrets stay server-side
- **Design:** the Claude Design "control-room" system (Space Grotesk / Instrument Sans / JetBrains Mono, mint `#37DFA0`)

## 1. Install

```bash
npm install
cp .env.example .env      # then fill in the values below
```

## 2. Supabase

Supabase is used purely as **Postgres + PostgREST** here — Supabase Auth is not
used at all (see §3). RLS still scopes every row to its owner; our own JWTs just
carry the same `auth.uid()`-compatible claims Supabase Auth would have issued.

1. Create a project at supabase.com.
2. **SQL Editor → New query →** paste `supabase/schema.sql` → Run. This creates
   `users`, `otp_codes`, and every app table with RLS policies already wired.
   (Migrating an *existing* ORBIT project that still has Supabase Auth users?
   Run `supabase/migrate_to_custom_auth.sql` instead — it carries your current
   users/passwords/data over, id-for-id, so everyone keeps their password.)
3. Project Settings → API → copy the **Project URL** and **anon key** into `.env`:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

## 3. Auth & mail (OTP signup, verification, forgot password)

Signup, email verification, login, and password reset are all custom — see
`netlify/functions/auth.ts`. Two more Supabase values are needed, both **server-
only** (set in Netlify env, never `VITE_`-prefixed — see `env.example`):

- `SUPABASE_JWT_SECRET` — Project Settings → API → JWT Settings → **Legacy JWT
  Secret**. Sessions are JWTs signed with this, using the same claim shape
  Supabase Auth produces, so `auth.uid()` / RLS keep working unchanged.
- `SUPABASE_SERVICE_ROLE_KEY` — Project Settings → API → **service_role** key.
  Lets `auth.ts` read/write `public.users` and `public.otp_codes`, which have
  no client-facing RLS policy on purpose (service-role only).

Then wire up the mailbox that sends the verification code, reset code, and
"new sign-in" alert emails (all responsive, branded HTML — see
`netlify/functions/_lib/email-templates.ts`). ORBIT sends these itself over
Gmail SMTP with an **app password** — it doesn't route through Supabase's mailer:

- **Production:** set `MAIL_USER`, `MAIL_APP_PASSWORD`, `MAIL_FROM` in Netlify env.
- **Local `netlify dev`:** either set the same vars in `.env`, or copy
  `netlify/functions/mail-config.example.json` → `netlify/functions/mail-config.json`
  (gitignored) and fill in your Gmail address + a 2-Step-Verification **app
  password** (not your normal Google password).

## 4. Run

```bash
npm run dev            # http://localhost:5173 (Vite only — auth needs functions, see below)
netlify dev             # http://localhost:8888 (Vite + the auth/zoho functions together)
```

Use `netlify dev` when working on auth/signup/mail — plain `vite` doesn't serve
`netlify/functions/*`. Create an account on the login screen (you'll be asked to
enter the emailed verification code before you can sign in), then add projects
from the Projects tab.

## 5. Local agent (VS Code / Visual Studio launches)

```bash
cd agent && npm install
cp agent-config.example.json agent-config.json   # paste the SAME SUPABASE_JWT_SECRET from §3
npm start                                         # http://localhost:47600
```

The agent verifies your ORBIT session token on every call, so Postgres servers,
Gmail credentials, and dev-server tracking are scoped per signed-in user —
two people running ORBIT against the same agent don't see each other's data
(Docker is the exception; it's whatever's running on that machine). The
topbar pill shows "Agent connected" once it's up (that's just `/ping`, which
doesn't need auth) — see `agent/README.md` for the auth setup, HTTPS/mkcert,
and how to swap in a .NET agent.

## 6. Zoho Sprints (work items)

You're on Zoho **Sprints**, not Desk, so the Tickets screen pulls Sprints work items.
This is **per-account, not shared** — there's no environment-variable fallback, so
every ORBIT account (including yours) links its own Zoho keys or sees "not configured."
ORBIT → Settings → Zoho Sprints walks through this: in the Zoho API Console (matching
your DC, e.g. `api-console.zoho.in`) create a **Self Client**, Generate Code with the
scope shown in the Settings page, then paste the Client ID / Secret / grant code back
into ORBIT and hit **Exchange for tokens** — the grant-code-for-refresh-token exchange
happens server-side (`netlify/functions/zoho-exchange.ts`), so nobody needs a terminal
or curl. Hit **Save & connect** once the Refresh Token field is filled. The function
auto-discovers your team and project; pin the Team ID / Project ID there only if you
want to skip that lookup. Once connected, ORBIT reconnects automatically on future
sign-ins — no reconnect step after logout.

## 7. Deploy (Netlify)

```bash
npm run build          # tsc + vite build → dist/
```

Connect the repo in Netlify (config is in `netlify.toml`). Set env vars:
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_AGENT_URL`,
`SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `MAIL_USER`,
`MAIL_APP_PASSWORD`, `MAIL_FROM`. Zoho is **not** a Netlify env var — each
account links its own keys in Settings (see §6).

## What's wired vs. what needs credentials

- **Fully wired:** custom OTP auth (signup / verify / login / forgot password /
  login alerts, all emailed), and Supabase-backed CRUD for projects, tasks,
  calendar events, notifications, tickets.
- **Per-account, nothing shared:** Zoho Sprints, Gmail, and Postgres servers are
  all linked per signed-in account (Settings, or the agent for Gmail/Postgres) —
  there's no environment-variable or cross-account fallback anywhere. A fresh
  account starts with none of these configured and links its own.
- **Needs your keys regardless:** Supabase URL/anon key (app is blank without
  them), `SUPABASE_JWT_SECRET` + `SUPABASE_SERVICE_ROLE_KEY` (auth won't work
  without them), mail credentials (no emails send without them), and the local
  agent must be running for IDE launches / Postgres / Gmail / Docker.
- **Presentational for now:** the Automation rules/jobs use local state; the
  schema has `time_entries` ready to back more of it.

## Layout

```
src/
  lib/         supabase, auth (session storage), agent, zoho clients + types + icons
  context/     AuthContext (custom OTP auth), Toast
  hooks/       useTable (generic RLS-scoped CRUD)
  components/  Layout (rail + topbar), ui atoms
  routes/      Login, VerifyEmail, ForgotPassword, Dashboard, Projects,
               ProjectDetail, Tickets, Tasks, Calendar, Notifications,
               Automation, TimeTracking, Settings
supabase/      schema.sql (fresh install), migrate_to_custom_auth.sql
               (existing project), seed.sql
netlify/       functions/auth.ts (OTP signup/login/reset + login alerts),
               functions/zoho-sprints.ts, functions/_lib/ (mailer, otp, db, geo,
               email templates), functions/mail-config.example.json
agent/         server.mjs (local companion)
```
