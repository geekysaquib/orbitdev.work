# Event Engine

## Purpose

Orbit now has multiple engines (AI, Integration) that each independently defined the shape of "something happened" — the Integration Engine's `IntegrationEvent` type, for instance, was built and documented but explicitly never wired to a dispatcher, because no dispatcher existed. Meanwhile the rest of the app logs "something happened" ad hoc: `recordAudit()` is called from 21 different UI call sites straight into the `audit_log` table, and cron functions insert into `notifications` directly, each with its own dedupe/shaping logic, with no shared contract between any of them.

The Event Engine (`src/engines/events/`) is Orbit's central communication backbone: one contract (`DomainEvent`) and one API (`EventEngine.publish`/`subscribe`/`replay`) every engine — AI, Integration, and whatever comes next — uses to announce things that happened, and that other code can react to, either live (in-process, or across processes via Realtime) or after the fact (replay). It does not replace `audit_log` or `notifications` in this pass — see Migration strategy.

## Architecture

```
src/engines/events/            environment-agnostic core (zero dependencies)
  types.ts                       DomainEvent, EventStore, EventHandler, EventEngineTelemetry
  engine.ts                       EventEngine — publish, subscribe, replay
  inMemoryStore.ts                 createInMemoryEventStore() — real, dependency-free EventStore
  index.ts                       barrel

src/lib/
  eventsStore.ts                browser EventStore (Supabase, RLS-scoped)
  eventsRealtime.ts              subscribeDomainEvents() — cross-process delivery via Realtime

netlify/functions/_lib/
  eventStore.ts                 server EventStore (service-role)

supabase/schema.sql             domain_events table + RLS + Realtime publication
```

Same split as the AI/Integration Engines: the core package (`src/engines/events`) has zero environment-specific dependencies — no Supabase, no Node, nothing but the `EventStore` interface it's handed. Concrete stores that actually touch a database live outside the core, one per environment, exactly like `CredentialManager`'s two backends.

## Event contract

```ts
interface DomainEvent<TPayload = Record<string, unknown>> {
  id: string;
  source: string;   // publishing engine, e.g. "integration-engine" — open string, no central union to edit
  type: string;      // engine-defined, e.g. "connected", "sync_completed"
  occurredAt: string;
  userId?: string | null;
  teamId?: string | null;
  payload: TPayload;
}
```

Events are **immutable** — the `domain_events` table (see below) has select+insert RLS policies only, no update or delete, ever, so a published event can never be edited or removed. `source`/`type` are open strings by design, same convention as `IntegrationId`: a new engine or event type never requires editing a shared union.

## Adopting the Event Engine (how an engine becomes a publisher)

The Integration Engine is the worked example (see below) — the pattern any future engine follows:

