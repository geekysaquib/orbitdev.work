// ORBIT local companion agent (headless — no GUI framework).
// Launches native apps the browser can't. Run: `node server.mjs`
// For https://localhost (no mixed-content issues), generate a trusted cert:
//   mkcert -install && mkcert localhost 127.0.0.1
// then set CERT/KEY paths below and use https.createServer.
//
// Every request (except / and /ping) must carry the same ORBIT session JWT the
// web app uses — the agent verifies it with SUPABASE_JWT_SECRET (the exact
// secret netlify/functions/auth.ts signs with) and trusts the `sub` claim as
// the caller's user id. Postgres servers, Gmail credentials, and dev-server
// tracking are all stored per user id, so two people running ORBIT against
// the same agent never see each other's data. Docker is the one exception —
// it reflects whatever's actually running on this machine, which by nature
// can't be split per user.

import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { spawn, execFile, exec } from "node:child_process";
import net from "node:net";
import { platform } from "node:os";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const sea = process.getBuiltinModule?.("node:sea");
const isPackaged = !!sea?.isSea();

// The packaged .exe should feel like an app, not a script: on Windows, the
// first launch is a normal (visible) console process — immediately respawn a
// second, fully hidden copy of itself (CREATE_NO_WINDOW) with a flag so it
// doesn't do this again, then exit. The hidden copy does the actual work
// below and opens the status page in the browser once it's listening.
if (isPackaged && process.platform === "win32" && !process.env.ORBIT_AGENT_HIDDEN) {
  spawn(process.execPath, process.argv.slice(2), {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
    env: { ...process.env, ORBIT_AGENT_HIDDEN: "1" },
  }).unref();
  process.exit(0);
}

// When bundled into a single-executable app (see build/build.mjs), import.meta.url
// points inside the embedded blob, not a real path on disk — config files must
// instead live next to the .exe the user actually launched.
const __dir = isPackaged ? dirname(process.execPath) : dirname(fileURLToPath(import.meta.url));
const GMAIL_CFG = join(__dir, "gmail-config.json");
const AGENT_CFG = join(__dir, "agent-config.json");

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

// ---- Auth: verify the same JWT netlify/functions/auth.ts issues ----
// Hardcoded as the default so the packaged .exe works with zero setup — this is
// Supabase's Legacy JWT Secret and does not rotate. Still overridable via env
// var or agent-config.json for local dev against a different Supabase project.
const DEFAULT_JWT_SECRET = "OumYPgsct1FfKyVhsCzAXJ6xgCt0lyxZDLD1qVLq1FmnCpuiJBcO7eKpQ2HPzTl8BxprGC/5inJLGFfaIhaniA==";
function jwtSecret() {
  if (process.env.SUPABASE_JWT_SECRET) return process.env.SUPABASE_JWT_SECRET;
  const fromConfig = readJson(AGENT_CFG, {}).jwtSecret;
  if (fromConfig) return fromConfig;
  return DEFAULT_JWT_SECRET;
}
const JWT_SECRET = jwtSecret();
function verifyToken(token) {
  const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
  const userId = typeof payload === "object" ? payload.sub : null;
  if (!userId) throw new Error("token has no sub claim");
  return userId;
}

const PUBLIC_PATHS = new Set(["/", "/ping", "/health/public"]);
function requireAuth(req, res, next) {
  if (PUBLIC_PATHS.has(req.path)) return next();
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
  if (!token) return res.status(401).json({ ok: false, error: "unauthorized — sign in to ORBIT first" });
  try {
    req.userId = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ ok: false, error: "unauthorized — sign in again" });
  }
}

// ---- Gmail (read-only IMAP, app password) — strictly one credential set per
// user, keyed by their ORBIT user id. No environment-variable fallback and no
// inheriting an old shared config: every account links its own Gmail here.
function gmailCredsAll() {
  const cfg = readJson(GMAIL_CFG, {});
  return cfg && typeof cfg === "object" && !Array.isArray(cfg) && typeof cfg.user !== "string" ? cfg : {};
}
function gmailCreds(userId) {
  return gmailCredsAll()[userId] || null;
}
function saveGmailCreds(userId, user, pass) {
  const all = gmailCredsAll();
  all[userId] = { user, pass };
  writeFileSync(GMAIL_CFG, JSON.stringify(all, null, 2), "utf8");
}
function deleteGmailCreds(userId) {
  const all = gmailCredsAll();
  delete all[userId];
  try { writeFileSync(GMAIL_CFG, JSON.stringify(all, null, 2), "utf8"); } catch { /**/ }
}

const imapClients = new Map(); // userId -> ImapFlow client
async function getClient(userId) {
  const c = gmailCreds(userId);
  if (!c) throw new Error("Gmail not configured");
  const existing = imapClients.get(userId);
  if (existing && existing.usable) return existing;
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: c.user, pass: c.pass }, logger: false, emitLogs: false });
  client.on("close", () => { if (imapClients.get(userId) === client) imapClients.delete(userId); });
  client.on("error", () => { try { client.close(); } catch { /**/ } if (imapClients.get(userId) === client) imapClients.delete(userId); });
  await client.connect();
  imapClients.set(userId, client);
  return client;
}
function resetClient(userId) {
  const c = imapClients.get(userId);
  try { c?.close(); } catch { /**/ }
  imapClients.delete(userId);
}
async function withImap(userId, fn) {
  const client = await getClient(userId);
  try { return await fn(client); }
  catch (e) { resetClient(userId); throw e; } // drop a bad connection so the next call reconnects clean
}

const app = express();
const PORT = process.env.PORT || 47600;

