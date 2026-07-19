import { useCallback, useEffect, useState } from "react";
import { useAgent } from "../context/Agent";
import { useZoho } from "../context/Zoho";
import { fetchDocker } from "../lib/agent";
import { fetchIntegrations } from "../lib/integrations";
import { pgServers, pgHealth } from "../lib/pg";
import { fetchProviderConnections } from "../lib/providerConnections";
import type { ProviderId } from "../lib/types";

export type HealthState = "ok" | "warn" | "unknown";

const PROVIDER_IDS: ProviderId[] = ["github", "gitlab", "azuredevops", "sentry", "netlify", "vercel", "aws", "msteams"];

export interface IntegrationHealth {
  agent: { state: HealthState; label: string };
  zoho: { state: HealthState; label: string };
  gmail: { state: HealthState; configured: boolean };
  docker: { state: HealthState; available: boolean; count: number };
  postgres: { state: HealthState; servers: { name: string; ok: boolean; error?: string }[] };
  anthropic: { state: HealthState };
  // GitHub/GitLab/Sentry/Netlify/Vercel/AWS — generic, since these all share
  // the same "connected or not" shape (unlike Docker/Postgres above, which
  // carry richer per-item detail existing call sites already depend on).
  providers: Record<ProviderId, { state: HealthState; label: string }>;
}

const EMPTY_PROVIDERS = Object.fromEntries(
  PROVIDER_IDS.map((p) => [p, { state: "unknown" as HealthState, label: "Checking…" }]),
) as Record<ProviderId, { state: HealthState; label: string }>;

const EMPTY: IntegrationHealth = {
  agent: { state: "unknown", label: "Checking…" },
  zoho: { state: "unknown", label: "Checking…" },
  gmail: { state: "unknown", configured: false },
  docker: { state: "unknown", available: false, count: 0 },
  postgres: { state: "unknown", servers: [] },
  anthropic: { state: "unknown" },
  providers: EMPTY_PROVIDERS,
};

/**
 * Single source of truth for "is this integration okay," shared by Settings'
 * side-rail dots and the Health page — so the two can't silently disagree.
 */
export function useIntegrationHealth() {
  const { status: agentStatus } = useAgent();
  const zoho = useZoho();
  const [health, setHealth] = useState<IntegrationHealth>(EMPTY);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);

    const agent: IntegrationHealth["agent"] = agentStatus === "online"
      ? { state: "ok", label: "Connected" }
      : agentStatus === "disconnected"
        ? { state: "warn", label: "Disconnected" }
        : { state: "warn", label: "Offline" };

    const zohoHealth: IntegrationHealth["zoho"] = zoho.status === "connected"
      ? { state: "ok", label: "Connected" }
      : zoho.status === "checking"
        ? { state: "unknown", label: "Checking…" }
        : { state: "warn", label: "Disconnected" };

    const integrations = await fetchIntegrations();
    const gmailConfigured = !!(integrations?.gmail_user && integrations?.gmail_app_password);
    const gmail: IntegrationHealth["gmail"] = { state: gmailConfigured ? "ok" : "unknown", configured: gmailConfigured };
    const anthropic: IntegrationHealth["anthropic"] = { state: integrations?.anthropic_api_key ? "ok" : "unknown" };

    const docker: IntegrationHealth["docker"] = agentStatus !== "online"
      ? { state: "unknown", available: false, count: 0 }
      : await fetchDocker().then((d) => ({ state: (d.available ? "ok" : "warn") as HealthState, available: d.available, count: d.containers.length }));

    const { servers } = await pgServers();
    let postgres: IntegrationHealth["postgres"];
    if (servers.length === 0) {
      postgres = { state: "unknown", servers: [] };
    } else if (agentStatus !== "online") {
      postgres = { state: "warn", servers: servers.map((s) => ({ name: s.name, ok: false, error: "Agent offline" })) };
    } else {
      const results = await Promise.all(servers.map((s) => pgHealth(s)));
      const allOk = results.every((r) => r.ok);
      postgres = { state: allOk ? "ok" : "warn", servers: results.map((r) => ({ name: r.name, ok: r.ok, error: r.error })) };
    }

    const connections = await fetchProviderConnections();
    const byProvider = new Map(connections.map((c) => [c.provider, c]));
    const providers = Object.fromEntries(
      PROVIDER_IDS.map((id) => {
        const row = byProvider.get(id);
        if (!row) return [id, { state: "unknown" as HealthState, label: "Not connected" }];
        return [id, { state: row.status === "connected" ? "ok" as HealthState : "warn" as HealthState, label: row.status === "connected" ? "Connected" : "Disconnected" }];
      }),
    ) as Record<ProviderId, { state: HealthState; label: string }>;

    setHealth({ agent, zoho: zohoHealth, gmail, docker, postgres, anthropic, providers });
    setLoading(false);
  }, [agentStatus, zoho.status]);

  useEffect(() => { refresh(); }, [refresh]);

  return { health, refresh, loading };
}
