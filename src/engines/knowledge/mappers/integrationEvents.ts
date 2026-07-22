import type { DomainEvent } from "../../events";
import type { Entity } from "../types";

/**
 * Translates Integration Engine domain events (see
 * `IntegrationRegistry`'s `events` sink, src/engines/integrations/registry.ts)
 * into `integration` entities — the one Event Engine publisher that exists
 * today, so this is the one real, working example of "subscribe to the
 * Event Engine" (see docs/architecture/knowledge-engine.md's Transitional
 * architecture section). Wire it explicitly:
 * `knowledge.subscribeToEvents(eventEngine, integrationEventMapper)`.
 */
export function integrationEventMapper(event: DomainEvent): { entity: Entity } | null {
  if (event.source !== "integration-engine") return null;
  const integrationId = event.payload.integrationId as string | undefined;
  if (!integrationId) return null;

  return {
    entity: {
      ref: { type: "integration", id: integrationId },
      label: integrationId,
      attributes: {
        connected: event.type === "connected",
        status: event.type,
        account: (event.payload.account as string | null | undefined) ?? null,
        error: (event.payload.error as string | undefined) ?? null,
      },
      updatedAt: event.occurredAt,
    },
  };
}
