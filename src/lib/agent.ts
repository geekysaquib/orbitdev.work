/**
 * Local companion agent client.
 * The browser cannot launch native apps, so a tiny background service on the
 * user's machine (see /agent) exposes an HTTPS endpoint that ORBIT calls.
 * When the agent is offline every action degrades gracefully.
 */
const BASE = (import.meta.env.VITE_AGENT_URL as string) || "https://localhost:47600";

async function call(path: string, body?: unknown): Promise<Response> {
  return fetch(BASE + path, {
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
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await call("/launch", { kind, ...payload });
    if (!r.ok) return { ok: false, error: `agent responded ${r.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: "agent offline" };
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
