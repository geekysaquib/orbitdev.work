// Phase 6 — reads every phase's raw results out of test-results/*.json and
// renders a single PDF report (cover, executive summary, per-phase tables,
// defects found, and a fix/backlog section) using jsPDF, already a project
// dependency (src/components/SchemaDiagram.tsx uses it for schema exports).
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { jsPDF } from "jspdf";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RESULTS_DIR = join(ROOT, "test-results");

function readJson(name, fallback = []) {
  const p = join(RESULTS_DIR, name);
  if (!existsSync(p)) return fallback;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; }
}

// ---- Normalize every phase's raw output into { area, name, status, detail } ----

function fromFlatArray(rows) {
  return rows.map((r) => ({ area: r.area, name: r.name, status: r.status, detail: r.detail || "" }));
}

function fromVitest(json) {
  const out = [];
  for (const file of json.testResults || []) {
    const fileName = file.name?.split(/[\\/]/).pop() || "unit test";
    for (const a of file.assertionResults || []) {
      const status = a.status === "passed" ? "pass" : a.status === "failed" ? "fail" : "skip";
      out.push({ area: `unit: ${fileName}`, name: a.fullName || a.title, status, detail: (a.failureMessages || []).join(" ").slice(0, 300) });
    }
  }
  return out;
}

function walkPwSuites(suites, out) {
  for (const s of suites || []) {
    for (const spec of s.specs || []) {
      for (const t of spec.tests || []) {
        const result = t.results?.[t.results.length - 1];
        const status = result?.status === "passed" ? "pass" : result?.status === "skipped" ? "skip" : "fail";
        const detail = status === "fail" ? (result?.error?.message || "").slice(0, 300) : (result?.status === "skipped" ? "skipped" : "");
        out.push({ area: `e2e: ${s.title || "spec"}`, name: spec.title, status, detail });
      }
    }
    walkPwSuites(s.suites, out);
  }
}
function fromPlaywright(json) {
  const out = [];
  walkPwSuites(json.suites, out);
  return out;
}

const allResults = [
  ...fromFlatArray(readJson("phase1-static.json")),
  ...fromVitest(readJson("vitest-results.json", { testResults: [] })),
  ...fromFlatArray(readJson("agent-smoke.json")),
  ...fromFlatArray(readJson("phase4-netlify.json")),
  ...fromPlaywright(readJson("e2e-results.json", { suites: [] })),
];

const counts = { pass: 0, fail: 0, skip: 0 };
for (const r of allResults) counts[r.status] = (counts[r.status] || 0) + 1;

