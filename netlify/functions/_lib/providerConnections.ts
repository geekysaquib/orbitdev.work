import type { HandlerEvent } from "@netlify/functions";

/**
 * Shared credential loader for the GitHub/GitLab/Sentry/Netlify/Vercel/AWS
 * proxy functions — reads the caller's own row from `provider_connections`
 * via their JWT + RLS (never the service-role key), same pattern as
 * zoho-sprints.ts's `loadCreds`. There is deliberately no environment-variable
 * fallback: each account links its own keys in Settings.
 */
export interface ProviderConnectionRow {
  id: string; provider: string; status: string;
  client_id: string | null; client_secret: string | null;
  access_token: string | null; refresh_token: string | null; expires_at: string | null; scope: string | null;
  external_account_id: string | null; external_account_name: string | null;
  config: Record<string, unknown>;
}

/** Core lookup, keyed by the caller's raw auth header rather than a full Netlify `HandlerEvent` — reused by the Integration Engine's `CredentialManager` (netlify/functions/_lib/credentialManager.ts), which only ever carries the header, not an event. */
export async function loadConnectionByAuthHeader(authHeader: string | null | undefined, provider: string): Promise<ProviderConnectionRow | null> {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Server misconfigured — SUPABASE_URL/SUPABASE_ANON_KEY are not set.");

  const r = await fetch(`${url}/rest/v1/provider_connections?provider=eq.${provider}&select=*`, {
    headers: { apikey: anon, Authorization: authHeader || "" },
  });
  if (!r.ok) throw new Error(`Could not load your ${provider} connection (${r.status}).`);
  const rows = await r.json();
  return Array.isArray(rows) && rows[0] ? (rows[0] as ProviderConnectionRow) : null;
}

export async function loadConnection(event: HandlerEvent, provider: string): Promise<ProviderConnectionRow | null> {
  return loadConnectionByAuthHeader(event.headers.authorization || event.headers.Authorization, provider);
}
