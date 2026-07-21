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
import { readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { runSeedJob, MAX_ROWS_PER_TABLE } from "./seed.mjs";

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

// SMTP send — same Gmail app-password credentials as IMAP, one transporter per user (cached).
const smtpTransporters = new Map(); // userId -> Transporter
function getTransporter(userId) {
  const c = gmailCreds(userId);
  if (!c) throw new Error("Gmail not configured");
  const existing = smtpTransporters.get(userId);
  if (existing) return existing;
  const t = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: c.user, pass: c.pass } });
  smtpTransporters.set(userId, t);
  return t;
}
function resetTransporter(userId) { smtpTransporters.delete(userId); }

const app = express();
const PORT = process.env.PORT || 47600;

// Restrict to your ORBIT origins. Deliberately no `*.netlify.app` wildcard —
// that would trust every site hosted on Netlify, not just this one.
app.use(cors({
  origin: [
    /^https?:\/\/localhost(:\d+)?$/,
    "https://orbitdev.work"
  ],
  credentials: false
}));
// Default 100kb is fine for every other route, but Gmail attachments (base64,
// ~33% larger than the source file) need real headroom — 25MB matches Gmail's
// own per-message attachment limit.
app.use(express.json({ limit: "25mb" }));
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
  // A literal `"` in the remaining string would close the quoted argument early and let
  // whatever follows run as a separate shell token. Windows already disallows `"` in real
  // paths, so this only ever fires on bad/malicious input — refuse it rather than risk it.
  if (s.includes('"')) return "";
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

app.delete("/gmail/config", (req, res) => { try { deleteGmailCreds(req.userId); } catch { /**/ } resetClient(req.userId); resetTransporter(req.userId); res.json({ ok: true }); });

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
        return {
          subject: p.subject || "(no subject)", from: p.from?.text || "", to: p.to?.text || "", date: p.date,
          text: p.text || "", html: typeof p.html === "string" ? p.html : "",
          messageId: p.messageId || "", references: [p.references || []].flat(),
          // Metadata only — no binary content is read into memory here, this
          // just powers the "create ticket from this email" attachments list.
          attachments: (p.attachments || []).map((a) => ({ filename: a.filename || "attachment", contentType: a.contentType, size: a.size })),
        };
      } finally { lock.release(); }
    });
    res.json({ ok: true, message });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Send a message (or a reply) through the same Gmail account as the inbox.
// `html` is optional (Compose's rich-text editor) — text is always sent too,
// as the plain-text alternative part. `attachments` are base64-encoded in the
// browser (FileReader) and decoded back to Buffers here.
app.post("/gmail/send", async (req, res) => {
  const { to, subject, text, html, cc, bcc, inReplyTo, references, attachments } = req.body || {};
  if (!to || !String(to).trim()) return res.status(400).json({ ok: false, error: "recipient required" });
  if (!text || !String(text).trim()) return res.status(400).json({ ok: false, error: "message body required" });
  try {
    const c = gmailCreds(req.userId);
    if (!c) return res.status(400).json({ ok: false, error: "Gmail not configured" });
    const mail = {
      from: c.user, to, cc: cc || undefined, bcc: bcc || undefined,
      subject: subject || "(no subject)", text, html: html || undefined,
      inReplyTo: inReplyTo || undefined,
      references: Array.isArray(references) && references.length ? references.join(" ") : undefined,
      attachments: Array.isArray(attachments) && attachments.length
        ? attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, content: Buffer.from(a.content, "base64") }))
        : undefined,
    };
    await getTransporter(req.userId).sendMail(mail);
    res.json({ ok: true });
  } catch (e) { resetTransporter(req.userId); res.status(500).json({ ok: false, error: e.message }); }
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

// List every container (running + stopped) for the Docker page's lifecycle controls —
// separate from GET /docker (running-only), which the dashboard stat depends on.
app.get("/docker/all", (_req, res) => {
  exec('docker ps -a --format "{{.Names}}|{{.Image}}|{{.Status}}|{{.State}}"', { timeout: 8000, windowsHide: true }, (err, stdout) => {
    if (err) return res.json({ ok: true, available: false, containers: [] });
    const containers = String(stdout).trim().split("\n").filter(Boolean).map((line) => {
      const [name, image, status, state] = line.split("|");
      return { name, image, status, state, running: state === "running" };
    });
    res.json({ ok: true, available: true, containers });
  });
});

const DOCKER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

function dockerLifecycle(action) {
  return (req, res) => {
    const name = String(req.body?.name || "");
    if (!DOCKER_NAME_RE.test(name)) return res.status(400).json({ ok: false, error: "invalid container name" });
    execFile("docker", [action, name], { timeout: 30000, windowsHide: true }, (err, _stdout, stderr) => {
      if (err) return res.status(500).json({ ok: false, error: (stderr || err.message || `${action} failed`).toString().trim().slice(-300) });
      broadcast("docker:changed", { name, action });
      res.json({ ok: true });
    });
  };
}
app.post("/docker/start", dockerLifecycle("start"));
app.post("/docker/stop", dockerLifecycle("stop"));
app.post("/docker/restart", dockerLifecycle("restart"));
// Destructive — the UI confirms before calling this.
app.post("/docker/rm", (req, res) => {
  const name = String(req.body?.name || "");
  if (!DOCKER_NAME_RE.test(name)) return res.status(400).json({ ok: false, error: "invalid container name" });
  execFile("docker", ["rm", "-f", name], { timeout: 30000, windowsHide: true }, (err, _stdout, stderr) => {
    if (err) return res.status(500).json({ ok: false, error: (stderr || err.message || "remove failed").toString().trim().slice(-300) });
    broadcast("docker:changed", { name, action: "rm" });
    res.json({ ok: true });
  });
});

// Tail logs (stdout+stderr) for one container.
app.get("/docker/logs", (req, res) => {
  const name = String(req.query.name || "");
  if (!DOCKER_NAME_RE.test(name)) return res.status(400).json({ ok: false, error: "invalid container name" });
  const tail = Math.min(Math.max(Number(req.query.tail) || 200, 1), 2000);
  execFile("docker", ["logs", "--tail", String(tail), "--timestamps", name], { timeout: 15000, maxBuffer: 1024 * 1024 * 8, windowsHide: true }, (err, stdout, stderr) => {
    if (err && !stdout && !stderr) return res.status(500).json({ ok: false, error: err.message.slice(-300) });
    res.json({ ok: true, logs: `${stdout || ""}${stderr || ""}` || "(no output)" });
  });
});

// Live-tail a container's logs over /events (`docker:log`), instead of the
// one-shot /docker/logs above. Keyed by user+name so a second start while one
// is already running is a no-op rather than spawning a duplicate `docker
// logs -f`; explicitly stopped via /docker/logs/unstream (the UI does this in
// its cleanup effect) rather than tied to any single websocket connection.
const dockerLogStreams = new Map(); // `${userId}:${name}` -> child process
app.post("/docker/logs/stream", (req, res) => {
  const name = String(req.body?.name || "");
  if (!DOCKER_NAME_RE.test(name)) return res.status(400).json({ ok: false, error: "invalid container name" });
  const key = `${req.userId}:${name}`;
  if (dockerLogStreams.has(key)) return res.json({ ok: true, already: true });

  const child = spawn("docker", ["logs", "-f", "--tail", "100", "--timestamps", name], { windowsHide: true });
  dockerLogStreams.set(key, child);
  const pushLine = (stream) => (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) sendToUser(req.userId, "docker:log", { name, stream, line });
  };
  child.stdout.on("data", pushLine("stdout"));
  child.stderr.on("data", pushLine("stderr"));
  child.on("exit", () => dockerLogStreams.delete(key));
  res.json({ ok: true });
});
app.post("/docker/logs/unstream", (req, res) => {
  const name = String(req.body?.name || "");
  const key = `${req.userId}:${name}`;
  const child = dockerLogStreams.get(key);
  if (child) { child.kill(); dockerLogStreams.delete(key); }
  res.json({ ok: true });
});

