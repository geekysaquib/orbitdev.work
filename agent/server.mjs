// ORBIT local companion agent (headless — no GUI framework).
// Launches native apps the browser can't. Run: `node server.mjs`
// For https://localhost (no mixed-content issues), generate a trusted cert:
//   mkcert -install && mkcert localhost 127.0.0.1
// then set CERT/KEY paths below and use https.createServer.

import express from "express";
import cors from "cors";
import { spawn, execFile, exec } from "node:child_process";
import { platform } from "node:os";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const __dir = dirname(fileURLToPath(import.meta.url));
const GMAIL_CFG = join(__dir, "gmail-config.json");

function gmailCreds() {
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) return { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD };
  if (existsSync(GMAIL_CFG)) { try { return JSON.parse(readFileSync(GMAIL_CFG, "utf8")); } catch { return null; } }
  return null;
}
let imapClient = null;
async function getClient() {
  const c = gmailCreds();
  if (!c) throw new Error("Gmail not configured");
  if (imapClient && imapClient.usable) return imapClient;
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: c.user, pass: c.pass }, logger: false, emitLogs: false });
  client.on("close", () => { if (imapClient === client) imapClient = null; });
  client.on("error", () => { try { client.close(); } catch { /**/ } if (imapClient === client) imapClient = null; });
  await client.connect();
  imapClient = client;
  return client;
}
function resetClient() { try { imapClient?.close(); } catch { /**/ } imapClient = null; }
async function withImap(fn) {
  const client = await getClient();
  try { return await fn(client); }
  catch (e) { resetClient(); throw e; } // drop a bad connection so the next call reconnects clean
}

const app = express();
const PORT = process.env.PORT || 47600;

// Restrict to your ORBIT origins.
app.use(cors({ origin: [/^https?:\/\/localhost(:\d+)?$/, /\.netlify\.app$/], credentials: false }));
app.use(express.json());

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
app.get("/gmail/status", (_req, res) => { const c = gmailCreds(); res.json({ ok: true, configured: !!c, user: c?.user || null }); });

app.post("/gmail/config", (req, res) => {
  const { user, pass } = req.body || {};
  if (!user || !pass) return res.status(400).json({ ok: false, error: "user and app password required" });
  try { writeFileSync(GMAIL_CFG, JSON.stringify({ user, pass: String(pass).replace(/\s+/g, "") }), "utf8"); resetClient(); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.delete("/gmail/config", (_req, res) => { try { if (existsSync(GMAIL_CFG)) unlinkSync(GMAIL_CFG); } catch { /**/ } resetClient(); res.json({ ok: true }); });

app.get("/gmail/list", async (req, res) => {
  try {
    const limit = Math.min(50, Number(req.query.limit) || 25);
    const messages = await withImap(async (client) => {
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
    const message = await withImap(async (client) => {
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
    res.json({ ok: true, tag: safeTag, output: (stdout || "").toString().slice(-500) });
  });
});

// ---- PostgreSQL (via the local agent, using the `pg` driver) ----
const PG_CFG = join(__dir, "pg-config.json");
function pgServers() {
  if (existsSync(PG_CFG)) { try { return JSON.parse(readFileSync(PG_CFG, "utf8")); } catch { return []; } }
  return [];
}
function savePgServers(list) { writeFileSync(PG_CFG, JSON.stringify(list, null, 2), "utf8"); }
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

app.get("/pg/servers", (_req, res) => res.json({ ok: true, servers: pgServers().map(pubServer) }));

app.post("/pg/servers", (req, res) => {
  const { name, host, port, user, password, database, ssl } = req.body || {};
  if (!host || !user) return res.status(400).json({ ok: false, error: "host and user are required" });
  const list = pgServers();
  const server = { id: "pg_" + Date.now().toString(36), name: name || host, host, port: Number(port) || 5432, user, password: password || "", database: database || "", ssl: !!ssl };
  list.push(server);
  try { savePgServers(list); } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
  res.json({ ok: true, server: pubServer(server) });
});

app.delete("/pg/servers/:id", (req, res) => {
  try { savePgServers(pgServers().filter((s) => s.id !== req.params.id)); } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
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
  const server = pgServers().find((s) => s.id === req.query.server);
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
  const server = pgServers().find((s) => s.id === req.query.server);
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
  const server = pgServers().find((s) => s.id === sid);
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
  console.log(`[agent] macro: ${name}`);
  res.json({ ok: true, ran: name });
});

app.listen(PORT, () => console.log(`ORBIT agent listening on http://localhost:${PORT}`));
