export * from "./types";
export * from "./router";
export { createAnthropicAdapter } from "./adapters/anthropic";
export { createGeminiAdapter } from "./adapters/gemini";
export { createOpenAiCompatAdapter } from "./adapters/openaiCompatible";

import type { AIAdapter } from "./types";
import { createAnthropicAdapter } from "./adapters/anthropic";
import { createGeminiAdapter } from "./adapters/gemini";
import { createOpenAiCompatAdapter } from "./adapters/openaiCompatible";

/** The four fetch-based cloud adapters, in `AI_PROVIDERS` order. Does not include a "local" adapter — see docs/architecture/ai-engine.md. */
export function createCloudAdapters(): AIAdapter[] {
  return [
    createAnthropicAdapter(),
    createGeminiAdapter(),
    createOpenAiCompatAdapter("openai", "https://api.openai.com/v1", "gpt-4o-mini"),
    createOpenAiCompatAdapter("grok", "https://api.x.ai/v1", "grok-3-mini"),
  ];
}
