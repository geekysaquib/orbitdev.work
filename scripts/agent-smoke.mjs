// Phase 3 — local agent smoke test. Boots against an already-running
// `agent/server.mjs` (npm start in agent/, port 47600) and exercises its HTTP
// surface without a browser. Mints its own session JWT (same signing recipe
// netlify/functions/auth.ts uses) so it can call the requireAuth-gated routes,
// and separately confirms the auth boundary itself holds.
//
// Usage: node scripts/agent-smoke.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = loadEnv(join(ROOT, ".env"));
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = env.SUPABASE_JWT_SECRET;
const AGENT_URL = env.VITE_AGENT_URL || "http://localhost:47600";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !JWT_SECRET) {
  console.error("Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_JWT_SECRET in .env");
  process.exit(1);
}

const results = [];
function record(area, name, status, detail = "") {
  results.push({ area, name, status, detail, at: new Date().toISOString() });
  const tag = status === "pass" ? "PASS" : status === "skip" ? "SKIP" : "FAIL";
  console.log(`[${tag}] ${area} — ${name}${detail ? ` (${detail})` : ""}`);
}

async function fetchAnyVerifiedUser() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/users?select=id,email,email_verified&email_verified=eq.true&limit=1`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const rows = await r.json();
  if (!r.ok || !Array.isArray(rows) || !rows.length) throw new Error(`no verified user found (${r.status}): ${JSON.stringify(rows)}`);
  return rows[0];
}

function mintToken(user) {
  return jwt.sign({ email: user.email, role: "authenticated" }, JWT_SECRET, {
    subject: user.id, audience: "authenticated", algorithm: "HS256", expiresIn: "1h",
  });
}

async function call(method, path, token, body) {
  try {
    const r = await fetch(`${AGENT_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = null; }
    return { status: r.status, json, text };
  } catch (e) {
    return { status: 0, json: null, text: "", error: e.message };
  }
}

