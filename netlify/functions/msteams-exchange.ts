import type { Handler } from "@netlify/functions";
import { verifySession } from "./_lib/verifyToken";
import { rateLimit } from "./_lib/rateLimit";

/**
 * Grant-code -> access-token exchange for a user's own Entra ID (Azure AD) app
 * registration, against the Microsoft identity platform v2.0 endpoint. Mirrors
 * gitlab-exchange.ts's shape; `tenant` plays the same per-installation role
 * `baseUrl` does there (default "common" for personal + any-org accounts).
 */

const json = (statusCode: number, data: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

const SCOPE = "openid profile offline_access User.Read OnlineMeetings.ReadWrite";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const session = await verifySession(event.headers.authorization || event.headers.Authorization);
  if (!session) return json(401, { error: "Sign in to ORBIT first." });

  const rl = rateLimit(`msteams-exchange:${session.userId}`, 5, 300_000);
  if (!rl.allowed) return json(429, { error: `Too many attempts — try again in ${rl.retryAfterSec}s.` });

  let body: { clientId?: string; clientSecret?: string; code?: string; redirectUri?: string; tenant?: string };
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad request body" }); }

  const clientId = (body.clientId || "").trim();
  const clientSecret = (body.clientSecret || "").trim();
  const code = (body.code || "").trim();
  const redirectUri = (body.redirectUri || "").trim();
  const tenant = (body.tenant || "common").trim();
  if (!clientId || !clientSecret || !code) return json(400, { error: "Application (client) ID, Secret and the authorization code are all required." });

  let r: Response;
  try {
    r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret, code, grant_type: "authorization_code",
        redirect_uri: redirectUri, scope: SCOPE,
      }),
    });
  } catch (e) {
    return json(502, { error: `Couldn't reach Microsoft: ${(e as Error).message}` });
  }
  const j = await r.json().catch(() => ({} as Record<string, unknown>));

  if (!j.access_token) {
    console.error("[msteams-exchange] token exchange failed", j);
    const hint = (j as { error?: string }).error === "invalid_grant"
      ? "That authorization code is invalid, already used, or expired — try connecting again."
      : "Microsoft didn't return an access token. Double-check your Application ID/Secret, tenant, and try again.";
    return json(400, { error: hint });
  }

  const accessToken = (j as { access_token: string }).access_token;
  let account: string | null = null;
  let accountId: string | null = null;
  try {
    const me = await fetch("https://graph.microsoft.com/v1.0/me", { headers: { Authorization: `Bearer ${accessToken}` } });
    if (me.ok) {
      const mj = await me.json();
      account = mj.userPrincipalName ?? mj.mail ?? mj.displayName ?? null;
      accountId = mj.id ?? null;
    }
  } catch { /* non-fatal */ }

  return json(200, {
    access_token: accessToken,
    refresh_token: (j as { refresh_token?: string }).refresh_token ?? null,
    expires_in: (j as { expires_in?: number }).expires_in ?? null,
    scope: (j as { scope?: string }).scope ?? SCOPE,
    external_account_id: accountId,
    external_account_name: account,
    tenant,
  });
};
