import { supabase } from "./supabase";

export interface Integrations {
  zoho_client_id?: string | null; zoho_client_secret?: string | null; zoho_refresh_token?: string | null;
  zoho_dc?: string | null; zoho_team_id?: string | null; zoho_project_id?: string | null;
  gmail_user?: string | null; gmail_app_password?: string | null;
}

export async function fetchIntegrations(): Promise<Integrations | null> {
  const { data, error } = await supabase.from("integrations").select("*").maybeSingle();
  if (error) return null;
  return (data as Integrations) ?? null;
}

export async function saveIntegrations(patch: Integrations): Promise<{ error?: string }> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { error: "Not signed in" };
  const { error } = await supabase.from("integrations")
    .upsert({ user_id: u.user.id, ...patch, updated_at: new Date().toISOString() } as never, { onConflict: "user_id" });
  return { error: error?.message };
}
