import { describe, it, expect, vi } from "vitest";
import { IntegrationRegistry } from "./registry";
import type { IntegrationAdapter, IntegrationContext, IntegrationStatus } from "./types";
import { isScmAdapter, type ScmAdapter } from "./capabilities/scm";
import { EventEngine, createInMemoryEventStore } from "../events";

function fakeAdapter(id: string, capabilities: IntegrationAdapter["capabilities"], status: IntegrationStatus = { connected: true }): IntegrationAdapter {
  return {
    id,
    displayName: id,
    capabilities,
    async checkStatus(): Promise<IntegrationStatus> {
      return status;
    },
  };
}

function fakeScmAdapter(id: string): ScmAdapter {
  return {
    ...fakeAdapter(id, ["scm"]),
    async listRepos() { return { ok: true, data: [] }; },
    async listPulls() { return { ok: true, data: [] }; },
    async listCommits() { return { ok: true, data: [] }; },
    async listRuns() { return { ok: true, data: [] }; },
    async countCommitsSince() { return { ok: true, data: 0 }; },
  };
}

describe("IntegrationRegistry", () => {
  it("registers and looks up an adapter by id", () => {
    const registry = new IntegrationRegistry();
    registry.register(fakeAdapter("github", ["scm"]));
    expect(registry.get("github")?.id).toBe("github");
    expect(registry.get("nope")).toBeUndefined();
  });

  it("rejects registering the same id twice", () => {
    const registry = new IntegrationRegistry();
    registry.register(fakeAdapter("github", ["scm"]));
    expect(() => registry.register(fakeAdapter("github", ["scm"]))).toThrow(/already registered/);
  });

  it("filters by capability without any provider-specific branching", () => {
    const registry = new IntegrationRegistry();
    registry.register(fakeAdapter("github", ["scm"]));
    registry.register(fakeAdapter("sentry", ["monitoring"]));
    registry.register(fakeAdapter("zoho", ["issues", "scm"]));
    expect(registry.listByCapability("scm").map((a) => a.id).sort()).toEqual(["github", "zoho"]);
    expect(registry.listByCapability("monitoring").map((a) => a.id)).toEqual(["sentry"]);
    expect(registry.listByCapability("chat")).toEqual([]);
  });

  it("getCapable narrows to a capability interface, or returns undefined if the adapter doesn't implement it", () => {
    const registry = new IntegrationRegistry();
    registry.register(fakeScmAdapter("github"));
    registry.register(fakeAdapter("sentry", ["monitoring"]));
    expect(registry.getCapable("github", isScmAdapter)).toBeDefined();
    expect(registry.getCapable("sentry", isScmAdapter)).toBeUndefined();
    expect(registry.getCapable("nope", isScmAdapter)).toBeUndefined();
  });

  it("instruments resolved adapters with telemetry when a sink is configured", async () => {
    const onCallStart = vi.fn();
    const onCallEnd = vi.fn();
    const registry = new IntegrationRegistry({ telemetry: { onCallStart, onCallEnd } });
    registry.register(fakeAdapter("github", ["scm"]));

    const ctx: IntegrationContext = { auth: { kind: "bearer", token: "t" }, config: {} };
    await registry.get("github")!.checkStatus(ctx);

    expect(onCallStart).toHaveBeenCalledWith({ integrationId: "github", operation: "checkStatus" });
    expect(onCallEnd).toHaveBeenCalledWith(expect.objectContaining({ integrationId: "github", operation: "checkStatus", ok: true }));
  });

  it("does not instrument when no telemetry sink is configured", () => {
    const registry = new IntegrationRegistry();
    registry.register(fakeAdapter("github", ["scm"]));
    // Same object identity back — no wrapping happened.
    expect(registry.get("github")).toBe(registry.get("github"));
  });

  describe("Event Engine publishing (checkStatus only)", () => {
    const ctx: IntegrationContext = { auth: { kind: "bearer", token: "t" }, config: {} };
    // Publishing is fire-and-forget (see registry.ts) — give its microtask a tick to settle before asserting on the store.
    const flush = () => new Promise((r) => setTimeout(r, 0));

    it("publishes a connected event when checkStatus reports connected", async () => {
      const store = createInMemoryEventStore();
      const events = new EventEngine(store);
      const registry = new IntegrationRegistry({ events: { engine: events } });
      registry.register(fakeAdapter("github", ["scm"], { connected: true, account: "me" }));

      await registry.get("github")!.checkStatus(ctx);
      await flush();

      const rows = await store.listSince({ source: "integration-engine" });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ source: "integration-engine", type: "connected", payload: { integrationId: "github", account: "me" } });
    });

    it("publishes authentication_failed vs disconnected based on whether an error is present", async () => {
      const store = createInMemoryEventStore();
      const events = new EventEngine(store);
      const registry = new IntegrationRegistry({ events: { engine: events } });
      registry.register(fakeAdapter("azuredevops", ["scm"], { connected: false, error: "bad PAT" }));
      registry.register(fakeAdapter("gitlab", ["scm"], { connected: false }));

      await registry.get("azuredevops")!.checkStatus(ctx);
      await registry.get("gitlab")!.checkStatus(ctx);
      await flush();

      const rows = await store.listSince({});
      expect(rows.find((r) => r.payload.integrationId === "azuredevops")?.type).toBe("authentication_failed");
      expect(rows.find((r) => r.payload.integrationId === "gitlab")?.type).toBe("disconnected");
    });

    it("does not publish for non-checkStatus capability methods", async () => {
      const store = createInMemoryEventStore();
      const events = new EventEngine(store);
      const registry = new IntegrationRegistry({ events: { engine: events } });
      registry.register(fakeScmAdapter("github"));

      await registry.getCapable("github", isScmAdapter)!.listPulls(ctx, "org/repo");
      await flush();

      expect(await store.listSince({})).toHaveLength(0);
    });

    it("a store failure never throws out of checkStatus (fire-and-forget)", async () => {
      const events = new EventEngine({ append: vi.fn().mockRejectedValue(new Error("db down")), listSince: vi.fn() });
      const registry = new IntegrationRegistry({ events: { engine: events } });
      registry.register(fakeAdapter("github", ["scm"]));

      await expect(registry.get("github")!.checkStatus(ctx)).resolves.toEqual({ connected: true });
    });
  });
});
