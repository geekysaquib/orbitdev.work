import type { Handler } from "@netlify/functions";
import { verifySession } from "./_lib/verifyToken";

/**
 * Does the "grant code -> access token" exchange for a user's own GitLab
 * OAuth App server-side. Mirrors github-exchange.ts's shape; GitLab's token
 * endpoint additionally supports self-hosted instances via `baseUrl`.
 */

const json = (statusCode: number, data: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const session = await verifySession(event.headers.authorization || event.headers.Authorization);
  if (!session) return json(401, { error: "Sign in to ORBIT first." });

  let body: { clientId?: string; clientSecret?: string; code?: string; redirectUri?: string; baseUrl?: string };
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad request body" }); }

  const clientId = (body.clientId || "").trim();
  const clientSecret = (body.clientSecret || "").trim();
  const code = (body.code || "").trim();
  const redirectUri = (body.redirectUri || "").trim();
  const baseUrl = (body.baseUrl || "https://gitlab.com").trim().replace(/\/+$/, "");
  if (!clientId || !clientSecret || !code) return json(400, { error: "Application ID, Secret and the authorization code are all required." });

  let r: Response;
  try {
    r = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri }),
    });
  } catch (e) {
    return json(502, { error: `Couldn't reach ${baseUrl}: ${(e as Error).message}` });
  }
  const j = await r.json().catch(() => ({} as Record<string, unknown>));

  if (!j.access_token) {
    console.error("[gitlab-exchange] token exchange failed", j);
    const hint = (j as { error?: string }).error === "invalid_grant"
      ? "That authorization code is invalid, already used, or expired — try connecting again."
      : "GitLab didn't return an access token. Double-check your Application ID/Secret, instance URL, and try again.";
    return json(400, { error: hint });
  }

  const accessToken = (j as { access_token: string }).access_token;
  let username: string | null = null;
  let accountId: string | null = null;
  try {
    const me = await fetch(`${baseUrl}/api/v4/user`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (me.ok) {
      const mj = await me.json();
      username = mj.username ?? null;
      accountId = mj.id != null ? String(mj.id) : null;
    }
  } catch { /* non-fatal */ }

  return json(200, {
    access_token: accessToken,
    refresh_token: (j as { refresh_token?: string }).refresh_token ?? null,
    expires_in: (j as { expires_in?: number }).expires_in ?? null,
    scope: (j as { scope?: string }).scope ?? null,
    external_account_id: accountId,
    external_account_name: username,
    base_url: baseUrl,
  });
};
