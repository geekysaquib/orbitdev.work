import { Icon } from "../lib/icons";

const SECTIONS = [
  ["start", "Getting started"],
  ["agent", "The local agent"],
  ["launch", "Launching apps"],
  ["projects", "Projects"],
  ["zoho", "Zoho Sprints"],
  ["tasks", "Tasks & tickets"],
  ["calendar", "Calendar & notifications"],
  ["automation", "Automation"],
  ["time", "Time tracking"],
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
            <li>Start the local agent so ORBIT can open apps for you (see below).</li>
            <li>Connect Zoho Sprints in <b>Settings</b> to pull your work items.</li>
            <li>Hit <b>Start Work</b> to boot a project's environment and start a timer.</li>
          </ol>

          <h2 id="d-agent">The local agent</h2>
          <p>Browsers can't open native apps like VS Code or Visual Studio. ORBIT solves this with a tiny
            background service — the agent — that runs on your machine and exposes a local endpoint ORBIT
            talks to. When the agent is running, the topbar pill turns green and reads "Agent connected".</p>
          <div className="cq">cd agent
npm install
npm start        # listens on http://localhost:47600</div>
          <p>For a deployed (HTTPS) ORBIT to reach the agent without browser mixed-content warnings, serve
            the agent over HTTPS with a locally-trusted certificate:</p>
          <div className="cq">mkcert -install
mkcert localhost 127.0.0.1</div>
          <p>Prefer .NET? The agent is swappable — any service exposing the same <code>/ping</code>,
            <code>/launch</code>, <code>/pick</code>, and <code>/macro</code> endpoints works; ORBIT
            doesn't care what language it's written in.</p>

          <h2 id="d-launch">Launching apps</h2>
          <p>Each project card and the project detail page have launch buttons. With the agent running:</p>
          <ul>
            <li><b>Open UI</b> — opens the frontend folder in VS Code.</li>
            <li><b>Backend</b> — opens the <code>.sln</code> in Visual Studio.</li>
            <li><b>Terminal</b> / <b>Browser</b> — opens a terminal in the project folder, or your dev URL.</li>
            <li><b>Open all</b> — runs all of the above together.</li>
          </ul>
          <p>If the agent is offline, ORBIT tells you instead of failing silently — nothing breaks, you
            just won't get the native launch until the agent is up.</p>

          <h2 id="d-projects">Projects</h2>
          <p>The Projects screen is your registry. Add a project with the <b>New project</b> button; use
            the <b>Browse</b> buttons next to the path fields to pick the frontend folder and backend
            <code>.sln</code> with a native dialog (this also needs the agent running). Filters let you
            narrow to client work, personal work, active, or on-hold. Click any row to open its detail
            view with tabs for overview, tasks, git, environment, and notes.</p>

          <h2 id="d-zoho">Zoho Sprints</h2>
          <p>ORBIT pulls your Zoho <b>Sprints</b> work items into the Tickets screen. Credentials live
            server-side (in a Netlify function), never in the browser. To connect, create a Self Client in
            the Zoho API Console for your data center, generate a grant code with these scopes, and
            exchange it for a refresh token:</p>
          <div className="cq">ZohoSprints.teams.READ,ZohoSprints.projects.READ,ZohoSprints.sprints.READ,ZohoSprints.items.READ</div>
          <p>Set <code>ZOHO_CLIENT_ID</code>, <code>ZOHO_CLIENT_SECRET</code>,
            <code>ZOHO_REFRESH_TOKEN</code>, and <code>ZOHO_DC</code> (e.g. <code>in</code>) in your
            Netlify environment, then hit <b>Sync</b> on the Tickets screen. ORBIT resolves your team and
            project automatically; you can pin <code>ZOHO_TEAM_ID</code> / <code>ZOHO_PROJECT_ID</code>
            once you know them.</p>

          <h2 id="d-tasks">Tasks & tickets</h2>
          <p>The <b>Tasks</b> board is a four-column kanban (to do → in progress → review → done) across
            all your projects. Add a task with the input at the top and move cards with the arrows.
            The <b>Tickets</b> screen shows synced Zoho work items; select one to see its detail, update
            its status, or spin it into a task.</p>

          <h2 id="d-calendar">Calendar & notifications</h2>
          <p>The <b>Calendar</b> gives a month view of deadlines, meetings, focus blocks, and reviews —
            click any day to add an event. <b>Notifications</b> collects ticket assignments, deploys, git
            events, and deadline reminders; unread items show a dot on the rail icon, and you can mark
            individual items or everything as read.</p>

          <h2 id="d-automation">Automation</h2>
          <p>The <b>Automation</b> screen holds your Start-Work and End-Work macros, if-this-then-that
            rules, and scheduled jobs. Start Work runs an ignition sequence — pull, containers, dev
            server, IDEs, Zoho sync, timer — so a project's whole environment comes up at once. Toggle
            rules and jobs on or off; scaffolding templates let you generate new modules.</p>

          <h2 id="d-time">Time tracking</h2>
          <p>Track focus per project with the timer, review your week at a glance, and see billable hours
            grouped by client. Export a client's hours as a timesheet from the table.</p>

          <h2 id="d-data">Data & security</h2>
          <p>All app data lives in your Supabase Postgres with row-level security, so every row is tied to
            your user id. Integration secrets (like Zoho) stay server-side. The agent only listens on
            localhost and only accepts requests from ORBIT's origins.</p>

          <h2 id="d-faq">FAQ</h2>
          <div className="docs-card"><b>The Agent pill says offline.</b><p style={{ margin: "6px 0 0" }}>Start it with <code>npm start</code> in the <code>agent</code> folder, then click the pill to re-check. On a deployed site, the agent needs HTTPS (mkcert).</p></div>
          <div className="docs-card"><b>Sync pulls nothing from Zoho.</b><p style={{ margin: "6px 0 0" }}>Confirm the <code>ZOHO_*</code> env vars are set in Netlify and your data center is right (<code>ZOHO_DC=in</code> for India). The function returns <code>meta.sampleKeys</code> to help map fields.</p></div>
          <div className="docs-card"><b>The app is blank after deploy.</b><p style={{ margin: "6px 0 0" }}>Env vars must be set before the build — add them in Netlify and trigger a fresh deploy.</p></div>
        </div>
      </div>
    </main>
  );
}
