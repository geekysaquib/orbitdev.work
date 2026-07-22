# AI Engine

## Purpose

Orbit talks to four cloud model providers (Anthropic, Gemini, OpenAI, Grok) plus a local llama-cpp model, from three different runtimes: the browser, a local companion agent process (`agent/server.mjs`), and Netlify scheduled functions (cron). Before this engine existed, "call a provider and fall back to the next one on failure" was implemented three separate times, once per runtime, each hand-rolling its own request shaping, error parsing, and fallback loop — `agent/server.mjs`'s `anthropicComplete`/`geminiComplete`/`openAiCompatComplete`, `netlify/functions/_lib/aiProviders.ts`'s now-removed duplicate of the same three functions, and `src/lib/ai.ts`'s `orderedProviders`/`runChain`. The three implementations already disagreed slightly (e.g. duplicated `CLOUD_PROVIDERS` arrays, near-identical but independently-maintained error message extraction).

The AI Engine (`src/engines/ai/`) is the single place that defines: what a "provider" is, what calling one looks like, and how fallback across configured providers works. Every current and future AI-provider integration is a small adapter conforming to one interface — adding a fifth provider means writing one adapter file, not touching call sites or fallback logic.

## Architecture

```
src/engines/ai/
  types.ts               AIAdapter interface + shared request/result types
  router.ts               AIRouter — fallback orchestration, provider-agnostic
  adapters/
    anthropic.ts           fetch-based Anthropic adapter
    gemini.ts               fetch-based Gemini adapter
    openaiCompatible.ts     factory for OpenAI + Grok (same wire format)
  index.ts                barrel + createCloudAdapters() convenience factory
```

- **`AIAdapter`** — the contract every provider implements: `id`, `complete(req)`, and an optional `stream(req)`. All provider-specific request shaping (auth headers, message format, error parsing) lives inside the adapter and nowhere else.
- **`AIRouter`** — takes a list of `AIAdapter`s and, given a request plus a caller's configured `ProviderKeys`, tries them in fallback order (`orderedProviders`: preferred provider first if configured, then the rest) until one succeeds. The router knows nothing about any provider's wire format — only the adapter interface.
- **Adapters are pure and environment-agnostic** — they use only global `fetch`, so the same adapter code runs in a Netlify function or a browser. They hold no state and don't know who's calling them.

## Responsibilities

