import type { AIAdapter, AICompleteRequest, AICompleteResult, AIProviderId } from "../types";

const MAX_TOKENS = 900;

// OpenAI nests error text as `{error:{message}}`; Grok (xAI) sometimes sends
// the plain-string form `{error:"..."}` instead — handle both.
function errorText(j: { error?: string | { message?: string } }, status: number, model: string): string {
  const e = j?.error;
  return (typeof e === "string" ? e : e?.message) || `${model} error ${status}`;
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
