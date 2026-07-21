/**
 * ORBIT for VS Code.
 *
 * Two jobs:
 *  1. Report what you're actually editing to the local ORBIT agent, so idle
 *     detection and focus analytics reflect real work instead of browser-tab
 *     activity (heads-down coding used to read as idle and pause the timer).
 *  2. Show your ORBIT tasks/tickets and drive the timer without leaving VS Code.
 *
 * Everything goes through the local agent on 127.0.0.1 — the extension never
 * talks to Supabase or any cloud service, and holds no credentials beyond the
 * ORBIT session token the user pastes once (kept in VS Code's SecretStorage).
 *
 * Writes are relayed rather than performed: the timer lives in the ORBIT tab's
 * localStorage and task writes go through its RLS-scoped Supabase client, so
 * commands are pushed to that tab over the agent's websocket. With no tab open
 * the agent answers 409 and we say so plainly.
 */
import * as vscode from "vscode";
import { panelHtml } from "./ui";

const TOKEN_KEY = "orbit.sessionToken";
const ACTIVITY_MS = 15_000;   // heartbeat; the agent treats >90s as disconnected
const REFRESH_MS = 30_000;

interface WorkItem { id: string; title: string; status: string; priority: string; project: string | null }
interface Timer { running: boolean; seconds?: number; startedAt?: number | null; project?: string | null; taskId?: string | null }
interface WorkList {
  fresh: boolean; ageMs?: number; orbitOpen?: boolean;
  tasks: WorkItem[]; tickets: WorkItem[];
  timer: Timer;
  hours?: { today: number; total: number } | null;
  projects?: { id: string; name: string }[];
  break?: { onBreak: boolean; startedAt: number | null; idlePaused: boolean } | null;
  ai?: { rankedAt: number; items: { id: string; reason: string }[] } | null;
}
interface EditorState { connected: boolean; file?: string | null; language?: string | null; project?: string | null }

let token: string | undefined;
let output: vscode.OutputChannel;

const cfg = () => vscode.workspace.getConfiguration("orbit");
const agentUrl = () => String(cfg().get("agentUrl") || "http://localhost:47600").replace(/\/+$/, "");
const webUrl = () => String(cfg().get("webUrl") || "http://localhost:8888").replace(/\/+$/, "");

/** null = couldn't reach the agent (or unauthorised); distinct from an empty result. */
async function api<T>(path: string, body?: unknown): Promise<T | null> {
  if (!token) return null;
  try {
    const res = await fetch(agentUrl() + path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) { output.appendLine("[orbit] token rejected — run 'ORBIT: Sign in'"); return null; }
    const json = (await res.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
    if (!json || json.ok === false) {
      // 409 is the expected "no ORBIT tab open" case — worth saying out loud,
      // since the user's click appeared to do nothing.
      if (res.status === 409) vscode.window.showWarningMessage(json?.error || "ORBIT isn't open.");
      return null;
    }
    return json;
  } catch {
    return null; // agent not running — the panel renders its own offline state
  }
}

const nonce = () => Array.from({ length: 32 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 62)]).join("");