- Own the definition of "what providers exist" (`AIProviderId`, `AI_PROVIDERS`) and "what order to try them in" (`orderedProviders`).
- Own provider-specific request/response shaping, one adapter per provider.
- Own fallback orchestration (`AIRouter`), so callers never write their own retry-next-provider loop.
- Does **not** own: API key storage/retrieval (callers pass in `ProviderKeys`), prompt/system-message construction (callers build the request), or UI concerns (provider display labels stay in `src/lib/ai.ts` as `PROVIDER_LABEL`, since that's presentation, not engine logic).

## Dependencies

None beyond global `fetch`. No SDK dependency (deliberately — see Migration below for why `agent/server.mjs` differs here).

## Current consumers

- **`netlify/functions/_lib/aiProviders.ts`** (daily-brief, weekly-digest cron) — the primary consumer today. It's a thin wrapper: builds an `AIRouter` over `createCloudAdapters()` and exposes the same `askAI()`/`orderedProviders()`/`CLOUD_PROVIDERS` surface it always has, so `daily-brief.ts`/`weekly-digest.ts` needed no changes. No local-model adapter is wired in here — cron has no running local agent to reach the Python worker through.
- **`src/lib/ai.ts`** (browser) — imports `CloudProvider`, `CLOUD_PROVIDERS`, `ProviderKeys`, and `orderedProviders` from this engine instead of redeclaring them, so there's one source of truth for "which providers exist." It does **not** use `AIRouter` or the adapters to make calls — the browser dispatches every provider call to the local agent over HTTP (`agentCall("/ai/ask", ...)`) rather than calling providers directly, and that dispatch-then-fallback loop (`runChain`, `askThreadStream`) is unchanged by this refactor. That loop is a candidate to eventually collapse into an `AIRouter` call once the agent exposes adapters (see Migration).

## Public API

```ts
import { AIRouter, createCloudAdapters, orderedProviders, type ProviderKeys, type AIAdapter } from "src/engines/ai";

const router = new AIRouter(createCloudAdapters());
const result = await router.complete({ system, turns: [{ role: "user", content: prompt }] }, keys, preferred);
// result: { ok, text?, error?, source, fellBackFrom? }
```

To add a fifth provider: write `adapters/<name>.ts` exporting `create<Name>Adapter(): AIAdapter`, add its id to `AIProviderId`/`AI_PROVIDERS` in `types.ts`, and include it in `createCloudAdapters()` (or construct a custom `AIRouter` with just the adapters a given caller wants).

## Migration path: `agent/server.mjs`

Deliberately **not touched** in this change. The agent is a plain `.mjs` script run directly via `node server.mjs` with no build step, so it can't `import` a TypeScript module the way Netlify functions and the browser bundle can — folding it into `src/engines/ai` verbatim isn't possible without first giving the agent a bundler step, which is a separate decision.

That said, the agent's existing code already has the right *shape* to become `AIAdapter`s with minimal changes, because the interface here was deliberately modeled on it:

| Engine concept | Agent's current equivalent |
|---|---|
| `AICompleteRequest.turns` (`{role, content}[]`) | `coerceTurns({prompt, messages})` output — same shape |
| `AIAdapter.complete({apiKey, system, turns})` | `anthropicComplete`/`geminiComplete`/`openAiCompatComplete({apiKey, system, turns})` — same signature |
| `AIAdapter.stream({apiKey, system, turns, onDelta})` | `anthropicStream`/`geminiStream`/`openAiCompatStream({..., onDelta})` — same signature |
| `AIRouter` picking an adapter by id | `cloudProvider(provider)` switch returning `{complete, stream}` |

Migrating the agent later is expected to be:

1. Wrap each existing `*Complete`/`*Stream` pair as an `AIAdapter` object (`{ id, complete, stream }`) instead of the current `cloudProvider()` switch. The Anthropic adapter will keep using `@anthropic-ai/sdk` internally (for its native streaming support) rather than switching to the fetch-based `adapters/anthropic.ts` — the interface doesn't require adapters to be fetch-based, only that they conform to `AIAdapter`.
2. Replace `cloudProvider(provider).complete(...)`/`.stream(...)` call sites in the `/ai/ask` and `/ai/ask/stream` routes with `router.complete(...)`/`router.stream(...)`.
3. Optionally wrap the local llama-cpp worker as a fifth adapter (`id: "local"`), which would let the *fallback loop itself* move server-side into the agent — collapsing `src/lib/ai.ts`'s `runChain`/`askThreadStream` (which today loops client-side, calling the agent once per provider) down to a single `agentCall("/ai/ask", { keys, preferred, ... })` that returns the already-routed result. Not required for the agent to adopt the engine, but the natural next step once it does.

This keeps the agent's runtime characteristics (long-lived process, SDK-based streaming, local model access) while converging on the same interface everything else already uses.

## Future expansion

- A fifth+ cloud provider is a new adapter file, no other changes.
- A "local" adapter (wrapping the agent's llama-cpp worker) would let the router treat local-vs-cloud as just another fallback tier instead of the special-cased "always last, not in `CLOUD_PROVIDERS`" logic `src/lib/ai.ts` has today.
- Per the top-level AI Model Routing principle (local → Gemini Flash → Claude → GPT by task complexity, not user choice), a future `AIRouter` variant could select adapters by task-complexity tier rather than by the user's configured preference order — the adapter interface doesn't need to change for that, only how a caller constructs the router/ordering.
