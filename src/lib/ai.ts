/**
 * Thin client for the local agent's AI endpoints. Two call shapes:
 *  - `ask()` — one-shot, no history. Schema Q&A (Postgres), ticket triage
 *    (Tickets), standup summaries (Dashboard).
 *  - `askThread()` — multi-turn conversation. Ask AI's follow-up thread.
 * The agent makes the actual model call server-side; the browser never talks
 * to Anthropic or Python directly.
 *
 * Two backends:
 *  - Cloud (Claude via Anthropic) — needs the user's own API key from Settings.
 *  - Local (llama-cpp-python via a Python worker the agent manages) — free,
 *    no key, but needs Python + `pip install llama-cpp-python` on the
 *    machine. Use `ask()`
 *    to get cloud-if-configured-else-local without caring which ran.
 */
import { agentCall } from "./agent";

export type AiSource = "cloud" | "local";
export interface AskResult { ok: boolean; text?: string; error?: string; source: AiSource; }
export interface AiMessage { role: "user" | "assistant"; content: string; }

export async function askAI(apiKey: string, prompt: string, system?: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  try {
    const r = await agentCall("/ai/ask", { apiKey, prompt, system });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return { ok: false, error: (j as { error?: string }).error || `agent ${r.status}` };
    return { ok: true, text: (j as { text?: string }).text || "" };
  } catch { return { ok: false, error: "agent offline" }; }
}

export async function askLocalAI(prompt: string, system?: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  try {
    const r = await agentCall("/ai/local/ask", { prompt, system });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return { ok: false, error: (j as { error?: string }).error || `agent ${r.status}` };
    return { ok: true, text: (j as { text?: string }).text || "" };
  } catch { return { ok: false, error: "agent offline" }; }
}

export interface LocalAiStatus { state: "idle" | "ready" | "error"; model?: string; device?: "gpu" | "cpu"; error?: string; }
export async function localAiStatus(): Promise<LocalAiStatus> {
  try {
    const r = await agentCall("/ai/local/status");
    const j = await r.json().catch(() => ({}));
    return { state: (j.state as LocalAiStatus["state"]) || "idle", model: j.model, device: j.device, error: j.error };
  } catch { return { state: "idle" }; }
}

/** Cloud if an Anthropic key is configured, otherwise the free local model — callers don't need to branch. */
export async function ask(prompt: string, system: string | undefined, apiKey: string | null): Promise<AskResult> {
  if (apiKey) { const r = await askAI(apiKey, prompt, system); return { ...r, source: "cloud" }; }
  const r = await askLocalAI(prompt, system);
  return { ...r, source: "local" };
}

/**
 * Multi-turn variant of `ask()` — same cloud-else-local routing, but sends the
 * whole conversation. The agent trims to the last ~6 exchanges and guarantees a
 * leading user turn, so callers can pass the transcript as-is.
 */
export async function askThread(messages: AiMessage[], system: string | undefined, apiKey: string | null): Promise<AskResult> {
  const endpoint = apiKey ? "/ai/ask" : "/ai/local/ask";
  const source: AiSource = apiKey ? "cloud" : "local";
  try {
    const r = await agentCall(endpoint, { apiKey: apiKey ?? undefined, messages, system });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return { ok: false, error: (j as { error?: string }).error || `agent ${r.status}`, source };
    return { ok: true, text: (j as { text?: string }).text || "", source };
  } catch { return { ok: false, error: "agent offline", source }; }
}