async function main() {
  // --- Public routes, no token ---
  {
    const r = await call("GET", "/ping");
    record("public", "GET /ping", r.status === 200 && r.json?.ok ? "pass" : "fail", `status ${r.status}`);
  }
  {
    const r = await call("GET", "/health/public");
    record("public", "GET /health/public", r.status === 200 && r.json?.ok ? "pass" : "fail", `status ${r.status}`);
  }

  // --- Auth boundary: protected route must 401 without a token ---
  {
    const r = await call("POST", "/git/status", null, { path: ROOT });
    record("auth-boundary", "POST /git/status with no token", r.status === 401 ? "pass" : "fail", `expected 401, got ${r.status}`);
  }
  {
    const r = await call("POST", "/git/status", "not-a-real-token", { path: ROOT });
    record("auth-boundary", "POST /git/status with a garbage token", r.status === 401 ? "pass" : "fail", `expected 401, got ${r.status}`);
  }

  // --- Mint a real session token for the rest ---
  let token;
  try {
    const user = await fetchAnyVerifiedUser();
    token = mintToken(user);
    record("setup", "mint session JWT for a verified user", "pass", user.email);
  } catch (e) {
    record("setup", "mint session JWT for a verified user", "fail", e.message);
    writeResults();
    return;
  }

  // --- Git routes, against this repo itself ---
  {
    const r = await call("POST", "/git/status", token, { path: ROOT });
    record("git", "POST /git/status", r.status === 200 && r.json?.ok ? "pass" : "fail", `status ${r.status}: ${r.json?.error || ""}`);
  }
  {
    const r = await call("POST", "/git/log", token, { path: ROOT, limit: 5 });
    record("git", "POST /git/log", r.status === 200 && r.json?.ok ? "pass" : "fail", `status ${r.status}`);
  }
  {
    const r = await call("POST", "/git/branches", token, { path: ROOT });
    record("git", "POST /git/branches", r.status === 200 && r.json?.ok ? "pass" : "fail", `status ${r.status}`);
  }
  {
    const r = await call("POST", "/git/diff", token, { path: ROOT });
    record("git", "POST /git/diff", r.status === 200 && r.json?.ok ? "pass" : "fail", `status ${r.status}`);
  }

  // --- Docker (skip gracefully if Docker Desktop isn't running) ---
  {
    const r = await call("GET", "/docker", token);
    if (r.status === 200 && r.json?.available === false) record("docker", "GET /docker", "skip", "Docker not available on this machine");
    else record("docker", "GET /docker", r.status === 200 ? "pass" : "fail", `status ${r.status}`);
  }

  // --- Postgres: no server configured, so expect the validation error, not a crash ---
  {
    const r = await call("POST", "/pg/test", token, {});
    record("postgres", "POST /pg/test with no connection details", r.status === 400 ? "pass" : "fail", `expected 400, got ${r.status}`);
  }
  {
    const r = await call("GET", "/pg/backup/available", token);
    record("postgres", "GET /pg/backup/available", r.status === 200 ? "pass" : "fail", `status ${r.status}`);
  }

  // --- Local AI model ---
  {
    const r = await call("GET", "/ai/local/status", token);
    record("ai-local", "GET /ai/local/status", r.status === 200 ? "pass" : "fail", `status ${r.status}: ${JSON.stringify(r.json)}`);
  }

  // --- VS Code bridge ---
  {
    const r = await call("GET", "/vscode/status", token);
    record("vscode", "GET /vscode/status", r.status === 200 ? "pass" : "fail", `status ${r.status}: ${JSON.stringify(r.json)}`);
  }
  {
    const r = await call("GET", "/vscode/extension/package", token);
    record("vscode", "GET /vscode/extension/package", r.status === 200 && r.json?.ok ? "pass" : "fail", `status ${r.status}: ${JSON.stringify(r.json)}`);
  }
  {
    const r = await call("GET", "/vscode/extensions", token);
    record("vscode", "GET /vscode/extensions", r.status === 200 ? "pass" : "fail", `status ${r.status}`);
  }

  // --- Worklist round trip ---
  {
    const payload = { tasks: [{ id: "smoke-1", title: "[ORBIT-TEST] smoke", status: "todo", priority: "low" }], tickets: [], timer: { running: false } };
    const post = await call("POST", "/worklist", token, payload);
    const get = await call("GET", "/worklist", token);
    const roundTrips = get.json?.tasks?.some((t) => t.id === "smoke-1");
    record("worklist", "POST then GET /worklist round trip", post.status === 200 && get.status === 200 && roundTrips ? "pass" : "fail",
      `post ${post.status}, get ${get.status}, found=${!!roundTrips}`);
  }

  // --- Editor activity/state ---
  {
    const post = await call("POST", "/editor/activity", token, { file: "smoke.ts", language: "typescript", editing: true });
    const get = await call("GET", "/editor/state", token);
    record("editor", "POST /editor/activity then GET /editor/state", post.status === 200 && get.status === 200 && get.json?.connected ? "pass" : "fail",
      `post ${post.status}, get ${get.status}, connected=${get.json?.connected}`);
  }

  // --- System idle ---
  {
    const r = await call("GET", "/system/idle", token);
    record("system", "GET /system/idle", r.status === 200 ? "pass" : "fail", `status ${r.status}: ${JSON.stringify(r.json)}`);
  }

  // --- orbit/command whitelist ---
  {
    const bad = await call("POST", "/orbit/command", token, { command: "rm -rf /", payload: {} });
    record("orbit-command", "unknown command is rejected", bad.status === 400 ? "pass" : "fail", `expected 400, got ${bad.status}`);
  }
  {
    // A real ORBIT tab may be connected right now (e.g. the account owner has
    // it open) — the relay would genuinely execute a timer/task command against
    // their live session, which this smoke test must never do. Check first via
    // /worklist's `orbitOpen` flag and only probe the "not delivered" (409) path
    // when we know nothing is listening.
    const wl = await call("GET", "/worklist", token);
    if (wl.json?.orbitOpen) {
      record("orbit-command", "valid command delivery path", "skip", "an ORBIT tab is live right now — not sending a real timer/task command to it");
    } else {
      const ok = await call("POST", "/orbit/command", token, { command: "timer:start", payload: {} });
      record("orbit-command", "valid command with no connected tab", ok.status === 409 ? "pass" : "fail", `expected 409 (no ORBIT tab open), got ${ok.status}`);
    }
  }

  // --- term/run, a harmless command only, in this repo's own directory ---
  {
    const r = await call("POST", "/term/run", token, { path: ROOT, command: "node -v" });
    record("term", "POST /term/run (node -v)", r.status === 200 && r.json?.ok !== false ? "pass" : "fail", `status ${r.status}: ${JSON.stringify(r.json)}`);
  }

  writeResults();
}

function writeResults() {
  const dir = join(ROOT, "test-results");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "agent-smoke.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => r.status === "fail");
  console.log(`\n${results.length} checks — ${results.filter((r) => r.status === "pass").length} pass, ${results.filter((r) => r.status === "skip").length} skip, ${failed.length} fail`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
