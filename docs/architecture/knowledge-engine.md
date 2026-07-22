# Knowledge Engine

## Purpose

The user's long-term vision for Orbit's AI architecture is a pipeline:

```
Integrations → Event Engine → Knowledge Engine → AI Engine → User
```

where the Knowledge Engine is the single owner of entities, relationships, embeddings, semantic retrieval, and context construction — and AI never queries integrations or databases directly when the Knowledge Engine can answer from its own maintained view. This is meant to be Orbit's clearest differentiator versus a generic project-management tool: not "an app with an AI chat bolted on," but a system that actually understands its own workspace.

This document also has to be honest about where the codebase is today (see **Transitional architecture** below): the Event Engine currently has exactly one real publisher, and Ask AI's existing context builder (`src/lib/askContext.ts`) still queries Supabase directly and is untouched by this engine. The Knowledge Engine (`src/engines/knowledge/`) ships as real, working infrastructure — entity/relationship model, graph query API, traversal, a context-builder interface, Event Engine subscription — but adopting it as *the* thing AI queries is a future migration phase, not something this pass claims to have completed.

## Architecture

```
src/engines/knowledge/          environment-agnostic core (zero dependencies beyond the Event Engine's types)
  types.ts                        Entity, Relationship, KnowledgeStore, KnowledgeQuery,
                                   ContextRequest/Result, EventEntityMapper,
                                   EmbeddingProvider/SearchProvider (deferred), KnowledgeTelemetry
  engine.ts                        KnowledgeEngine — query, traversal, context building, event subscription
  inMemoryStore.ts                  createInMemoryKnowledgeStore() — the one real KnowledgeStore this pass
  mappers/
    integrationEvents.ts             the one real Event Engine → graph mapper (Integration Engine's events)
  index.ts                        barrel

src/lib/
  knowledgeSync.ts                syncFromSupabase() — the direct-synchronization half of the hybrid model
```

Same shape as the other three engines: a small core contract, a pluggable store (`KnowledgeStore`), and concrete implementations that live outside the core. `KnowledgeEngine` depends only on the `KnowledgeStore` interface and, for event subscription, the Event Engine's `EventEngine`/`DomainEvent` types — it has no built-in knowledge of Supabase, Zoho, or any specific integration.

## Entity / relationship model

```ts
type EntityType = string;   // open — "project" | "task" | "ticket" | "integration" today
interface EntityRef { type: EntityType; id: string; }
interface Entity<TAttrs = Record<string, unknown>> {
  ref: EntityRef; label: string; attributes: TAttrs; updatedAt: string;
}
type RelationType = string; // open — "belongs_to" today
interface Relationship { from: EntityRef; type: RelationType; to: EntityRef; }
```

`EntityType`/`RelationType` are open strings, same "no central union to edit" convention as `IntegrationId` — the target Knowledge Graph vocabulary is large (workspace, project, sprint, task, developer, repository, commit, branch, pull request, deployment, release, notification, database, machine, AI conversation — see the project's architecture guidelines), and only a handful of those exist as real entities today (see Current consumers).

## `KnowledgeStore`

```ts
interface KnowledgeStore {
  upsertEntity(entity: Entity): Promise<void>;
  upsertRelationship(rel: Relationship): Promise<void>;
  getEntity(ref: EntityRef): Promise<Entity | null>;
  getRelated(ref: EntityRef, opts?: { type?: RelationType; direction?: "out" | "in" }): Promise<{ relationship: Relationship; entity: Entity }[]>;
  search(query: { type?: EntityType; text?: string; limit?: number }): Promise<Entity[]>;
  deleteEntity(ref: EntityRef): Promise<void>;
}
```

`createInMemoryKnowledgeStore()` is the only implementation this pass. **Deliberately no Postgres-backed store yet**: the graph is a derived/cache view over Supabase's real tables (populated via direct sync — see below), not a new source of truth, so it doesn't need its own persistent table before there's a real reason for the graph to survive a page reload. This also means this pass adds **no new schema/migration** — the Event Engine's `domain_events` table (already pending application) is the only outstanding migration from this session.

## Graph query API & traversal

- `query(q: KnowledgeQuery): Promise<Entity[]>` — structured/keyword search (naive substring match on label + stringified attributes this pass; see Deferred: embeddings below for the semantic alternative).
- `related(ref, opts?)` — 1-hop traversal, filterable by relation type and direction (`"out"`/`"in"`).
- `traverse(ref, { type?, direction?, depth })` — multi-hop, breadth-first, depth-bounded, cycle-safe (visited-set keyed by `type:id`). The graph is small and sparse today, so this is a plain bounded walk over `related()`, not a specialized graph-database traversal algorithm — reconsider if/when the graph gets large enough for that to matter.

## Context builder interface

```ts
interface ContextRequest { type?: EntityType; text?: string; limit?: number; includeRelated?: boolean; }
interface ContextResult { entities: Entity[]; relationships: Relationship[]; renderedText: string; }
```

`buildContext()` runs `query()`, optionally pulls each match's 1-hop related entities in (`includeRelated`), and renders a generic, type-grouped text block. This is a **new, standalone capability** — nothing consumes it yet, Ask AI included. It is intentionally not shaped like `askContext.ts`'s output (which carries Ask-AI-specific concerns: an `ActionIndex` of citable ids, a `compact` token-budget mode, prompt-engineering-tuned line formats) — `buildContext()` is generic across any future consumer, not a drop-in replacement for that file.

## Event Engine integration

```ts
type EventEntityMapper = (event: DomainEvent) => { entity?: Entity; relationships?: Relationship[] } | null;
knowledge.subscribeToEvents(eventEngine, mapper): () => void
```

`KnowledgeEngine` has no built-in knowledge of any specific engine's event shapes — a `mapper` translates one source's events into graph updates, supplied explicitly by whoever wires the two engines together. A mapper throwing, or a store failure while applying its result, is caught and reported to `telemetry.onEventIngestError` — never thrown — so one bad event can't break the subscription.

**The one real mapper today** (`mappers/integrationEvents.ts`): translates the Integration Engine's `connected`/`disconnected`/`authentication_failed` events (see `docs/architecture/integration-engine.md`'s Event Engine wiring) into `integration`-type entities. This is genuinely real and working end-to-end, because it's the only engine actually publishing yet.

