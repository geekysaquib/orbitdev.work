/**
 * Cron-context entry point into the shared AI Engine (src/engines/ai, see
 * docs/architecture/ai-engine.md). Netlify scheduled functions
 * (daily-brief.ts, weekly-digest.ts) have no running local agent to call —
 * unlike src/lib/ai.ts, which dispatches every provider call to the agent —
 * so this wraps the engine's fetch-based cloud adapters directly. No
 * local-model fallback exists here for the same reason: cron has no running
 * local agent to reach the Python worker through.
 */
import { AIRouter, createCloudAdapters, type AIProviderId, type ProviderKeys as EngineProviderKeys } from "../../../src/engines/ai";

export type CloudProvider = AIProviderId;
export const CLOUD_PROVIDERS: CloudProvider[] = ["anthropic", "gemini", "openai", "grok"];
export type ProviderKeys = EngineProviderKeys;

export { orderedProviders } from "../../../src/engines/ai";

const router = new AIRouter(createCloudAdapters());

/**
 * Tries the user's configured providers in fallback order and returns the
 * first one that actually answers — so one provider being out of credit or
 * rate-limited doesn't silently stop daily-brief/weekly-digest from ever
 * producing a notification again. Returns { text: null } only when every
 * configured provider failed (or none are configured).
 */
export async function askAI(
  keys: ProviderKeys, preferred: CloudProvider | null | undefined, system: string, prompt: string,
): Promise<{ text: string | null; source: CloudProvider | null }> {
  const r = await router.complete({ system, turns: [{ role: "user", content: prompt }] }, keys, preferred);
  return { text: r.ok ? r.text ?? null : null, source: r.source };
}
