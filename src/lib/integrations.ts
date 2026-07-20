import { supabase } from "./supabase";
import { getUser } from "./auth";
import { getOnline, OFFLINE_ERROR } from "./offline";
import type { CloudProvider, ProviderKeys } from "./ai";

export interface Integrations {
  zoho_client_id?: string | null; zoho_client_secret?: string | null; zoho_refresh_token?: string | null;
  zoho_dc?: string | null; zoho_team_id?: string | null; zoho_project_id?: string | null;
  gmail_user?: string | null; gmail_app_password?: string | null;
  anthropic_api_key?: string | null; gemini_api_key?: string | null; openai_api_key?: string | null; grok_api_key?: string | null;
  ai_provider?: CloudProvider | null;
}

/** Pulls the four provider keys out of an `Integrations` row into the shape `ai.ts`'s fallback chain expects. */
export function providerKeys(i: Integrations | null): ProviderKeys {
  return { anthropic: i?.anthropic_api_key, gemini: i?.gemini_api_key, openai: i?.openai_api_key, grok: i?.grok_api_key };
}

export async function fetchIntegrations(): Promise<Integrations | null> {
  const { data, error } = await supabase.from("integrations").select("*").maybeSingle();
  if (error) return null;
  return (data as Integrations) ?? null;
}

/** Fired after a successful save so long-lived mounts (Ask AI) can re-read without a full page reload. */
export const INTEGRATIONS_EVENT = "orbit-integrations-change";

export async function saveIntegrations(patch: Integrations): Promise<{ error?: string }> {
  if (!getOnline()) return { error: OFFLINE_ERROR };
  const u = getUser();
  if (!u) return { error: "Not signed in" };
  const { error } = await supabase.from("integrations")
    .upsert({ user_id: u.id, ...patch, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (!error) { try { window.dispatchEvent(new Event(INTEGRATIONS_EVENT)); } catch { /* noop */ } }
  return { error: error?.message };
}