class OrbitPanel implements vscode.WebviewViewProvider {
  static readonly viewType = "orbit.panel";
  private view?: vscode.WebviewView;
  private work: WorkList | null = null;
  private editor: EditorState = { connected: false };
  private agentUp = true;

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    const n = nonce();
    view.webview.options = { enableScripts: true };
    view.webview.html = panelHtml(n, `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}';`);
    view.webview.onDidReceiveMessage((m) => void this.onMessage(m));
    // Refresh when the panel becomes visible again rather than polling a hidden view.
    view.onDidChangeVisibility(() => { if (view.visible) void this.refresh(); });
    void this.refresh();
  }

  private post() {
    this.view?.webview.postMessage({
      type: "state",
      payload: {
        signedIn: !!token,
        agent: this.agentUp,
        orbitOpen: this.work?.orbitOpen ?? false,
        fresh: this.work?.fresh ?? true,
        tasks: this.work?.tasks ?? [],
        tickets: this.work?.tickets ?? [],
        timer: this.work?.timer ?? { running: false },
        hours: this.work?.hours ?? null,
        editor: this.editor,
        break: this.work?.break ?? null,
        ai: this.work?.ai ?? null,
      },
    });
  }

  async refresh() {
    if (!token) { this.agentUp = true; this.post(); return; }
    const [w, e] = await Promise.all([api<WorkList>("/worklist"), api<EditorState>("/editor/state")]);
    this.agentUp = w !== null;
    if (w) this.work = w;
    this.editor = e ?? { connected: false };
    this.post();
  }

  get timer(): Timer { return this.work?.timer ?? { running: false }; }
  get projects() { return this.work?.projects ?? []; }
  /** True once a ranking lands that's newer than 60s — the poll's stop condition. */
  get rankedRecently(): boolean {
    const at = this.work?.ai?.rankedAt;
    return !!at && Date.now() - at < 60_000;
  }

  private async onMessage(m: { type: string; payload?: Record<string, string> }) {
    switch (m.type) {
      case "ready": return this.post();
      case "refresh": return void this.refresh();
      case "signIn": return void vscode.commands.executeCommand("orbit.setToken");
      case "toggleTimer": return void vscode.commands.executeCommand("orbit.toggleTimer");
      case "newTask": return void vscode.commands.executeCommand("orbit.newTask");
      case "rankTasks": return void vscode.commands.executeCommand("orbit.rankTasks");
      case "open": {
        const kind = m.payload?.kind === "ticket" ? "tickets" : "tasks";
        await vscode.env.openExternal(vscode.Uri.parse(`${webUrl()}/${kind}?id=${encodeURIComponent(m.payload?.id || "")}`));
        return;
      }
      case "setStatus": {
        const ok = await api("/orbit/command", { command: "task:status", payload: { id: m.payload?.id, status: m.payload?.status } });
        if (ok) { vscode.window.setStatusBarMessage(`$(check) Task → ${m.payload?.status}`, 2500); await this.settleThenRefresh(); }
        return;
      }
      case "timerForTask": {
        const running = this.timer.running && this.timer.taskId === m.payload?.id;
        const ok = await api("/orbit/command", running
          ? { command: "timer:stop" }
          : { command: "timer:start", payload: { taskId: m.payload?.id } });
        if (ok) await this.settleThenRefresh();
        return;
      }
    }
  }

  /** The ORBIT tab applies the command and re-pushes; give it a beat before re-reading. */
  private async settleThenRefresh() {
    await new Promise((r) => setTimeout(r, 1200));
    await this.refresh();
  }
}

// ---- Activity reporting ----

function startActivityReporting(ctx: vscode.ExtensionContext) {
  let editedAt = 0;
  ctx.subscriptions.push(vscode.workspace.onDidChangeTextDocument(() => { editedAt = Date.now(); }));

  const post = () => {
    if (!token || !cfg().get("reportActivity")) return;
    // Only report while VS Code actually has focus — a background window sitting
    // on a file isn't work, and counting it would recreate the very
    // false-activity problem this exists to fix.
    if (!vscode.window.state.focused) return;
    const doc = vscode.window.activeTextEditor?.document;
    const folder = doc ? vscode.workspace.getWorkspaceFolder(doc.uri) : vscode.workspace.workspaceFolders?.[0];
    void api("/editor/activity", {
      file: doc && doc.uri.scheme === "file" ? doc.uri.fsPath : null,
      language: doc?.languageId ?? null,
      workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
      project: folder?.name ?? null,
      editing: Date.now() - editedAt < ACTIVITY_MS,
    });
  };
  post();
  const t = setInterval(post, ACTIVITY_MS);
  ctx.subscriptions.push({ dispose: () => clearInterval(t) });
}

// ---- Activation ----