// ---- Fix / backlog content — synthesized from this pass's findings plus the
// existing project backlog (orbit-backlog memory), not auto-derived. ----
const CRITICAL_FIXES = [
  {
    title: "Rotate the Supabase Legacy JWT Secret — it's hardcoded in committed source",
    detail: "agent/server.mjs:66 (commit ebcca15c, 2026-07-13) hardcodes the project's real Supabase Legacy JWT Secret as a source-level fallback default, confirmed identical to the live SUPABASE_JWT_SECRET. Anyone with read access to this repo (or the packaged .exe) can forge a valid session for any user id in this Supabase project. Rotate the secret and stop hardcoding a real project secret as a source default.",
  },
  {
    title: "daily-brief.ts and weekly-digest.ts have no AI-provider fallback",
    detail: "Both cron functions only ever try the account's anthropic_api_key via _lib/anthropic.ts's askClaude(), unlike the reactive Ask AI path (src/lib/ai.ts's orderedProviders() + local-model fallback). Confirmed live: this account's Anthropic key is out of credit, so both functions run correctly end-to-end but silently produce zero notifications, with no visible error anywhere. Recommend reusing the same provider-fallback chain (or at minimum, notifying the user their proactive-AI features have gone quiet).",
  },
  {
    title: "Remove kickbacks-v2.vsix and the scratch_*.cjs debug scripts before committing",
    detail: "kickbacks-v2.vsix at repo root is an unrelated third-party extension. scratch_dbg.cjs / scratch_tight.cjs / scratch_v3.cjs embed a hardcoded live session JWT for the real account in plaintext. Neither belongs in the repo as-is.",
  },
];
const MINOR_FIXES = [
  "VS Code timer relay bypasses automation: useVscodeBridge.ts's timer:start/timer:stop handlers call startTimer()/stopTimer() directly instead of going through TimeTracking.tsx's fireAsync(), so \"when a timer starts/stops\" automation rules never fire when the timer is toggled from VS Code — only from the Time Tracking page in the browser.",
  "ProjectDetail.tsx's \"Open workspace\" button only renders when both fe_path AND sln_path are set, but openProjectWorkspace's own comment describes a single-folder fallback that is therefore unreachable from the UI (dead code, low impact — other buttons already cover the single-folder case).",
  "All 4 scheduled functions return {statusCode, body} out of habit from the non-scheduled function pattern, which triggers a harmless but noisy \"Your function returned body\" warning from netlify-cli on every invocation.",
  "anomaly-scan.ts's de-dupe window (alreadyNotified, 20h) could not be exercised in this pass since no day-over-day baseline existed yet to actually trigger an anomaly — worth a follow-up check once real historical data accumulates.",
  "e2e/automation-flow.spec.ts's own cleanup step is best-effort (clicks Delete if the card is present) rather than verified, and left a stray [ORBIT-TEST] rule + task behind after a passing run twice in this session — worth hardening to a REST-based teardown like the other specs' cleanup.",
];
const REMAINING_BACKLOG = [
  "Bidirectional Zoho sync — create/update sprint items (still read-only). Biggest effort/value item.",
  "Postgres restore — /pg/backup exists, no /pg/restore to complete the pair.",
  "Slack integration — mirrors the existing MS Teams setup panel + provider_connections pattern.",
  "Jira integration — alternative to Zoho.",
  "Keyboard-shortcut cheat-sheet overlay.",
  "Mobile / PWA — no manifest or service worker yet.",
  "VS Code extension: no automated extension-host UI test (@vscode/test-electron) — this pass verified its HTTP dependencies (/worklist, /editor/*, /vscode/*) directly instead.",
];

// ---- PDF rendering ----
const doc = new jsPDF({ unit: "pt", format: "a4" });
const W = doc.internal.pageSize.getWidth();
const MARGIN = 48;
let y = MARGIN;

function newPageIfNeeded(lines = 1, lineHeight = 14) {
  if (y + lines * lineHeight > 800) { doc.addPage(); y = MARGIN; }
}
function h1(text) { newPageIfNeeded(2, 24); doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(20, 20, 20); doc.text(text, MARGIN, y); y += 28; }
function h2(text) { newPageIfNeeded(2, 20); doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(20, 20, 20); doc.text(text, MARGIN, y); y += 20; }
function body(text, opts = {}) {
  doc.setFont("helvetica", opts.bold ? "bold" : "normal");
  doc.setFontSize(opts.size || 10.5);
  doc.setTextColor(...(opts.color || [40, 40, 40]));
  const lines = doc.splitTextToSize(text, W - MARGIN * 2 - (opts.indent || 0));
  newPageIfNeeded(lines.length, 13);
  doc.text(lines, MARGIN + (opts.indent || 0), y);
  y += lines.length * 13 + (opts.gap ?? 6);
}
function statusColor(s) { return s === "pass" ? [22, 132, 62] : s === "fail" ? [178, 34, 34] : [140, 110, 20]; }
function statusLabel(s) { return s === "pass" ? "PASS" : s === "fail" ? "FAIL" : "SKIP"; }

