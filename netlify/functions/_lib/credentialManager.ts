import type { CredentialManager, CredentialPrincipal, IntegrationContext, IntegrationId } from "../../../src/engines/integrations";
import { loadConnectionByAuthHeader, type ProviderConnectionRow } from "./providerConnections";
import { dbSelect } from "./db";

/**
 * Server-side `CredentialManager` implementations — see
 * docs/architecture/integration-engine.md's Authentication flow section.
 * These are the *only* place in the codebase allowed to read
 * `provider_connections`/`integrations` row shapes; every adapter and every
 * `*-api.ts` proxy only ever sees the resulting `IntegrationContext`. Kept
 * server-side (not in src/engines/integrations, which stays
 * environment-agnostic like the AI Engine's adapters) because both backends
 * touch either a caller's raw JWT or the service-role key.
 */

function envUrl(): string {
  return process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
}
function envAnon(): string {
  return process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
}

// Azure DevOps stores a pasted PAT used as HTTP Basic auth; everything else
// currently backed by `provider_connections` is a bearer token (OAuth access
// token or another flavor of PAT sent as `Authorization: Bearer`).
function providerConnectionAuthKind(integrationId: IntegrationId): "bearer" | "basic" {
  return integrationId === "azuredevops" ? "basic" : "bearer";
}

// `IntegrationContext.config` is the only channel available for provider-
// specific extras, so display metadata that isn't part of the config jsonb
// column (the connection's `external_account_name`) rides along under this
// key rather than adding a field to the core context shape just for it.
const ACCOUNT_NAME_KEY = "accountName";

function rowToContext(integrationId: IntegrationId, row: ProviderConnectionRow | null): IntegrationContext | null {
  if (!row?.access_token) return null;
  return {
    auth: { kind: providerConnectionAuthKind(integrationId), token: row.access_token },
    config: { ...(row.config ?? {}), [ACCOUNT_NAME_KEY]: row.external_account_name ?? null },
  };
}

/** Backs github/gitlab/azuredevops/sentry/msteams/netlify/vercel/aws — the multi-row-per-user `provider_connections` table. */
export class ProviderConnectionsCredentialManager implements CredentialManager {
  async getContext(integrationId: IntegrationId, principal: CredentialPrincipal): Promise<IntegrationContext | null> {
    if (principal.kind === "request") {
      const row = await loadConnectionByAuthHeader(principal.authHeader, integrationId);
      return rowToContext(integrationId, row);
    }
    const rows = await dbSelect<ProviderConnectionRow>(
      "provider_connections",
      `user_id=eq.${principal.userId}&provider=eq.${integrationId}&select=*`,
    );
    return rowToContext(integrationId, rows[0] ?? null);
  }
}

// The `integrations` table is one row per user with a flat column per
// provider (see supabase/schema.sql) rather than a multi-row shape — each
// supported integrationId maps to its own column(s) here. Only the AI
// providers map cleanly to a static-token `IntegrationContext` today; Zoho's
// credential is a client_id/secret/refresh_token triple that needs a live
// OAuth refresh call to produce a usable token (see _lib/zohoAuth.ts's
// `accessToken()`) — that belongs in a future Zoho adapter, not this
// abstraction, so "zoho" isn't included here yet.
const AI_KEY_COLUMN: Partial<Record<IntegrationId, string>> = {
  anthropic: "anthropic_api_key",
  gemini: "gemini_api_key",
  openai: "openai_api_key",
  grok: "grok_api_key",
};

interface IntegrationsAiKeyRow {
  anthropic_api_key?: string | null;
  gemini_api_key?: string | null;
  openai_api_key?: string | null;
  grok_api_key?: string | null;
}

/** Backs the AI providers' keys — the singular-per-user `integrations` table. */
export class IntegrationsTableCredentialManager implements CredentialManager {
  async getContext(integrationId: IntegrationId, principal: CredentialPrincipal): Promise<IntegrationContext | null> {
    const column = AI_KEY_COLUMN[integrationId];
    if (!column) return null;

    const row = principal.kind === "request"
      ? await this.loadByAuthHeader(principal.authHeader, column)
      : (await dbSelect<IntegrationsAiKeyRow>("integrations", `user_id=eq.${principal.userId}&select=${column}`))[0];

    const key = row?.[column as keyof IntegrationsAiKeyRow];
    if (!key) return null;
    return { auth: { kind: "apiKey", token: key }, config: {} };
  }

  private async loadByAuthHeader(authHeader: string | null, column: string): Promise<IntegrationsAiKeyRow | null> {
    const url = envUrl(), anon = envAnon();
    if (!url || !anon) throw new Error("Server misconfigured — SUPABASE_URL/SUPABASE_ANON_KEY are not set.");
    const r = await fetch(`${url}/rest/v1/integrations?select=${column}`, { headers: { apikey: anon, Authorization: authHeader || "" } });
    if (!r.ok) throw new Error(`Could not load your integration credentials (${r.status}).`);
    const rows = await r.json();
    return Array.isArray(rows) && rows[0] ? (rows[0] as IntegrationsAiKeyRow) : null;
  }
}

/**
 * The one place that knows today's credential storage is split across two
 * tables — everything else in the Integration Engine (adapters, proxies,
 * cron wrappers) only calls `CredentialManager.getContext()`. If the tables
 * are ever unified, only this composite changes.
 */
export class CompositeCredentialManager implements CredentialManager {
  private readonly providerConnections = new ProviderConnectionsCredentialManager();
  private readonly integrationsTable = new IntegrationsTableCredentialManager();

  async getContext(integrationId: IntegrationId, principal: CredentialPrincipal): Promise<IntegrationContext | null> {
    if (AI_KEY_COLUMN[integrationId]) return this.integrationsTable.getContext(integrationId, principal);
    return this.providerConnections.getContext(integrationId, principal);
  }
}

export const credentialManager: CredentialManager = new CompositeCredentialManager();

/** Reads the `provider_connections`-only `accountName` extra a `*-api.ts` proxy needs for its `status` response — see `ACCOUNT_NAME_KEY` above. */
export function accountNameOf(ctx: IntegrationContext | null): string | null {
  return (ctx?.config?.[ACCOUNT_NAME_KEY] as string | null | undefined) ?? null;
}
