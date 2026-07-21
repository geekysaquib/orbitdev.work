/**
 * VS Code integration — driven through the local agent's `code` CLI endpoints.
 *
 * Every open/jump call degrades to a `vscode://` deep link when the agent isn't
 * reachable: the URI handler is registered by VS Code itself, so the browser can
 * open the editor with no agent at all. The agent path is still preferred — it
 * reports whether the launch actually worked, supports `--diff` and workspace
 * files, and doesn't make the browser prompt about an external protocol.
 */
import { agentCall } from "./agent";

export interface VscodeStatus { available: boolean; version?: string; error?: string }
export interface VscodeExtension { id: string; version: string }
/** Live editor state, posted by the ORBIT VS Code extension. */
export interface EditorState {
  connected: boolean;
  file?: string | null; language?: string | null;
  workspace?: string | null; project?: string | null;
  editing?: boolean; idleSeconds?: number;
}

const json = async <T,>(path: string, body?: unknown): Promise<T | null> => {
  try {
    const r = await agentCall(path, body);
    const j = await r.json().catch(() => null);
    return j && (j as { ok?: boolean }).ok !== false ? (j as T) : null;
  } catch { return null; }
};

export async function vscodeStatus(): Promise<VscodeStatus> {
  const j = await json<{ available: boolean; version?: string; error?: string }>("/vscode/status");
  return j ?? { available: false, error: "agent offline" };
}

/** `vscode://file/<abs path>[:line[:col]]` — the no-agent fallback. */
export function deepLink(path: string, line?: number, column?: number): string {
  const p = path.replace(/\\/g, "/").replace(/^\/+/, "");
  const suffix = Number.isFinite(line) ? `:${line}${Number.isFinite(column) ? `:${column}` : ""}` : "";
  return `vscode://file/${p}${suffix}`;
}

/**
 * Open a folder, or a file at a specific line. Returns how it was opened so the
 * caller can tell the user when it fell back (the deep link can't report failure
 * — the browser hands off and forgets).
 */
export async function openInVscode(
  path: string,
  opts: { line?: number; column?: number; newWindow?: boolean } = {},
): Promise<{ ok: boolean; via: "agent" | "deeplink" }> {
  const viaAgent = await json<{ ok: true }>("/vscode/open", {
    path, line: opts.line, column: opts.column, newWindow: !!opts.newWindow, reuse: !opts.newWindow,
  });
  if (viaAgent) return { ok: true, via: "agent" };
  window.location.href = deepLink(path, opts.line, opts.column);
  return { ok: true, via: "deeplink" };
}

/** Side-by-side diff of two files. Agent-only — `vscode://` has no diff verb. */
export async function diffInVscode(left: string, right: string): Promise<boolean> {
  return !!(await json<{ ok: true }>("/vscode/diff", { left, right }));
}

export async function listVscodeExtensions(): Promise<VscodeExtension[]> {
  const j = await json<{ extensions: VscodeExtension[] }>("/vscode/extensions");
  return j?.extensions ?? [];
}

export async function installVscodeExtension(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await agentCall("/vscode/extensions/install", { id });
    const j = await r.json().catch(() => ({}));
    return (j as { ok?: boolean }).ok ? { ok: true } : { ok: false, error: (j as { error?: string }).error || "install failed" };
  } catch { return { ok: false, error: "agent offline" }; }
}

/**
 * Write a multi-root `.code-workspace` from a project's folders and open it, so
 * a project whose frontend and solution live in separate trees opens as one
 * window. Falls back to opening the first folder when the agent is unreachable.
 */
export async function openProjectWorkspace(
  name: string,
  folders: (string | null | undefined)[],
): Promise<{ ok: boolean; via: "agent" | "deeplink"; file?: string }> {
  const list = folders.filter((f): f is string => !!f && !!f.trim());
  if (!list.length) return { ok: false, via: "agent" };
  const j = await json<{ file: string }>("/vscode/workspace", { name, folders: list, open: true });
  if (j) return { ok: true, via: "agent", file: j.file };
  window.location.href = deepLink(list[0]);
  return { ok: true, via: "deeplink" };
}

/** The ORBIT extension's own .vsix, shipped next to the agent for one-click install. */
export async function orbitExtensionPackage(): Promise<{ available: boolean; version?: string }> {
  const j = await json<{ available: boolean; version?: string }>("/vscode/extension/package");
  return j ?? { available: false };
}

export async function installOrbitExtension(): Promise<{ ok: boolean; error?: string; output?: string }> {
  try {
    const r = await agentCall("/vscode/extension/install", {}); // body forces POST
    const j = await r.json().catch(() => ({}));
    const o = j as { ok?: boolean; error?: string; output?: string };
    return o.ok ? { ok: true, output: o.output } : { ok: false, error: o.error || "install failed" };
  } catch { return { ok: false, error: "agent offline" }; }
}

export async function fetchEditorState(): Promise<EditorState> {
  const j = await json<EditorState>("/editor/state");
  return j ?? { connected: false };
}

/** OS-wide input idle. `supported:false` on platforms with no probe (see the agent). */
export async function systemIdle(): Promise<{ supported: boolean; seconds: number | null }> {
  const j = await json<{ supported: boolean; seconds?: number }>("/system/idle");
  if (!j || !j.supported) return { supported: false, seconds: null };
  return { supported: true, seconds: j.seconds ?? 0 };
}