// One-shot `docker exec` — not an interactive shell, just runs a single command and returns its output.
app.post("/docker/exec", (req, res) => {
  const name = String(req.body?.name || "");
  const cmd = String(req.body?.cmd || "").trim();
  if (!DOCKER_NAME_RE.test(name)) return res.status(400).json({ ok: false, error: "invalid container name" });
  if (!cmd) return res.status(400).json({ ok: false, error: "command required" });
  execFile("docker", ["exec", name, "sh", "-c", cmd], { timeout: 20000, maxBuffer: 1024 * 1024 * 4, windowsHide: true }, (err, stdout, stderr) => {
    if (err && !stdout && !stderr) return res.status(500).json({ ok: false, error: err.message.slice(-300) });
    res.json({ ok: true, output: `${stdout || ""}${stderr || ""}` || "(no output)" });
  });
});

// ---- Docker Compose ----
app.get("/docker/compose/ls", (_req, res) => {
  exec('docker compose ls -a --format json', { timeout: 10000, windowsHide: true }, (err, stdout) => {
    if (err) return res.json({ ok: true, available: false, stacks: [] });
    let stacks = [];
    try { stacks = JSON.parse(stdout || "[]"); } catch { stacks = []; }
    res.json({ ok: true, available: true, stacks: stacks.map((s) => ({ name: s.Name, status: s.Status, configFiles: s.ConfigFiles || "" })) });
  });
});
app.post("/docker/compose/up", (req, res) => {
  const file = String(req.body?.file || "").trim().replace(/^["']|["']$/g, "");
  if (!file) return res.status(400).json({ ok: false, error: "compose file required" });
  const dir = dirname(file);
  execFile("docker", ["compose", "-f", file, "up", "-d"], { cwd: dir, timeout: 300000, maxBuffer: 1024 * 1024 * 8, windowsHide: true }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ ok: false, error: (stderr || err.message || "compose up failed").toString().slice(-500) });
    broadcast("docker:changed", { compose: file, action: "up" });
    res.json({ ok: true, output: (stdout || stderr || "").toString().slice(-500) });
  });
});
app.post("/docker/compose/down", (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ ok: false, error: "stack name required" });
  execFile("docker", ["compose", "-p", name, "down"], { timeout: 120000, maxBuffer: 1024 * 1024 * 8, windowsHide: true }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ ok: false, error: (stderr || err.message || "compose down failed").toString().slice(-500) });
    broadcast("docker:changed", { compose: name, action: "down" });
    res.json({ ok: true, output: (stdout || stderr || "").toString().slice(-500) });
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

