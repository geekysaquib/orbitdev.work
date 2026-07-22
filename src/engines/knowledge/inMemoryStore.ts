import type { Entity, EntityRef, KnowledgeQuery, KnowledgeStore, RelatedOptions, Relationship } from "./types";

function refKey(ref: EntityRef): string {
  return `${ref.type}:${ref.id}`;
}

/**
 * Dependency-free `KnowledgeStore` — the one real implementation this pass
 * (see types.ts's `KnowledgeStore` doc comment for why there's no
 * persistent one yet). Used directly by callers and by tests.
 */
export function createInMemoryKnowledgeStore(): KnowledgeStore {
  const entities = new Map<string, Entity>();
  const relationships: Relationship[] = [];

  return {
    async upsertEntity(entity) {
      entities.set(refKey(entity.ref), entity);
    },

    async upsertRelationship(rel) {
      const exists = relationships.some(
        (r) => refKey(r.from) === refKey(rel.from) && r.type === rel.type && refKey(r.to) === refKey(rel.to),
      );
      if (!exists) relationships.push(rel);
    },

    async getEntity(ref) {
      return entities.get(refKey(ref)) ?? null;
    },

    async getRelated(ref, opts: RelatedOptions = {}) {
      const direction = opts.direction ?? "out";
      const key = refKey(ref);
      const matches = relationships.filter((r) => {
        if (opts.type && r.type !== opts.type) return false;
        return direction === "out" ? refKey(r.from) === key : refKey(r.to) === key;
      });
      const out: { relationship: Relationship; entity: Entity }[] = [];
      for (const relationship of matches) {
        const otherRef = direction === "out" ? relationship.to : relationship.from;
        const entity = entities.get(refKey(otherRef));
        if (entity) out.push({ relationship, entity });
      }
      return out;
    },

    async search(query: KnowledgeQuery) {
      const needle = query.text?.trim().toLowerCase();
      let results = [...entities.values()];
      if (query.type) results = results.filter((e) => e.ref.type === query.type);
      if (needle) {
        results = results.filter((e) => `${e.label} ${JSON.stringify(e.attributes)}`.toLowerCase().includes(needle));
      }
      results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return query.limit ? results.slice(0, query.limit) : results;
    },

    async deleteEntity(ref) {
      const key = refKey(ref);
      entities.delete(key);
      for (let i = relationships.length - 1; i >= 0; i--) {
        if (refKey(relationships[i].from) === key || refKey(relationships[i].to) === key) relationships.splice(i, 1);
      }
    },
  };
}
