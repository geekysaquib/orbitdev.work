/**
 * Local companion agent client.
 * The browser cannot launch native apps, so a tiny background service on the
 * user's machine (see /agent) exposes an endpoint that ORBIT calls.
 * The endpoint URL is runtime-configurable from Settings (persisted locally)
 * and falls back to VITE_AGENT_URL, then to http://localhost:47600.
 */
const DEFAULT_URL = "http://localhost:47600";
const KEY = "orbit.agentUrl";

export function getAgentUrl(): string {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) return stored;
  } catch { /* ignore */ }
  return (import.meta.env.VITE_AGENT_URL as string) || DEFAULT_URL;
}

export function setAgentUrl(url: string): void {
  try { localStorage.setItem(KEY, url.trim().replace(/\/+$/, "")); } catch { /* ignore */ }
}

async function call(path: string, body?: unknown): Promise<Response> {
  return fetch(getAgentUrl() + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function pingAgent(): Promise<boolean> {
  try {
    const r = await call("/ping");
    return r.ok;
  } catch {
    return false;
  }
}

export type LaunchKind = "vscode" | "visualstudio" | "terminal" | "browser" | "all";

export async function launch(kind: LaunchKind, payload: {
  fe_path?: string | null; sln_path?: string | null; dev_port?: number | null; name?: string;
}): Promise<{ ok: boolean; error?: string; opened?: string[] }> {
  try {
    const r = await call("/launch", { kind, ...payload });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: (j as { error?: string }).error || `agent responded ${r.status}` };
    return { ok: true, opened: (j as { opened?: string[] }).opened };
  } catch {
    return { ok: false, error: "agent offline" };
  }
}

/** Ask the local agent to open a native folder/file dialog and return the chosen path. */
export async function pickPath(type: "folder" | "file"): Promise<string | null> {
  try {
    const r = await call("/pick", { type });
    if (!r.ok) return null;
    const j = await r.json();
    return (j.path as string) || null;
  } catch {
    return null;
  }
}

export async function runMacro(name: "start-work" | "end-work", payload: unknown) {
  try {
    const r = await call("/macro", { name, payload });
    return { ok: r.ok };
  } catch {
    return { ok: false };
  }
}

export interface DockerContainer { name: string; image: string; status: string; }
export async function fetchDocker(): Promise<{ available: boolean; containers: DockerContainer[] }> {
  try {
    const r = await call("/docker");
    if (!r.ok) return { available: false, containers: [] };
    const j = await r.json();
    return { available: !!j.available, containers: j.containers ?? [] };
  } catch {
    return { available: false, containers: [] };
  }
}

export interface DockerImage { repository: string; tag: string; id: string; size: string; created: string; }
export async function fetchDockerImages(): Promise<{ available: boolean; images: DockerImage[] }> {
  try {
    const r = await call("/docker/images");
    if (!r.ok) return { available: false, images: [] };
    const j = await r.json();
    return { available: !!j.available, images: j.images ?? [] };
  } catch { return { available: false, images: [] }; }
}
export async function dockerSave(image: string, dir: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const r = await call("/docker/save", { image, dir });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: (j as { error?: string }).error || `agent ${r.status}` };
    return { ok: true, path: (j as { path?: string }).path };
  } catch { return { ok: false, error: "agent offline" }; }
}
export async function dockerBuild(tag: string, context: string, dockerfile?: string):
  Promise<{ ok: boolean; tag?: string; output?: string; error?: string }> {
  try {
    const r = await call("/docker/build", { tag, context, dockerfile });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: (j as { error?: string }).error || `agent ${r.status}` };
    return { ok: true, tag: (j as { tag?: string }).tag, output: (j as { output?: string }).output };
  } catch { return { ok: false, error: "agent offline" }; }
}

