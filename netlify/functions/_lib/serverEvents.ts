import { EventEngine } from "../../../src/engines/events";
import { eventStore } from "./eventStore";

/**
 * Shared server-side `EventEngine` instance, module-scope-constructed —
 * same idiom `_lib/providerFetch.ts` already uses for its registry (reused
 * opportunistically by a warm function container, never relied on for
 * correctness; there is no persistent process here to hold a stateful
 * "runtime" in, unlike the browser's OrbitRuntime — see
 * docs/architecture/orbit-runtime.md). Backed by the service-role
 * `EventStore`, so every publish durably lands in `domain_events`
 * regardless of whether this module instance survives to the next
 * invocation.
 */
export const serverEventEngine = new EventEngine(eventStore);
