# Integration Engine

## Purpose

Orbit talks to a growing list of external systems: source control (GitHub, GitLab, Azure DevOps), issue trackers (Zoho Sprints, eventually Jira), observability (Sentry), chat (MS Teams, eventually Slack), cloud accounts (Netlify, Vercel, AWS), and AI providers (see [ai-engine.md](./ai-engine.md)). Before this engine, each one was its own isolated, hand-rolled integration — worse, the *same* provider was often reimplemented twice: `netlify/functions/{github,gitlab,azuredevops}-api.ts` (browser-facing, JWT-gated proxies) each duplicated the exact REST calls that `netlify/functions/_lib/providerFetch.ts` reimplemented independently for cron, because scheduled functions have no caller JWT to route through the JWT-gated proxies.

The Integration Engine (`src/engines/integrations/`) is Orbit's single abstraction layer for *every* external system, not just Git providers. It follows the same adapter + shared-contract shape as the [AI Engine](./ai-engine.md) (this codebase's reference implementation for engine structure and adapter design), generalized with a **capability model** so heterogeneous systems — a source-control provider and a chat tool do fundamentally different things — can still share one registration/resolution/credential/telemetry story instead of each other's leftover abstractions.

## Architecture

```
src/engines/integrations/
  types.ts                 IntegrationAdapter core contract, capability kinds,
                            auth/context/result types, CredentialManager
                            interface, event model, telemetry hooks
  registry.ts                IntegrationRegistry — registration, resolution,
                              capability filtering, telemetry instrumentation
  capabilities/
    scm.ts                    ScmAdapter — the one capability with real
                               adapters today
  adapters/
    github.ts                  fetch-based GitHub ScmAdapter
    gitlab.ts                   fetch-based GitLab ScmAdapter
    azuredevops.ts               fetch-based Azure DevOps ScmAdapter
  index.ts                  barrel + createDefaultRegistry() convenience factory

netlify/functions/_lib/
  credentialManager.ts      server-side CredentialManager implementations
                            (the only code allowed to read provider_connections/
                            integrations row shapes)
```

### The core contract vs. capabilities

Unlike the AI Engine — where every adapter does the same one thing ("complete a prompt") — integrations are heterogeneous: GitHub lists pull requests, Sentry lists issues, Teams sends messages. Forcing all of that into one fixed interface would leave most methods `N/A` for most adapters. Instead:

- **`IntegrationAdapter`** is the minimal contract *every* adapter implements: `id`, `displayName`, `capabilities` (what it can do), `checkStatus()` (a cheap reachability/credential check).
- **Capability interfaces** (`ScmAdapter` today; `IssueTrackerAdapter`/`CiCdAdapter`/`MonitoringAdapter`/`ChatAdapter`/`DatabaseAdapter` are the next intended slots, see Migration strategy) extend `IntegrationAdapter` and add the operations specific to that family. An adapter implements only the capabilities relevant to what it actually is.
- `capabilities: IntegrationCapabilityKind[]` on every adapter is the single source of truth both the registry's `listByCapability()` and type guards like `isScmAdapter()` check — the declared list and the actual TypeScript narrowing can't drift apart, because the guard *is* `adapter.capabilities.includes("scm")`.

## Adapter lifecycle