// Database names can't be parameterized in DDL, so this is the one place we
// build SQL by hand — restrict to Postgres's own safe-identifier charset
// (letters/digits/underscore, not leading with a digit) before quoting it.
const SAFE_DB_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
app.post("/pg/databases/create", async (req, res) => {
  const server = readServer(req.body);
  if (!server) return res.status(400).json({ ok: false, error: "server connection details are required" });
  const name = (req.body.name || "").trim();
  if (!SAFE_DB_NAME.test(name)) return res.status(400).json({ ok: false, error: "Database name must start with a letter or underscore and contain only letters, digits, and underscores." });
  let client;
  try {
    client = await pgConnect(server, "postgres");
    await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
    res.json({ ok: true, database: name });
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

// pg_dump-based backup only (no restore this pass — that's a real destructive
// operation triggered remotely and deserves its own explicit go-ahead later).
// Shells out to the separate `pg_dump` client-tools binary, not the `pg` npm
// driver pgConnect() uses above — same "not installed" detection pattern as
// Docker's /docker endpoint (probe, degrade to unavailable rather than 500).
app.get("/pg/backup/available", (_req, res) => {
  execFile("pg_dump", ["--version"], { timeout: 5000, windowsHide: true }, (err) => res.json({ ok: true, available: !err }));
});
app.post("/pg/backup", (req, res) => {
  const server = readServer(req.body);
  if (!server) return res.status(400).json({ ok: false, error: "server connection details are required" });
  const database = String(req.body.database || server.database || "postgres");
  const env = { ...process.env, PGPASSWORD: server.password || "" };
  if (server.ssl) env.PGSSLMODE = "require";
  const args = ["-h", server.host, "-p", String(Number(server.port) || 5432), "-U", server.user, "-d", database, "--no-owner", "--no-privileges"];
  execFile("pg_dump", args, { env, timeout: 300000, maxBuffer: 1024 * 1024 * 200, windowsHide: true }, (err, stdout, stderr) => {
    if (err) {
      const notInstalled = err.code === "ENOENT";
      return res.status(500).json({ ok: false, error: notInstalled ? "pg_dump isn't installed on this machine." : (stderr || err.message || "pg_dump failed").toString().trim().slice(-500) });
    }
    res.setHeader("Content-Type", "application/sql");
    res.setHeader("Content-Disposition", `attachment; filename="${database}-${new Date().toISOString().slice(0, 10)}.sql"`);
    res.send(stdout);
  });
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

app.post("/git/status", async (req, res) => {
  const { path } = req.body || {};
  if (!path) return res.status(400).json({ ok: false, error: "path required" });
  const dir = clean(path);

  const top = await git(dir, "rev-parse --show-toplevel");
  if (!top.ok) return res.status(400).json({ ok: false, reason: "not_a_repo", error: "not a git repository" });
  const root = top.out || dir;

  const branch = (await git(root, "rev-parse --abbrev-ref HEAD")).out || "HEAD";
  const upstream = await git(root, "rev-parse --abbrev-ref --symbolic-full-name @{u}");
  let ahead = 0, behind = 0;
  if (upstream.ok) {
    const counts = await git(root, "rev-list --left-right --count HEAD...@{u}");
    const [a, b] = (counts.out || "0\t0").split(/\s+/);
    ahead = Number(a) || 0; behind = Number(b) || 0;
  }
  const st = await git(root, "status --porcelain");
  const dirtyFiles = st.out ? st.out.split("\n").filter(Boolean) : [];
  const last = await git(root, "log -1 --format=%H%x1f%an%x1f%ad%x1f%s --date=iso-strict");
  const [hash, author, date, subject] = (last.out || "").split("\x1f");

  res.json({
    ok: true, root, branch, upstream: upstream.ok ? upstream.out : null, ahead, behind,
    dirty: dirtyFiles.length, dirtyFiles: dirtyFiles.slice(0, 50),
    lastCommit: hash ? { hash, author, date, subject } : null,
  });
});

// Git ref names (branches) and commit hashes both end up interpolated straight
// into a shell string via git() — unlike `path` (which only ever becomes a
// `cwd`, never part of the command line), these need a real allow-list, not
// just quote-stripping. Same spirit as DOCKER_NAME_RE below.
const GIT_REF_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/;
const GIT_HASH_RE = /^[0-9a-fA-F]{4,40}$/;

app.post("/git/log", async (req, res) => {
  const { path, limit, branch } = req.body || {};
  if (!path) return res.status(400).json({ ok: false, error: "path required" });
  const dir = clean(path);
  if (branch && !GIT_REF_RE.test(branch)) return res.status(400).json({ ok: false, error: "invalid branch name" });

  const top = await git(dir, "rev-parse --show-toplevel");
  if (!top.ok) return res.status(400).json({ ok: false, reason: "not_a_repo", error: "not a git repository" });
  const root = top.out || dir;

  const n = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const ref = branch || "HEAD";
  const log = await git(root, `log -${n} ${ref} --format=%H%x1f%an%x1f%ae%x1f%ad%x1f%s%x1f%P --date=iso-strict`);
  if (!log.ok) return res.status(200).json({ ok: false, error: log.err.slice(-300) || "log failed" });
  const commits = log.out.split("\n").filter(Boolean).map((l) => {
    const [hash, author, email, date, subject, parents] = l.split("\x1f");
    return { hash, author, email, date, subject, parents: parents ? parents.split(" ").filter(Boolean) : [] };
  });
  res.json({ ok: true, root, commits });
});

app.post("/git/branches", async (req, res) => {
  const { path } = req.body || {};
  if (!path) return res.status(400).json({ ok: false, error: "path required" });
  const dir = clean(path);

  const top = await git(dir, "rev-parse --show-toplevel");
  if (!top.ok) return res.status(400).json({ ok: false, reason: "not_a_repo", error: "not a git repository" });
  const root = top.out || dir;

  // for-each-ref's format DSL is not git-log's pretty-format — it doesn't
  // support the %x1f hex-literal escape the other endpoints use (verified:
  // it prints "%x1f" literally), but it does support %09 (an actual tab).
  const list = await git(root, `for-each-ref refs/heads/ --format=%(refname:short)%09%(objectname)%09%(committerdate:iso-strict)%09%(subject)%09%(HEAD)`);
  if (!list.ok) return res.status(200).json({ ok: false, error: list.err.slice(-300) || "branch list failed" });
  const branches = list.out.split("\n").filter(Boolean).map((l) => {
    const [name, hash, date, subject, head] = l.split("\t");
    return { name, hash, date, subject, current: head === "*" };
  });
  res.json({ ok: true, root, branches });
});

app.post("/git/show", async (req, res) => {
  const { path, hash } = req.body || {};
  if (!path) return res.status(400).json({ ok: false, error: "path required" });
  if (!hash || !GIT_HASH_RE.test(hash)) return res.status(400).json({ ok: false, error: "invalid commit hash" });
  const dir = clean(path);

  const top = await git(dir, "rev-parse --show-toplevel");
  if (!top.ok) return res.status(400).json({ ok: false, reason: "not_a_repo", error: "not a git repository" });
  const root = top.out || dir;

  const shown = await git(root, `show --format=%H%x1f%an%x1f%ae%x1f%ad%x1f%s%x1e --unified=3 --date=iso-strict ${hash}`, 30000);
  if (!shown.ok) return res.status(200).json({ ok: false, error: shown.err.slice(-300) || "show failed" });
  const sep = shown.out.indexOf("\x1e");
  const header = sep === -1 ? shown.out : shown.out.slice(0, sep);
  const patch = sep === -1 ? "" : shown.out.slice(sep + 1).replace(/^\n/, "");
  const [h, author, email, date, subject] = header.split("\x1f");
  res.json({ ok: true, root, commit: { hash: h, author, email, date, subject }, patch });
});

// Working-tree diff — staged and unstaged separately, so a caller (the AI
// commit-message writer) can prefer staged when there is any, same as `git
// commit` itself would. With an optional `base` ref, also returns the
// three-dot range diff against it (base...HEAD) for the AI PR-description
// writer. `base` goes through the same GIT_REF_RE allow-list /git/log uses
// for `branch` — the only user-supplied ref here.
app.post("/git/diff", async (req, res) => {
  const { path, base } = req.body || {};
  if (!path) return res.status(400).json({ ok: false, error: "path required" });
  if (base && !GIT_REF_RE.test(base)) return res.status(400).json({ ok: false, error: "invalid base ref" });
  const dir = clean(path);

  const top = await git(dir, "rev-parse --show-toplevel");
  if (!top.ok) return res.status(400).json({ ok: false, reason: "not_a_repo", error: "not a git repository" });
  const root = top.out || dir;

  const [staged, unstaged, range] = await Promise.all([
    git(root, "diff --cached --unified=3"),
    git(root, "diff --unified=3"),
    base ? git(root, `diff --unified=3 ${base}...HEAD`) : Promise.resolve({ ok: true, out: "" }),
  ]);
  res.json({ ok: true, root, staged: staged.out, unstaged: unstaged.out, range: base ? range.out : undefined });
});

// One-shot project terminal — cwd is always the caller-supplied project path
// (same trust model /git/*, /dev/start etc. already use: the client is the
// one that resolved this from the project's saved fe_path/sln_path, not a
// free-form value typed by whoever's driving the terminal). Deliberately not
// a PTY/interactive shell, and the command itself is intentionally NOT
// allow-listed (that's the point of a terminal) — the only thing this
// endpoint constrains is where it runs, not what.
app.post("/term/run", (req, res) => {
  const { path, command } = req.body || {};
  if (!path) return res.status(400).json({ ok: false, error: "path required" });
  const cmd = String(command || "").trim();
  if (!cmd) return res.status(400).json({ ok: false, error: "command required" });
  const dir = clean(path);
  exec(cmd, { cwd: dir, timeout: 300000, maxBuffer: 1024 * 1024 * 8, windowsHide: true }, (err, stdout, stderr) => {
    res.json({ ok: true, code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: String(stdout || ""), stderr: String(stderr || "") });
  });
});

app.get("/port/check", async (req, res) => {
  const port = Number(req.query.port);
  if (!port) return res.status(400).json({ ok: false, error: "port required" });
  const inUse = await portInUse(port);
  const owned = [...devServers.values()].find((d) => d.port === port && d.userId === req.userId);
  res.json({ ok: true, inUse, ownedBy: owned ? owned.project : null });
});

// Find every PID currently LISTENING on a given TCP port — used to clean up
// stale agent processes left behind by a crashed window or a launch that
// didn't shut down cleanly (the classic EADDRINUSE-on-restart case).
function pidsOnPort(port) {
  return new Promise((resolve) => {
    if (isWin) {
      exec("netstat -ano", { windowsHide: true, maxBuffer: 1024 * 1024 * 8 }, (err, stdout) => {
        if (err) return resolve([]);
        const pids = new Set();
        for (const line of String(stdout).split("\n")) {
          const m = line.trim().match(/^TCP6?\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
          if (m && Number(m[1]) === port) pids.add(Number(m[2]));
        }
        resolve([...pids]);
      });
    } else {
      exec(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, (err, stdout) => {
        if (err) return resolve([]);
        resolve([...new Set(String(stdout).split("\n").map((s) => Number(s.trim())).filter(Boolean))]);
      });
    }
  });
}

// Kill every process (across every ORBIT window/session on this machine)
// bound to the agent's own port, then exit this instance too if it's one of
// them — leaves the port fully free for the next `npm start` / relaunch.
app.post("/agent/kill-sessions", async (req, res) => {
  const pids = await pidsOnPort(PORT);
  const self = process.pid;
  const others = pids.filter((pid) => pid !== self);
  const killed = [];
  for (const pid of others) {
    try {
      if (isWin) exec(`taskkill /PID ${pid} /T /F`, { windowsHide: true });
      else process.kill(pid, "SIGKILL");
      killed.push(pid);
    } catch { /* already gone */ }
  }
  const killedSelf = pids.includes(self);
  res.json({ ok: true, killed, killedSelf });
  if (killedSelf) setTimeout(() => process.exit(0), 200); // let the response flush before this process exits too
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
    // stdout/stderr piped (not "ignore") so /events can push live lines — see
    // pushLog below. Still detached+unref so the dev server survives if the
    // agent process itself exits (e.g. the packaged .exe's auto-quit), same
    // as before this change; piping doesn't affect that.
    const child = spawn(command, { cwd: clean(path), shell: true, detached: true, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    child.unref();
    const rec = { pid: child.pid, port: port ? Number(port) : null, path: clean(path), command, project: project || null, startedAt: Date.now(), userId: req.userId, log: [] };
    devServers.set(child.pid, rec);

    const pushLog = (stream) => (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
        rec.log.push(line);
        if (rec.log.length > 500) rec.log.shift();
        sendToUser(rec.userId, "dev:log", { pid: child.pid, stream, line });
      }
    };
    child.stdout?.on("data", pushLog("stdout"));
    child.stderr?.on("data", pushLog("stderr"));

    child.on("exit", () => { devServers.delete(child.pid); broadcast("dev:changed", { pid: child.pid, up: false }); });
    broadcast("dev:changed", { pid: child.pid, up: true, project: rec.project, port: rec.port });
    res.json({ ok: true, pid: child.pid, port: rec.port });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get("/dev/running", (req, res) => res.json({ ok: true, servers: [...devServers.values()].filter((d) => d.userId === req.userId) }));

// Recent-history snapshot (ring buffer, last 500 lines) so a client that
// opens the log panel after the server already started still sees context —
// live lines after that arrive over /events as `dev:log`.
app.get("/dev/log/:pid", (req, res) => {
  const pid = Number(req.params.pid);
  const rec = devServers.get(pid);
  if (!rec || rec.userId !== req.userId) return res.status(404).json({ ok: false, error: "not found" });
  res.json({ ok: true, lines: rec.log });
});

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

// ---- System idle ----
// ORBIT's timer used to infer idle from browser-tab events, which counts a user
// heads-down in their editor as idle and wrongly pauses the session. This reads
// real OS-wide input idle time instead, so "no activity" means the machine, not
// the tab. Windows: GetLastInputInfo via P/Invoke. macOS: IOHIDSystem's
// HIDIdleTime. Linux: xprintidle when present. Unsupported platforms report
// `supported:false` so the client can fall back to its old behaviour.
const IDLE_PS = `Add-Type @'
using System;
using System.Runtime.InteropServices;
public class OrbitIdle {
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  public static uint Seconds() {
    LASTINPUTINFO l = new LASTINPUTINFO();
    l.cbSize = (uint)Marshal.SizeOf(l);
    GetLastInputInfo(ref l);
    return ((uint)Environment.TickCount - l.dwTime) / 1000;
  }
}
'@
[Console]::Out.Write([OrbitIdle]::Seconds())`;

function systemIdleSeconds() {
  return new Promise((resolve) => {
    const done = (v) => resolve(Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
    if (isWin) {
      execFile("powershell", ["-NoProfile", "-Command", IDLE_PS], { windowsHide: true, timeout: 5000 },
        (err, out) => done(err ? NaN : parseInt(String(out).trim(), 10)));
    } else if (platform() === "darwin") {
      // HIDIdleTime is in nanoseconds.
      exec("ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print $NF; exit}'", { timeout: 5000 },
        (err, out) => done(err ? NaN : parseInt(String(out).trim(), 10) / 1e9));
    } else {
      exec("xprintidle", { timeout: 5000 }, (err, out) => done(err ? NaN : parseInt(String(out).trim(), 10) / 1000));
    }
  });
}

app.get("/system/idle", async (_req, res) => {
  const seconds = await systemIdleSeconds();
  if (seconds === null) return res.json({ ok: true, supported: false });
  res.json({ ok: true, supported: true, seconds });
});

// ---- VS Code ----
// Everything here shells out to the `code` CLI, same as /launch's openVSCode.
// Capturing output (rather than fire-and-forget) is what separates these from
// runShell: listing extensions and probing availability need the stdout back.
const codeExec = (args, timeout = 20000) =>
  new Promise((resolve) => {
    // `code` on Windows is code.cmd, which execFile can't run without a shell.
    exec(`code ${args}`, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 * 4 },
      (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ""), err: String(stderr || err?.message || "") }));
  });

app.get("/vscode/status", async (_req, res) => {
  const r = await codeExec("--version", 8000);
  if (!r.ok) return res.json({ ok: true, available: false, error: "`code` CLI not on PATH — in VS Code run “Shell Command: Install 'code' command in PATH”" });
  const [version] = r.out.trim().split(/\r?\n/);
  res.json({ ok: true, available: true, version });
});

// Open a folder, or jump straight to a file at a line/column (`code -g`).
app.post("/vscode/open", (req, res) => {
  const { path: target, line, column, reuse = true, newWindow = false } = req.body || {};
  if (!target) return res.status(400).json({ ok: false, error: "path required" });
  const quoted = q(target);
  if (!quoted) return res.status(400).json({ ok: false, error: "invalid path" });
  const win = newWindow ? "-n" : reuse ? "-r" : "";
  // -g takes file:line:col and must not be quoted apart from the path itself, so
  // the suffix is appended inside the quotes.
  const goto = Number.isFinite(Number(line))
    ? `-g ${q(`${target}:${Number(line)}${Number.isFinite(Number(column)) ? `:${Number(column)}` : ""}`)}`
    : quoted;
  const okRun = runShell(`code ${win} ${goto}`.replace(/\s+/g, " ").trim());
  if (!okRun) return res.status(500).json({ ok: false, error: "couldn't launch VS Code" });
  res.json({ ok: true });
});

app.post("/vscode/diff", (req, res) => {
  const { left, right } = req.body || {};
  const a = q(left), b = q(right);
  if (!a || !b) return res.status(400).json({ ok: false, error: "left and right paths required" });
  if (!runShell(`code --diff ${a} ${b}`)) return res.status(500).json({ ok: false, error: "couldn't launch VS Code" });
  res.json({ ok: true });
});

app.get("/vscode/extensions", async (_req, res) => {
  const r = await codeExec("--list-extensions --show-versions");
  if (!r.ok) return res.status(500).json({ ok: false, error: r.err.slice(0, 200) || "couldn't list extensions" });
  const extensions = r.out.trim().split(/\r?\n/).filter(Boolean).map((l) => {
    const at = l.lastIndexOf("@");
    return at > 0 ? { id: l.slice(0, at), version: l.slice(at + 1) } : { id: l, version: "" };
  });
  res.json({ ok: true, extensions });
});

// ---- ORBIT's own VS Code extension ----
// Shipped as a .vsix next to the agent so ORBIT can offer a one-click install
// rather than making the user hunt for a folder and reload. Checked in a few
// places because the agent runs both from source (repo layout) and as a
// packaged exe (vsix sits beside it).
function findOrbitVsix() {
  const dirs = [
    join(__dir, "..", "extension"),   // running from source: agent/ -> extension/
    join(__dir, "extension"),
    __dir,                            // packaged: dropped beside orbit.exe
  ];
  for (const dir of dirs) {
    try {
      if (!existsSync(dir)) continue;
      const hit = readdirSync(dir).filter((f) => /^orbit-vscode-.*\.vsix$/i.test(f)).sort().pop();
      if (hit) return join(dir, hit);
    } catch { /* unreadable dir — try the next */ }
  }
  return null;
}

app.get("/vscode/extension/package", (_req, res) => {
  const file = findOrbitVsix();
  if (!file) return res.json({ ok: true, available: false });
  const version = (file.match(/orbit-vscode-(.+)\.vsix$/i) || [])[1] || null;
  res.json({ ok: true, available: true, file, version });
});

app.post("/vscode/extension/install", async (req, res) => {
  const file = findOrbitVsix();
  if (!file) return res.status(404).json({ ok: false, error: "No ORBIT .vsix found next to the agent — run `npm run package` in extension/" });
  const r = await codeExec(`--install-extension ${q(file)} --force`, 120000);
  if (!r.ok) return res.status(500).json({ ok: false, error: (r.err || "install failed").slice(0, 300) });
  // `code` exits 0 on "already installed" too — pass its own words back so the
  // UI can say what actually happened instead of a generic success.
  res.json({ ok: true, output: r.out.trim().slice(-300), reloadRequired: true });
});

app.post("/vscode/extensions/install", async (req, res) => {
  const { id } = req.body || {};
  // Marketplace ids are `publisher.name`; anything else is refused rather than
  // interpolated into a shell string.
  if (!id || !/^[A-Za-z0-9][\w-]*\.[\w.-]+$/.test(String(id))) {
    return res.status(400).json({ ok: false, error: "invalid extension id" });
  }
  const r = await codeExec(`--install-extension ${id} --force`, 120000);
  if (!r.ok) return res.status(500).json({ ok: false, error: r.err.slice(0, 200) || "install failed" });
  res.json({ ok: true, output: r.out.trim().slice(-400) });
});

// Generate a multi-root .code-workspace from a project's folders and open it —
// a project whose frontend and solution live in different trees opens as one
// window instead of two. Written next to the first folder so it's stable across
// calls (VS Code remembers per-workspace layout/state by path).
app.post("/vscode/workspace", (req, res) => {
  const { name, folders, open = true } = req.body || {};
  const list = (Array.isArray(folders) ? folders : []).map((f) => String(f || "").trim()).filter(Boolean);
  if (!list.length) return res.status(400).json({ ok: false, error: "at least one folder required" });
  const safeName = String(name || "orbit").replace(/[^\w.-]+/g, "-").slice(0, 60) || "orbit";
  try {
    const base = clean(list[0]);
    const file = join(base, `${safeName}.code-workspace`);
    writeFileSync(file, JSON.stringify({ folders: list.map((p) => ({ path: clean(p) })), settings: {} }, null, 2));
    if (open && !runShell(`code ${q(file)}`)) return res.status(500).json({ ok: false, error: "wrote workspace but couldn't open VS Code" });
    res.json({ ok: true, file });
  } catch (e) { res.status(500).json({ ok: false, error: e.message.slice(0, 200) }); }
});

// ---- Editor activity (posted by the ORBIT VS Code extension) ----
// Kept in memory only: it's a live signal (what am I editing right now), not a
// record — the durable version is focus_events, which the browser writes.
const editorState = new Map(); // userId -> { file, language, workspace, project, at, editing }
const EDITOR_STALE_MS = 90_000;

app.post("/editor/activity", (req, res) => {
  const { file, language, workspace, project, editing } = req.body || {};
  editorState.set(req.userId, {
    file: file ? String(file).slice(0, 500) : null,
    language: language ? String(language).slice(0, 40) : null,
    workspace: workspace ? String(workspace).slice(0, 300) : null,
    project: project ? String(project).slice(0, 120) : null,
    editing: !!editing,
    at: Date.now(),
  });
  res.json({ ok: true });
});

app.get("/editor/state", (req, res) => {
  const s = editorState.get(req.userId);
  // A closed editor stops posting; don't report minutes-old state as current.
  if (!s || Date.now() - s.at > EDITOR_STALE_MS) return res.json({ ok: true, connected: false });
  res.json({ ok: true, connected: true, ...s, idleSeconds: Math.floor((Date.now() - s.at) / 1000) });
});

// ---- Work list bridge (ORBIT tab -> agent -> VS Code extension) ----
// The agent has no Supabase client (it only verifies the JWT, it never queries),
// and giving it one would mean shipping project URL + anon key into the agent's
// config for every user. The browser already holds this data, so it pushes a
// compact snapshot here instead and the extension reads it back. Trade-off: the
// sidebar is only as fresh as the last time an ORBIT tab was open — the
// extension surfaces that rather than showing stale rows as current.
const workList = new Map(); // userId -> { tasks, tickets, timer, at }
const WORKLIST_STALE_MS = 10 * 60_000;

app.post("/worklist", (req, res) => {
  const { tasks, tickets, timer } = req.body || {};
  const trim = (arr) => (Array.isArray(arr) ? arr : []).slice(0, 50).map((t) => ({
    id: String(t?.id || "").slice(0, 64),
    title: String(t?.title || "").slice(0, 200),
    status: String(t?.status || "").slice(0, 40),
    priority: String(t?.priority || "").slice(0, 16),
    project: t?.project ? String(t.project).slice(0, 80) : null,
  }));
  const { hours, projects, break: brk, ai } = req.body || {};
  workList.set(req.userId, {
    tasks: trim(tasks),
    tickets: trim(tickets),
    timer: timer && typeof timer === "object"
      ? {
          running: !!timer.running, projectId: timer.projectId ?? null, taskId: timer.taskId ?? null,
          seconds: Number(timer.seconds) || 0,
          startedAt: Number(timer.startedAt) || null, project: timer.project ?? null,
        }
      : { running: false },
    hours: hours && typeof hours === "object" ? { today: Number(hours.today) || 0, total: Number(hours.total) || 0 } : null,
    projects: (Array.isArray(projects) ? projects : []).slice(0, 40)
      .map((p) => ({ id: String(p?.id || "").slice(0, 64), name: String(p?.name || "").slice(0, 80) })),
    break: brk && typeof brk === "object"
      ? { onBreak: !!brk.onBreak, startedAt: Number(brk.startedAt) || null, idlePaused: !!brk.idlePaused }
      : null,
    // Ranking is expensive to produce, so it's kept verbatim until ORBIT replaces it.
    ai: ai && Array.isArray(ai.items)
      ? { rankedAt: Number(ai.rankedAt) || Date.now(), items: ai.items.slice(0, 40).map((x) => ({ id: String(x?.id || "").slice(0, 64), reason: String(x?.reason || "").slice(0, 120) })) }
      : null,
    at: Date.now(),
  });
  res.json({ ok: true });
});

/** Live ORBIT tabs for this user — lets the extension distinguish "stale data" from "nothing is driving it". */
function orbitTabCount(userId) {
  if (!wss) return 0;
  let n = 0;
  for (const c of wss.clients) if (c.readyState === 1 && c.userId === userId) n++;
  return n;
}

app.get("/worklist", (req, res) => {
  const orbitOpen = orbitTabCount(req.userId) > 0;
  const w = workList.get(req.userId);
  if (!w) return res.json({ ok: true, fresh: false, orbitOpen, tasks: [], tickets: [], timer: { running: false } });
  res.json({ ok: true, fresh: Date.now() - w.at <= WORKLIST_STALE_MS, ageMs: Date.now() - w.at, orbitOpen, ...w });
});

// The extension can't act on ORBIT state directly — the timer lives in the
// browser's localStorage and task writes go through the browser's RLS-scoped
// Supabase client. So commands are relayed over the existing websocket to the
// ORBIT tab, which performs them as if the user had clicked.
const ORBIT_COMMANDS = new Set(["timer:start", "timer:stop", "task:status", "task:create", "ai:rank", "open"]);

app.post("/orbit/command", (req, res) => {
  const { command, payload } = req.body || {};
  if (!ORBIT_COMMANDS.has(String(command))) return res.status(400).json({ ok: false, error: "unknown command" });
  const delivered = sendToUser(req.userId, "orbit:command", { command, payload: payload || {} });
  if (!delivered) return res.status(409).json({ ok: false, error: "ORBIT isn't open — open the ORBIT tab and try again" });
  res.json({ ok: true });
});

// Open a native folder/file dialog and return the selected absolute path.
function nativePick(type) {
  return new Promise((resolve) => {
    let cmd, args;
    if (isWin) {
      // Folder picking deliberately does NOT use System.Windows.Forms.FolderBrowserDialog —
      // that legacy dialog enumerates the whole shell namespace (This PC, every drive,
      // Network) before it's usable, which can hang for many seconds if a mapped network
      // drive is disconnected or a removable/optical drive is slow to respond. Using
      // OpenFileDialog with CheckFileExists/ValidateNames off ("pick a folder" hack) reuses
      // the same fast modern Explorer dialog as the .sln picker below, so it opens instantly.
      const ps = type === "folder"
        ? "Add-Type -AssemblyName System.Windows.Forms;$d=New-Object System.Windows.Forms.OpenFileDialog;$d.ValidateNames=$false;$d.CheckFileExists=$false;$d.CheckPathExists=$true;$d.FileName='Select Folder';$d.Title='Select a folder';if($d.ShowDialog() -eq 'OK'){[Console]::Out.Write([System.IO.Path]::GetDirectoryName($d.FileName))}"
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

// Normalizes either wire shape into a chat `messages` array: `messages` (Ask AI's
// follow-up thread) wins, `prompt` (every other caller) is the single-turn form.
// Returns [] when there's nothing usable, so callers do one emptiness check.
const MAX_TURNS = 12; // ~6 exchanges — bounds both cost and the local model's 4k context

// JS strings are UTF-16, so a plain slice() can land between the two halves of a
// surrogate pair (any emoji or astral character) and leave a lone surrogate. That
// isn't representable in UTF-8: it survives JSON intact and then throws
// "surrogates not allowed" inside the Python worker while it tokenizes the prompt,
// failing the request before generation starts. Drop the orphaned half.
function sliceText(s, max) {
  const out = String(s).slice(0, max);
  const last = out.charCodeAt(out.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? out.slice(0, -1) : out;
}

function coerceTurns({ prompt, messages }) {
  const turns = Array.isArray(messages) && messages.length
    ? messages
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && String(m.content || "").trim())
        .map((m) => ({ role: m.role, content: sliceText(m.content, 12000) }))
        .slice(-MAX_TURNS)
    : (prompt && String(prompt).trim() ? [{ role: "user", content: sliceText(prompt, 12000) }] : []);
  // Anthropic requires the first turn to be `user`. Trimming to the last N can
  // land on an assistant turn, so this has to run after the slice, not before.
  if (turns.length && turns[0].role !== "user") turns.shift();
  return turns;
}

// ---- Generic AI helper (schema Q&A, ticket triage, standup summaries, Ask AI) —
// reuses the caller's own API key (stored in Supabase `integrations`, forwarded
// per-request same as the seed feature's project hints; never persisted here).
// Four cloud providers share this endpoint shape so the client's fallback chain
// (see src/lib/ai.ts) can fail over between them without knowing any
// provider-specific request/response format itself. ----
const CLOUD_MODELS = {
  // Haiku/flash/mini tiers, not the flagship ones — these are short, bounded
  // answers (triage lines, standup bullets, grounded Q&A, or Ask AI's threaded
  // prose+actions), so the fastest/cheapest tier per provider is plenty.
  anthropic: "claude-haiku-4-5-20251001",
  gemini: "gemini-2.5-flash",
  openai: "gpt-4o-mini",
  grok: "grok-3-mini",
};
const CLOUD_MAX_TOKENS = 900; // Ask AI's threaded answers carry prose plus an actions block; other callers are far shorter and don't use the headroom.

async function anthropicComplete({ apiKey, system, turns }) {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: CLOUD_MODELS.anthropic, max_tokens: CLOUD_MAX_TOKENS,
    system: system ? sliceText(system, 6000) : undefined,
    messages: turns,
  });
  if (response.stop_reason === "refusal") return { ok: false, error: "The model declined to answer that." };
  return { ok: true, text: response.content.find((b) => b.type === "text")?.text || "" };
}
async function anthropicStream({ apiKey, system, turns, onDelta }) {
  const client = new Anthropic({ apiKey });
  const stream = client.messages.stream({
    model: CLOUD_MODELS.anthropic, max_tokens: CLOUD_MAX_TOKENS,
    system: system ? sliceText(system, 6000) : undefined,
    messages: turns,
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta") onDelta(event.delta.text);
  }
  return { ok: true };
}

function geminiContents(turns) {
  return turns.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] }));
}
function geminiBody(system, turns) {
  return {
    contents: geminiContents(turns),
    generationConfig: { maxOutputTokens: CLOUD_MAX_TOKENS },
    ...(system ? { systemInstruction: { parts: [{ text: sliceText(system, 6000) }] } } : {}),
  };
}
async function geminiComplete({ apiKey, system, turns }) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${CLOUD_MODELS.gemini}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(geminiBody(system, turns)),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: j.error?.message || `Gemini error ${r.status}` };
  return { ok: true, text: j.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "" };
}
async function geminiStream({ apiKey, system, turns, onDelta }) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${CLOUD_MODELS.gemini}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(geminiBody(system, turns)),
  });
  if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); return { ok: false, error: j.error?.message || `Gemini error ${r.status}` }; }
  await pumpSse(r.body, (obj) => {
    const text = obj?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    if (text) onDelta(text);
  });
  return { ok: true };
}

