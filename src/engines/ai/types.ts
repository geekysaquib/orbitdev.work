/**
 * Shared contract for the AI Engine (see docs/architecture/ai-engine.md).
 * Every model provider is an `AIAdapter` implementing this interface — no
 * caller should hand-roll a provider-specific request/response shape.
 */

export type AIProviderId = "anthropic" | "gemini" | "openai" | "grok";
export const AI_PROVIDERS: AIProviderId[] = ["anthropic", "gemini", "openai", "grok"];

/** One entry per provider a caller can hold a key for. Missing/empty = not configured. */
export interface ProviderKeys {
  anthropic?: string | null;
  gemini?: string | null;
  openai?: string | null;
  grok?: string | null;
}

export interface AITurn {
  role: "user" | "assistant";
  content: string;
}

export interface AICompleteRequest {
  apiKey: string;
  system?: string;
  turns: AITurn[];
}

export interface AICompleteResult {
  ok: boolean;
  text?: string;
  error?: string;
}

export interface AIStreamRequest extends AICompleteRequest {
  onDelta: (chunk: string) => void;
  signal?: AbortSignal;
}

export interface AIStreamResult {
  ok: boolean;
  error?: string;
  /** Tokens were already emitted via onDelta before this failed — a caller must not retry (would duplicate them). */
  emitted?: boolean;
}

/**
 * One implementation per model provider. `stream` is optional — adapters
 * that only ever run one-shot (e.g. a serverless/cron context with no
 * persistent connection to stream over) can omit it; the router simply
 * skips non-streaming adapters when `stream()` is called.
 */
export interface AIAdapter {
  readonly id: AIProviderId;
  complete(req: AICompleteRequest): Promise<AICompleteResult>;
  stream?(req: AIStreamRequest): Promise<AIStreamResult>;
}