1. **Construct** — a factory function (`createGithubAdapter()`) returns a plain object literal implementing `IntegrationAdapter` plus whichever capability interfaces apply. Adapters are stateless and environment-agnostic (only global `fetch`), same rule as the AI Engine's adapters — the same adapter code runs in a Netlify function today and could run in the browser or the local agent tomorrow.
2. **Register** — `registry.register(adapter)` adds it to an `IntegrationRegistry`, keyed by `id`. Throws if that id is already registered (catches accidental double-registration, not a runtime "last one wins" surprise).
3. **Resolve** — a caller asks the registry for what it needs: `registry.get(id)` (exact adapter), `registry.getCapable(id, isScmAdapter)` (adapter narrowed to a capability, `undefined` if it doesn't implement it), or `registry.listByCapability("scm")` (every adapter that does SCM, regardless of which providers exist). No caller ever branches on provider id to decide what to do.
4. **Call** — the caller builds an `IntegrationContext` (via a `CredentialManager`, never by hand) and invokes a capability method: `adapter.listPulls(ctx, repoFullName)`.
5. **(Future) Emit** — an adapter or its caller would emit an `IntegrationEvent` (connected, sync completed, rate limited, ...) through a dispatcher. Not wired yet — see Event model below.

## Registration mechanism

`createDefaultRegistry()` in `index.ts` is the composition root: it constructs the registry and registers today's three SCM adapters. Adding a new integration is **one new adapter file plus one `register()` call** — never editing a shared switch statement. A caller that only ever needs one adapter can also import its factory directly (`createGithubAdapter()`) and skip the registry entirely; the registry exists for callers that need to resolve *by id* or *by capability* at runtime (e.g. `providerFetch.ts`, which is handed a `RepoProvider` string and needs whichever adapter matches it).

## Authentication flow

Every adapter method takes an `IntegrationContext { auth, config }` — normalized credentials plus provider-specific extras (self-hosted `base_url`, org/tenant id). Adapters and their callers **never** read `provider_connections` or `integrations` directly; a `CredentialManager` is the only thing that does.

```ts
interface CredentialManager {
  getContext(integrationId: IntegrationId, principal: CredentialPrincipal): Promise<IntegrationContext | null>;
}
type CredentialPrincipal =
  | { kind: "request"; authHeader: string | null }  // browser call, RLS-scoped to the caller's own JWT
  | { kind: "service"; userId: string };              // cron/scheduled function, service-role key
```

`CredentialPrincipal` mirrors the two access patterns already used throughout `netlify/functions`: a browser request carrying the caller's own JWT (reads scoped by Postgres RLS), or a scheduled job acting as a specific user via the service-role key (no caller JWT exists). Concrete implementations live server-side in `netlify/functions/_lib/credentialManager.ts` (not in `src/engines/integrations`, which stays environment-agnostic) because they touch either a raw JWT or the service-role key:

- **`ProviderConnectionsCredentialManager`** — backs github/gitlab/azuredevops/sentry/msteams/netlify/vercel/aws, the multi-row-per-user `provider_connections` table (one row per provider per user, `access_token`/`config` columns).
- **`IntegrationsTableCredentialManager`** — backs the AI providers' keys (anthropic/gemini/openai/grok), the singular-per-user `integrations` table (one row per user, a flat column per provider). Zoho's credential (a client_id/secret/refresh_token triple needing a live OAuth refresh call — see `_lib/zohoAuth.ts`) doesn't fit a static-token `IntegrationContext` and isn't wired in here yet; that belongs in a future Zoho adapter that does its own refresh, not this abstraction.
- **`CompositeCredentialManager`** — the *one* place that knows the credential store is split across two tables. It picks a backend per `integrationId`. If the tables are ever unified, only this composite changes; every adapter, proxy, and cron wrapper is unaffected because they only ever call `getContext()`.

Today's `*-api.ts` proxies (`github-api.ts`, `gitlab-api.ts`, `azuredevops-api.ts`) use the `request`-principal path. `netlify/functions/_lib/providerFetch.ts` (used by `daily-brief.ts`/`anomaly-scan.ts`) is a special case: those cron functions already batch-load *all* of a user's `provider_connections` rows themselves in one query (covering github/gitlab/azuredevops/sentry at once) and hand the resulting token/config straight to `providerFetch.ts`'s functions as parameters — so there's no separate credential lookup for that file to perform, and it doesn't call `CredentialManager` (which matters when *fetching* a credential from storage, not when one has already been handed to you).

## Event model

```ts
type IntegrationEventType =
  | "connected" | "disconnected"
  | "sync_started" | "sync_completed"
  | "token_refreshed"
  | "webhook_received"
  | "rate_limited"
  | "authentication_failed";
interface IntegrationEvent { integrationId: IntegrationId; type: IntegrationEventType; occurredAt: string; meta?: Record<string, unknown>; }
```

**Not wired to a dispatcher in this pass.** There is no existing event bus or pub/sub in the codebase — today's `audit_log` and `notifications` tables are written to directly, ad hoc, from dozens of call sites (e.g. `src/components/GithubSetupPanel.tsx` calls `recordAudit({action: "integration.connect", ...})` after a successful connect; cron functions `dbInsert` into `notifications` directly). Building a real dispatcher and migrating those call sites to it is a separate, non-incremental change — out of scope here. The type is defined now so future adapter code has a contract to target; the concrete next step is a dispatcher that becomes the *one* writer for both tables, superseding today's scattered direct inserts (consistent with how the AI Engine consolidated three duplicate fallback loops into one router).

## Telemetry hooks

```ts
interface IntegrationTelemetry {
  onCallStart?(info: { integrationId: IntegrationId; operation: string }): void;
  onCallEnd?(info: { integrationId: IntegrationId; operation: string; ok: boolean; durationMs: number; status?: number }): void;
  onRateLimited?(info: { integrationId: IntegrationId; retryAfterMs?: number }): void;
}
```

Unlike the event model, this is real and working today, not just documented: `new IntegrationRegistry({ telemetry })` wraps every method of an adapter it resolves (via `get`/`getCapable`) with start/end timing calls into the sink — a generic decorator over whatever methods the adapter happens to expose, so it works for any capability without per-capability instrumentation code. `ok` is read from either an `IntegrationResult.ok` or an `IntegrationStatus.connected` return shape, covering both kinds of methods adapters expose. A registry constructed without a telemetry sink (`createDefaultRegistry()`, today's default) behaves identically to one with no instrumentation at all — zero overhead, zero behavior change. No sink is wired up to a real metrics backend yet; this is the seam a future health-monitoring/latency/rate-limit dashboard would plug into.

## Responsibilities

- Own the capability model (`IntegrationCapabilityKind`, capability interfaces) and the core adapter contract.
- Own adapter registration and resolution (`IntegrationRegistry`) — by id or by capability, never a hardcoded switch.
- Own the shape credentials arrive in (`IntegrationContext`, `CredentialManager`) — never own where they're stored.
- Own the (currently undispatched) event and telemetry contracts.
- Does **not** own: UI/Settings-panel connect flows, OAuth authorization-code exchange (`*-exchange.ts` functions), or provider-specific request/response shaping outside an adapter's own file.

## Dependencies

`src/engines/integrations/*` (the engine itself): none beyond global `fetch`, same as the AI Engine. `netlify/functions/_lib/credentialManager.ts` (server-only): `_lib/providerConnections.ts`, `_lib/db.ts` — the same JWT/service-role primitives every other Netlify function already uses.

## Current consumers

- **`netlify/functions/{github,gitlab,azuredevops}-api.ts`** — browser-facing JWT-gated proxies. Each resolves credentials via `credentialManager.getContext(id, {kind:"request", authHeader})`, then calls the matching `ScmAdapter`. HTTP response JSON is byte-identical to the pre-engine versions (verified mode-by-mode), including provider-specific quirks like Azure DevOps' live-status-check vs. GitHub/GitLab's cheap token-presence check.
- **`netlify/functions/_lib/providerFetch.ts`** — thin wrapper preserving its exact pre-engine exports (`fetchOpenPulls`, `fetchRecentRuns`, `fetchCommitCountSince`, `fetchSentryUnresolvedCount`, `type RepoProvider`) so `daily-brief.ts`/`anomaly-scan.ts` needed no changes. Backed by `createDefaultRegistry()`'s SCM adapters; `fetchSentryUnresolvedCount` stays hand-written REST (no Sentry adapter yet).

## Public API

```ts
import { createDefaultRegistry, isScmAdapter } from "src/engines/integrations";

const registry = createDefaultRegistry();
const github = registry.getCapable("github", isScmAdapter)!;
const result = await github.listPulls(ctx, "org/repo");
// result: { ok, data?: ScmPull[], error?, status? }
```

To add a new SCM provider (e.g. Bitbucket): write `adapters/bitbucket.ts` exporting `createBitbucketAdapter(): ScmAdapter` with `capabilities: ["scm"]`, add its id to `PROVIDER_CONNECTIONS_IDS`-equivalent handling in `credentialManager.ts` if it's stored there, and register it in `createDefaultRegistry()`. No registry, capability-guard, or call-site changes required.

To add a new *capability* (e.g. `ChatAdapter` for Slack/Teams): define the interface in `capabilities/chat.ts` extending `IntegrationAdapter`, add `"chat"` to `IntegrationCapabilityKind`, write a matching `isChatAdapter` guard, and adapters/callers use `registry.listByCapability("chat")` / `registry.getCapable(id, isChatAdapter)` exactly like SCM does today.

## Migration strategy

This pass migrates only the SCM family (GitHub/GitLab/Azure DevOps) end-to-end, matching the project's incremental, don't-rewrite-working-code policy. Deliberately **not** touched:

- **Sentry** (`sentry-api.ts`) — next natural `MonitoringAdapter` candidate; same shape of duplication risk if a cron consumer is ever added for it.
- **MS Teams** (`msteams-api.ts`, `msteams-exchange.ts`) — would become the first `ChatAdapter`, and the first adapter needing token-refresh-before-call (its `ensureFreshToken()` pattern) as part of its `checkStatus`/call lifecycle, not just static-token auth.
- **Zoho Sprints** (`zoho-sprints.ts`, `_lib/zohoAuth.ts`) — first `IssueTrackerAdapter` candidate; its OAuth-refresh credential shape needs `CredentialManager`/`IntegrationContext` to grow slightly (or the adapter itself owns the refresh, using `config` as the client_id/secret/refresh_token carrier) — a design decision for when that migration actually happens, not resolved speculatively here.
- **Netlify/Vercel/AWS** (`cloud-api.ts`) — Netlify/Vercel fit the existing bearer-token `ScmAdapter`-adjacent shape; AWS's SigV4 signing doesn't fit `IntegrationAuth`'s bearer/basic/apiKey kinds and would need either a fourth auth kind or to stay a special case.
- **AI providers** — the [AI Engine](./ai-engine.md) already solves this family well and is not being folded in or rewritten. Structurally, `AIAdapter` already has the right shape to become an `"ai"`-capability `IntegrationAdapter` later (`id`, and a `complete`/`stream` pair analogous to a capability's methods) — a future step could register AI adapters in this same `IntegrationRegistry` for uniform discovery, without changing how the AI Engine itself works internally.
- **Event dispatcher** — see Event model above.

## Future expansion

- New provider within an existing capability (Bitbucket, Jira, Slack): one adapter file, one registration line.
- New capability family: one capability-interface file, one `IntegrationCapabilityKind` addition, one type guard — existing adapters/capabilities are unaffected.
- A real event dispatcher becoming the single writer for `audit_log`/`notifications`, replacing today's scattered direct inserts.
- A telemetry sink wired to an actual metrics backend, using the hooks already in place in `IntegrationRegistry`.
- `DatabaseAdapter` capability, giving Orbit's own Postgres-schema/backup tooling (`Postgres` route, `/pg/*` agent endpoints) the same adapter shape as everything else instead of being bespoke.
