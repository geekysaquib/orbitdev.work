/**
 * Thin client for the local agent's AI endpoints. Two call shapes:
 *  - `ask()` — one-shot, no history. Schema Q&A (Postgres), ticket triage
 *    (Tickets), standup summaries (Dashboard), commit/PR writing (git tab).
 *  - `askThread()` / `askThreadStream()` — multi-turn conversation. Ask AI's
 *    follow-up thread.
 * The agent makes the actual model call server-side; the browser never talks
 * to a cloud provider or Python directly.
 *
 * Backends, tried in order:
 *  - Cloud providers (Anthropic, Gemini, OpenAI, Grok) — each needs the
 *    user's own API key from Settings. `preferred` (Settings' "AI provider")
 *    goes first if its key is set; the rest of the configured providers are
 *    tried after it, in `CLOUD_PROVIDERS` order, so a single provider being
 *    out of credit or rate-limited doesn't take Ask AI down outright.
 *  - Local (llama-cpp-python via a Python worker the agent manages) — free,
 *    no key, but needs Python + `pip install llama-cpp-python` on the
 *    machine. Always the last resort. Use `ask()`/`askThread()`/
 *    `askThreadStream()` to get provider-chain-then-local without callers
 *    having to branch.
 */
import { agentCall } from "./agent";

export type CloudProvider = "anthropic" | "gemini" | "openai" | "grok";
export const CLOUD_PROVIDERS: CloudProvider[] = ["anthropic", "gemini", "openai", "grok"];
export const PROVIDER_LABEL: Record<CloudProvider, string> = {
  anthropic: "Claude", gemini: "Gemini", openai: "ChatGPT", grok: "Grok",
};

/** One entry per provider Settings can hold a key for. Missing/empty = not configured. */
export interface ProviderKeys {
  anthropic?: string | null; gemini?: string | null; openai?: string | null; grok?: string | null;
}

export type AiSource = CloudProvider | "local";
export interface AskResult {
  ok: boolean; text?: string; error?: string; source: AiSource;
  /** Any tokens already rendered — a retry would duplicate them, so callers must not re-run. */
  emitted?: boolean;
  /** Set when earlier provider(s) failed before this result landed — comma-joined display names. */
  fellBackFrom?: string;
}
export interface AiMessage { role: "user" | "assistant"; content: string; }

/** Configured cloud providers, `preferred` first if it has a key — the order callers try them in. Empty if none configured. */
export function orderedProviders(keys: ProviderKeys, preferred?: CloudProvider): CloudProvider[] {
  const configured = CLOUD_PROVIDERS.filter((p) => keys[p]);
  if (!configured.length) return [];
  const first = preferred && configured.includes(preferred) ? preferred : configured[0];
  return [first, ...configured.filter((p) => p !== first)];
}

async function cloudOnce(provider: CloudProvider, apiKey: string, prompt: string | undefined, system: string | undefined, messages: AiMessage[] | undefined): Promise<AskResult> {
  try {
    const r = await agentCall("/ai/ask", { provider, apiKey, prompt, system, messages });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return { ok: false, error: (j as { error?: string }).error || `agent ${r.status}`, source: provider };
    return { ok: true, text: (j as { text?: string }).text || "", source: provider };
  } catch { return { ok: false, error: "agent offline", source: provider }; }
}

async function localOnce(prompt: string | undefined, system: string | undefined, messages: AiMessage[] | undefined): Promise<AskResult> {
  try {
    const r = await agentCall("/ai/local/ask", { prompt, system, messages });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return { ok: false, error: (j as { error?: string }).error || `agent ${r.status}`, source: "local" };
    return { ok: true, text: (j as { text?: string }).text || "", source: "local" };
  } catch { return { ok: false, error: "agent offline", source: "local" }; }
}

/** Try configured cloud providers in order, then the local model. Shared by `ask()` and `askThread()`. */
async function runChain(
  keys: ProviderKeys, preferred: CloudProvider | undefined,
  prompt: string | undefined, system: string | undefined, messages: AiMessage[] | undefined,
): Promise<AskResult> {
  const failed: string[] = [];
  for (const p of orderedProviders(keys, preferred)) {
    const r = await cloudOnce(p, keys[p]!, prompt, system, messages);
    if (r.ok) return failed.length ? { ...r, fellBackFrom: failed.join(", ") } : r;
    failed.push(PROVIDER_LABEL[p]);
  }
  const local = await localOnce(prompt, system, messages);
  if (local.ok) return failed.length ? { ...local, fellBackFrom: failed.join(", ") } : local;
  // Nothing worked — surface the local error (most actionable: usually "install Python" /
  // "worker failed to start") but note the cloud attempts weren't silently skipped.
  return failed.length ? { ...local, error: `${local.error || "Local AI failed"} (also tried: ${failed.join(", ")})` } : local;
}

/** Cloud-chain-then-local — callers don't need to branch on which backend answered. */
export async function ask(prompt: string, system: string | undefined, keys: ProviderKeys, preferred?: CloudProvider): Promise<AskResult> {
  return runChain(keys, preferred, prompt, system, undefined);
}