// Restrict to your ORBIT origins.
app.use(cors({
  origin: [
    /^https?:\/\/localhost(:\d+)?$/,
    /\.netlify\.app$/,
    "https://orbitdev.work"
  ],
  credentials: false
}));
app.use(express.json());
app.use(requireAuth);

const isWin = platform() === "win32";

// Run a shell command STRING (so we control quoting ourselves — critical on
// Windows where paths contain spaces and spawn(shell:true) joins args unquoted).
function runShell(cmdString) {
  try { spawn(cmdString, { detached: true, stdio: "ignore", shell: true, windowsHide: true }).unref(); return true; }
  catch { return false; }
}
// Normalise a path for the current OS and wrap in quotes.
function q(p) {
  if (!p) return "";
  let s = String(p).trim().replace(/^["']|["']$/g, "");
  if (isWin) s = s.replace(/\//g, "\\");   // code/start dislike forward slashes on Windows
  return `"${s}"`;
}

function openVSCode(p) { if (!p) return false; return runShell(`code ${q(p)}`); }
function openVisualStudio(sln) {
  if (!sln) return false;
  return isWin ? runShell(`start "" ${q(sln)}`) : runShell(`open ${q(sln)}`);
}
function openTerminal(p) {
  if (isWin) return runShell(p ? `wt -d ${q(p)}` : `wt`);
  return runShell(`x-terminal-emulator`);
}
function openBrowser(port) {
  const url = `http://localhost:${port || 3000}`;
  return isWin ? runShell(`start "" "${url}"`) : runShell(`open "${url}"`);
}

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>ORBIT agent</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{height:100vh;display:grid;place-items:center;background:radial-gradient(900px 500px at 50% 12%,rgba(55,223,160,.10),transparent),#0A0B0D;color:#ECEEF2;font-family:'Space Grotesk',system-ui,sans-serif;overflow:hidden}
  .wrap{display:flex;flex-direction:column;align-items:center;gap:26px;text-align:center}
  svg{overflow:visible}
  .glow{animation:glow 3.6s ease-in-out infinite}
  .ring{animation:spin 22s linear infinite}
  .sat,.core{filter:drop-shadow(0 0 7px #37DFA0)}
  h1{font-size:30px;font-weight:700;letter-spacing:6px}
  .status{display:flex;align-items:center;gap:9px;font-size:14px;color:#37DFA0;font-weight:600}
  .sdot{width:9px;height:9px;border-radius:50%;background:#37DFA0;box-shadow:0 0 10px #37DFA0;animation:blink 1.6s infinite}
  .endpoint{font-family:'JetBrains Mono',monospace;font-size:12.5px;color:#8B92A0;background:#101216;border:1px solid #20242C;padding:8px 14px;border-radius:9px}
  .hint{font-size:12.5px;color:#565C68;max-width:340px;line-height:1.6}
  .checks{display:flex;flex-direction:column;gap:8px;background:#101216;border:1px solid #20242C;border-radius:11px;padding:12px 16px;min-width:220px}
  .check{display:flex;align-items:center;gap:9px;font-family:'JetBrains Mono',monospace;font-size:12px;color:#8B92A0}
  .check .dot{width:7px;height:7px;border-radius:50%;background:#565C68;flex-shrink:0;transition:background .2s,box-shadow .2s}
  .check .dot.up{background:#37DFA0;box-shadow:0 0 8px #37DFA0}
  .check .dot.down{background:#E0607A;box-shadow:0 0 8px #E0607A}
  .check .label{flex:1;text-align:left}
  @keyframes glow{0%,100%{opacity:.10;transform:scale(1)}50%{opacity:.22;transform:scale(1.09)}}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:.35}}
  @media(prefers-reduced-motion:reduce){.glow,.ring,.sat,.sdot{animation:none}}
</style></head>
<body>
  <div class="wrap">
    <svg width="260" height="260" viewBox="-150 -150 300 300" fill="none">
      <circle class="glow" r="46" fill="#37DFA0"/>
      <g class="ring"><ellipse rx="132" ry="30" stroke="#37DFA0" stroke-opacity="0.18" stroke-width="2"/></g>
      <g transform="rotate(-26)">
        <ellipse rx="112" ry="47" stroke="#37DFA0" stroke-opacity="0.42" stroke-width="2.5"/>
        <circle class="sat" r="10" fill="#37DFA0">
          <animateMotion dur="5s" repeatCount="indefinite" rotate="auto"
            path="M-112,0 a112,47 0 1,0 224,0 a112,47 0 1,0 -224,0"/>
        </circle>
      </g>
      <circle class="core" r="30" stroke="#37DFA0" stroke-width="4"/>
      <circle class="core" r="8" fill="#37DFA0"/>
    </svg>
    <h1>ORBIT</h1>
    <div class="status"><span class="sdot"></span>Agent is active</div>
    <div class="endpoint">${`http://localhost:${PORT}`}</div>
    <div class="checks">
      <div class="check"><span class="dot" id="dot-docker"></span><span class="label">Docker</span><span id="txt-docker">checking…</span></div>
      <div class="check"><span class="dot up"></span><span class="label">Agent</span><span>online</span></div>
    </div>
    <div class="hint">This window can stay minimized. ORBIT connects to it automatically — sign in to see live Postgres &amp; Gmail health in the app.</div>
  </div>
  <script>
    async function refreshHealth() {
      try {
        const r = await fetch('/health/public').then(r => r.json());
        const dot = document.getElementById('dot-docker');
        const txt = document.getElementById('txt-docker');
        dot.className = 'dot ' + (r.docker?.running ? 'up' : 'down');
        txt.textContent = r.docker?.running ? 'running' : 'not running';
      } catch { /* agent still starting up */ }
    }
    refreshHealth();
    setInterval(refreshHealth, 15000);

    // Presence-only socket so the agent knows this tab is open — closing this
    // tab (and every other ORBIT tab) is what lets the packaged agent auto-quit.
    (function connectPresence() {
      try {
        const ws = new WebSocket(location.origin.replace(/^http/, 'ws') + '/presence');
        ws.onclose = () => setTimeout(connectPresence, 3000);
        ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
      } catch { setTimeout(connectPresence, 3000); }
    })();
  </script>
</body></html>`);
});

app.get("/ping", (_req, res) => res.json({ ok: true, agent: "orbit", version: "0.1.0" }));

// Unauthenticated — Docker isn't scoped per user, so this is safe to expose
// without a session token. Powers the standalone status page's live dot.
// Postgres/Gmail health is per-user and only served from GET /health (auth required).
app.get("/health/public", async (_req, res) => res.json({ ok: true, checkedAt: Date.now(), docker: await checkDocker() }));

// ---- Gmail (read-only IMAP, app password) ----
app.get("/gmail/status", (req, res) => { const c = gmailCreds(req.userId); res.json({ ok: true, configured: !!c, user: c?.user || null }); });

app.post("/gmail/config", (req, res) => {
  const { user, pass } = req.body || {};
  if (!user || !pass) return res.status(400).json({ ok: false, error: "user and app password required" });
  try { saveGmailCreds(req.userId, user, String(pass).replace(/\s+/g, "")); resetClient(req.userId); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.delete("/gmail/config", (req, res) => { try { deleteGmailCreds(req.userId); } catch { /**/ } resetClient(req.userId); res.json({ ok: true }); });

app.get("/gmail/list", async (req, res) => {
  try {
    const limit = Math.min(50, Number(req.query.limit) || 25);
    const messages = await withImap(req.userId, async (client) => {
      const lock = await client.getMailboxLock("INBOX");
      try {
        const total = client.mailbox.exists;
        if (!total) return [];
        const start = Math.max(1, total - limit + 1);
        const out = [];
        for await (const m of client.fetch(`${start}:*`, { envelope: true, flags: true })) {
          const f = m.envelope.from?.[0];
          out.push({
            uid: m.uid, seq: m.seq,
            subject: m.envelope.subject || "(no subject)",
            from: f?.name || f?.address || "",
            fromAddr: f?.address || "",
            date: m.envelope.date, seen: m.flags.has("\\Seen"),
          });
        }
        return out.reverse();
      } finally { lock.release(); }
    });
    res.json({ ok: true, messages });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get("/gmail/message", async (req, res) => {
  try {
    const uid = String(req.query.uid || "");
    if (!uid) return res.status(400).json({ ok: false, error: "uid required" });
    const message = await withImap(req.userId, async (client) => {
      const lock = await client.getMailboxLock("INBOX");
      try {
        const msg = await client.fetchOne(uid, { source: true }, { uid: true });
        const p = await simpleParser(msg.source);
        return { subject: p.subject || "(no subject)", from: p.from?.text || "", to: p.to?.text || "", date: p.date, text: p.text || "", html: typeof p.html === "string" ? p.html : "" };
      } finally { lock.release(); }
    });
    res.json({ ok: true, message });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// List running Docker containers (for the dashboard "Containers up" stat).
// Docker reflects the machine, not the caller — every authenticated user sees the same thing.
app.get("/docker", (_req, res) => {
  exec('docker ps --format "{{.Names}}|{{.Image}}|{{.Status}}"', { timeout: 8000, windowsHide: true }, (err, stdout) => {
    if (err) return res.json({ ok: true, available: false, containers: [] }); // docker not installed / not running
    const containers = String(stdout).trim().split("\n").filter(Boolean).map((line) => {
      const [name, image, status] = line.split("|");
      return { name, image, status };
    });
    res.json({ ok: true, available: true, containers });
  });
});

// List Docker images on the system.
app.get("/docker/images", (_req, res) => {
  exec('docker images --format "{{.Repository}}|{{.Tag}}|{{.ID}}|{{.Size}}|{{.CreatedSince}}"', { timeout: 10000, windowsHide: true }, (err, stdout) => {
    if (err) return res.json({ ok: true, available: false, images: [] });
    const images = String(stdout).trim().split("\n").filter(Boolean).map((line) => {
      const [repository, tag, id, size, created] = line.split("|");
      return { repository, tag, id, size, created };
    });
    res.json({ ok: true, available: true, images });
  });
});

// Export an image to a .tar via `docker save`.
app.post("/docker/save", (req, res) => {
  const { image, dir } = req.body || {};
  if (!image || !dir) return res.status(400).json({ ok: false, error: "image and dir required" });
  const safe = String(image).replace(/[/:]/g, "_").replace(/[^\w.-]/g, "");
  const sep = isWin ? "\\" : "/";
  const cleanDir = String(dir).replace(/^["']|["']$/g, "");
  const outPath = `${cleanDir}${cleanDir.endsWith(sep) ? "" : sep}${safe}.tar`;
  exec(`docker save -o "${outPath}" "${image}"`, { timeout: 120000, windowsHide: true }, (err) => {
    if (err) return res.status(500).json({ ok: false, error: err.message.slice(0, 200) });
    res.json({ ok: true, path: outPath });
  });
});

// Build an image from a project's context folder (must contain a Dockerfile,
// or point -f at one). Runs `docker build -t <tag> [-f <dockerfile>] <context>`.
app.post("/docker/build", (req, res) => {
  const { tag, context, dockerfile } = req.body || {};
  if (!tag || !context) return res.status(400).json({ ok: false, error: "tag and context required" });
  const clean = (p) => String(p).trim().replace(/^["']|["']$/g, "");
  const ctx = clean(context);
  const safeTag = String(tag).trim();
  if (!/^[a-z0-9][a-z0-9._/-]*(:[\w.-]+)?$/i.test(safeTag)) return res.status(400).json({ ok: false, error: "invalid image tag" });
  const dfArg = dockerfile ? ` -f "${clean(dockerfile)}"` : "";
  exec(`docker build -t "${safeTag}"${dfArg} "${ctx}"`, { timeout: 900000, maxBuffer: 1024 * 1024 * 16, windowsHide: true }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ ok: false, error: (stderr || err.message || "build failed").toString().slice(-500) });
    broadcast("docker:changed", { tag: safeTag });
    res.json({ ok: true, tag: safeTag, output: (stdout || "").toString().slice(-500) });
  });
});

// ---- PostgreSQL (via the local agent, using the `pg` driver) ----
// The agent is stateless about servers — the saved list lives in Supabase
// (`pg_servers`, RLS-scoped per user) and the browser hands over the
// connection details it needs for each call. Nothing Postgres-related is
// written to disk here anymore.
let _pg = null;
async function getPgModule() {
  if (_pg) return _pg;
  try { _pg = (await import("pg")).default; return _pg; } catch { return null; }
}
async function pgConnect(server, database) {
  const Pg = await getPgModule();
  if (!Pg) throw new Error("pg driver not installed — run `npm install` in the agent folder");
  const client = new Pg.Client({
    host: server.host, port: Number(server.port) || 5432,
    user: server.user, password: server.password,
    database: database || server.database || "postgres",
    ssl: server.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 8000, statement_timeout: 30000, query_timeout: 30000,
  });
  await client.connect();
  return client;
}

// Every /pg/* route below takes the connection details inline in the request
// body (`server: {host,port,user,password,ssl}`) — the agent looks nothing up
// locally anymore. `req.body.server` is the caller's own Supabase-scoped row,
// forwarded as-is; validate just enough to fail clearly, not to gatekeep.
function readServer(body) {
  const s = (body && body.server) || null;
  if (!s || !s.host || !s.user) return null;
  return s;
}

// Test a connection without saving.
app.post("/pg/test", async (req, res) => {
  const s = req.body || {};
  if (!s.host || !s.user) return res.status(400).json({ ok: false, error: "host and user are required" });
  let client;
  try { client = await pgConnect(s, s.database); const r = await client.query("SELECT version()"); res.json({ ok: true, version: r.rows[0]?.version || "" }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  finally { try { await client?.end(); } catch { /**/ } }
});

app.post("/pg/databases", async (req, res) => {
  const server = readServer(req.body);
  if (!server) return res.status(400).json({ ok: false, error: "server connection details are required" });
  let client;
  try {
    client = await pgConnect(server, "postgres");
    const r = await client.query("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname");
    res.json({ ok: true, databases: r.rows.map((x) => x.datname) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  finally { try { await client?.end(); } catch { /**/ } }
});

app.post("/pg/tables", async (req, res) => {
  const server = readServer(req.body);
  if (!server) return res.status(400).json({ ok: false, error: "server connection details are required" });
  let client;
  try {
    client = await pgConnect(server, req.body.database);
    const r = await client.query(
      `SELECT table_schema, table_name, table_type
       FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog','information_schema')
       ORDER BY table_schema, table_name`
    );
    res.json({ ok: true, tables: r.rows.map((x) => ({ schema: x.table_schema, name: x.table_name, type: x.table_type })) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  finally { try { await client?.end(); } catch { /**/ } }
});

// Full schema map for the ER diagram: every table's columns (with a compact
// type label), primary keys, and foreign keys (composite-key aware, via
// pg_constraint rather than information_schema so multi-column FKs come back
// as one edge instead of one per column).
function pgShortType(c) {
  switch (c.data_type) {
    case "character varying": return `varchar${c.character_maximum_length ? `(${c.character_maximum_length})` : ""}`;
    case "character": return `char(${c.character_maximum_length || 1})`;
    case "numeric": return `numeric${c.numeric_precision ? `(${c.numeric_precision}${c.numeric_scale ? `,${c.numeric_scale}` : ""})` : ""}`;
    case "timestamp without time zone": return "timestamp";
    case "timestamp with time zone": return "timestamptz";
    case "time without time zone": return "time";
    case "double precision": return "float8";
    case "ARRAY": return `${(c.udt_name || "").replace(/^_/, "")}[]`;
    case "USER-DEFINED": return c.udt_name;
    default: return c.data_type;
  }
}
app.post("/pg/schema", async (req, res) => {
  const server = readServer(req.body);
  if (!server) return res.status(400).json({ ok: false, error: "server connection details are required" });
  let client;
  try {
    client = await pgConnect(server, req.body.database);

    const colsQ = client.query(
      `SELECT table_schema, table_name, column_name, data_type, udt_name, is_nullable, column_default,
              character_maximum_length, numeric_precision, numeric_scale, ordinal_position
       FROM information_schema.columns
       WHERE table_schema NOT IN ('pg_catalog','information_schema')
       ORDER BY table_schema, table_name, ordinal_position`
    );
    const tablesQ = client.query(
      `SELECT table_schema, table_name, table_type
       FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog','information_schema')
       ORDER BY table_schema, table_name`
    );
    const pkQ = client.query(
      `SELECT tc.table_schema, tc.table_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema NOT IN ('pg_catalog','information_schema')
       ORDER BY tc.table_schema, tc.table_name, kcu.ordinal_position`
    );
    // pg_constraint (not information_schema) so composite FKs collapse to a single edge.
    const fkQ = client.query(
      `SELECT con.conname AS constraint_name,
              ns.nspname AS table_schema, tbl.relname AS table_name, att.attname AS column_name,
              fns.nspname AS ref_schema, ftbl.relname AS ref_table, fatt.attname AS ref_column,
              ord.ordinality AS position
       FROM pg_constraint con
       JOIN pg_class tbl ON tbl.oid = con.conrelid
       JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
       JOIN pg_class ftbl ON ftbl.oid = con.confrelid
       JOIN pg_namespace fns ON fns.oid = ftbl.relnamespace
       JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ord(attnum, ordinality) ON true
       JOIN pg_attribute att ON att.attnum = ord.attnum AND att.attrelid = tbl.oid
       JOIN pg_attribute fatt ON fatt.attnum = con.confkey[ord.ordinality] AND fatt.attrelid = ftbl.oid
       WHERE con.contype = 'f' AND ns.nspname NOT IN ('pg_catalog','information_schema')
       ORDER BY table_schema, table_name, constraint_name, ord.ordinality`
    );

    const [cols, tbls, pks, fks] = await Promise.all([colsQ, tablesQ, pkQ, fkQ]);

    const pkSet = new Set(pks.rows.map((r) => `${r.table_schema}.${r.table_name}.${r.column_name}`));
    const tableMap = new Map();
    for (const t of tbls.rows) {
      const key = `${t.table_schema}.${t.table_name}`;
      tableMap.set(key, { schema: t.table_schema, name: t.table_name, type: t.table_type, columns: [], primaryKey: [] });
    }
    for (const c of cols.rows) {
      const key = `${c.table_schema}.${c.table_name}`;
      const t = tableMap.get(key);
      if (!t) continue;
      const isPk = pkSet.has(`${c.table_schema}.${c.table_name}.${c.column_name}`);
      if (isPk) t.primaryKey.push(c.column_name);
      t.columns.push({ name: c.column_name, type: pgShortType(c), nullable: c.is_nullable === "YES", default: c.column_default, isPrimaryKey: isPk });
    }

    const fkMap = new Map();
    for (const r of fks.rows) {
      const key = `${r.table_schema}.${r.table_name}.${r.constraint_name}`;
      let fk = fkMap.get(key);
      if (!fk) {
        fk = { name: r.constraint_name, schema: r.table_schema, table: r.table_name, columns: [], refSchema: r.ref_schema, refTable: r.ref_table, refColumns: [] };
        fkMap.set(key, fk);
      }
      fk.columns.push(r.column_name);
      fk.refColumns.push(r.ref_column);
    }

    res.json({ ok: true, tables: [...tableMap.values()], foreignKeys: [...fkMap.values()] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  finally { try { await client?.end(); } catch { /**/ } }
});

app.post("/pg/query", async (req, res) => {
  const { database, sql } = req.body || {};
  const server = readServer(req.body);
  if (!server) return res.status(400).json({ ok: false, error: "server connection details are required" });
  if (!sql || !String(sql).trim()) return res.status(400).json({ ok: false, error: "sql required" });
  let client;
  const started = Date.now();
  try {
    client = await pgConnect(server, database);
    const r = await client.query(String(sql));
    const result = Array.isArray(r) ? r[r.length - 1] : r; // multi-statement → report the last result set
    const allRows = result.rows || [];
    const fields = (result.fields || []).map((f) => f.name);
    res.json({ ok: true, command: result.command, fields, rows: allRows.slice(0, 1000), rowCount: result.rowCount ?? allRows.length, truncated: allRows.length > 1000, ms: Date.now() - started });
  } catch (e) { res.status(500).json({ ok: false, error: e.message, ms: Date.now() - started }); }
  finally { try { await client?.end(); } catch { /**/ } }
});

// ---- Start Work: git pull, port checks, dev servers ----
const devServers = new Map(); // pid -> { pid, port, path, command, project, startedAt, userId }
const clean = (p) => String(p).trim().replace(/^["']|["']$/g, "");

function portInUse(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", (e) => resolve(e.code === "EADDRINUSE"));
    srv.once("listening", () => srv.close(() => resolve(false)));
    srv.listen(port, "127.0.0.1");
  });
}

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo", GCM_INTERACTIVE: "never" };
const git = (cwd, args, timeout = 90000) =>
  new Promise((resolve) => {
    exec(`git ${args}`, { cwd, env: GIT_ENV, timeout, maxBuffer: 1024 * 1024 * 8, windowsHide: true }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: String(stdout || "").trim(), err: String(stderr || err?.message || "").trim() })
    );
  });

app.post("/git/pull", async (req, res) => {
  const { path } = req.body || {};
  if (!path) return res.status(400).json({ ok: false, error: "path required" });
  const dir = clean(path);

  // resolve the repo root — project paths often point at a subfolder (frontend/)
  const top = await git(dir, "rev-parse --show-toplevel");
  if (!top.ok) return res.status(400).json({ ok: false, reason: "not_a_repo", error: "not a git repository" });
  const root = top.out || dir;

  const branchR = await git(root, "rev-parse --abbrev-ref HEAD");
  const branch = branchR.out || "HEAD";
  const upstream = await git(root, "rev-parse --abbrev-ref --symbolic-full-name @{u}");
  if (!upstream.ok) return res.json({ ok: true, root, branch, reason: "no_upstream", updated: false, ahead: 0, behind: 0, dirty: 0, output: "no upstream branch" });

  const fetched = await git(root, "fetch --prune", 120000);
  if (!fetched.ok) {
    const auth = /authentication|could not read|permission denied|terminal prompts disabled|access denied/i.test(fetched.err);
    return res.status(200).json({ ok: false, root, branch, reason: auth ? "auth" : "fetch_failed", error: fetched.err.slice(-300) || "fetch failed" });
  }

  const counts = await git(root, "rev-list --left-right --count HEAD...@{u}");
  const [aheadS, behindS] = (counts.out || "0\t0").split(/\s+/);
  const ahead = Number(aheadS) || 0, behind = Number(behindS) || 0;
  const st = await git(root, "status --porcelain");
  const dirty = st.out ? st.out.split("\n").filter(Boolean).length : 0;

  if (behind === 0) return res.json({ ok: true, root, branch, upstream: upstream.out, reason: "up_to_date", updated: false, ahead, behind, dirty, output: "Already up to date." });

  const pulled = await git(root, "pull --ff-only", 120000);
  if (!pulled.ok) {
    const conflict = /diverge|not possible to fast-forward|unmerged|would be overwritten|local changes/i.test(pulled.err);
    return res.status(200).json({ ok: false, root, branch, reason: conflict ? "conflict" : "pull_failed", ahead, behind, dirty, error: pulled.err.slice(-300) || "pull failed" });
  }
  const files = (pulled.out.match(/(\d+) files? changed/) || [])[1];
  res.json({ ok: true, root, branch, upstream: upstream.out, reason: "updated", updated: true, ahead, behind, dirty, files: Number(files) || 0, output: pulled.out.slice(-300) });
});

app.get("/port/check", async (req, res) => {
  const port = Number(req.query.port);
  if (!port) return res.status(400).json({ ok: false, error: "port required" });
  const inUse = await portInUse(port);
  const owned = [...devServers.values()].find((d) => d.port === port && d.userId === req.userId);
  res.json({ ok: true, inUse, ownedBy: owned ? owned.project : null });
});

app.post("/dev/start", async (req, res) => {
  const { path, command, port, project } = req.body || {};
  if (!path || !command) return res.status(400).json({ ok: false, error: "path and command required" });
  if (port) {
    const inUse = await portInUse(Number(port));
    if (inUse) {
      const owned = [...devServers.values()].find((d) => d.port === Number(port));
      return res.status(409).json({ ok: false, error: `port ${port} already in use`, ownedBy: owned && owned.userId === req.userId ? owned.project : null });
    }
  }
  try {
    const child = spawn(command, { cwd: clean(path), shell: true, detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    const rec = { pid: child.pid, port: port ? Number(port) : null, path: clean(path), command, project: project || null, startedAt: Date.now(), userId: req.userId };
    devServers.set(child.pid, rec);
    child.on("exit", () => { devServers.delete(child.pid); broadcast("dev:changed", { pid: child.pid, up: false }); });
    broadcast("dev:changed", { pid: child.pid, up: true, project: rec.project, port: rec.port });
    res.json({ ok: true, pid: child.pid, port: rec.port });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get("/dev/running", (req, res) => res.json({ ok: true, servers: [...devServers.values()].filter((d) => d.userId === req.userId) }));

app.post("/dev/stop", (req, res) => {
  const pid = Number(req.body?.pid);
  if (!pid) return res.status(400).json({ ok: false, error: "pid required" });
  const rec = devServers.get(pid);
  if (!rec || rec.userId !== req.userId) return res.status(404).json({ ok: false, error: "not found" });
  try {
    if (isWin) exec(`taskkill /PID ${pid} /T /F`, { windowsHide: true });
    else { try { process.kill(-pid); } catch { process.kill(pid); } }
    devServers.delete(pid);
    broadcast("dev:changed", { pid, up: false });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post("/launch", (req, res) => {
  const { kind, fe_path, sln_path, dev_port } = req.body || {};
  const opened = [];
  const missing = [];
  const tryOpen = (label, fn, arg) => { if (!arg) { missing.push(label); return; } if (fn(arg)) opened.push(label); };
  switch (kind) {
    case "vscode": tryOpen("VS Code", openVSCode, fe_path); break;
    case "visualstudio": tryOpen("Visual Studio", openVisualStudio, sln_path); break;
    case "terminal": openTerminal(fe_path); opened.push("Terminal"); break;
    case "browser": if (dev_port) { openBrowser(dev_port); opened.push("Browser"); } else missing.push("Dev port"); break;
    case "all":
      tryOpen("VS Code", openVSCode, fe_path);
      tryOpen("Visual Studio", openVisualStudio, sln_path);
      if (dev_port) { openBrowser(dev_port); opened.push("Browser"); }
      break;
    default: return res.status(400).json({ ok: false, error: "unknown kind" });
  }
  if (opened.length === 0) {
    return res.status(422).json({ ok: false, error: missing.length ? `No path set for: ${missing.join(", ")}` : "Nothing to open" });
  }
  res.json({ ok: true, opened, missing });
});

// Open a native folder/file dialog and return the selected absolute path.
function nativePick(type) {
  return new Promise((resolve) => {
    let cmd, args;
    if (isWin) {
      const ps = type === "folder"
        ? "Add-Type -AssemblyName System.Windows.Forms;$d=New-Object System.Windows.Forms.FolderBrowserDialog;$d.ShowNewFolderButton=$true;if($d.ShowDialog() -eq 'OK'){[Console]::Out.Write($d.SelectedPath)}"
        : "Add-Type -AssemblyName System.Windows.Forms;$d=New-Object System.Windows.Forms.OpenFileDialog;$d.Filter='Solution (*.sln)|*.sln|All files (*.*)|*.*';if($d.ShowDialog() -eq 'OK'){[Console]::Out.Write($d.FileName)}";
      cmd = "powershell"; args = ["-NoProfile", "-STA", "-Command", ps];
    } else if (platform() === "darwin") {
      const osa = type === "folder"
        ? 'POSIX path of (choose folder)'
        : 'POSIX path of (choose file of type {"sln","*"})';
      cmd = "osascript"; args = ["-e", osa];
    } else {
      cmd = "zenity"; args = type === "folder" ? ["--file-selection", "--directory"] : ["--file-selection"];
    }
    execFile(cmd, args, { timeout: 120000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      resolve(stdout.toString().trim() || null);
    });
  });
}

app.post("/pick", async (req, res) => {
  const type = req.body?.type === "file" ? "file" : "folder";
  const path = await nativePick(type);
  res.json({ ok: !!path, path });
});

app.post("/macro", (req, res) => {
  const { name } = req.body || {};
  // Extend: git pull, docker compose up, dev server, etc.
  console.log(`[agent] macro: ${name} (user ${req.userId})`);
  res.json({ ok: true, ran: name });
});

// ---- npm chores: dependency drift + advisories (read-only) ----
const npmRun = (cwd, args, timeout = 120000) =>
  new Promise((resolve) => {
    exec(`npm ${args}`, { cwd, timeout, maxBuffer: 1024 * 1024 * 24, env: { ...process.env, NO_UPDATE_NOTIFIER: "1" }, windowsHide: true },
      (err, stdout, stderr) => resolve({ err, out: String(stdout || ""), stderr: String(stderr || "") }));
  });

// `npm outdated` exits 1 when packages are outdated — that's a success for us.
app.post("/npm/outdated", async (req, res) => {
  const { path } = req.body || {};
  if (!path) return res.status(400).json({ ok: false, error: "path required" });
  const dir = clean(path);
  if (!existsSync(join(dir, "package.json"))) return res.json({ ok: false, reason: "no_package_json" });
  const { out } = await npmRun(dir, "outdated --json");
  let data = {};
  try { data = JSON.parse(out || "{}"); } catch { return res.json({ ok: false, reason: "parse_failed" }); }
  const pkgs = Object.entries(data).map(([name, v]) => ({
    name, current: v.current || "", wanted: v.wanted || "", latest: v.latest || "",
    major: !!(v.current && v.latest && String(v.current).split(".")[0] !== String(v.latest).split(".")[0]),
  }));
  res.json({ ok: true, total: pkgs.length, major: pkgs.filter((p) => p.major).length, packages: pkgs.slice(0, 25) });
});

app.post("/npm/audit", async (req, res) => {
  const { path } = req.body || {};
  if (!path) return res.status(400).json({ ok: false, error: "path required" });
  const dir = clean(path);
  if (!existsSync(join(dir, "package.json"))) return res.json({ ok: false, reason: "no_package_json" });
  const { out } = await npmRun(dir, "audit --json");
  let data = {};
  try { data = JSON.parse(out || "{}"); } catch { return res.json({ ok: false, reason: "parse_failed" }); }
  const v = data?.metadata?.vulnerabilities || {};
  const total = ["critical", "high", "moderate", "low", "info"].reduce((a, k) => a + (Number(v[k]) || 0), 0);
  res.json({ ok: true, total, critical: Number(v.critical) || 0, high: Number(v.high) || 0, moderate: Number(v.moderate) || 0, low: Number(v.low) || 0 });
});

// ---- Docker disk usage (read-only) + gated prune ----
app.get("/docker/df", (_req, res) => {
  exec('docker system df --format "{{json .}}"', { timeout: 15000, windowsHide: true }, (err, stdout) => {
    if (err) return res.json({ ok: true, available: false, rows: [] });
    const rows = String(stdout).trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    exec("docker images -f dangling=true -q", { timeout: 10000, windowsHide: true }, (e2, out2) => {
      const dangling = e2 ? 0 : String(out2).trim().split("\n").filter(Boolean).length;
      const reclaimable = rows.map((r) => r.Reclaimable || "").find((x) => /\d/.test(x)) || "0B";
      res.json({ ok: true, available: true, rows, dangling, reclaimable });
    });
  });
});
// Destructive — never called automatically; the UI gates this behind a toggle.
app.post("/docker/prune", (_req, res) => {
  exec("docker system prune -f", { timeout: 120000, maxBuffer: 1024 * 1024 * 8, windowsHide: true }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ ok: false, error: (stderr || err.message).slice(-300) });
    res.json({ ok: true, output: String(stdout).trim().slice(-300) });
  });
});

// ---- Postgres health ping ----
app.post("/pg/health", async (req, res) => {
  const server = readServer(req.body);
  if (!server) return res.status(400).json({ ok: false, error: "server connection details are required" });
  let client;
  try {
    client = await pgConnect(server, req.body.database);
    const conns = await client.query("SELECT count(*)::int AS n FROM pg_stat_activity");
    const longest = await client.query(
      "SELECT COALESCE(EXTRACT(EPOCH FROM (now() - min(query_start))), 0)::int AS s FROM pg_stat_activity WHERE state = 'active' AND query NOT ILIKE '%pg_stat_activity%'");
    const size = await client.query("SELECT pg_size_pretty(pg_database_size(current_database())) AS size");
    res.json({ ok: true, connections: conns.rows[0]?.n ?? 0, longestSec: longest.rows[0]?.s ?? 0, size: size.rows[0]?.size || "—" });
  } catch (e) { res.status(200).json({ ok: false, error: e.message.slice(0, 160) }); }
  finally { try { await client?.end(); } catch { /**/ } }
});

// ---- Routine checkup: is everything this user depends on actually reachable? ----
function checkDocker() {
  return new Promise((resolve) => {
    exec('docker ps --format "{{.Names}}"', { timeout: 5000, windowsHide: true }, (err) => resolve({ ok: !err, running: !err }));
  });
}

async function checkGmailHealth(userId) {
  const creds = gmailCreds(userId);
  if (!creds) return { configured: false, ok: true };
  try {
    await withImap(userId, async () => true);
    return { configured: true, ok: true, user: creds.user };
  } catch (e) {
    return { configured: true, ok: false, user: creds.user, error: String(e.message || e).slice(0, 160) };
  }
}

// The saved server list now lives in Supabase, not on this machine, so there's
// nothing to proactively iterate here anymore — per-server health is an
// on-demand POST /pg/health call instead (see pgHealth() client-side).
async function runHealthCheck(userId) {
  const [docker, gmail] = await Promise.all([checkDocker(), checkGmailHealth(userId)]);
  return { ok: true, checkedAt: Date.now(), docker, gmail, postgres: [] };
}

app.get("/health", async (req, res) => {
  try { res.json(await runHealthCheck(req.userId)); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ---- What's actually listening on the dev ports ----
app.get("/ports/map", async (req, res) => {
  const ports = String(req.query.ports || "").split(",").map((p) => Number(p.trim())).filter(Boolean);
  const out = [];
  for (const p of ports) {
    const inUse = await portInUse(p);
    const owned = [...devServers.values()].find((d) => d.port === p && d.userId === req.userId);
    out.push({ port: p, inUse, ownedBy: owned ? owned.project : null, orbit: !!owned });
  }
  res.json({ ok: true, ports: out });
});

// ---- Unread mail count ----
app.get("/gmail/unread", async (req, res) => {
  try {
    const unread = await withImap(req.userId, async (client) => {
      const lock = await client.getMailboxLock("INBOX");
      try { const r = await client.status("INBOX", { unseen: true }); return r.unseen || 0; }
      finally { lock.release(); }
    });
    res.json({ ok: true, unread });
  } catch (e) { res.status(200).json({ ok: false, error: e.message }); }
});

// ---- WebSocket push: agent tells the UI when dev servers / docker change ----
let wss = null;
function broadcast(event, payload = {}) {
  if (!wss) return;
  const msg = JSON.stringify({ event, payload, at: Date.now() });
  for (const c of wss.clients) { if (c.readyState === 1) { try { c.send(msg); } catch { /**/ } } }
}
function sendToUser(userId, event, payload = {}) {
  if (!wss) return;
  const msg = JSON.stringify({ event, payload, at: Date.now() });
  for (const c of wss.clients) { if (c.readyState === 1 && c.userId === userId) { try { c.send(msg); } catch { /**/ } } }
}

// Routine checkup, run for every currently-connected user every 45s, pushed
// over the websocket so a kept-open status page (or the ORBIT tab) reflects
// Postgres/Gmail/Docker health without polling.
setInterval(async () => {
  if (!wss) return;
  const userIds = new Set([...wss.clients].filter((c) => c.readyState === 1 && c.userId).map((c) => c.userId));
  for (const userId of userIds) {
    try { sendToUser(userId, "health:update", await runHealthCheck(userId)); } catch { /**/ }
  }
}, 45000);

const server = app.listen(PORT, () => {
  console.log(`ORBIT agent listening on http://localhost:${PORT}`);
  if (isPackaged) openBrowser(PORT);
});

(async () => {
  try {
    const { WebSocketServer } = await import("ws");
    // No `path` filter: the authenticated ORBIT web app connects on /events, and
    // the agent's own auto-opened status page (no user session to authenticate
    // with) connects on /presence purely so its tab is counted below.
    wss = new WebSocketServer({ server });
    wss.on("connection", (c, req) => {
      const { pathname, searchParams } = new URL(req.url, "http://agent");
      if (pathname === "/presence") return; // unauthenticated — presence-only, no push events
      if (pathname !== "/events") { c.close(1008, "unknown path"); return; }
      try {
        c.userId = verifyToken(searchParams.get("token") || "");
      } catch {
        c.close(4001, "unauthorized");
        return;
      }
      try { c.send(JSON.stringify({ event: "hello", payload: { agent: "orbit" }, at: Date.now() })); } catch { /**/ }
      runHealthCheck(c.userId).then((h) => { try { c.send(JSON.stringify({ event: "health:update", payload: h, at: Date.now() })); } catch { /**/ } }).catch(() => {});
    });
    console.log(`[agent] websocket events on ws://localhost:${PORT}/events`);
  } catch {
    console.log("[agent] `ws` not installed — run `npm install` in agent/ for live push (polling still works)");
  }
})();

// ---- Auto-quit the packaged background agent once every ORBIT tab is closed ----
// The web app holds one /events WebSocket open for as long as any tab is open —
// in-app navigation (React Router) doesn't touch it, only a real tab close,
// reload, or browser quit does. A reload briefly drops to zero clients too, so
// we wait out a grace period rather than exiting on the first empty check.
// Only for the double-clickable .exe: `node server.mjs` in a dev terminal
// should keep running even with no tab open.
if (isPackaged) {
  const AUTO_QUIT_GRACE_MS = 25000;
  let everConnected = false;
  let emptySince = null;
  setInterval(() => {
    if (!wss) return;
    const openClients = [...wss.clients].filter((c) => c.readyState === 1).length;
    if (openClients > 0) { everConnected = true; emptySince = null; return; }
    if (!everConnected) return; // no tab has connected since launch yet — don't quit before anyone's opened one
    if (emptySince === null) { emptySince = Date.now(); return; }
    if (Date.now() - emptySince >= AUTO_QUIT_GRACE_MS) {
      console.log(`[agent] no ORBIT tab connected for ${Math.round(AUTO_QUIT_GRACE_MS / 1000)}s — shutting down`);
      process.exit(0);
    }
  }, 5000);
}
