# ORBIT local agent

Headless background service that gives the browser hands: it launches VS Code,
Visual Studio, terminals, and browsers, runs your Start/End-Work macros, and
proxies Postgres/Gmail/Docker/git that the browser can't reach directly.

```bash
cd agent
npm install
npm start          # http://localhost:47600
```

## Just want to run it? Download the prebuilt app

Most users don't need to build anything — grab the latest `orbit.exe` directly:

**[github.com/geekysaquib/orbitdev.work/releases/latest/download/orbit.exe](https://github.com/geekysaquib/orbitdev.work/releases/latest/download/orbit.exe)**

That link always resolves to the newest published build. It's also linked from
ORBIT's Settings → Local agent, and offered right after signup. Double-click
it — no console window, no config, it opens a status page and connects
automatically. See "Run it as a one-click app" below for what happens on launch.

## Building it yourself (no Node.js required to *run* the result)

To build a fresh `orbit.exe` yourself instead of using the release above —
e.g. after changing `server.mjs` — package it into a single branded `orbit.exe`
(Windows) — a real standalone binary with Node built in, built with Node's own
[Single Executable Applications](https://nodejs.org/api/single-executable-applications.html)
feature, not a third-party packager:

```bash
cd agent
npm install
npm run build:exe
```

This produces `agent/dist/orbit.exe` (~93 MB, self-contained, ORBIT icon and
version info attached). To run it:

1. Copy `orbit.exe` to wherever you want it to live (e.g. Desktop or `Program Files\ORBIT Agent`).
2. Double-click it. **No console window stays open** — the visible launch process immediately respawns itself hidden (`CREATE_NO_WINDOW`) and exits, so only the background service remains. It then opens your default browser to its own status page (`http://localhost:47600`), which shows the ORBIT mark, a live "online" indicator, and a Docker health dot that refreshes every 15s.
3. ORBIT's browser tab connects to the agent automatically. Add Postgres servers / Gmail from ORBIT's Settings page as normal — Postgres servers are saved to your ORBIT account (Supabase), Gmail credentials write `gmail-config.json` next to the exe, same as the `npm start` flow.

No `agent-config.json` / `jwtSecret` setup needed — the Legacy JWT Secret is
baked into the build (it's Supabase's fixed signing key, not a per-user
value). This is a deliberate tradeoff, not an oversight: it's what makes the
GitHub release download work with zero setup, but it also means anyone
holding the `.exe` can extract that secret and forge a session token for any
ORBIT user. If that secret is ever rotated in Supabase, every published
release needs rebuilding and re-uploading. `agent-config.json` still works as
an override for pointing a local build at a different Supabase project.

To stop it, there's no console window to `Ctrl+C` anymore — use Task Manager
(look for `orbit.exe`) or `taskkill /IM orbit.exe /F`. The icon is generated
procedurally by `build/make-icon.mjs` (no image assets checked in) — rerun it
if you want to tweak the mark, then rebuild.

### Publishing a new release

The download link (`.../releases/latest/download/orbit.exe`) always serves
whatever release is tagged "latest" — after rebuilding, publish it so the
link and ORBIT's in-app download button pick it up:

```bash
npm run build:exe
gh release create agent-vX.Y.Z agent/dist/orbit.exe \
  --repo geekysaquib/orbitdev.work \
  --title "ORBIT Agent vX.Y.Z" \
  --notes "…"
```

## Routine health checkup

The agent checks Docker and each signed-in user's Gmail account in the
background:

- `GET /health` (authenticated) — on-demand full check for the calling user: `{ docker, gmail, postgres: [] }` (`postgres` is always empty — see below).
- `GET /health/public` (no auth) — Docker only, since Docker isn't scoped per user; this is what the standalone status page polls.
- Every 45s, and immediately on connect, the agent runs the full check for each user with an open `/events` websocket and pushes a `health:update` event — so a kept-open ORBIT tab reflects connection health without polling.

Postgres isn't part of that background sweep: the agent doesn't hold a server
list to iterate anymore (see below), so per-server health is on-demand only —
`POST /pg/health` with the connection details, called from the Postgres tab.

## Auth (required)

Every endpoint except `/`, `/ping`, and `/health/public` requires the caller's ORBIT session
token (the same JWT `netlify/functions/auth.ts` issues on login) — the agent
verifies it and uses the `sub` claim as the user id to scope Gmail
credentials and dev-server tracking. Two people running ORBIT against the
same agent never see each other's data — except Docker, which reflects
whatever's actually running on this machine and can't be split per user.

Postgres servers ("machines") aren't scoped this way at all anymore — they're
not stored on this machine, full stop. See "Postgres: stateless by design"
below.

The agent ships with the project's Legacy JWT Secret hardcoded as the
default, so this works out of the box against the main Supabase project —
nothing to configure. Pointing a local build at a **different** Supabase
project needs the matching secret (`SUPABASE_JWT_SECRET` — Supabase Project
Settings → API → JWT Settings → Legacy JWT Secret), as an environment
variable or a local config file that overrides the default:

```bash
cp agent-config.example.json agent-config.json
# then paste the secret into "jwtSecret"
```

If that secret is ever wrong for the project you're pointed at, every
authenticated request 401s and ORBIT's topbar will still show "Agent
connected" (that only checks `/ping`) even though nothing else works — check
the agent's terminal output if Docker/Postgres/Gmail panels stay empty.

## Postgres: stateless by design

Saved Postgres servers ("machines") live in Supabase (`pg_servers`, RLS-scoped
per user) — see `supabase/schema.sql` (fresh installs) / `supabase/migrations.sql`
(existing installs) — and
are managed straight from the browser via the Supabase client, no agent
involved. The agent itself stores nothing about them and never did a lookup
by id: every `/pg/*` route (`test`, `databases`, `tables`, `schema`, `query`,
`health`) takes the connection details inline in the request body
(`{ server: {host,port,user,password,ssl}, database }`) and opens a one-shot
connection with the `pg` driver. If you're pointing an agent build at a
different Supabase project than the web app, that's fine — the agent never
talks to Supabase itself, only the browser does, so there's nothing to
reconfigure here for Postgres.

## Per-user config files (gitignored — never commit these)

- `gmail-config.json` — `{ "<user-id>": { "user": "...", "pass": "..." } }`.

No environment-variable fallback and no inheriting an old shared config —
each account's Gmail is entirely separate, keyed by their ORBIT user id. If
the file predates per-user scoping (a flat `{ user, pass }` object), the
agent treats it as unset rather than guessing whose it was; reconnect Gmail
from Settings once per account.

## HTTPS

For a Netlify (HTTPS) page → localhost without mixed-content warnings, serve the
agent over HTTPS with a locally-trusted cert:

```bash
mkcert -install
mkcert localhost 127.0.0.1
# then wrap the app in https.createServer({ key, cert }, app)
```

Prefer .NET? Swap this Node service for a .NET minimal API exposing the same
routes — the web app doesn't care which runs, as long as it verifies the same
JWT the same way.