1. Get access to an `EventEngine` instance (constructed by whoever wires the two together — a Netlify function, the app's bootstrap, etc.).
2. Call `engine.publish({ source: "<your-engine>", type: "<your-event>", occurredAt: new Date().toISOString(), payload: {...} })` at the moment something worth announcing happens.
3. **Fire-and-forget.** A publish call must never be able to break the caller's primary request path — the same principle `src/lib/audit.ts`'s `recordAudit()` already documents for itself ("never let this break the caller's flow"). Don't `await` a publish call inline in a response path; call it, `.catch()` the rejection into telemetry, and move on.
4. Nothing else in the engine's existing API changes. Callers who don't pass an `EventEngine` in get identical behavior to before — this is how "adopt incrementally without breaking compatibility" holds for every future adopter, not just this pass's one example.

### Worked example: the Integration Engine

`IntegrationRegistry`'s constructor (`src/engines/integrations/registry.ts`) takes an optional `events?: { engine: EventEngine; source?: string }` alongside the existing `telemetry?`. When configured, the registry's `instrument()` wrapper — the same generic per-method wrapper already used for telemetry — additionally publishes after a **`checkStatus()`** call resolves:

| `IntegrationStatus` | `DomainEvent.type` |
|---|---|
| `connected: true` | `"connected"` |
| `connected: false`, `error` set | `"authentication_failed"` |
| `connected: false`, no `error` | `"disconnected"` |

Payload: `{ integrationId, account, error }`. Only `checkStatus` publishes — not `listPulls`/`listRuns`/etc. — because those can be called frequently for dashboard polling, and a durable event row per call would make `domain_events` grow unboundedly for no benefit; `checkStatus` is inherently low-frequency (a Settings-page check, a connection-status read). The publish call is fire-and-forget (`void engine.publish(...).catch(() => {})`) so a `*-api.ts` proxy's status response can never fail because an event row failed to write. `createDefaultRegistry()` — used by every existing caller today — is completely unaffected unless a caller explicitly opts in by passing `events`.

This is a *translation* at the registry boundary, not a change to the Integration Engine's own `IntegrationEvent`/`IntegrationEventType` (already shipped, still independently documented) — those types are untouched; the registry constructs a `DomainEvent` independently when an `events` sink is configured.

## Subscribers: in-process vs. cross-process

Two genuinely different mechanisms exist, for two genuinely different needs:

- **`EventEngine.subscribe({ source?, type? }, handler)`** — in-process only. A handler registered on one `EventEngine` instance only ever sees events published through that *same instance*, in the *same running process*. This is instant and cheap, but a Netlify function's subscribers never see events published by another invocation or by the browser — each invocation is a fresh process with its own `EventEngine` instance (if any).
- **`subscribeDomainEvents({ source?, type? }, onEvent)`** (`src/lib/eventsRealtime.ts`, browser-only) — cross-process, via Supabase Realtime over the `domain_events` table's insert stream. This is a direct generalization of `src/lib/activity.ts`'s `subscribeTeamActivity()`, which already proves this exact mechanism in production for the team activity feed. This is the piece that actually delivers on "communication backbone": a browser tab reacting live to an event published by a Netlify function, a cron job, or another tab. One caveat inherited from Realtime itself: its `postgres_changes` filter supports one column condition, not a compound AND (same constraint `subscribeTeamActivity`'s single `team_id=eq.` filter already has) — `source` narrows at the transport level, `type` (if given) is re-checked client-side in the callback.

## Replay

```ts
engine.replay({ source?, type?, since?, limit? }, handler): Promise<number>
```

Reads historical rows from the `EventStore` (`listSince`, oldest first) and feeds them to `handler` — for a subscriber catching up after being offline, or for rebuilding derived state from the durable log. Replayed events go only to the given `handler`, not to other live subscribers, and are never re-appended. This only works because events are durable and immutable in the first place (§ Event contract) — an in-memory-only event bus couldn't offer this at all.

## Telemetry hooks

```ts
interface EventEngineTelemetry {
  onPublish?(event: DomainEvent): void;
  onPublishError?(info: { event: Omit<DomainEvent, "id">; error: unknown }): void;
  onSubscriberError?(info: { event: DomainEvent; error: unknown }): void;
}
```

Passed to `new EventEngine(store, telemetry)`. Unlike the Integration Engine's telemetry hooks (defined but not yet exercised by any real caller), these are exercised today: the Integration Engine wiring above hits `onPublishError` if a fire-and-forget publish fails. No sink is wired to a real metrics backend yet — this is the seam a future health-monitoring/latency dashboard plugs into, same posture as the Integration Engine's telemetry.

## Durable store & RLS

New table, `domain_events`, modeled directly on `audit_log`'s already-proven append-only shape (owner select/insert, team-member select when `team_id` is set, no update/delete policy ever) — see `supabase/schema.sql` and the corresponding entry appended to `supabase/migrations.sql`. **Not applied to the live database by this change** — per this project's standing constraint (no live Supabase access from the coding agent), the user needs to run the migration themselves.

**Why a new table instead of reusing `audit_log`/`notifications`:** the three serve different purposes despite superficial similarity (all are "append-only, timestamped, jsonb payload"):

| Table | Purpose | Audience |
|---|---|---|
| `audit_log` | Who did what, for accountability | Humans (Audit Log page, team activity feed) |
| `notifications` | What should this user know about | The specific user (inbox) |
| `domain_events` | What happened, for other code to react to | Other engines/subscribers |

Forcing domain events into either existing table would corrupt its established meaning (and its RLS/consumers, which assume a specific shape). Both `audit_log` and `notifications` are already in the `supabase_realtime` publication and follow the identical RLS pattern `domain_events` now reuses — this table isn't a new *kind* of infrastructure, just a new instance of a pattern the project already trusts.

## Responsibilities

- Own the domain event contract (`DomainEvent`) and the publish/subscribe/replay API.
- Own nothing about *what* an event means — that's entirely up to the publishing engine (`source`/`type`/`payload` are opaque to `EventEngine` itself).
- Does **not** own credential storage, UI notification rendering, or the audit trail — those stay exactly as they are.

## Dependencies

`src/engines/events/*` (core): none. `src/lib/eventsStore.ts`/`eventsRealtime.ts` (browser): the existing `supabase` client. `netlify/functions/_lib/eventStore.ts` (server): `_lib/db.ts`'s service-role primitives, same as every other server-side store in this codebase.

## Current consumers

- **Integration Engine** (`IntegrationRegistry`'s optional `events` sink) — see Worked example above. Opt-in; no existing caller of `createDefaultRegistry()` is affected.
- Nothing else publishes yet. `recordAudit()` and the cron functions' `notifications` inserts are unchanged and continue to be the operative mechanism for their respective purposes.

## Public API

```ts
import { EventEngine, createInMemoryEventStore } from "src/engines/events";
import { eventStore } from "src/lib/eventsStore"; // or netlify/functions/_lib/eventStore for server code

const events = new EventEngine(eventStore);
const unsubscribe = events.subscribe({ source: "integration-engine" }, (e) => console.log(e.type, e.payload));
await events.publish({ source: "my-engine", type: "something_happened", occurredAt: new Date().toISOString(), payload: {} });
await events.replay({ source: "integration-engine", since: lastSeenIso }, handleCatchUpEvent);
```

## Migration strategy

- **AI Engine as the next publisher**, wired the same optional/fire-and-forget way — e.g. `AIRouter` publishing `"fallback_occurred"` when a preferred provider fails over to the next configured one. Not done in this pass; the Integration Engine is deliberately the only worked example, to keep this change reviewable.
- **`audit_log`/`notifications` convergence** — the natural longer-term step (already flagged in `docs/architecture/integration-engine.md`'s Event model section, now given a concrete home) is a subscriber on `EventEngine` that becomes the single writer behind both tables, superseding today's ~24 scattered direct-insert call sites. Not started here — those call sites are unaffected and continue to work exactly as they do today.
- **More adapters/capabilities publishing beyond `checkStatus`** — e.g. a future `sync_completed`/`rate_limited` event from a capability method, once there's a real need and a plan for keeping `domain_events`' growth bounded (batching, sampling, or a retention policy) for high-frequency operations.

## Future expansion

- A real subscriber that projects `domain_events` into `audit_log`/`notifications` (or replaces them).
- A telemetry sink wired to an actual metrics backend, using the hooks already in place.
- Server-side publishers (cron functions) using `netlify/functions/_lib/eventStore.ts`'s `ServiceRoleEventStore` — built and available, not yet exercised by a real cron call site.
- AI Engine, and any future engine, becoming publishers via the same optional/fire-and-forget pattern documented above.
