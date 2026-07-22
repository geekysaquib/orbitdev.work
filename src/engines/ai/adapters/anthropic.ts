import type { AIAdapter, AICompleteRequest, AICompleteResult } from "../types";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 900;

/**
 * Fetch-based Anthropic adapter — works anywhere with a global `fetch`
 * (Netlify functions, browser). agent/server.mjs currently talks to
 * Anthropic via the `@anthropic-ai/sdk` package instead (for streaming
 * support); its migration to this same `AIAdapter` interface is documented
 * in docs/architecture/ai-engine.md.
 */
export function createAnthropicAdapter(): AIAdapter {
  return {
    id: "anthropic",
    async complete({ apiKey, system, turns }: AICompleteRequest): Promise<AICompleteResult> {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system, messages: turns }),
      });
      const j = await r.json().catch(() => ({} as Record<string, unknown>));
      if (!r.ok) {
        const error = (j as { error?: { message?: string } }).error;
        return { ok: false, error: error?.message || `anthropic error ${r.status}` };
      }
      const content = (j as { content?: { type: string; text?: string }[] }).content;
      return { ok: true, text: content?.find((b) => b.type === "text")?.text || "" };
    },
  };
}
