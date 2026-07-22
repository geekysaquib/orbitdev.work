/**
 * Shared contract for the Knowledge Engine (see
 * docs/architecture/knowledge-engine.md) — the intended single owner of
 * entities, relationships, and context construction for AI, per the target
 * pipeline `Integrations → Event Engine → Knowledge Engine → AI Engine →
 * User`. See that doc's "Transitional architecture" section for how today's
 * hybrid population model (direct sync + the one real Event Engine
 * publisher) relates to that target. Environment-agnostic core, zero
 * dependencies — same rule the AI/Integration/Event Engines' cores follow.
 */
import type { DomainEvent } from "../events";

/** Open — "project" | "task" | "ticket" | "integration" today; commit/PR/deployment/etc. later. No central union to edit when a new entity type appears. */
export type EntityType = string;

export interface EntityRef {
  type: EntityType;
  id: string;
}

export interface Entity<TAttrs = Record<string, unknown>> {
  ref: EntityRef;
  /** Human-readable — a task's title, a project's name, an integration's id. */
  label: string;
  /** Domain-specific fields, opaque to the engine itself. */
  attributes: TAttrs;
  updatedAt: string;
}

/** Open — "belongs_to" today; "assigned_to" | "blocks" | etc. later. */
export type RelationType = string;

export interface Relationship {
  from: EntityRef;
  type: RelationType;
  to: EntityRef;
}

export interface KnowledgeQuery {
  type?: EntityType;
  /** Naive keyword match against label + attributes this pass — see SearchProvider below for the semantic alternative. */
  text?: string;
  limit?: number;
}

export interface RelatedOptions {
  type?: RelationType;
  direction?: "out" | "in";
}

/**
 * Persistence abstraction — `createInMemoryKnowledgeStore()`
 * (src/engines/knowledge/inMemoryStore.ts) is the one real implementation
 * this pass. The graph is a derived/cache view over Supabase's real tables
 * (see src/lib/knowledgeSync.ts), not a new source of truth yet, so it
 * doesn't need a persistent store of its own before there's a real reason
 * to survive a page reload — see the doc's Migration strategy.
 */
export interface KnowledgeStore {
  upsertEntity(entity: Entity): Promise<void>;
  upsertRelationship(rel: Relationship): Promise<void>;
  getEntity(ref: EntityRef): Promise<Entity | null>;
  getRelated(ref: EntityRef, opts?: RelatedOptions): Promise<{ relationship: Relationship; entity: Entity }[]>;
  search(query: KnowledgeQuery): Promise<Entity[]>;
  deleteEntity(ref: EntityRef): Promise<void>;
}

export interface ContextRequest {
  type?: EntityType;
  text?: string;
  limit?: number;
  /** Also pull each match's 1-hop related entities into the result — off by default since it multiplies store reads. */
  includeRelated?: boolean;
}
export interface ContextResult {
  entities: Entity[];
  relationships: Relationship[];
  /** Generic, type-grouped text rendering — NOT the Ask AI prompt format (see src/lib/askContext.ts, which this does not replace in this pass). */
  renderedText: string;
}

/**
 * Translates one engine's `DomainEvent`s into graph updates. The
 * `KnowledgeEngine` core has no built-in knowledge of any specific engine's
 * event shapes — same "depend on the Event Engine, never hardcode a sibling
 * engine" principle the other engines already follow — a mapper is how a
 * specific source's events get translated in. Returning `null` means "not
 * relevant to me," e.g. an event from a source this mapper doesn't handle.
 * `deleteRef` (e.g. for a `*.deleted` event) removes that entity from the
 * graph instead of upserting one — see `KnowledgeEngine.ingest()`.
 */
export type EventEntityMapper = (event: DomainEvent) => { entity?: Entity; relationships?: Relationship[]; deleteRef?: EntityRef } | null;

/**
 * Deferred capability — no implementation this pass (see
 * docs/architecture/knowledge-engine.md's "Deferred: embeddings & semantic
 * search"). Needs a vector store (pgvector isn't enabled in this project
 * today) and a provider decision before either can be built for real.
 */
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}
export interface SearchProvider {
  retrieve(queryText: string, opts?: { limit?: number; type?: EntityType }): Promise<Entity[]>;
}

/** Optional instrumentation, unset by default — same convention as the other engines' telemetry hooks. */
export interface KnowledgeTelemetry {
  onEntityUpserted?(entity: Entity): void;
  onQuery?(query: KnowledgeQuery, resultCount: number): void;
  onEventIngestError?(info: { event: DomainEvent; error: unknown }): void;
}
