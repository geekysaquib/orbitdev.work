// ORBIT local companion agent (headless — no GUI framework).
// Launches native apps the browser can't. Run: `node server.mjs`
// For https://localhost (no mixed-content issues), generate a trusted cert:
//   mkcert -install && mkcert localhost 127.0.0.1
// then set CERT/KEY paths below and use https.createServer.

import express from "express";
import cors from "cors";
import { spawn } from "node:child_process";
import { platform } from "node:os";

const app = express();
const PORT = process.env.PORT || 47600;

// Restrict to your ORBIT origins.
app.use(cors({ origin: [/^https?:\/\/localhost(:\d+)?$/, /\.netlify\.app$/], credentials: false }));
app.use(express.json());

const isWin = platform() === "win32";

function run(cmd, args = []) {
  try { spawn(cmd, args, { detached: true, stdio: "ignore", shell: isWin }).unref(); return true; }
  catch { return false; }
}

function openVSCode(p) { if (p) run("code", [p]); }
function openVisualStudio(sln) {
  if (!sln) return;
  if (isWin) run("cmd", ["/c", "start", "", sln]);   // opens .sln in Visual Studio
  else run("open", [sln]);
}
function openTerminal(p) {
  if (isWin) run("wt", ["-d", p || "."]);
  else run("x-terminal-emulator", []);
}
function openBrowser(port) { const url = `http://localhost:${port || 3000}`; run(isWin ? "cmd" : "open", isWin ? ["/c", "start", url] : [url]); }

app.get("/ping", (_req, res) => res.json({ ok: true, agent: "orbit", version: "0.1.0" }));

app.post("/launch", (req, res) => {
  const { kind, fe_path, sln_path, dev_port } = req.body || {};
  switch (kind) {
    case "vscode": openVSCode(fe_path); break;
    case "visualstudio": openVisualStudio(sln_path); break;
    case "terminal": openTerminal(fe_path); break;
    case "browser": openBrowser(dev_port); break;
    case "all":
      openVSCode(fe_path); openVisualStudio(sln_path);
      if (dev_port) openBrowser(dev_port);
      break;
    default: return res.status(400).json({ ok: false, error: "unknown kind" });
  }
  res.json({ ok: true });
});

app.post("/macro", (req, res) => {
  const { name } = req.body || {};
  // Extend: git pull, docker compose up, dev server, etc.
  console.log(`[agent] macro: ${name}`);
  res.json({ ok: true, ran: name });
});

app.listen(PORT, () => console.log(`ORBIT agent listening on http://localhost:${PORT}`));
