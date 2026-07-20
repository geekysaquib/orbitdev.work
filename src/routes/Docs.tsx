import { Icon } from "../lib/icons";

const SECTIONS = [
  ["start", "Getting started"],
  ["agent", "The local agent"],
  ["launch", "Start Work & launching apps"],
  ["projects", "Projects"],
  ["project-detail", "Project detail"],
  ["ask-ai", "Ask AI"],
  ["tasks", "Tasks"],
  ["tickets", "Tickets"],
  ["zoho", "Zoho Sprints"],
  ["insights", "Insights"],
  ["automation", "Automation"],
  ["time", "Time tracking"],
  ["calendar", "Calendar & notifications"],
  ["mail", "Mail"],
  ["docker", "Docker"],
  ["postgres", "PostgreSQL"],
  ["chores", "Break chores & idle detection"],
  ["integrations", "Integrations & Health"],
  ["teams", "Teams"],
  ["appearance", "Appearance & account"],
  ["palette", "Command palette"],
  ["audit", "Audit log"],
  ["data", "Data & security"],
  ["faq", "FAQ"],
];

export default function Docs() {
  const go = (id: string) => document.getElementById("d-" + id)?.scrollIntoView({ behavior: "smooth" });
  return (
    <main className="page">
      <div className="rowhead">
        <div>
          <div className="h1" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: "var(--mint)" }}><Icon name="book" size={22} /></span>Docs
          </div>
          <div className="sub">How ORBIT works and how to operate every part of it.</div>
        </div>
      </div>

      <div className="docs" style={{ marginTop: 24 }}>
        <nav className="docs-nav">
          {SECTIONS.map(([id, label]) => (
            <a key={id} onClick={() => go(id)} style={{ cursor: "pointer" }}>{label}</a>
          ))}
        </nav>

        <div className="docs-body">
          <h2 id="d-start">Getting started</h2>
          <p>ORBIT is your personal developer command center. It keeps every project, work item, task,
            and time log in one place, and — through a small companion agent running on your machine —
            lets you launch your whole dev environment for a project in one click.</p>
          <p>Your account and all data are stored in Supabase and scoped to you with row-level security,
            so nobody else can read your projects. Sign in once and every screen is populated from your
            own workspace.</p>
          <ol>
            <li>Add your projects on the <b>Projects</b> screen (name, client, frontend folder, backend <code>.sln</code>).</li>
            <li>Start the local agent so ORBIT can open apps, run git/Docker, and browse Postgres for you (see below).</li>
            <li>Connect Zoho Sprints in <b>Settings</b> to pull your work items.</li>
            <li>Hit <b>Start Work</b> to pull, boot, and start timing a project's environment in one click.</li>
            <li>Once you're set up, try <b>Ask AI</b> (top bar or <code>Ctrl/Cmd+K</code>) for a grounded answer about your day, and set up an <b>Automation</b> rule to skip a repetitive step.</li>
          </ol>

          <h2 id="d-agent">The local agent</h2>
          <p>Browsers can't open native apps like VS Code or Visual Studio, read your Docker containers, or
            run <code>git</code>. ORBIT solves this with a tiny background service — the agent — that runs
            on your machine and exposes a local endpoint ORBIT talks to. When the agent is running, the
            topbar pill turns green and reads "Agent connected". Beyond launching apps, the same agent
            powers the Docker and PostgreSQL tabs, the project terminal, AI commit/PR writing, break
            chores, and the in-app SQL/Docker tooling — most of the app degrades gracefully (with a clear
            "agent offline" notice) rather than breaking when it isn't running.</p>
          <p>Easiest path: download the prebuilt Windows app from <b>Settings → Local agent</b> and
            double-click it — no install, no console window. Building it from source instead:</p>
          <div className="cq">cd agent
npm install
npm start        # listens on http://localhost:47600</div>
          <p>For a deployed (HTTPS) ORBIT to reach the agent without browser mixed-content warnings, serve
            the agent over HTTPS with a locally-trusted certificate:</p>
          <div className="cq">mkcert -install
