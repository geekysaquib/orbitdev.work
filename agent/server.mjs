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

const __dir = dirname(fileURLToPath(import.meta.url));
const GMAIL_CFG = join(__dir, "gmail-config.json");
const PG_CFG = join(__dir, "pg-config.json");
const AGENT_CFG = join(__dir, "agent-config.json");

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

// ---- Auth: verify the same JWT netlify/functions/auth.ts issues ----
function jwtSecret() {
  if (process.env.SUPABASE_JWT_SECRET) return process.env.SUPABASE_JWT_SECRET;
  return readJson(AGENT_CFG, {}).jwtSecret || "";
}
const JWT_SECRET = jwtSecret();
if (!JWT_SECRET) {
  console.warn("[agent] SUPABASE_JWT_SECRET not set (env or agent-config.json) — every authenticated request will fail with 401.");
  console.warn("[agent] Copy agent-config.example.json -> agent-config.json and paste the same Legacy JWT Secret Netlify uses.");
}

function verifyToken(token) {
  const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
  const userId = typeof payload === "object" ? payload.sub : null;
  if (!userId) throw new Error("token has no sub claim");
  return userId;
}

const PUBLIC_PATHS = new Set(["/", "/ping"]);
function requireAuth(req, res, next) {
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (!JWT_SECRET) return res.status(500).json({ ok: false, error: "agent misconfigured — set SUPABASE_JWT_SECRET (see agent/README.md)" });
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
app.use(cors({ origin: [/^https?:\/\/localhost(:\d+)?$/, /\.netlify\.app$/], credentials: false }));
app.use(express.json());
app.use(requireAuth);

const isWin = platform() === "win32";

// Run a shell command STRING (so we control quoting ourselves — critical on
// Windows where paths contain spaces and spawn(shell:true) joins args unquoted).
function runShell(cmdString) {
  try { spawn(cmdString, { detached: true, stdio: "ignore", shell: true }).unref(); return true; }
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
    <div class="hint">This window can stay minimized. ORBIT connects to it automatically — keep it running to launch your IDEs and browse for project paths.</div>
  </div>
</body></html>`);
});

app.get("/ping", (_req, res) => res.json({ ok: true, agent: "orbit", version: "0.1.0" }));

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
  exec('docker ps --format "{{.Names}}|{{.Image}}|{{.Status}}"', { timeout: 8000 }, (err, stdout) => {
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
  exec('docker images --format "{{.Repository}}|{{.Tag}}|{{.ID}}|{{.Size}}|{{.CreatedSince}}"', { timeout: 10000 }, (err, stdout) => {
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
  exec(`docker save -o "${outPath}" "${image}"`, { timeout: 120000 }, (err) => {
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
  exec(`docker build -t "${safeTag}"${dfArg} "${ctx}"`, { timeout: 900000, maxBuffer: 1024 * 1024 * 16 }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ ok: false, error: (stderr || err.message || "build failed").toString().slice(-500) });
    broadcast("docker:changed", { tag: safeTag });
    res.json({ ok: true, tag: safeTag, output: (stdout || "").toString().slice(-500) });
  });
});

// ---- PostgreSQL (via the local agent, using the `pg` driver) — strictly one
// server list per user, keyed by their ORBIT user id. No inheriting an old
// shared list: every account adds its own servers here.
function pgAll() {
  const cfg = readJson(PG_CFG, {});
  return cfg && typeof cfg === "object" && !Array.isArray(cfg) ? cfg : {};
}
function pgServersFor(userId) {
  return pgAll()[userId] || [];
}
function savePgServersFor(userId, list) {
  const all = pgAll();
  all[userId] = list;
  writeFileSync(PG_CFG, JSON.stringify(all, null, 2), "utf8");
}
const pubServer = (s) => ({ id: s.id, name: s.name, host: s.host, port: s.port, user: s.user, database: s.database || null, ssl: !!s.ssl });

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

app.get("/pg/servers", (req, res) => res.json({ ok: true, servers: pgServersFor(req.userId).map(pubServer) }));

app.post("/pg/servers", (req, res) => {
  const { name, host, port, user, password, database, ssl } = req.body || {};
  if (!host || !user) return res.status(400).json({ ok: false, error: "host and user are required" });
  const list = pgServersFor(req.userId);
  const server = { id: "pg_" + Date.now().toString(36), name: name || host, host, port: Number(port) || 5432, user, password: password || "", database: database || "", ssl: !!ssl };
  list.push(server);
  try { savePgServersFor(req.userId, list); } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
  res.json({ ok: true, server: pubServer(server) });
});

app.delete("/pg/servers/:id", (req, res) => {
  try { savePgServersFor(req.userId, pgServersFor(req.userId).filter((s) => s.id !== req.params.id)); } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
  res.json({ ok: true });
});

// Test a connection without saving.
app.post("/pg/test", async (req, res) => {
  const s = req.body || {};
  if (!s.host || !s.user) return res.status(400).json({ ok: false, error: "host and user are required" });
  let client;
  try { client = await pgConnect(s, s.database); const r = await client.query("SELECT version()"); res.json({ ok: true, version: r.rows[0]?.version || "" }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  finally { try { await client?.end(); } catch { /**/ } }
});

app.get("/pg/databases", async (req, res) => {
  const server = pgServersFor(req.userId).find((s) => s.id === req.query.server);
  if (!server) return res.status(404).json({ ok: false, error: "server not found" });
  let client;
  try {
    client = await pgConnect(server, "postgres");
    const r = await client.query("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname");
    res.json({ ok: true, databases: r.rows.map((x) => x.datname) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  finally { try { await client?.end(); } catch { /**/ } }
});

app.get("/pg/tables", async (req, res) => {
  const server = pgServersFor(req.userId).find((s) => s.id === req.query.server);
  if (!server) return res.status(404).json({ ok: false, error: "server not found" });
  let client;
  try {
    client = await pgConnect(server, req.query.database);
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

app.post("/pg/query", async (req, res) => {
  const { server: sid, database, sql } = req.body || {};
  const server = pgServersFor(req.userId).find((s) => s.id === sid);
  if (!server) return res.status(404).json({ ok: false, error: "server not found" });
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
    exec(`git ${args}`, { cwd, env: GIT_ENV, timeout, maxBuffer: 1024 * 1024 * 8 }, (err, stdout, stderr) =>
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
    const child = spawn(command, { cwd: clean(path), shell: true, detached: true, stdio: "ignore" });
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
    if (isWin) exec(`taskkill /PID ${pid} /T /F`);
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
    execFile(cmd, args, { timeout: 120000 }, (err, stdout) => {
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
    exec(`npm ${args}`, { cwd, timeout, maxBuffer: 1024 * 1024 * 24, env: { ...process.env, NO_UPDATE_NOTIFIER: "1" } },
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
  exec('docker system df --format "{{json .}}"', { timeout: 15000 }, (err, stdout) => {
    if (err) return res.json({ ok: true, available: false, rows: [] });
    const rows = String(stdout).trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    exec("docker images -f dangling=true -q", { timeout: 10000 }, (e2, out2) => {
      const dangling = e2 ? 0 : String(out2).trim().split("\n").filter(Boolean).length;
      const reclaimable = rows.map((r) => r.Reclaimable || "").find((x) => /\d/.test(x)) || "0B";
      res.json({ ok: true, available: true, rows, dangling, reclaimable });
    });
  });
});
// Destructive — never called automatically; the UI gates this behind a toggle.
app.post("/docker/prune", (_req, res) => {
  exec("docker system prune -f", { timeout: 120000, maxBuffer: 1024 * 1024 * 8 }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ ok: false, error: (stderr || err.message).slice(-300) });
    res.json({ ok: true, output: String(stdout).trim().slice(-300) });
  });
});

// ---- Postgres health ping ----
app.get("/pg/health", async (req, res) => {
  const server = pgServersFor(req.userId).find((s) => s.id === req.query.server);
  if (!server) return res.status(404).json({ ok: false, error: "server not found" });
  let client;
  try {
    client = await pgConnect(server, req.query.database);
    const conns = await client.query("SELECT count(*)::int AS n FROM pg_stat_activity");
    const longest = await client.query(
      "SELECT COALESCE(EXTRACT(EPOCH FROM (now() - min(query_start))), 0)::int AS s FROM pg_stat_activity WHERE state = 'active' AND query NOT ILIKE '%pg_stat_activity%'");
    const size = await client.query("SELECT pg_size_pretty(pg_database_size(current_database())) AS size");
    res.json({ ok: true, name: server.name, connections: conns.rows[0]?.n ?? 0, longestSec: longest.rows[0]?.s ?? 0, size: size.rows[0]?.size || "—" });
  } catch (e) { res.status(200).json({ ok: false, name: server.name, error: e.message.slice(0, 160) }); }
  finally { try { await client?.end(); } catch { /**/ } }
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

const server = app.listen(PORT, () => console.log(`ORBIT agent listening on http://localhost:${PORT}`));

(async () => {
  try {
    const { WebSocketServer } = await import("ws");
    wss = new WebSocketServer({ server, path: "/events" });
    wss.on("connection", (c, req) => {
      try {
        const token = new URL(req.url, "http://agent").searchParams.get("token") || "";
        verifyToken(token);
      } catch {
        c.close(4001, "unauthorized");
        return;
      }
      try { c.send(JSON.stringify({ event: "hello", payload: { agent: "orbit" }, at: Date.now() })); } catch { /**/ }
    });
    console.log(`[agent] websocket events on ws://localhost:${PORT}/events`);
  } catch {
    console.log("[agent] `ws` not installed — run `npm install` in agent/ for live push (polling still works)");
  }
})();
