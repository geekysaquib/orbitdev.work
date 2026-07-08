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