// OpenAI and Grok (xAI) both speak the OpenAI chat-completions wire format, so
// one implementation serves both — only the base URL, model, and key differ.
function openAiCompatMessages(system, turns) {
  const msgs = turns.map((t) => ({ role: t.role, content: t.content }));
  if (system) msgs.unshift({ role: "system", content: sliceText(system, 6000) });
  return msgs;
}
// OpenAI nests error text as `{error:{message}}`; Grok (xAI) sometimes sends
// the plain-string form `{error:"..."}` instead — handle both.
function openAiCompatError(j, status, model) {
  const e = j?.error;
  return (typeof e === "string" ? e : e?.message) || `${model} error ${status}`;
}
async function openAiCompatComplete({ baseUrl, model, apiKey, system, turns }) {
  const r = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, max_tokens: CLOUD_MAX_TOKENS, messages: openAiCompatMessages(system, turns) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: openAiCompatError(j, r.status, model) };
  return { ok: true, text: j.choices?.[0]?.message?.content || "" };
}
async function openAiCompatStream({ baseUrl, model, apiKey, system, turns, onDelta }) {
  const r = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, max_tokens: CLOUD_MAX_TOKENS, messages: openAiCompatMessages(system, turns), stream: true }),
  });
  if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); return { ok: false, error: openAiCompatError(j, r.status, model) }; }
  await pumpSse(r.body, (obj, raw) => {
    if (raw === "[DONE]") return;
    const text = obj?.choices?.[0]?.delta?.content;
    if (text) onDelta(text);
  });
  return { ok: true };
}

