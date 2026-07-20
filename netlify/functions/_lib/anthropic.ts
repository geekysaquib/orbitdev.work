/**
 * Direct Anthropic REST call for scheduled functions — NOT `src/lib/ai.ts`'s
 * `ask()`, which is client-only and can fall back to the user's local agent.
 * A cron job has no running agent to call, so callers of this helper must
 * skip users with no `integrations.anthropic_api_key` rather than falling
 * back. Extracted out of weekly-digest.ts so daily-brief.ts can reuse it too.
 */
export async function askClaude(apiKey: string, system: string, prompt: string, maxTokens = 500): Promise<string | null> {
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001", max_tokens: maxTokens,
        system, messages: [{ role: "user", content: prompt }],
      }),
    });
    const j = await r.json().catch(() => ({} as Record<string, unknown>));
    if (!r.ok) { console.error("[anthropic] call failed", j); return null; }
    const content = (j as { content?: { type: string; text?: string }[] }).content;
    return content?.find((b) => b.type === "text")?.text || null;
  } catch (e) {
    console.error("[anthropic] call threw", e);
    return null;
  }
}
