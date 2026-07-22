import type {
  ContextRequest, ContextResult, Entity, EntityRef, EntityType, EventEntityMapper,
  KnowledgeQuery, KnowledgeStore, KnowledgeTelemetry, RelatedOptions, Relationship,
} from "./types";
import type { DomainEvent, EventEngine } from "../events";

function refKey(ref: EntityRef): string {
  return `${ref.type}:${ref.id}`;
}

/** Generic, type-grouped text rendering — not Ask AI's prompt format (see src/lib/askContext.ts, untouched by this engine). */
function renderEntities(entities: Entity[]): string {
  if (!entities.length) return "No matching knowledge found.";
  const byType = new Map<EntityType, Entity[]>();
  for (const e of entities) {
    const list = byType.get(e.ref.type) ?? [];
    list.push(e);
    byType.set(e.ref.type, list);
  }
  const lines: string[] = [];
  for (const [type, list] of byType) {
    lines.push(`${type}:`);
    for (const e of list) {
      const attrs = Object.entries(e.attributes).map(([k, v]) => `${k}: ${v}`).join(", ");
      lines.push(`  - ${e.label}${attrs ? ` (${attrs})` : ""}`);
    }
  }
  return lines.join("\n");
}

/**
 * Intended single owner of entities, relationships, and context construction
 * (see docs/architecture/knowledge-engine.md). `store` is injected — a real
 * `KnowledgeStore` implementation (in-memory today) does the actual
 * persistence; this class only knows the `KnowledgeStore` interface, same
 * "core depends on an injected abstraction, never a concrete backend"
 * pattern as the other three engines.
 */
export class KnowledgeEngine {
  constructor(private readonly store: KnowledgeStore, private readonly telemetry?: KnowledgeTelemetry) {}

  async upsertEntity(entity: Entity): Promise<void> {
    await this.store.upsertEntity(entity);
    this.telemetry?.onEntityUpserted?.(entity);
  }

  async upsertRelationship(rel: Relationship): Promise<void> {
    await this.store.upsertRelationship(rel);
  }

  async getEntity(ref: EntityRef): Promise<Entity | null> {
    return this.store.getEntity(ref);
  }

  async deleteEntity(ref: EntityRef): Promise<void> {
    await this.store.deleteEntity(ref);
  }

  /** The graph query API's entry point — structured/keyword search this pass (see types.ts's `SearchProvider` for the deferred semantic alternative). */
  async query(q: KnowledgeQuery): Promise<Entity[]> {
    const results = await this.store.search(q);
    this.telemetry?.onQuery?.(q, results.length);
    return results;
  }

  /** 1-hop traversal. */
  async related(ref: EntityRef, opts?: RelatedOptions): Promise<{ relationship: Relationship; entity: Entity }[]> {
    return this.store.getRelated(ref, opts);
  }

  /**
   * Multi-hop traversal, breadth-first, depth-bounded, cycle-safe via a
   * visited set — the graph is small/sparse today, so this doesn't need a
   * specialized graph-database traversal algorithm, just a bounded walk over
   * `related()`. Each reached entity is reported once, at the depth it was
   * first reached at.
   */
  async traverse(
    ref: EntityRef,
    opts: RelatedOptions & { depth: number },
  ): Promise<{ relationship: Relationship; entity: Entity; depth: number }[]> {
    const visited = new Set<string>([refKey(ref)]);
    let frontier = [ref];
    const results: { relationship: Relationship; entity: Entity; depth: number }[] = [];

    for (let depth = 1; depth <= opts.depth && frontier.length; depth++) {
      const next: EntityRef[] = [];
      for (const node of frontier) {
        const related = await this.related(node, opts);
        for (const hit of related) {
          const key = refKey(hit.entity.ref);
          if (visited.has(key)) continue;
          visited.add(key);
          results.push({ ...hit, depth });
          next.push(hit.entity.ref);
        }
      }
      frontier = next;
    }
    return results;
  }

  /**
   * The context builder interface's implementation — runs `query()`,
   * optionally enriches each hit with its 1-hop related entities, and
   * renders a generic text block. A new, standalone capability: nothing
   * (Ask AI included) consumes this yet — see the doc's Migration strategy.
   */
  async buildContext(request: ContextRequest): Promise<ContextResult> {
    const matches = await this.query({ type: request.type, text: request.text, limit: request.limit });
    const entities = [...matches];
    const relationships: Relationship[] = [];

    if (request.includeRelated) {
      for (const match of matches) {
        for (const hit of await this.related(match.ref)) {
          relationships.push(hit.relationship);
          if (!entities.some((e) => refKey(e.ref) === refKey(hit.entity.ref))) entities.push(hit.entity);
        }
      }
    }

    return { entities, relationships, renderedText: renderEntities(entities) };
  }

  /**
   * Applies one `DomainEvent` to the graph via `mapper` — a mapper error, or
   * a store failure while applying its result, is reported to
   * `telemetry.onEventIngestError` and never thrown — one bad event must
   * never break whatever delivered it. Shared by `subscribeToEvents` (local,
   * in-process delivery) and Orbit Runtime's realtime bridge (cross-process
   * delivery via Supabase Realtime, src/runtime/OrbitRuntime.ts) — both feed
   * events through this same, single ingestion path.
   */
  async ingest(event: DomainEvent, mapper: EventEntityMapper): Promise<void> {
    let result: ReturnType<EventEntityMapper>;
    try {
      result = mapper(event);
    } catch (error) {
      this.telemetry?.onEventIngestError?.({ event, error });
      return;
    }
    if (!result) return;
    try {
      if (result.entity) await this.upsertEntity(result.entity);
      if (result.relationships) for (const rel of result.relationships) await this.upsertRelationship(rel);
      if (result.deleteRef) await this.deleteEntity(result.deleteRef);
    } catch (error) {
      this.telemetry?.onEventIngestError?.({ event, error });
    }
  }

  /**
   * Subscribes to an `EventEngine` and translates events into graph updates
   * via `mapper` (see `ingest()`) — see `EventEntityMapper` in types.ts for
   * why this class has no built-in knowledge of any specific engine's event
   * shapes. Returns an unsubscribe function.
   */
  subscribeToEvents(events: EventEngine, mapper: EventEntityMapper): () => void {
    return events.subscribe({}, (event) => this.ingest(event, mapper));
  }
}