// Shared SSE line-pump for the three REST-based providers (Anthropic's SDK does
// its own framing via `client.messages.stream`). Frames are `data: <json>\n\n`
// (OpenAI/Grok terminate with the literal `data: [DONE]`, passed through as
// `raw` since it isn't JSON); a chunk can split one frame in half.
async function pumpSse(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, sep).trim(); buf = buf.slice(sep + 2);
      if (!frame.startsWith("data:")) continue;
      const raw = frame.slice(5).trim();
      if (raw === "[DONE]") { onEvent(null, raw); continue; }
      let obj; try { obj = JSON.parse(raw); } catch { continue; }
      onEvent(obj, raw);
    }
  }
}

function cloudProvider(provider) {
  switch (provider) {
    case "gemini": return { complete: geminiComplete, stream: geminiStream };
    case "openai": return {
      complete: (a) => openAiCompatComplete({ ...a, baseUrl: "https://api.openai.com/v1", model: CLOUD_MODELS.openai }),
      stream: (a) => openAiCompatStream({ ...a, baseUrl: "https://api.openai.com/v1", model: CLOUD_MODELS.openai }),
    };
    case "grok": return {
      complete: (a) => openAiCompatComplete({ ...a, baseUrl: "https://api.x.ai/v1", model: CLOUD_MODELS.grok }),
      stream: (a) => openAiCompatStream({ ...a, baseUrl: "https://api.x.ai/v1", model: CLOUD_MODELS.grok }),
    };
    case "anthropic": default: return { complete: anthropicComplete, stream: anthropicStream };
  }
}

