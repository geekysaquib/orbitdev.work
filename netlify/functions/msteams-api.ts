import type { Handler, HandlerEvent } from "@netlify/functions";
import { verifySession } from "./_lib/verifyToken";
import { loadConnection, type ProviderConnectionRow } from "./_lib/providerConnections";

/**
 * Microsoft Graph proxy for the Teams meeting integration. Mirrors
 * gitlab-api.ts's trust model (RLS-scoped read of the caller's own
 * provider_connections row via loadConnection, never the service-role key)
 * but adds one thing the other provider proxies skip: Graph access tokens
 * expire in ~1hr (vs GitHub's effectively-permanent tokens and GitLab's ~2hr
 * ones, neither of which ORBIT bothers refreshing), so this refreshes and
 * writes the new token back — via the same RLS-scoped REST call loadConnection
 * already uses, with the caller's own JWT, not a service-role bypass — before
 * every Graph call rather than letting the integration silently die hourly.
 */

const json = (statusCode: number, data: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

async function saveTokens(event: HandlerEvent, patch: { access_token: string; expires_at: string; refresh_token?: string }) {
  const auth = event.headers.authorization || event.headers.Authorization;
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return;
  await fetch(`${url}/rest/v1/provider_connections?provider=eq.msteams`, {
    method: "PATCH",
    headers: { apikey: anon, Authorization: auth || "", "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  }).catch(() => {});
}

/** Refreshes if the token is missing or within 2 minutes of expiring — a Graph call mid-flight shouldn't race an expiry. */
async function ensureFreshToken(event: HandlerEvent, conn: ProviderConnectionRow): Promise<{ token: string; error?: string }> {
  const soon = Date.now() + 2 * 60_000;
  if (conn.access_token && (!conn.expires_at || new Date(conn.expires_at).getTime() > soon)) {
    return { token: conn.access_token };
  }
  if (!conn.refresh_token || !conn.client_id || !conn.client_secret) {
    return { token: "", error: "Microsoft Teams needs reconnecting — the saved session has expired." };
  }
  const tenant = String((conn.config as { tenant?: string })?.tenant || "common");
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: conn.client_id, client_secret: conn.client_secret,
      grant_type: "refresh_token", refresh_token: conn.refresh_token,
      scope: "openid profile offline_access User.Read OnlineMeetings.ReadWrite",
    }),
  });
  const j = await r.json().catch(() => ({} as Record<string, unknown>));
  if (!j.access_token) return { token: "", error: "Couldn't refresh the Microsoft Teams connection — reconnect it in Settings." };

  const expiresAt = new Date(Date.now() + ((j.expires_in as number) ?? 3600) * 1000).toISOString();
  await saveTokens(event, { access_token: j.access_token as string, expires_at: expiresAt, refresh_token: (j.refresh_token as string) ?? conn.refresh_token });
  return { token: j.access_token as string };
}

export const handler: Handler = async (event: HandlerEvent) => {
  const session = await verifySession(event.headers.authorization || event.headers.Authorization);
  if (!session) return json(401, { error: "Sign in to ORBIT first." });

  const conn = await loadConnection(event, "msteams");
  const mode = event.queryStringParameters?.mode || "status";

  if (mode === "status") {
    return json(200, { connected: !!conn?.access_token, account: conn?.external_account_name ?? null });
  }
  if (!conn?.access_token) return json(400, { error: "Microsoft Teams isn't connected — connect it in Settings first." });

  const { token, error } = await ensureFreshToken(event, conn);
  if (error) return json(400, { error });

  if (mode === "create-meeting") {
    let body: { subject?: string; startDateTime?: string; endDateTime?: string };
    try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad request body" }); }
    const subject = (body.subject || "ORBIT meeting").trim();
    const startDateTime = body.startDateTime;
    const endDateTime = body.endDateTime;
    if (!startDateTime || !endDateTime) return json(400, { error: "startDateTime and endDateTime are required." });

    const r = await fetch("https://graph.microsoft.com/v1.0/me/onlineMeetings", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ subject, startDateTime, endDateTime }),
    });
    const j = await r.json().catch(() => ({} as Record<string, unknown>));
    if (!r.ok) return json(r.status, { error: (j as { error?: { message?: string } }).error?.message || "Couldn't create the Teams meeting." });
    return json(200, { joinUrl: (j as { joinWebUrl?: string }).joinWebUrl ?? null });
  }

  return json(400, { error: `Unknown mode "${mode}"` });
};
