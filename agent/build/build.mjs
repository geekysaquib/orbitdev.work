// Packages the headless agent into a single double-clickable orbit.exe (Node's
// "Single Executable Application" feature) — no Node.js install required on
// the user's machine. Run: `npm run build:exe` (from agent/).
//
// Steps: bundle server.mjs (+deps) into one CJS file with esbuild, ask Node to
// generate a SEA blob from it, copy the current node.exe, brand it (icon +
// version info via rcedit — must happen *before* postject so the resource
// edit doesn't disturb the injected blob), then inject the blob with
// postject. Output: agent/dist/orbit.exe

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rcedit } from "rcedit";

const __dir = dirname(fileURLToPath(import.meta.url));
const agentDir = dirname(__dir);
const distDir = join(agentDir, "dist");

// On Windows, a running dist/orbit.exe holds its own file open — rmSync then
// fails with EPERM/EBUSY. Retry a few times (covers AV scanning it right
// after launch too) before giving the user an actionable message instead of
// a raw stack trace.
if (existsSync(distDir)) {
  const attempts = 5;
  for (let i = 1; i <= attempts; i++) {
    try { rmSync(distDir, { recursive: true, force: true }); break; }
    catch (e) {
      const locked = e.code === "EPERM" || e.code === "EBUSY";
      if (!locked || i === attempts) {
        if (locked) {
          console.error(
            `\n[build] Couldn't remove ${distDir} — ${join(distDir, process.platform === "win32" ? "orbit.exe" : "orbit")} is still running.\n` +
            `[build] Stop the ORBIT agent (Task Manager -> End orbit.exe, or close its tray/status window) and run this build again.\n`
          );
          process.exit(1);
        }
        throw e;
      }
      execFileSync(process.execPath, ["-e", "setTimeout(()=>{}, 500)"]); // small sync wait between retries
    }
  }
}
mkdirSync(distDir, { recursive: true });

const bundlePath = join(distDir, "bundle.cjs");
const blobPath = join(distDir, "sea-blob.blob");
const seaConfigPath = join(distDir, "sea-config.json");
const iconPath = join(__dir, "orbit.ico");
const exePath = join(distDir, process.platform === "win32" ? "orbit.exe" : "orbit");

console.log("[build] bundling server.mjs -> bundle.cjs");
await build({
  entryPoints: [join(agentDir, "server.mjs")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: bundlePath,
  logLevel: "info",
});

writeFileSync(
  seaConfigPath,
  JSON.stringify(
    {
      main: bundlePath,
      output: blobPath,
      disableExperimentalSEAWarning: true,
    },
    null,
    2
  )
);

console.log("[build] generating SEA blob");
execFileSync(process.execPath, ["--experimental-sea-config", seaConfigPath], { stdio: "inherit" });

console.log("[build] copying node binary ->", exePath);
copyFileSync(process.execPath, exePath);

// Not bundled into the SEA blob (it's Python, not JS) — must ship next to the
// exe so ensureLocalAi()'s `join(__dir, "ai_local.py")` finds it at runtime.
copyFileSync(join(agentDir, "ai_local.py"), join(distDir, "ai_local.py"));

if (process.platform === "win32" && existsSync(iconPath)) {
  console.log("[build] branding exe (icon + version info)");
  await rcedit(exePath, {
    icon: iconPath,
    "version-string": {
      ProductName: "ORBIT Agent",
      FileDescription: "ORBIT local companion agent",
      CompanyName: "ORBIT",
    },
    "product-version": "0.1.0",
    "file-version": "0.1.0",
  });
}

console.log("[build] injecting blob with postject");
const postjectCli = join(agentDir, "node_modules", "postject", "dist", "cli.js");
execFileSync(
  process.execPath,
  [postjectCli, exePath, "NODE_SEA_BLOB", blobPath, "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"],
  { stdio: "inherit" }
);

console.log(`[build] done -> ${exePath}`);