app.post("/ai/ask", async (req, res) => {
  const { provider, apiKey, system, prompt, messages } = req.body || {};
  if (!apiKey) return res.status(400).json({ ok: false, error: "API key required — add one in Settings" });
  const turns = coerceTurns({ prompt, messages });
  if (!turns.length) return res.status(400).json({ ok: false, error: "prompt or messages required" });
  try {
    const r = await cloudProvider(provider).complete({ apiKey, system, turns });
    res.json(r);
  } catch (e) { res.status(500).json({ ok: false, error: (e.message || String(e)).slice(0, 300) }); }
});

// ---- Local AI (llama-cpp-python via a persistent Python worker) — genuinely
// free, no API key: needs Python 3 + `pip install llama-cpp-python` on this
// machine. Pre-warmed at server startup (see app.listen below) so the model
// loads once in the background, not on a user's first request; a crashed
// worker is respawned on the next request. ----
const LOCAL_AI_SCRIPT = join(__dir, "ai_local.py");
let localAi = null; // { proc, model, ready: Promise<{ok,error?}> }
let localAiPending = null; // { resolve, onDelta? } for the one in-flight request
let localAiQueue = Promise.resolve(); // the worker handles one request at a time

function ensureLocalAi() {
  if (localAi) return localAi.ready;
  const proc = spawn(isWin ? "python" : "python3", [LOCAL_AI_SCRIPT], { windowsHide: true });
  let buf = "", stderrBuf = "", readyResolved = false, resolveReady;
  const ready = new Promise((res) => { resolveReady = res; });
  const entry = { proc, model: null, device: null, ready };
  localAi = entry;

  proc.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (!readyResolved) {
        readyResolved = true;
        if (msg.ok && msg.status === "ready") { entry.model = msg.model; entry.device = msg.device || null; resolveReady({ ok: true }); }
        else resolveReady({ ok: false, error: msg.error || "local AI worker failed to start" });
        continue;
      }
      if (!localAiPending) continue;
      // A streaming request stays subscribed across many delta lines and is only
      // settled by the terminating line (done, text, or error) that follows them.
      if (msg.delta !== undefined) { localAiPending.onDelta?.(msg.delta); continue; }
      const p = localAiPending; localAiPending = null; p.resolve(msg);
    }
  });
  proc.stderr.on("data", (d) => { stderrBuf += d.toString(); });
  proc.on("exit", (code) => {
    if (!readyResolved) { readyResolved = true; resolveReady({ ok: false, error: stderrBuf.trim().slice(-300) || `python exited (${code})` }); }
    if (localAiPending) { const p = localAiPending; localAiPending = null; p.resolve({ ok: false, error: "local AI worker exited" }); }
    if (localAi === entry) localAi = null;
  });
  proc.on("error", (e) => {
    if (!readyResolved) {
      readyResolved = true;
      resolveReady({ ok: false, error: e.code === "ENOENT" ? "Python not found on PATH — install Python 3, then `pip install llama-cpp-python`" : e.message });
    }
  });
  return ready;
}