/** Multi-turn, non-streaming variant of `ask()`. */
export async function askThread(messages: AiMessage[], system: string | undefined, keys: ProviderKeys, preferred?: CloudProvider): Promise<AskResult> {
  return runChain(keys, preferred, undefined, system, messages);
}

export async function askLocalAI(prompt: string, system?: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  return localOnce(prompt, system, undefined);
}

export interface LocalAiStatus { state: "idle" | "ready" | "error"; model?: string; device?: "gpu" | "cpu"; error?: string; }
export async function localAiStatus(): Promise<LocalAiStatus> {
  try {
    const r = await agentCall("/ai/local/status");
    const j = await r.json().catch(() => ({}));
    return { state: (j.state as LocalAiStatus["state"]) || "idle", model: j.model, device: j.device, error: j.error };
  } catch { return { state: "idle" }; }
}

/**
 * Streaming variant of `askThread()`. `onDelta` fires per token chunk; the
 * resolved `text` is the full concatenation, so a caller that ignores `onDelta`
 * behaves exactly like `askThread()`.
 *
 * The local model runs at ~5-7 tok/s on CPU, which is tens of seconds of blank
 * screen for a complete answer — streaming doesn't speed that up, it makes the
 * wait legible. All backends emit the same SSE shape ({delta} … {done}|{error}),
 * so the only thing that differs here is which endpoint/provider gets called.
 */
export async function askThreadStream(
  messages: AiMessage[],
  system: string | undefined,
  keys: ProviderKeys,
  preferred: CloudProvider | undefined,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
  /**
   * Swapped in when the chain reaches the local model. The right prompt size
   * depends on which backend actually answers, not on which keys are configured:
   * a user with a cloud key that's out of credit still lands on local, and the
   * cloud-sized prompt costs it ~80 tok/s of prefill (and can blow the 4k window).
   */
  localOverride?: { messages: AiMessage[]; system?: string },
): Promise<AskResult> {
  const failed: string[] = [];
  for (const p of orderedProviders(keys, preferred)) {
    const r = await streamOnce(p, keys[p]!, messages, system, onDelta, signal);
    if (r.ok || r.error === "cancelled") return failed.length ? { ...r, fellBackFrom: failed.join(", ") } : r;
    // A provider can fail for reasons another provider doesn't share — an expired
    // key, an exhausted credit balance, a rate limit. Trying the next configured
    // one (then local) keeps AI working instead of failing outright; `emitted`
    // guards against re-rendering a half-streamed answer, so this only advances
    // to the next backend when the failed attempt produced nothing.
    if (r.emitted) return r;
    failed.push(PROVIDER_LABEL[p]);
  }
  const local = await streamOnce(
    null, null,
    localOverride?.messages ?? messages,
    localOverride ? localOverride.system : system,
    onDelta, signal,
  );
  if (local.ok || local.error === "cancelled") return failed.length && local.ok ? { ...local, fellBackFrom: failed.join(", ") } : local;
  return failed.length ? { ...local, error: `${local.error || "Local AI failed"} (also tried: ${failed.join(", ")})` } : local;
}

/** One SSE attempt against whichever backend `provider` selects (`null` = local). */
async function streamOnce(
  provider: CloudProvider | null,
  apiKey: string | null,
  messages: AiMessage[],
  system: string | undefined,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<AskResult> {
  const source: AiSource = provider ?? "local";
  const endpoint = provider ? "/ai/ask/stream" : "/ai/local/ask/stream";
  try {
    const r = await agentCall(endpoint, provider ? { provider, apiKey, messages, system } : { messages, system }, signal);
    // A pre-stream failure (bad key, empty turns) still comes back as plain JSON.
    if (!r.ok || !r.body) {
      const j = await r.json().catch(() => ({}));
      return { ok: false, error: (j as { error?: string }).error || `agent ${r.status}`, source };
    }
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "", text = "", failure: string | null = null, done = false;
    while (!done) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      buf += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line; a chunk can split one in half.
      let sep;
      while ((sep = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, sep).trim(); buf = buf.slice(sep + 2);
        if (!frame.startsWith("data:")) continue;
        let evt: { delta?: string; done?: boolean; error?: string };
        try { evt = JSON.parse(frame.slice(5).trim()); } catch { continue; }
        if (evt.delta) { text += evt.delta; onDelta(evt.delta); }
        else if (evt.error) { failure = evt.error; done = true; break; }
        else if (evt.done) { done = true; break; }
      }
    }
    if (failure) return { ok: false, error: failure, source, emitted: text.length > 0 };
    return { ok: true, text, source, emitted: text.length > 0 };
  } catch (e) {
    // An abort is the caller closing the modal, not a failure worth surfacing.
    if ((e as Error)?.name === "AbortError") return { ok: false, error: "cancelled", source };
    return { ok: false, error: "agent offline", source };
  }
}
