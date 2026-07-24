import type { AIAdapter, AICompleteRequest, AICompleteResult, AIProviderId } from "../types";

const MAX_TOKENS = 900;

// OpenAI nests error text as `{error:{message,type,code}}`; Grok (xAI)
// sometimes sends the plain-string form `{error:"..."}` instead — handle
// both. `type`/`code` (e.g. "insufficient_quota" vs "rate_limit_exceeded")
// are the single most useful bit for telling "your account has no billing
// set up" apart from "you're actually being throttled" — both read as some
// flavor of "limit" in the bare `.message` text alone, so surface them
// instead of discarding them. Kept in sync by hand with the duplicate
// implementation in agent/server.mjs's openAiCompatError.
function errorText(j: { error?: string | { message?: string; type?: string; code?: string } }, status: number, model: string): string {
  const e = j?.error;
  const message = (typeof e === "string" ? e : e?.message) || `${model} error ${status}`;
  const tag = typeof e === "object" && e ? [e.type, e.code].filter(Boolean).join("/") : "";
  return `${message} [HTTP ${status}${tag ? ` · ${tag}` : ""}]`;
}

/**
 * OpenAI and Grok (xAI) both speak the OpenAI chat-completions wire format —
 * one adapter factory serves both, only `id`/`baseUrl`/`model` differ. See
 * anthropic.ts for the adapter contract this follows.
 */
export function createOpenAiCompatAdapter(id: Extract<AIProviderId, "openai" | "grok">, baseUrl: string, model: string): AIAdapter {
  return {
    id,
    async complete({ apiKey, system, turns }: AICompleteRequest): Promise<AICompleteResult> {
      const r = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          messages: [...(system ? [{ role: "system", content: system }] : []), ...turns],
        }),
      });
      const j = await r.json().catch(() => ({} as Record<string, unknown>));
      if (!r.ok) return { ok: false, error: errorText(j, r.status, model) };
      return { ok: true, text: (j as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content || "" };
    },
  };
}