// ---- Start Work ----
export type PullReason = "updated" | "up_to_date" | "no_upstream" | "conflict" | "auth" | "fetch_failed" | "pull_failed" | "not_a_repo" | "offline";
export interface PullResult {
  ok: boolean; reason: PullReason; branch?: string; ahead?: number; behind?: number;
  dirty?: number; files?: number; output?: string; error?: string;
}
export async function gitPull(path: string): Promise<PullResult> {
  try {
    const r = await call("/git/pull", { path });
    const j = (await r.json().catch(() => ({}))) as Partial<PullResult>;
    if (j.reason) return { ok: !!j.ok, ...j } as PullResult;
    return { ok: false, reason: "pull_failed", error: j.error || `agent ${r.status}` };
  } catch { return { ok: false, reason: "offline", error: "agent offline" }; }
}
export async function checkPort(port: number): Promise<{ ok: boolean; inUse: boolean; ownedBy: string | null; error?: string }> {
  try {
    const r = await fetch(`${getAgentUrl()}/port/check?port=${port}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, inUse: false, ownedBy: null, error: (j as { error?: string }).error };
    return { ok: true, inUse: !!(j as { inUse?: boolean }).inUse, ownedBy: (j as { ownedBy?: string | null }).ownedBy ?? null };
  } catch { return { ok: false, inUse: false, ownedBy: null, error: "agent offline" }; }
}
export async function devStart(path: string, command: string, port: number | null, project?: string):
  Promise<{ ok: boolean; pid?: number; port?: number | null; error?: string; ownedBy?: string | null }> {
  try {
    const r = await call("/dev/start", { path, command, port, project });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: (j as { error?: string }).error || `agent ${r.status}`, ownedBy: (j as { ownedBy?: string | null }).ownedBy ?? null };
    return { ok: true, pid: (j as { pid?: number }).pid, port: (j as { port?: number | null }).port ?? null };
  } catch { return { ok: false, error: "agent offline" }; }
}
export interface DevServer { pid: number; port: number | null; path: string; command: string; project: string | null; startedAt: number; }
export async function devRunning(): Promise<DevServer[]> {
  try { const r = await call("/dev/running"); const j = await r.json().catch(() => ({})); return (j.servers ?? []) as DevServer[]; }
  catch { return []; }
}
export async function devStop(pid: number): Promise<{ ok: boolean }> {
  try { const r = await call("/dev/stop", { pid }); return { ok: r.ok }; } catch { return { ok: false }; }
}

export interface GmailMsg { uid: number; subject: string; from: string; fromAddr: string; date: string; seen: boolean; }
export interface GmailFull { subject: string; from: string; to: string; date: string; text: string; html: string; }

export async function gmailStatus(): Promise<{ configured: boolean; user: string | null }> {
  try { const r = await call("/gmail/status"); const j = await r.json(); return { configured: !!j.configured, user: j.user ?? null }; }
  catch { return { configured: false, user: null }; }
}
export async function gmailConfigure(user: string, pass: string): Promise<{ ok: boolean; error?: string }> {
  try { const r = await call("/gmail/config", { user, pass }); const j = await r.json().catch(() => ({})); return r.ok ? { ok: true } : { ok: false, error: (j as { error?: string }).error }; }
  catch { return { ok: false, error: "agent offline" }; }
}
export async function gmailDisconnect(): Promise<void> {
  try { await fetch(getAgentUrl() + "/gmail/config", { method: "DELETE" }); } catch { /**/ }
}
export async function gmailList(limit = 25): Promise<{ ok: boolean; messages: GmailMsg[]; error?: string }> {
  try { const r = await call(`/gmail/list?limit=${limit}`); const j = await r.json().catch(() => ({})); return r.ok ? { ok: true, messages: j.messages ?? [] } : { ok: false, messages: [], error: (j as { error?: string }).error }; }
  catch { return { ok: false, messages: [], error: "agent offline" }; }
}
export async function gmailMessage(uid: number): Promise<{ ok: boolean; message?: GmailFull; error?: string }> {
  try { const r = await call(`/gmail/message?uid=${uid}`); const j = await r.json().catch(() => ({})); return r.ok ? { ok: true, message: j.message } : { ok: false, error: (j as { error?: string }).error }; }
  catch { return { ok: false, error: "agent offline" }; }
}

// ---- Break chores: npm, docker disk, ports, mail ----
export interface OutdatedPkg { name: string; current: string; wanted: string; latest: string; major: boolean; }
export async function npmOutdated(path: string): Promise<{ ok: boolean; total: number; major: number; packages: OutdatedPkg[] }> {
  try {
    const r = await call("/npm/outdated", { path });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) return { ok: false, total: 0, major: 0, packages: [] };
    return { ok: true, total: j.total ?? 0, major: j.major ?? 0, packages: j.packages ?? [] };
  } catch { return { ok: false, total: 0, major: 0, packages: [] }; }
}
export interface AuditResult { ok: boolean; total: number; critical: number; high: number; moderate: number; low: number; }
export async function npmAudit(path: string): Promise<AuditResult> {
  try {
    const r = await call("/npm/audit", { path });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) return { ok: false, total: 0, critical: 0, high: 0, moderate: 0, low: 0 };
    return { ok: true, total: j.total ?? 0, critical: j.critical ?? 0, high: j.high ?? 0, moderate: j.moderate ?? 0, low: j.low ?? 0 };
  } catch { return { ok: false, total: 0, critical: 0, high: 0, moderate: 0, low: 0 }; }
}
export async function dockerDf(): Promise<{ available: boolean; dangling: number; reclaimable: string }> {
  try {
    const r = await call("/docker/df");
    const j = await r.json().catch(() => ({}));
    return { available: !!j.available, dangling: j.dangling ?? 0, reclaimable: j.reclaimable ?? "0B" };
  } catch { return { available: false, dangling: 0, reclaimable: "0B" }; }
}
export async function dockerPrune(): Promise<{ ok: boolean; output?: string; error?: string }> {
  try { const r = await call("/docker/prune", {}); const j = await r.json().catch(() => ({})); return { ok: !!j.ok, output: j.output, error: j.error }; }
  catch { return { ok: false, error: "agent offline" }; }
}
export interface PortInfo { port: number; inUse: boolean; ownedBy: string | null; orbit: boolean; }
export async function portsMap(ports: number[]): Promise<PortInfo[]> {
  if (!ports.length) return [];
  try { const r = await fetch(`${getAgentUrl()}/ports/map?ports=${ports.join(",")}`); const j = await r.json().catch(() => ({})); return (j.ports ?? []) as PortInfo[]; }
  catch { return []; }
}
export async function gmailUnread(): Promise<{ ok: boolean; unread: number }> {
  try { const r = await call("/gmail/unread"); const j = await r.json().catch(() => ({})); return { ok: !!j.ok, unread: j.unread ?? 0 }; }
  catch { return { ok: false, unread: 0 }; }
}

/** Subscribe to agent push events. Returns an unsubscribe fn. Falls back silently. */
export function agentEvents(onEvent: (event: string) => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout>;
  const connect = () => {
    if (closed) return;
    try {
      ws = new WebSocket(getAgentUrl().replace(/^http/, "ws") + "/events");
      ws.onmessage = (m) => { try { const d = JSON.parse(m.data as string); if (d.event) onEvent(d.event); } catch { /* noop */ } };
      ws.onclose = () => { if (!closed) retry = setTimeout(connect, 5000); };
      ws.onerror = () => { try { ws?.close(); } catch { /* noop */ } };
    } catch { retry = setTimeout(connect, 5000); }
  };
  connect();
  return () => { closed = true; clearTimeout(retry); try { ws?.close(); } catch { /* noop */ } };
}
