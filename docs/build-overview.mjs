/**
 * Builds docs/orbit-overview.html from orbit-overview.src.html.
 *
 * The published page is an Artifact, and the Artifact CSP blocks every external
 * request — so screenshots and brand logos have to be inlined rather than linked.
 * This script does that inlining:
 *
 *   {{IMG:name}}   -> src="data:image/webp;base64,..." width="W" height="H"
 *   {{ICON:slug}}  -> <svg viewBox="0 0 24 24">...</svg>   (from docs/icons/<slug>.svg)
 *
 * Screenshots come from docs/images/*.png and are downscaled to WebP with ffmpeg.
 * Re-run after replacing or adding a screenshot:  node docs/build-overview.mjs
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const DOCS = import.meta.dirname;
const IMAGES = path.join(DOCS, "images");
const ICONS = path.join(DOCS, "icons");
const SRC = path.join(DOCS, "orbit-overview.src.html");
const OUT = path.join(DOCS, "orbit-overview.html");

const MAX_WIDTH = 1400;
const QUALITY = 82;

/* Screenshot key -> source file in docs/images/ */
const SHOTS = {
  dashboard:     "Screenshot 2026-07-23 031656.png",
  projects:      "Screenshot 2026-07-23 031726.png",
  insights:      "Screenshot 2026-07-23 031800.png",
  teams:         "Screenshot 2026-07-23 031813.png",
  mail:          "Screenshot 2026-07-23 031846.png",
  postgres:      "Screenshot 2026-07-23 032005.png",
  health:        "Screenshot 2026-07-23 032034.png",
  home:          "Screenshot 2026-07-23 032056.png",
  intelligence:  "Screenshot 2026-07-23 032128.png",
  startwork:     "Screenshot 2026-07-23 032143.png",
  askai:         "Screenshot 2026-07-23 032339.png",
  automation:    "Screenshot 2026-07-23 032414.png",
  sprints:       "Screenshot 2026-07-23 032447.png",
  velocity:      "Screenshot 2026-07-23 032503.png",
  projectdetail: "Screenshot 2026-07-23 032551.png",
};

function resolveBin(name) {
  const winget = path.join(
    os.homedir(),
    "AppData/Local/Microsoft/WinGet/Packages",
    "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe",
    "ffmpeg-7.1.1-full_build/bin",
    name + ".exe"
  );
  try {
    execFileSync(name, ["-version"], { stdio: "ignore" });
    return name;
  } catch {
    if (fs.existsSync(winget)) return winget;
    throw new Error(`${name} not found on PATH or at ${winget}`);
  }
}

const FFMPEG = resolveBin("ffmpeg");
const FFPROBE = resolveBin("ffprobe");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-overview-"));

function buildImage(key) {
  const src = path.join(IMAGES, SHOTS[key]);
  if (!fs.existsSync(src)) throw new Error(`missing screenshot for "${key}": ${src}`);
  const webp = path.join(tmp, key + ".webp");

  execFileSync(FFMPEG, [
    "-y", "-loglevel", "error",
    "-i", src,
    "-vf", `scale='min(${MAX_WIDTH},iw)':-2`,
    "-c:v", "libwebp", "-quality", String(QUALITY),
    "-compression_level", "6", "-frames:v", "1",
    webp,
  ]);

  const dims = execFileSync(FFPROBE, [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height", "-of", "csv=p=0", webp,
  ]).toString().trim().split(",");

  const b64 = fs.readFileSync(webp).toString("base64");
  const kb = Math.round(b64.length / 1024);
  console.log(`  ${key.padEnd(14)} ${dims[0]}x${dims[1]}  ${kb}KB (base64)`);
  return `src="data:image/webp;base64,${b64}" width="${dims[0]}" height="${dims[1]}"`;
}

function buildIcon(slug) {
  const file = path.join(ICONS, slug + ".svg");
  if (!fs.existsSync(file)) throw new Error(`missing icon: ${file}`);
  const svg = fs.readFileSync(file, "utf8");
  const d = svg.match(/\sd="([^"]+)"/);
  if (!d) throw new Error(`no path data in ${slug}.svg`);
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="${d[1]}"/></svg>`;
}

let html = fs.readFileSync(SRC, "utf8");

console.log("screenshots:");
html = html.replace(/\{\{IMG:([a-z]+)\}\}/g, (_, k) => buildImage(k));
const icons = new Set();
html = html.replace(/\{\{ICON:([a-z0-9]+)\}\}/g, (_, s) => { icons.add(s); return buildIcon(s); });
console.log(`icons: ${[...icons].sort().join(", ")}`);

const leftover = html.match(/\{\{[A-Z]+:[^}]+\}\}/g);
if (leftover) throw new Error("unreplaced tokens: " + leftover.join(", "));

fs.writeFileSync(OUT, html);

/* ---------------------------------------------------------------
 * Second output: public/about.html, served at /about by Netlify.
 *
 * OUT is a *fragment* — the Artifact host supplies <html>/<head>/<body>
 * around it. Served directly that would have no charset and, worse, no
 * viewport meta, so phones would lay it out at desktop width. The site
 * copy therefore gets a real document wrapper.
 * ------------------------------------------------------------- */
const MARK =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#37DFA0" stroke-width="1.7">` +
  `<circle cx="12" cy="12" r="3.4" fill="#37DFA0" stroke="none"/>` +
  `<ellipse cx="12" cy="12" rx="10" ry="4.6" transform="rotate(-28 12 12)"/>` +
  `<ellipse cx="12" cy="12" rx="10" ry="4.6" transform="rotate(28 12 12)" opacity=".45"/></svg>`;

const DESC = "ORBIT — your personal developer command center. Its modules, ecosystem, stack and data model.";
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="${DESC}">
<meta name="color-scheme" content="dark">
<meta property="og:title" content="ORBIT — Developer Command Center">
<meta property="og:description" content="${DESC}">
<meta property="og:type" content="website">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(MARK)}">
<style>html,body{margin:0;padding:0;background:#0A0B0D}</style>
</head>
<body>
${html}
</body>
</html>
`;

const PUBLIC = path.join(DOCS, "..", "public", "about.html");
fs.writeFileSync(PUBLIC, page);

fs.rmSync(tmp, { recursive: true, force: true });

const mb = (p) => (fs.statSync(p).size / 1024 / 1024).toFixed(2);
console.log(`\nwrote ${path.relative(process.cwd(), OUT)}  (${mb(OUT)} MB)  — artifact fragment`);
console.log(`wrote ${path.relative(process.cwd(), PUBLIC)}  (${mb(PUBLIC)} MB)  — served at /about`);