function table(rows) {
  for (const r of rows) {
    newPageIfNeeded(1, 14);
    const [sr, sg, sb] = statusColor(r.status);
    doc.setFont("courier", "bold"); doc.setFontSize(9); doc.setTextColor(sr, sg, sb);
    doc.text(statusLabel(r.status), MARGIN, y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(30, 30, 30);
    const nameLines = doc.splitTextToSize(`${r.area} — ${r.name}`, W - MARGIN * 2 - 50);
    doc.text(nameLines, MARGIN + 50, y);
    y += Math.max(1, nameLines.length) * 12;
    if (r.detail) {
      doc.setFont("helvetica", "italic"); doc.setFontSize(8.5); doc.setTextColor(100, 100, 100);
      const detailLines = doc.splitTextToSize(r.detail, W - MARGIN * 2 - 50);
      newPageIfNeeded(detailLines.length, 11);
      doc.text(detailLines, MARGIN + 50, y);
      y += detailLines.length * 11;
    }
    y += 4;
  }
}

// Cover
doc.setFillColor(18, 18, 22); doc.rect(0, 0, W, 200, "F");
doc.setFont("helvetica", "bold"); doc.setFontSize(26); doc.setTextColor(255, 255, 255);
doc.text("ORBIT — Full Feature Test Report", MARGIN, 90);
doc.setFont("helvetica", "normal"); doc.setFontSize(12); doc.setTextColor(200, 230, 210);
doc.text(new Date().toISOString().slice(0, 10), MARGIN, 120);
doc.setFontSize(10.5);
doc.text("Static verification · unit tests · local-agent smoke tests · live Netlify function", MARGIN, 145);
doc.text("& cron invocation · Playwright E2E across every authenticated route", MARGIN, 160);
y = 230;

h2("Executive summary");
body(`${allResults.length} checks run across 6 phases: ${counts.pass || 0} passed, ${counts.fail || 0} failed, ${counts.skip || 0} skipped/blocked.`, { bold: true, size: 12, gap: 10 });
body("Scope: root build + VS Code extension build, 7 unit-test files (39 assertions) covering health scoring / retrospective / estimate accuracy / focus analytics / velocity / automation matching / AI provider ordering, a 22-check local-agent HTTP smoke test, the full custom OTP auth flow + all 4 scheduled cron functions invoked against live Supabase, all 3 connected provider proxies, and an 23-test Playwright suite covering all 18 authenticated routes plus real create-rule/drag-to-trigger automation, timer start/stop, and Ask AI flows.", { gap: 14 });

h2("Results by phase");
const areas = [...new Set(allResults.map((r) => r.area))];
for (const area of areas) {
  newPageIfNeeded(2, 16);
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(10, 10, 10);
  doc.text(area, MARGIN, y); y += 16;
  table(allResults.filter((r) => r.area === area));
  y += 6;
}

doc.addPage(); y = MARGIN;
h1("Defects found");
body("Ranked most-important first. The first three are worth acting on regardless of anything else in this report.", { color: [90, 90, 90], gap: 14 });
for (const f of CRITICAL_FIXES) {
  newPageIfNeeded(3, 13);
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(178, 34, 34);
  const t = doc.splitTextToSize(`⚠ ${f.title}`, W - MARGIN * 2);
  doc.text(t, MARGIN, y); y += t.length * 14 + 2;
  body(f.detail, { size: 9.5, indent: 14, gap: 12 });
}
h2("Minor / lower-severity findings");
for (const m of MINOR_FIXES) body(`•  ${m}`, { size: 9.5, gap: 8 });

doc.addPage(); y = MARGIN;
h1("What's still left to build");
body("Carried forward from the existing backlog, plus anything newly surfaced in this pass:", { color: [90, 90, 90], gap: 14 });
for (const b of REMAINING_BACKLOG) body(`•  ${b}`, { size: 10, gap: 9 });

const outPath = process.argv[2] || join(ROOT, "orbit-feature-test-report.pdf");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, Buffer.from(doc.output("arraybuffer")));
console.log(`PDF written to ${outPath}`);
console.log(`${allResults.length} checks — ${counts.pass || 0} pass, ${counts.fail || 0} fail, ${counts.skip || 0} skip`);
