import { AI_PROVIDERS, type AIAdapter, type AICompleteRequest, type AICompleteResult, type AIProviderId, type AIStreamResult, type ProviderKeys } from "./types";

/** Configured providers, `preferred` first if it has a key — the order they're tried in. Empty if none configured. */
export function orderedProviders(keys: ProviderKeys, preferred?: AIProviderId | null): AIProviderId[] {
  const configured = AI_PROVIDERS.filter((p) => keys[p]);
  if (!configured.length) return [];
  const first = preferred && configured.includes(preferred) ? preferred : configured[0];
  return [first, ...configured.filter((p) => p !== first)];
}

export interface AIRouterResult extends AICompleteResult {
  source: AIProviderId | null;
  /** Comma-joined display of providers that failed before `source` answered. */
  fellBackFrom?: string;
}

export interface AIStreamRouterResult extends AIStreamResult {
  source: AIProviderId | null;
  fellBackFrom?: string;
}

type StreamCallArgs = Omit<Parameters<NonNullable<AIAdapter["stream"]>>[0], "apiKey">;

/**
 * Tries configured providers in fallback order and returns the first one
 * that actually answers, so a single provider being out of credit or
 * rate-limited doesn't take a caller down outright. All provider-specific
 * request/response shaping lives inside each `AIAdapter` — the router only
 * knows the fallback contract, never a provider's wire format.
 */
export class AIRouter {
  constructor(private readonly adapters: AIAdapter[]) {}

  private adapter(id: AIProviderId): AIAdapter | undefined {
    return this.adapters.find((a) => a.id === id);
  }

  async complete(req: Omit<AICompleteRequest, "apiKey">, keys: ProviderKeys, preferred?: AIProviderId | null): Promise<AIRouterResult> {
    const failed: AIProviderId[] = [];
    for (const id of orderedProviders(keys, preferred)) {
      const adapter = this.adapter(id);
      if (!adapter) continue;
      try {
        const r = await adapter.complete({ ...req, apiKey: keys[id]! });
        if (r.ok) return { ...r, source: id, fellBackFrom: failed.length ? failed.join(", ") : undefined };
      } catch {
        // fall through to the next configured provider
      }
      failed.push(id);
    }
    return {
      ok: false,
      source: null,
      error: failed.length ? `All configured providers failed (tried: ${failed.join(", ")})` : "No AI provider configured",
    };
  }

  /** Same fallback contract as `complete`, but only considers adapters that implement `stream`. */
  async stream(req: StreamCallArgs, keys: ProviderKeys, preferred?: AIProviderId | null): Promise<AIStreamRouterResult> {
    const failed: AIProviderId[] = [];
    for (const id of orderedProviders(keys, preferred)) {
      const adapter = this.adapter(id);
      if (!adapter?.stream) continue;
      try {
        const r = await adapter.stream({ ...req, apiKey: keys[id]! });
        if (r.ok || r.emitted) return { ...r, source: id, fellBackFrom: failed.length ? failed.join(", ") : undefined };
      } catch {
        // fall through to the next configured provider
      }
      failed.push(id);
    }
    return {
      ok: false,
      source: null,
      error: failed.length ? `All configured providers failed (tried: ${failed.join(", ")})` : "No streaming-capable AI provider configured",
    };
  }
}