// Pass `onDelta` to stream: it fires per token chunk and the resolved `text` is
// the concatenation, so streaming and non-streaming callers get the same result.
async function askLocalAi({ prompt, system, messages, onDelta }) {
  const started = await ensureLocalAi();
  if (!started.ok) return started;
  const entry = localAi;
  const stream = !!onDelta;
  let acc = "";
  const task = localAiQueue.then(() => new Promise((resolve) => {
    localAiPending = {
      resolve,
      onDelta: stream ? (d) => { acc += d; onDelta(d); } : undefined,
    };
    entry.proc.stdin.write(JSON.stringify({ prompt, system, messages, stream }) + "\n");
  }));
  localAiQueue = task.then(() => {}, () => {});
  const msg = await task;
  if (!msg.ok) return { ok: false, error: msg.error || "local AI failed" };
  return { ok: true, text: stream ? acc : msg.text };
}

app.get("/ai/local/status", async (_req, res) => {
  if (!localAi) return res.json({ ok: true, state: "idle" });
  const r = await localAi.ready;
  res.json({ ok: true, state: r.ok ? "ready" : "error", model: localAi.model, device: localAi.device, error: r.error });
});
app.post("/ai/local/ask", async (req, res) => {
  const turns = coerceTurns(req.body || {});
  if (!turns.length) return res.status(400).json({ ok: false, error: "prompt or messages required" });
  const system = req.body?.system ? String(req.body.system) : undefined;
  const r = await askLocalAi({ system, messages: turns });
  if (!r.ok) return res.status(500).json(r);
  res.json(r);
});

