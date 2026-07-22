import type { AIAdapter, AICompleteRequest, AICompleteResult, AITurn } from "../types";

const MODEL = "gemini-3.6-flash";
const MAX_OUTPUT_TOKENS = 900;

function geminiContents(turns: AITurn[]) {
  return turns.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] }));
}

/** Fetch-based Gemini adapter — see anthropic.ts for the adapter contract this follows. */
export function createGeminiAdapter(): AIAdapter {
  return {
    id: "gemini",
    async complete({ apiKey, system, turns }: AICompleteRequest): Promise<AICompleteResult> {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: geminiContents(turns),
            // These are short, bounded Q&A/action answers (same tier intent as the other
            // providers' fast/cheap models, none of which reason by default) — gemini-3
            // models default to "medium" thinking, which spends the output budget on hidden
            // reasoning before ever writing a visible answer, so turn it off.
            generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, thinkingConfig: { thinkingLevel: "minimal" } },
            ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          }),
        },
      );
      const j = await r.json().catch(() => ({} as Record<string, unknown>));
      if (!r.ok) {
        const error = (j as { error?: { message?: string } }).error;
        return { ok: false, error: error?.message || `gemini error ${r.status}` };
      }
      type GeminiResponse = {
        candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
        promptFeedback?: { blockReason?: string };
      };
      const g = j as GeminiResponse;
      const text = g.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
      if (!text) {
        // Google can report success with zero content — safety-filtered, truncated
        // before any output (MAX_TOKENS), or the whole prompt blocked pre-generation.
        // Without this, that looks identical to "the model said nothing."
        const reason = g.candidates?.[0]?.finishReason || g.promptFeedback?.blockReason;
        return { ok: false, error: reason ? `Gemini returned no text (${reason})` : "Gemini returned no text" };
      }
      return { ok: true, text };
    },
  };
}