mkcert localhost 127.0.0.1</div>
          <p>Prefer .NET? The agent is swappable — any service exposing the same endpoints works; ORBIT
            doesn't care what language it's written in. If a packaged agent behaves oddly after an ORBIT
            update, rebuild or re-download it — an old build can be missing newer routes.</p>

          <h2 id="d-launch">Start Work & launching apps</h2>
          <p>Each project card and the project detail page have launch buttons. With the agent running:</p>
          <ul>
            <li><b>Open UI</b> — opens the frontend folder in VS Code.</li>
            <li><b>Backend</b> — opens the <code>.sln</code> in Visual Studio.</li>
            <li><b>Terminal</b> / <b>Browser</b> — opens a terminal in the project folder, or your dev URL.</li>
            <li><b>Open all</b> — runs all of the above together.</li>
          </ul>
          <p>If the agent is offline, ORBIT tells you instead of failing silently — nothing breaks, you
            just won't get the native launch until the agent is up.</p>
          <p><b>Start Work</b> (topbar) goes further: pick any of your active projects, and ORBIT walks
            each one through <code>git pull</code> → checks whether its dev port is already in use →
            starts it with the command it detects for your stack (<code>npm run dev</code> for
            Vite/Next, <code>npm start</code> for React/Angular/Vue). Each project shows its own live
            status — <i>Pulling…</i>, <i>Checking port…</i>, <i>Starting…</i>, <i>Running</i>,
            <i> Skipped</i> (port already in use), or <i>Failed</i> — and a running project gets a
            <b> Logs</b> button that opens a live tail of its dev-server output. Dev servers keep running
            in the background after you close the modal.</p>

          <h2 id="d-projects">Projects</h2>
          <p>The Projects screen is your registry. Add a project with the <b>New project</b> button; use
            the <b>Browse</b> buttons next to the path fields to pick the frontend folder and backend
            <code>.sln</code> with a native dialog (this also needs the agent running). Filters let you
            narrow to <b>Client work</b>, <b>Personal</b>, <b>Active</b>, or <b>On hold</b>, and the search
            box matches name, client, stack, and branch. The <b>Branch</b> column shows each project's
            live git branch, read straight from the agent, with a refresh icon to recheck all of them.
            Click any row to open its detail view.</p>
          <p>Projects can be personal (only you see them) or shared with a team — see <b>Teams</b> below.
            Only the owner (or a team admin, once shared) can edit a project.</p>

          <h2 id="d-project-detail">Project detail</h2>
          <p>Opening a project gives you six tabs:</p>
          <ul>
            <li><b>Overview</b> — description, stack chips, paths, its Zoho Sprints link (jump straight
              to that project's board), team sharing, and a few quick-action shortcuts.</li>
            <li><b>Tasks</b> — a mini kanban of just this project's tasks.</li>
            <li><b>Git</b> — local working-tree status (branch, ahead/behind, uncommitted file count,
              last commit) with a <b>Pull</b> button and an <b>AI commit message</b> button that reads your
              staged (or unstaged) diff and drafts a message; a remote panel once you <b>Link a
              repository</b> (GitHub/GitLab/Azure DevOps) showing recent CI runs, open pull requests, and
              recent commits; and a branch-picker commit graph below with click-to-view diffs and an
              <b> AI PR description</b> button when you're on a non-default branch.</li>
            <li><b>Terminal</b> — a project-scoped terminal: type a command, hit Enter, it runs to
              completion in that project's folder via the agent and appends its output. One shot at a
              time, not an interactive shell.</li>
            <li><b>Environment</b> and <b>Notes</b> — placeholders reserved for future env-var/container
              management and free-form notes; nothing is wired up on these two tabs yet.</li>
          </ul>

          <h2 id="d-ask-ai">Ask AI</h2>
          <p>Ask AI is available everywhere — the topbar sparkle icon, or <code>Ctrl/Cmd+K</code> →
            "Ask AI". It's grounded in a live snapshot of your workspace (projects, tasks, tickets, and
            your Zoho sprint boards), so answers like "what should I focus on today" or "summarize my open
            work" reflect your real data rather than a generic reply. Conversations support follow-ups —
            the thread stays open even if you close and reopen the modal — and answers can include
            clickable actions (open a ticket, jump to a project, start a timer on something) rather than
            just text.</p>
          <p>Under the hood it tries your preferred AI provider first (Anthropic, Gemini, OpenAI, or Grok
            — whichever you've saved a key for in <b>Settings → AI providers</b>), then any other
            configured provider, then falls back to a free local model that runs on your machine via the
            agent — no key required. If it had to fall back, a toast tells you which provider was tried
            and which one actually answered.</p>

          <h2 id="d-tasks">Tasks</h2>
          <p>The <b>Tasks</b> board is a four-column kanban (to do → in progress → review → done) across
            all your projects. Add a task with the input at the top (pick a priority chip first), then
            drag cards between columns — priority also cycles by clicking the priority label on a card.
            Each card lets you set an <b>estimate</b> in minutes (used by Insights' estimate-accuracy
            view), shows its due date once set, and — if you're on a team — a "Share with {"{team}"}"
            selector to make it visible to teammates instead of just you. Filter by project or hide done
            cards with the toolbar controls.</p>

          <h2 id="d-tickets">Tickets</h2>
          <p>The <b>Tickets</b> screen shows work items synced from Zoho Sprints. Hit the sync icon to
            pull the latest; new items are auto-triaged by AI the moment they're synced (priority,
            matching project, and a short note are filled in automatically). Select a ticket to update its
            status (<b>In progress</b> / <b>Close</b>), re-run <b>AI triage</b> manually at any time, or
            spin it into a task. Tickets are deep-linkable — a link like <code>/tickets?id=…</code> selects
            that ticket directly, which is how Ask AI's "open ticket" action and shared links work.</p>

          <h2 id="d-zoho">Zoho Sprints</h2>
          <p>ORBIT pulls your Zoho <b>Sprints</b> work items into the Tickets screen. Credentials live
            server-side (in a Netlify function), never in the browser, and are scoped to your account.
            Connect from <b>Settings → Zoho Sprints</b>, which walks through this same checklist with
            a copy button and a live exchange step, but here's the full picture:</p>
          <ol>
            <li>Open the Zoho API Console for your data center (<code>api-console.zoho.in</code>,
              <code>.com</code>, <code>.eu</code>, etc.) and sign in with the Zoho account that has
              access to your Sprints team.</li>
            <li>Click <b>Add Client</b> (or <b>Get Started</b> the first time), choose <b>Self
              Client</b> as the type, and confirm/<b>CREATE</b>. Self Client is the right choice here —
              it doesn't need a redirect URL.</li>
            <li>On the <b>Client Secret</b> tab, copy the <b>Client ID</b> and <b>Client Secret</b> —
              these go straight into ORBIT.</li>
            <li>Switch to the <b>Generate Code</b> tab. Paste this scope into <i>Scope</i>, write
              anything in <i>Scope Description</i>, set <i>Time Duration</i> to a few minutes, then
              <b> CREATE</b>:</li>
          </ol>
          <div className="cq">ZohoSprints.teams.READ,ZohoSprints.projects.READ,ZohoSprints.sprints.READ,ZohoSprints.items.READ</div>
          <ol start={5}>
            <li>Zoho shows a <b>code</b> — it's single-use and expires within minutes. Copy it.</li>
            <li>Back in ORBIT → Settings → Zoho Sprints, paste the Client ID, Client Secret and that
              code, then hit <b>Exchange for tokens</b>. ORBIT does the code-for-refresh-token
              exchange server-side — no terminal, no curl — and fills in the Refresh Token field.</li>
            <li>Hit <b>Save & connect</b> and you're done. ORBIT auto-discovers your team and default
              project; pin a Team ID / Project ID only if you want to skip that lookup.</li>
          </ol>
          <p>Once connected, it stays connected across sign-outs — no need to reconnect after logging
            back in. If the code expires before you paste it (they're short-lived), just generate a
            fresh one from the same <b>Generate Code</b> tab and try again.</p>
          <p>The <b>Sprints</b> screen shows the full board for a linked Zoho project: sprint tabs across
            the top, search plus type/priority/assignee filters, and a <b>Velocity</b> toggle once a
            project has more than one sprint. Click any card to see its full description and attachments —
            images and video preview inline in a lightbox, other files open in Zoho.</p>

          <h2 id="d-insights">Insights</h2>
          <p>The <b>Insights</b> screen has four tabs, all computed live from your existing data — nothing
            here needs separate setup beyond linking a project to a repo and/or Zoho:</p>
          <ul>
            <li><b>Health</b> — a 0-100 score per active project from up to four signals: open-PR age,
              days since last commit, open bug count, and sprint-to-sprint velocity trend. Any signal
              without a linked source (no repo, no Zoho project) is simply skipped rather than faked, and
              a project with zero available signals shows "Not enough data" instead of a score.</li>
            <li><b>Weekly retrospective</b> — this week's logged time by project, tasks completed, and
              commits/PRs on repo-linked projects.</li>
            <li><b>Estimate accuracy</b> — compares each task's estimate (set on its Tasks card) against
              the time actually logged against it.</li>
            <li><b>Focus analytics</b> — interruption frequency, most-interrupted hours, and your longest
              same-day gap without an idle/resume event (a rough "deep work streak"), built from the
              idle-detection events described below.</li>
          </ul>

          <h2 id="d-automation">Automation</h2>
          <p>The <b>Automation</b> screen is a "when X, then Y" rule list. Hit <b>New rule</b>, name it,
            then pick:</p>
          <ul>
            <li><b>When</b> — a task's status changes, a ticket's status changes, or a timer starts/stops,
              optionally narrowed to one status or one project.</li>
            <li><b>Then</b> — create a task, set a task/ticket status, send a notification, or start a
              timer (optionally on whatever project triggered the rule).</li>
          </ul>
          <p>The form only shows fields relevant to what you've picked — a timer trigger won't ask for a
            status, and an action that doesn't match its trigger's kind (e.g. "set ticket status" on a
            task trigger) is disabled with an explanation. Each rule in the list shows how many times it's
            run and when, and can be paused, edited, or deleted without losing that history. Rules run the
            moment the triggering change happens, through the same permissions you'd have doing it by
            hand — so a rule can never do something you couldn't do yourself.</p>

          <h2 id="d-time">Time tracking</h2>
          <p>The <b>Time</b> screen shows Orbit focus hours and Zoho Sprints logged hours side by side, so
            you can see both at a glance. Pick a project and (optionally) a task before hitting
            <b> Start</b> — the running timer shows what it's logging to. Stopping it logs the session and
            shows how long you tracked. If <b>idle detection</b> is on (Settings → Account), the timer
            auto-pauses after a set number of minutes of no activity in this browser tab, and resumes when
            you're back. Below the timer, Zoho hours break down by project and by person once Zoho Sprints
            is connected.</p>

          <h2 id="d-calendar">Calendar & notifications</h2>
          <p>The <b>Calendar</b> gives a month view of deadlines, meetings, focus blocks, and reviews —
            click any day to add an event. For a <b>meeting</b>, you can also check "Create a Microsoft
            Teams meeting" to have ORBIT generate a real join link (needs Microsoft Teams connected in
            Settings first); the link appears on the event and is one click to join from the calendar.</p>
          <p><b>Notifications</b> collects ticket assignments, deploys, git events, and deadline
            reminders; unread items show a dot on the rail icon. Use <b>Preferences</b> to turn on desktop
            alerts and mute specific notification types, and <b>Mark all read</b> to clear the list. A
            "Today's digest" strip groups the day's notifications by type before the full list.</p>

          <h2 id="d-mail">Mail</h2>
          <p>Connect Gmail in <b>Settings → Gmail</b> with your address and a Google <b>App Password</b>
            (2-Step Verification → App passwords, not your normal Google password) — Mail runs through the
            local agent, so it also needs the agent online. Once connected you get a two-pane inbox with
            <b> All</b>/<b>Unread</b>/<b>Promotions</b> tabs and search. Selecting a message opens it in a
            sandboxed reading pane with:</p>
          <ul>
            <li><b>Compose</b> / <b>Reply</b> — a small rich-text editor (bold/italic/underline, lists,
              links) with file attachments up to 20MB each, and your mail signature auto-appended to a
              fresh compose.</li>
            <li><b>AI draft</b> — drafts a reply grounded only in the open thread (it won't invent facts
              or commitments that aren't in the email).</li>
            <li><b>Create ticket</b> — turns an email (with its attachment list) into a ticket, for
              messages that have attachments.</li>
            <li><b>Templates</b>, <b>Rules</b>, and <b>Scheduled</b> — reusable message templates you can
              drop into a compose; simple "notify me when a message's from/subject contains X" rules; and
              a queue of messages scheduled to send later (scheduled messages can't carry attachments yet
              — remove them or send immediately instead).</li>
          </ul>
          <p>Mail auto-refreshes every couple of minutes while the tab is open, and <b>Disconnect</b>
            clears both the agent's local session and the saved credentials.</p>

          <h2 id="d-docker">Docker</h2>
          <p>The <b>Docker</b> screen reads your local Docker Desktop through the agent (needs the agent
            online, and Docker Desktop running with <code>docker</code> on your PATH). You can:</p>
          <ul>
            <li><b>Build an image</b> from a project — pick a project and it fills in a sensible tag and
              build context; choose <b>Backend</b> or <b>Frontend</b> as the source, and <b>Browse</b> for
              the context folder or a non-default Dockerfile if needed.</li>
            <li>Manage <b>containers</b> — start/stop/restart, view <b>Logs</b> (including a live tail),
              <b> Exec</b> a single command inside a running container, or remove one; a <b>Resource
              usage</b> panel shows live CPU/memory for running containers.</li>
            <li>Bring stacks up or down from a <code>docker-compose.yml</code> path (<b>Compose
              stacks</b>).</li>
            <li>Export any image to a <code>.tar</code> file from the <b>Images</b> table.</li>
          </ul>

          <h2 id="d-postgres">PostgreSQL</h2>
          <p>The <b>Postgres</b> screen lets you browse and query databases through the agent. Add a
            server (host, port, user, password, default database, SSL toggle) with <b>Test</b> to confirm
            it connects before saving. Once added:</p>
          <ul>
            <li>Browse its <b>databases</b> and <b>tables</b>, and run ad-hoc SQL in a multi-tab query
              runner with a find-table palette to jump straight to any table's default query.</li>
            <li>View the database's structure as a <b>schema diagram</b>, or <b>diff</b> the live schema
              against a snapshot you took earlier.</li>
            <li><b>Seed dummy data</b> — generate realistic rows for testing: set a row count per table,
              exclude specific tables, and optionally describe the project in plain English to steer the
              generated data (this AI-assisted description step needs an Anthropic key specifically, even
              if you use another provider elsewhere).</li>
            <li><b>Backup</b> a database straight to a downloadable <code>.sql</code> file. (Restoring
              from a backup isn't built yet — export only, for now.)</li>
          </ul>

          <h2 id="d-chores">Break chores & idle detection</h2>
          <p>When you take a break from the Dashboard, ORBIT auto-pauses your focus timer and — if the
            agent is online — runs a real background sweep of your workspace instead of showing a fake
            "AI is coding" animation: <code>git pull</code> across your projects, <code>npm outdated</code>
            /<code>npm audit</code>, open-bug/sprint-burndown/review/blocked counts from Zoho, drift
            between your Orbit hours and Zoho-logged hours, unread mail, Docker container/image/disk
            status (with an opt-in prune of dangling images), Postgres server health, dev-port
            conflicts, and which dev servers are currently running. Each finding streams into a live feed
            as it's found, and ending the break leaves a digest notification summarizing what happened.
            Configure which chores run, how often, and whether warnings should also post a notification,
            in <b>Settings → Break chores</b> — every chore is read-only except the explicitly-labeled
            Docker prune, which is off by default.</p>
          <p><b>Idle detection</b> (Settings → Account) is the related, simpler mechanism that pauses your
            running timer after a chosen number of minutes of no mouse/keyboard activity in the ORBIT tab
            — it only sees activity in this browser tab, so it won't notice you're active elsewhere (e.g.
            coding in your editor with ORBIT in the background).</p>

          <h2 id="d-integrations">Integrations & Health</h2>
          <p>The <b>Health</b> page is a single glance at every integration ORBIT relies on — agent, Zoho,
            Gmail, GitHub, GitLab, Azure DevOps, Microsoft Teams, Sentry, Cloud (Netlify/Vercel/AWS),
            Docker, Postgres, local AI (with a one-click <b>Test</b>), and any cloud AI keys you've set —
            each with a "Fix in Settings" or "Set up" link straight to the right place. Recheck everything
            at once with the button at the top.</p>
          <p>Connecting a provider happens in <b>Settings</b>, and each one follows the same pattern as
            Zoho above — bring your own credentials, nothing shared across ORBIT users:</p>
          <ul>
            <li><b>GitHub</b>, <b>GitLab</b>, and <b>Microsoft Teams</b> — bring your own OAuth app
              (you create the app in that provider's developer settings, paste its Client ID/Secret into
              ORBIT, then connect through a popup). GitLab also takes a base URL, so self-hosted instances
              work. Microsoft Teams additionally needs a Directory (tenant) ID and the
              <code> User.Read</code>/<code>OnlineMeetings.ReadWrite</code> Graph permissions, since it's
              used to create real Teams meetings from Calendar events.</li>
            <li><b>Azure DevOps</b> — organization name + a Personal Access Token, no OAuth popup.</li>
            <li><b>Sentry</b> — an Internal Integration token (Project: Read, Issue & Event: Read) plus
              your org slug.</li>
            <li><b>Cloud</b> — three independent connections: a Netlify Personal Access Token, a Vercel
              Personal Access Token, and an AWS IAM access key scoped to just
              <code> ce:GetCostAndUsage</code> for cost/status data.</li>
          </ul>
          <p>Once GitHub/GitLab/Azure DevOps is connected, its Settings panel shows which of your projects
            are already linked to it — link more from a project's <b>Git</b> tab.</p>

          <h2 id="d-teams">Teams</h2>
          <p>Create a team from the <b>Teams</b> screen, then invite people by email with a role
            (<b>Member</b>, <b>Admin</b>, or <b>Viewer</b>) — they get an emailed link that expires in 7
            days and only works for that address. Owners and admins can change roles, remove members, or
            resend/revoke a pending invite; any non-owner can leave a team themselves. The team detail view
            also shows who's <b>live</b> right now and a running <b>activity</b> feed of what's changed.
            Sharing itself happens elsewhere in the app — a project or task owned by you gets a
            "Share with {"{team}"}" selector (Project overview / task card) that makes it visible to
            everyone on that team, read-only unless they're an owner or admin.</p>

          <h2 id="d-appearance">Appearance & account</h2>
          <p>In <b>Settings → Appearance</b>: pick a theme, an accent color (presets or a custom hex),
            a font, and a density. The dashboard's stat tiles can be shown/hidden here too, or reordered
            and resized directly on the Dashboard itself with <b>Customise</b> — drag a tile's edge to
            resize, or drag the tile to reorder.</p>
          <p><b>Settings → Account</b> covers your display timezone (clocks and timestamps across ORBIT
            follow it), idle-detection on/off and its threshold, the setup guide (re-run onboarding at any
            time), a shortcut to the Health page, and sign out.</p>

          <h2 id="d-palette">Command palette</h2>
          <p>Press <code>Ctrl/Cmd+K</code> anywhere in ORBIT to open the command palette — type to jump to
            any page, or trigger a handful of quick actions (new project, compose an email, a new SQL
            query, or open <b>Ask AI</b>). Arrow keys move the selection, Enter runs it, Esc closes it.</p>

          <h2 id="d-audit">Audit log</h2>
          <p>The <b>Audit log</b> is a durable, filterable record of sign-ins, integration connect/update/
            disconnect events, and work-item changes (tasks, tickets, projects, Postgres servers, team
            membership, onboarding) on your account — filter by action or entity type, paginated 50 rows
            at a time.</p>

          <h2 id="d-data">Data & security</h2>
          <p>All app data lives in your Supabase Postgres with row-level security, so every row is tied to
            your user id. Integration secrets (like Zoho, GitHub, Gmail) stay server-side. The agent only
            listens on localhost and only accepts requests from ORBIT's origins.</p>
          <p>Sign-in is ORBIT's own — it never touches Supabase Auth. Passwords are hashed with bcrypt and
            verified server-side; a forgotten password requires an emailed one-time code, never a
            plaintext reset link. Every sign-in also emails you the time, approximate location, and
            device, so you'd notice if it wasn't you. Break-chore digests are retained in a
            <code> break_logs</code> table for your own history.</p>

          <h2 id="d-faq">FAQ</h2>
          <div className="docs-card"><b>The Agent pill says offline.</b><p style={{ margin: "6px 0 0" }}>Start it with <code>npm start</code> in the <code>agent</code> folder, then click the pill to re-check. On a deployed site, the agent needs HTTPS (mkcert).</p></div>
          <div className="docs-card"><b>Sync pulls nothing from Zoho.</b><p style={{ margin: "6px 0 0" }}>Confirm the <code>ZOHO_*</code> env vars are set in Netlify and your data center is right (<code>ZOHO_DC=in</code> for India). The function returns <code>meta.sampleKeys</code> to help map fields.</p></div>
          <div className="docs-card"><b>The app is blank after deploy.</b><p style={{ margin: "6px 0 0" }}>Env vars must be set before the build — add them in Netlify and trigger a fresh deploy.</p></div>
          <div className="docs-card"><b>Ask AI / AI triage says no provider is available.</b><p style={{ margin: "6px 0 0" }}>Add a key for any of Anthropic/Gemini/OpenAI/Grok in Settings → AI providers, or just wait — the free local model is the automatic fallback and needs no key, though its first run downloads a small model.</p></div>
          <div className="docs-card"><b>Mail says "Start the ORBIT agent".</b><p style={{ margin: "6px 0 0" }}>Gmail is read through the local agent, not directly from the browser — start the agent, then reopen Mail.</p></div>
          <div className="docs-card"><b>An Automation rule isn't firing.</b><p style={{ margin: "6px 0 0" }}>Check it isn't paused (the rule list shows "paused" and its run count/last-run time), and that the trigger's project filter (if any) matches the item you changed.</p></div>
        </div>
      </div>
    </main>
  );
}