// ---- Streaming variants (SSE) ----
// The local model generates at ~5-7 tok/s on CPU, so a complete answer is tens of
// seconds of blank screen. Streaming doesn't make it faster, it makes the wait
// legible: first token in ~5s instead of ~30-75s of nothing. Both backends speak
// the same event shape so the client doesn't branch: {delta} … then {done} | {error}.
function openSse(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // don't let a proxy sit on the chunks
  res.flushHeaders?.();
  return (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

app.post("/ai/local/ask/stream", async (req, res) => {
  const turns = coerceTurns(req.body || {});
  if (!turns.length) return res.status(400).json({ ok: false, error: "prompt or messages required" });
  const system = req.body?.system ? String(req.body.system) : undefined;
  const send = openSse(res);
  // A disconnect (modal closed mid-answer) must not keep pumping into a dead socket.
  // Hook `res`, not `req`: on a POST, req's "close" fires as soon as the body has
  // been read, which would abort every stream before its first token.
  let aborted = false;
  res.on("close", () => { aborted = true; });
  const r = await askLocalAi({ system, messages: turns, onDelta: (d) => { if (!aborted) send({ delta: d }); } });
  if (!aborted) send(r.ok ? { done: true } : { error: r.error });
  res.end();
});

app.post("/ai/ask/stream", async (req, res) => {
  const { provider, apiKey, system, prompt, messages } = req.body || {};
  if (!apiKey) return res.status(400).json({ ok: false, error: "API key required — add one in Settings" });
  const turns = coerceTurns({ prompt, messages });
  if (!turns.length) return res.status(400).json({ ok: false, error: "prompt or messages required" });
  const send = openSse(res);
  let aborted = false;
  res.on("close", () => { aborted = true; }); // see the note in /ai/local/ask/stream
  try {
    const r = await cloudProvider(provider).stream({ apiKey, system, turns, onDelta: (d) => { if (!aborted) send({ delta: d }); } });
    if (!aborted) send(r.ok ? { done: true } : { error: r.error || "stream failed" });
  } catch (e) {
    if (!aborted) send({ error: (e.message || String(e)).slice(0, 300) });
  }
  res.end();
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

// ---- Docker container resource usage (read-only, one-shot snapshot) ----
// `docker stats` itself is snapshot-oriented even in its own `--no-stream`
// mode, so this is polled client-side every few seconds rather than pushed
// over /events — no persistent stream to manage server-side, unlike the log
// tailing above.
app.get("/docker/stats", (_req, res) => {
  exec('docker stats --no-stream --format "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}"', { timeout: 10000, windowsHide: true }, (err, stdout) => {
    if (err) return res.json({ ok: true, available: false, stats: [] });
    const stats = String(stdout).trim().split("\n").filter(Boolean).map((line) => {
      const [name, cpu, memUsage, memPerc] = line.split("|");
      return { name, cpuPercent: parseFloat(cpu) || 0, memUsage: memUsage || "", memPercent: parseFloat(memPerc) || 0 };
    });
    res.json({ ok: true, available: true, stats });
  });
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

// ---- Dummy-data seeding: introspects the schema and inserts realistic rows in
// FK order in the background, reporting progress over the existing WS channel.
// Append-only — never truncates or modifies existing rows. ----
const seedJobs = new Map(); // jobId -> job state (scoped to the userId that started it)

app.post("/pg/seed/start", async (req, res) => {
  const server = readServer(req.body);
  if (!server) return res.status(400).json({ ok: false, error: "server connection details are required" });
  const database = req.body.database;
  if (!database) return res.status(400).json({ ok: false, error: "database is required" });
  const rowsPerTable = Math.min(Math.max(1, Number(req.body.rowsPerTable) || 0), MAX_ROWS_PER_TABLE);
  if (!rowsPerTable) return res.status(400).json({ ok: false, error: "rowsPerTable must be at least 1" });
  const excludeTables = Array.isArray(req.body.excludeTables) ? req.body.excludeTables : [];
  const projectPrompt = typeof req.body.projectPrompt === "string" ? req.body.projectPrompt.slice(0, 2000) : "";
  const aiApiKey = typeof req.body.aiApiKey === "string" ? req.body.aiApiKey.trim() : "";

  const already = [...seedJobs.values()].find(
    (j) => j.userId === req.userId && j.status === "running" && j.host === server.host && j.database === database
  );
  if (already) return res.status(409).json({ ok: false, error: "A seed job is already running for this database" });

  let client;
  try { client = await pgConnect(server, database); }
  catch (e) { return res.status(500).json({ ok: false, error: e.message }); }

  const jobId = randomUUID();
  const job = {
    jobId, userId: req.userId, host: server.host, database, status: "running",
    overallDone: 0, overallTotal: 0, currentTable: null, tableDone: 0, tableTotal: 0,
    startedAt: Date.now(), cancelled: false, result: null, error: null,
  };
  seedJobs.set(jobId, job);

  runSeedJob({
    client, rowsPerTable, excludeTables, projectPrompt, aiApiKey,
    isCancelled: () => job.cancelled,
    onProgress: (p) => {
      job.currentTable = p.table; job.tableDone = p.tableDone; job.tableTotal = p.tableTotal;
      job.overallDone = p.overallDone; job.overallTotal = p.overallTotal;
      sendToUser(req.userId, "seed:progress", { jobId, ...p });
    },
  }).then((result) => {
    job.status = job.cancelled ? "cancelled" : "done";
    job.result = result;
    sendToUser(req.userId, "seed:done", { jobId, status: job.status, result });
  }).catch((e) => {
    job.status = "error";
    job.error = e.message;
    sendToUser(req.userId, "seed:error", { jobId, error: e.message });
  }).finally(() => { try { client.end(); } catch { /**/ } });

  res.json({ ok: true, jobId });
});

app.get("/pg/seed/status/:jobId", (req, res) => {
  const job = seedJobs.get(req.params.jobId);
  if (!job || job.userId !== req.userId) return res.status(404).json({ ok: false, error: "job not found" });
  const { jobId, status, overallDone, overallTotal, currentTable, tableDone, tableTotal, result, error } = job;
  res.json({ ok: true, job: { jobId, status, overallDone, overallTotal, currentTable, tableDone, tableTotal, result, error } });
});

app.post("/pg/seed/cancel/:jobId", (req, res) => {
  const job = seedJobs.get(req.params.jobId);
  if (!job || job.userId !== req.userId) return res.status(404).json({ ok: false, error: "job not found" });
  job.cancelled = true;
  res.json({ ok: true });
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
/** Returns how many live sockets received it, so callers can tell "nobody is listening" from "sent". */
function sendToUser(userId, event, payload = {}) {
  if (!wss) return 0;
  const msg = JSON.stringify({ event, payload, at: Date.now() });
  let sent = 0;
  for (const c of wss.clients) {
    if (c.readyState === 1 && c.userId === userId) { try { c.send(msg); sent++; } catch { /**/ } }
  }
  return sent;
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
  // Kick off the local AI worker now so model load (or first-run download) happens
  // in the background instead of stalling a user's first Ask — see ensureLocalAi().
  ensureLocalAi();
});

(async () => {
  try {
    const { WebSocketServer } = await import("ws");
    // No `path` filter: the authenticated ORBIT web app connects on /events, and
    // the agent's own auto-opened status page (no user session to authenticate
    // with) connects on /presence purely so its tab is counted below.
    wss = new WebSocketServer({ server });
    wss.on("connection", (c, req) => {
      const { pathname } = new URL(req.url, "http://agent");
      if (pathname === "/presence") return; // unauthenticated — presence-only, no push events
      if (pathname !== "/events") { c.close(1008, "unknown path"); return; }

      // Auth arrives as the first message instead of a `?token=` query param, so
      // the session token never lands in a proxy/access log. Give the client a
      // few seconds to send it before dropping the connection.
      const authTimeout = setTimeout(() => c.close(4001, "auth timeout"), 5000);
      c.once("message", (raw) => {
        clearTimeout(authTimeout);
        let token = "";
        try { token = JSON.parse(raw.toString()).token || ""; } catch { /* not JSON */ }
        try {
          c.userId = verifyToken(token);
        } catch {
          c.close(4001, "unauthorized");
          return;
        }
        try { c.send(JSON.stringify({ event: "hello", payload: { agent: "orbit" }, at: Date.now() })); } catch { /**/ }
        runHealthCheck(c.userId).then((h) => { try { c.send(JSON.stringify({ event: "health:update", payload: h, at: Date.now() })); } catch { /**/ } }).catch(() => {});
      });
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
