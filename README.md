# ORBIT

Your personal developer command center — one place to launch every project, track
tickets/tasks/time, run your Start-Work macro, and see it all in a control-room UI.

- **Stack:** React 19 + Vite 7 + TypeScript, React Router 7
- **Data + auth:** Supabase (Postgres + Auth, row-level security)
- **Native launches:** a small local agent (Node) that opens VS Code / Visual Studio
- **Zoho:** pulled through a Netlify function so secrets stay server-side
- **Design:** the Claude Design "control-room" system (Space Grotesk / Instrument Sans / JetBrains Mono, mint `#37DFA0`)

## 1. Install

```bash
npm install
cp .env.example .env      # then fill in the values below
```

## 2. Supabase

1. Create a project at supabase.com.
2. **SQL Editor → New query →** paste `supabase/schema.sql` → Run. This creates all
   tables, the signup trigger, and RLS policies.
3. Project Settings → API → copy the **Project URL** and **anon key** into `.env`:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Email confirmations are on by default. For instant local testing, turn off
"Confirm email" in Supabase → Authentication → Providers → Email.

## 3. Run

```bash
npm run dev            # http://localhost:5173
```

Create an account on the login screen, then add projects from the Projects tab.

## 4. Local agent (VS Code / Visual Studio launches)

```bash
cd agent && npm install && npm start   # http://localhost:47600
```

The topbar pill shows "Agent connected" once it's up. See `agent/README.md` for the
HTTPS/mkcert setup and how to swap in a .NET agent.

## 5. Zoho Sprints (work items)

You're on Zoho **Sprints**, not Desk, so the Tickets screen pulls Sprints work items.
In the Zoho API Console (matching your DC, e.g. `api-console.zoho.in`) create a
**Self Client**, Generate Code with scope
`ZohoSprints.teams.READ,ZohoSprints.projects.READ,ZohoSprints.sprints.READ,ZohoSprints.items.READ`,
then exchange it for a refresh token. Set the `ZOHO_*` vars in Netlify
(see `netlify/functions/README.md`) and hit **Sync** on the Tickets screen.
Locally, `netlify dev` serves the function. The function auto-discovers your team and
project; pin `ZOHO_TEAM_ID` / `ZOHO_PROJECT_ID` once you know them for speed.

## 6. Deploy (Netlify)

```bash
npm run build          # tsc + vite build → dist/
```

Connect the repo in Netlify (config is in `netlify.toml`). Set env vars:
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_AGENT_URL`, and the `ZOHO_*` keys.

## What's wired vs. what needs credentials

- **Fully wired:** Supabase auth (login / create account / session guard), and
  Supabase-backed CRUD for projects, tasks, calendar events, notifications, tickets.
- **Needs your keys:** Supabase URL/anon key (app is blank without them), Zoho
  (`ZOHO_*`), and the local agent must be running for IDE launches.
- **Presentational for now:** the Time charts and Automation rules/jobs use local
  state; the schema has `time_entries` + `integrations` tables ready to back them.

## Layout

```
src/
  lib/         supabase, agent, zoho clients + types + icons
  context/     AuthContext, Toast
  hooks/       useTable (generic RLS-scoped CRUD)
  components/  Layout (rail + topbar), ui atoms
  routes/      Login, Dashboard, Projects, ProjectDetail, Tickets, Tasks,
               Calendar, Notifications, Automation, TimeTracking, Settings
supabase/      schema.sql (tables + RLS + triggers), seed.sql
netlify/       functions/zoho-tickets.ts
agent/         server.mjs (local companion)
```
