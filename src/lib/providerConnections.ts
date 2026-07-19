/**
 * CRUD over `provider_connections` (RLS-scoped, one row per user+provider) —
 * GitHub, GitLab, Sentry, Netlify, Vercel, AWS. Same plaintext-column trust
 * model as `pg_servers`/`integrations`: RLS is the only gate. Unlike
 * `integrations` (single row per user), a user can hold several of these at
 * once, so this is a multi-row table keyed on (user_id, provider) — see
 * `src/lib/pg.ts` for the CRUD shape this mirrors.
 */
import { supabase } from "./supabase";
import { getUser } from "./auth";
import { getOnline, OFFLINE_ERROR } from "./offline";
import type { Json } from "./database.types";
import type { ProviderConnection, ProviderId } from "./types";

export async function fetchProviderConnections(): Promise<ProviderConnection[]> {
  const { data, error } = await supabase.from("provider_connections").select("*");
  if (error) return [];
  return (data ?? []) as ProviderConnection[];
}

export async function fetchProviderConnection(provider: ProviderId): Promise<ProviderConnection | null> {
  const { data, error } = await supabase.from("provider_connections").select("*").eq("provider", provider).maybeSingle();
  if (error) return null;
  return (data as ProviderConnection) ?? null;
}

export async function saveProviderConnection(provider: ProviderId, patch: Partial<ProviderConnection>): Promise<{ ok: boolean; error?: string }> {
  if (!getOnline()) return { ok: false, error: OFFLINE_ERROR };
  const u = getUser();
  if (!u) return { ok: false, error: "Not signed in" };
  const { error } = await supabase.from("provider_connections")
    .upsert({ user_id: u.id, provider, status: "connected", ...patch, config: patch.config as Json, updated_at: new Date().toISOString() }, { onConflict: "user_id,provider" });
  return { ok: !error, error: error?.message };
}

export async function deleteProviderConnection(provider: ProviderId): Promise<{ ok: boolean; error?: string }> {
  if (!getOnline()) return { ok: false, error: OFFLINE_ERROR };
  const { error } = await supabase.from("provider_connections").delete().eq("provider", provider);
  return { ok: !error, error: error?.message };
}