## Direct synchronization

```ts
syncFromSupabase(engine: KnowledgeEngine): Promise<void>  // src/lib/knowledgeSync.ts
```

Reads `projects`/`tasks`/`tickets` directly via the Supabase client and upserts them as entities plus `belongs_to` relationships (task→project, ticket→project). This is the **primary population mechanism today** — not a stand-in for event adoption, but the thing that makes the graph actually useful before more of Orbit's engines publish through the Event Engine. It reads the same tables `askContext.ts` reads, via a completely separate, parallel path — `askContext.ts` itself is unmodified.

## Transitional architecture

This is explicitly a **hybrid population model**, not the target pipeline fully realized:

| Path | Status today |
|---|---|
| Direct sync (`syncFromSupabase`) | **Primary.** Real, working, covers projects/tasks/tickets. |
| Event Engine subscription | Real, but narrow — only the Integration Engine's connect/disconnect signals flow through it. None of Orbit's actual domain mutations (creating a task, updating a ticket, moving a project) publish events yet; those still go straight from React components to Supabase. |
| Semantic retrieval | Not implemented — see below. |
| AI querying the Knowledge Engine instead of data directly | Not true yet — `askContext.ts` is untouched and remains what Ask AI actually uses. |

The target end state — `Integrations → Event Engine → Knowledge Engine → AI Engine → User`, with the Knowledge Engine as the *only* thing AI queries — requires, in order: (1) more of Orbit's own engines/mutation paths publishing real domain events (task/ticket/project CRUD, not just connection health), at which point direct sync becomes a bootstrap/reconciliation mechanism rather than the primary path; (2) a persistent `KnowledgeStore` so the graph survives beyond one browser session; (3) real semantic retrieval; (4) Ask AI actually migrated onto `buildContext()`. None of these are started here — this pass is the stable foundation those steps build on, per the explicit goal of this milestone.

## Deferred: embeddings & semantic search

```ts
interface EmbeddingProvider { embed(text: string): Promise<number[]>; }
interface SearchProvider { retrieve(queryText: string, opts?: { limit?: number; type?: EntityType }): Promise<Entity[]>; }
```

Defined, **not implemented**. No vector store exists in this project (`pgvector` isn't enabled in `supabase/schema.sql`) and no embedding provider is wired up anywhere in the codebase. Building either for real requires: enabling `pgvector` (another migration), picking an embedding model/provider (cost and dependency implications), and deciding where embeddings get computed (client-side, a Netlify function, or the local agent). None of that is decided or built here — `query()`'s keyword search is the only retrieval mechanism this pass.

## Responsibilities

- Own the entity/relationship graph shape and the query/traversal/context-building API over it.
- Own the mapper contract for translating Event Engine events into graph updates.
- Does **not** own: how entities get populated (direct sync vs. events is a per-caller choice today), embedding computation, or Ask AI's actual prompt construction.

## Dependencies

`src/engines/knowledge/*` (core): the Event Engine's types only (`DomainEvent`, `EventEngine`), for the `subscribeToEvents` signature — no Supabase, no Node. `src/lib/knowledgeSync.ts` (outside the core): the existing `supabase` client, same as `askContext.ts`.

## Current consumers

**None wired into live app bootstrap.** Nothing in `Layout.tsx` or app startup constructs a running `KnowledgeEngine` singleton yet — this pass ships infrastructure, exercised by tests and available to import, matching the same restraint already shown for the Integration Engine's optional `events` sink and the Event Engine's Integration Engine wiring (both real, both opt-in, neither turned on by default). Turning this into a live, running part of the app (constructing a shared instance, calling `syncFromSupabase` on load, wiring `subscribeToEvents`) is a deliberate next step, not assumed here.

## Public API

```ts
import { KnowledgeEngine, createInMemoryKnowledgeStore, integrationEventMapper } from "src/engines/knowledge";
import { syncFromSupabase } from "src/lib/knowledgeSync";

const knowledge = new KnowledgeEngine(createInMemoryKnowledgeStore());
knowledge.subscribeToEvents(eventEngine, integrationEventMapper);
await syncFromSupabase(knowledge);

const openTasks = await knowledge.query({ type: "task", text: "bug" });
const { renderedText } = await knowledge.buildContext({ type: "task", includeRelated: true });
```

## Migration strategy

- **Persistent `KnowledgeStore`** (Postgres-backed, mirroring the `EventStore`/`CredentialManager` split of interface-in-core vs. implementation-outside) once the graph needs to survive beyond one session.
- **Real embeddings**, once `pgvector` is enabled and a provider is chosen — implements `EmbeddingProvider`/`SearchProvider` without changing `KnowledgeStore`'s or `KnowledgeEngine`'s existing shape.
- **More Event Engine publishers**: as the AI Engine and future engines (and eventually Orbit's own task/ticket/project mutation paths) publish real domain events, more mappers land here, and direct sync's role shrinks toward bootstrap/reconciliation.
- **Ask AI migration**: `askContext.ts` moves onto `buildContext()` (likely needing Ask-AI-specific rendering on top of the generic one, and the `ActionIndex`/compact-mode concerns folded in) — a dedicated future phase, deliberately not attempted here.
