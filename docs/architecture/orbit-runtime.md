# Orbit Runtime

## Purpose

Four engines exist (AI, Integration, Event, Knowledge), each built with real, working infrastructure but deliberately left unwired from the live app — opt-in, exercised by tests, not actually running anywhere. Orbit Runtime is the composition root that changes that: it constructs, wires, and exposes all four engines as singletons so the application — and React components specifically — never construct an engine themselves.

## The two-environment reality

"A single composition root" doesn't mean one runtime, because Orbit runs in two processes with fundamentally different lifetimes:

- **The browser** is the only place with a genuine, long-lived process — the only place "singleton" and "start/stop/dispose lifecycle" mean anything real. `OrbitRuntime` (`src/runtime/OrbitRuntime.ts`) lives here.
- **Netlify functions are stateless, one invocation at a time.** There's no persistent process to hold lifecycle in. Giving server code a class with `start()`/`stop()` would imply guarantees that don't exist. The existing codebase already reflects this — `_lib/providerFetch.ts` builds its registry at module scope, reused opportunistically by a warm container but never relied on for correctness. This pass adds the same idiom for events: `netlify/functions/_lib/serverEvents.ts` exports one module-scope `EventEngine` instance, imported by the `*-api.ts` proxies and `providerFetch.ts` — not a second "runtime," just the existing pattern extended to cover events.

## Architecture (browser)

```
src/runtime/
  OrbitRuntime.ts       the composition root — constructs all four engines, owns lifecycle
  RuntimeProvider.tsx    React context + the module-level singleton + useOrbitRuntime()
  OrbitRuntime.test.ts    lifecycle/wiring tests, all dependencies injected
  index.ts               barrel
```

`OrbitRuntime`'s constructor takes optional dependency overrides (`eventStore`, `knowledgeStore`, `syncKnowledge`, `subscribeRealtime`), defaulting to the real browser implementations (`src/lib/eventsStore.ts`, `createInMemoryKnowledgeStore()`, `src/lib/knowledgeSync.ts`'s `syncFromSupabase`, `src/lib/eventsRealtime.ts`'s `subscribeDomainEvents`) — the same dependency-injection convention every engine already follows (`AIRouter` takes adapters, `EventEngine` takes a store), and what makes the Runtime testable without touching real Supabase or opening a real Realtime channel.

### What's genuinely live vs. structurally present

- **`events` and `knowledge` are genuinely live.** `start()` wires the Knowledge Engine to both local (in-process `EventEngine.subscribe`) and cross-process (Realtime, via `KnowledgeEngine.ingest()`) event delivery, then runs the direct-sync bootstrap.
- **`integrations` and `ai` are constructed for a consistent API surface** ("instantiate all engines," literally) but are **structurally inert in the browser today**: Integration Engine adapters need credentials that only exist server-side (RLS-protected tokens — the browser never holds a raw provider token), and Orbit's AI calls deliberately route through the local agent (`src/lib/ai.ts`) rather than a direct browser-to-provider fetch, which would leak API keys client-side. No browser code should call `runtime.integrations.get(id)!.checkStatus(...)` or `runtime.ai.complete(...)` — both are documented, in code comments on the class itself, as having nothing valid to call with from the browser.

## Lifecycle

- **`start()`** — idempotent (a second call while already started is a no-op), so React StrictMode's dev-mode mount→unmount→remount double-invoke can't double-subscribe. Subscribes the Knowledge Engine to both delivery paths, then runs the sync bootstrap.
- **`stop()`** — unsubscribes both feeds. Engines and their accumulated data stay intact; `start()` can be called again.
- **`dispose()`** — same effect as `stop()`, named separately to signal end-of-life intent at call sites (e.g. `RuntimeProvider`'s unmount).

## React integration

```tsx
import { RuntimeProvider, useOrbitRuntime } from "src/runtime";

// src/App.tsx — inside the authenticated area only:
<Guard><RuntimeProvider><Layout /></RuntimeProvider></Guard>

// any component under it:
const { knowledge } = useOrbitRuntime();
```

`orbitRuntime` (the module-level singleton) is constructed once at module load; `RuntimeProvider` starts it on mount and disposes it on unmount, and provides it via context. Mounted **inside** the authenticated `Guard`, not at the app root — unauthenticated pages (login, landing, invite-accept) never trigger a sync or open a Realtime channel, matching `askContext.ts`'s own session-gated pattern. This is a real, if small, behavior change to the running app: every authenticated page load now runs `syncFromSupabase` (a handful of read-only queries against `projects`/`tasks`/`tickets` — the same tables `askContext.ts` already polls) and opens one Realtime channel.

## Server-side wiring

`netlify/functions/_lib/serverEvents.ts` exports `serverEventEngine`, a module-scope `EventEngine` backed by the service-role `EventStore`. `github-api.ts`, `gitlab-api.ts`, `azuredevops-api.ts`, and `_lib/providerFetch.ts` now construct their registries with `createDefaultRegistry({ events: { engine: serverEventEngine } })` instead of the bare, event-less call from the Integration Engine pass — so `checkStatus` calls (which only ever happen server-side, since that's the only place with real provider credentials) actually publish `connected`/`disconnected`/`authentication_failed` domain events into `domain_events` for real, not just in tests.

## Responsibilities

- Own construction and wiring of the four engines for the browser.
- Own the browser-side event-delivery bridge (local + Realtime) into the Knowledge Engine.
- Does **not** own server-side composition (that stays each Netlify function's own module-scope construction, now consistently wired to `serverEventEngine`) or React component logic — components only ever read from `useOrbitRuntime()`.

## Dependencies

All four engines, plus their browser-side concrete implementations (`eventsStore.ts`, `eventsRealtime.ts`, `knowledgeSync.ts`) and React (`RuntimeProvider`/`useOrbitRuntime`).

## Current consumers

`src/App.tsx` (the only wiring point today — no route/component reaches into `OrbitRuntime` directly yet; `useOrbitRuntime()` exists and is ready to use, but nothing consumes `knowledge`/`events` for a real feature in this pass). This is intentionally the extent of this milestone: the runtime exists and is live, but no UI feature has been rebuilt on top of it yet.

## Public API

```ts
import { useOrbitRuntime } from "src/runtime";

function MyComponent() {
  const { knowledge, events } = useOrbitRuntime();
  // knowledge.query({ type: "task", text: "bug" })
  // events.subscribe({ source: "integration-engine" }, (e) => ...)
}
```

## Testing approach

`OrbitRuntime.test.ts` injects fakes for every dependency (`createInMemoryEventStore()`, `createInMemoryKnowledgeStore()`, a `vi.fn()` sync, and a controllable fake realtime subscriber that lets a test manually "deliver" an event) — no test touches real Supabase or opens a real websocket. Covers: idempotent `start()`, local event delivery, realtime event delivery via `ingest()`, `stop()` actually stopping both feeds, and `dispose()` → `start()` again (the StrictMode double-mount case).

## Future expansion

- A real feature migrated onto `useOrbitRuntime().knowledge` (e.g. a dashboard widget querying the graph instead of its own Supabase call) — the first actual consumer beyond `App.tsx`'s wiring.
- More Event Engine publishers (as other engines/mutation paths adopt it) flowing through the same local + realtime bridge already built here, with no changes to `OrbitRuntime` itself needed.
- If `integrations`/`ai` ever need to be genuinely callable from the browser (e.g. a lightweight status-only endpoint that hands the browser a short-lived scoped token), that's a deliberate future decision — not something this Runtime does today.