export async function activate(ctx: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel("ORBIT");
  ctx.subscriptions.push(output);
  token = await ctx.secrets.get(TOKEN_KEY);

  const panel = new OrbitPanel();
  ctx.subscriptions.push(vscode.window.registerWebviewViewProvider(OrbitPanel.viewType, panel, { webviewOptions: { retainContextWhenHidden: true } }));

  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  bar.command = "orbit.toggleTimer";
  ctx.subscriptions.push(bar);
  const paintBar = () => {
    if (!token) { bar.text = "$(circle-slash) ORBIT"; bar.tooltip = "Sign in to ORBIT"; return bar.show(); }
    const t = panel.timer;
    const secs = t.running ? (t.startedAt ? (Date.now() - t.startedAt) / 1000 : t.seconds ?? 0) : 0;
    bar.text = t.running ? `$(debug-pause) ${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m` : "$(play) ORBIT";
    bar.tooltip = t.running ? `ORBIT timer running${t.project ? ` · ${t.project}` : ""} — click to stop` : "Click to start the ORBIT timer";
    bar.show();
  };
  paintBar();
  // 1s keeps the status bar clock honest; the panel refresh is the slower loop.
  const barTick = setInterval(paintBar, 1000);
  const refreshLoop = setInterval(() => void panel.refresh().then(paintBar), REFRESH_MS);
  ctx.subscriptions.push({ dispose: () => { clearInterval(barTick); clearInterval(refreshLoop); } });

  startActivityReporting(ctx);

  const reload = async () => { await panel.refresh(); paintBar(); };

  ctx.subscriptions.push(
    vscode.commands.registerCommand("orbit.refresh", reload),

    vscode.commands.registerCommand("orbit.setToken", async () => {
      const value = await vscode.window.showInputBox({
        title: "ORBIT session token",
        prompt: "In ORBIT: Settings → Local agent → VS Code → Copy VS Code token",
        password: true, ignoreFocusOut: true,
      });
      if (value === undefined) return;
      const trimmed = value.trim();
      if (!trimmed) { await ctx.secrets.delete(TOKEN_KEY); token = undefined; }
      else { await ctx.secrets.store(TOKEN_KEY, trimmed); token = trimmed; }
      await reload();
    }),

    vscode.commands.registerCommand("orbit.signOut", async () => {
      await ctx.secrets.delete(TOKEN_KEY);
      token = undefined;
      await reload();
      vscode.window.showInformationMessage("ORBIT: signed out of this editor.");
    }),

    vscode.commands.registerCommand("orbit.toggleTimer", async () => {
      if (!token) return void vscode.commands.executeCommand("orbit.setToken");
      const running = panel.timer.running;
      let payload: Record<string, unknown> = {};
      if (!running) {
        // Offer the current workspace's matching ORBIT project first, so the
        // logged session lands against something meaningful.
        const folderName = vscode.workspace.workspaceFolders?.[0]?.name;
        const match = panel.projects.find((p) => p.name.toLowerCase() === (folderName || "").toLowerCase());
        payload = { projectId: match?.id ?? null, project: folderName ?? null };
      }
      const ok = await api("/orbit/command", { command: running ? "timer:stop" : "timer:start", payload });
      if (ok) {
        vscode.window.setStatusBarMessage(running ? "$(check) ORBIT timer stopped" : "$(check) ORBIT timer started", 3000);
        setTimeout(() => void reload(), 1200);
      }
    }),

    vscode.commands.registerCommand("orbit.newTask", async () => {
      if (!token) return void vscode.commands.executeCommand("orbit.setToken");
      // A selection is the common case — turning a TODO or a failing line into a
      // task shouldn't mean retyping it.
      const sel = vscode.window.activeTextEditor?.selection;
      const seed = sel && !sel.isEmpty ? vscode.window.activeTextEditor!.document.getText(sel).trim().slice(0, 120) : "";
      const title = await vscode.window.showInputBox({ title: "New ORBIT task", prompt: "Task title", value: seed, ignoreFocusOut: true });
      if (!title?.trim()) return;
      const priority = await vscode.window.showQuickPick(["low", "med", "high"], { title: "Priority", placeHolder: "med" });
      const folderName = vscode.workspace.workspaceFolders?.[0]?.name;
      const match = panel.projects.find((p) => p.name.toLowerCase() === (folderName || "").toLowerCase());
      const ok = await api("/orbit/command", {
        command: "task:create",
        payload: { title: title.trim(), priority: priority ?? "med", projectId: match?.id ?? null },
      });
      if (ok) { vscode.window.setStatusBarMessage("$(check) Task created in ORBIT", 3000); setTimeout(() => void reload(), 1200); }
    }),

    vscode.commands.registerCommand("orbit.rankTasks", async () => {
      if (!token) return void vscode.commands.executeCommand("orbit.setToken");
      // ORBIT runs the model (it owns the provider keys) and pushes the result
      // back through /worklist, so this only kicks it off and re-reads.
      const ok = await api("/orbit/command", { command: "ai:rank" });
      if (!ok) return void panel.refresh();   // clears the spinner on 409/offline
      vscode.window.setStatusBarMessage("$(sparkle) Ranking your tasks…", 4000);
      // The local model can take ~30s; poll a few times rather than one guess.
      for (const delay of [2500, 4000, 6000, 9000, 12000]) {
        await new Promise((r) => setTimeout(r, delay));
        await panel.refresh();
        if (panel.rankedRecently) break;
      }
      await panel.refresh();
    }),

    vscode.commands.registerCommand("orbit.openApp", () => vscode.env.openExternal(vscode.Uri.parse(webUrl() + "/app"))),
  );

  if (!token) {
    void vscode.window.showInformationMessage("ORBIT: sign in to see your work here.", "Sign in")
      .then((pick) => { if (pick) void vscode.commands.executeCommand("orbit.setToken"); });
  }
}

export function deactivate() { /* intervals are disposed via ctx.subscriptions */ }
