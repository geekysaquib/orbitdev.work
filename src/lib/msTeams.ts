/**
 * Microsoft Teams access via the Netlify function proxy (secrets stay
 * server-side). See netlify/functions/msteams-api.ts + msteams-exchange.ts.
 * Mirrors src/lib/gitlab.ts's shape — a tenant field plays the role gitlab.ts's
 * baseUrl does.
 */
import { authHeader } from "./auth";
import { postJson } from "./apiClient";
import { openOAuthPopup, randomState } from "./oauthPopup";
import { saveProviderConnection, deleteProviderConnection } from "./providerConnections";

const fn = "/.netlify/functions/msteams-api";
const SCOPE = "openid profile offline_access User.Read OnlineMeetings.ReadWrite";

async function get<T>(qs = ""): Promise<T> {
  const r = await fetch(fn + qs, { headers: authHeader() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Microsoft Teams fetch failed (${r.status})`);
  return j as T;
}

export async function fetchMsTeamsStatus(): Promise<{ connected: boolean; account: string | null; error?: string }> {
  try { return await get("?mode=status"); }
  catch (e) { return { connected: false, account: null, error: (e as Error).message }; }
}

/**
 * Full connect flow: opens a popup at Microsoft's v2.0 authorize endpoint,
 * waits for the grant code via src/routes/OAuthCallback.tsx, exchanges it
 * server-side, and saves the resulting tokens to provider_connections.
 */
export async function connectMsTeams(clientId: string, clientSecret: string, tenant: string): Promise<{ ok: boolean; account?: string | null; error?: string }> {
  const cleanTenant = (tenant || "common").trim();
  const redirectUri = `${window.location.origin}/oauth/callback`;
  const state = randomState();
  const authorizeUrl = `https://login.microsoftonline.com/${encodeURIComponent(cleanTenant)}/oauth2/v2.0/authorize?${new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: "code", response_mode: "query", scope: SCOPE, state,
  })}`;
  const result = await openOAuthPopup(authorizeUrl, state);
  if ("error" in result) return { ok: false, error: result.error };

  const res = await postJson<{ access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; external_account_id?: string; external_account_name?: string; tenant?: string }>(
    "/.netlify/functions/msteams-exchange",
    { clientId, clientSecret, code: result.code, redirectUri, tenant: cleanTenant },
  );
  if (!res.ok) return { ok: false, error: res.error };

  const expiresAt = res.expires_in ? new Date(Date.now() + res.expires_in * 1000).toISOString() : null;
  const saved = await saveProviderConnection("msteams", {
    client_id: clientId, client_secret: clientSecret,
    access_token: res.access_token ?? null, refresh_token: res.refresh_token ?? null,
    expires_at: expiresAt, scope: res.scope ?? null,
    external_account_id: res.external_account_id ?? null, external_account_name: res.external_account_name ?? null,
    config: { tenant: res.tenant ?? cleanTenant },
  });
  if (!saved.ok) return { ok: false, error: saved.error };
  return { ok: true, account: res.external_account_name };
}

export async function disconnectMsTeams(): Promise<{ ok: boolean; error?: string }> {
  return deleteProviderConnection("msteams");
}

export async function createTeamsMeeting(subject: string, startDateTime: string, endDateTime: string): Promise<{ ok: boolean; joinUrl?: string | null; error?: string }> {
  try {
    const r = await fetch(`${fn}?mode=create-meeting`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ subject, startDateTime, endDateTime }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: (j as { error?: string }).error || `Couldn't create the meeting (${r.status})` };
    return { ok: true, joinUrl: (j as { joinUrl?: string | null }).joinUrl ?? null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
