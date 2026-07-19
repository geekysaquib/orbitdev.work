import type { Handler } from "@netlify/functions";
import { verifySession } from "./_lib/verifyToken";

/**
 * Does the "grant code -> access token" exchange for a user's own GitHub
 * OAuth App server-side, so client_secret never has to round-trip anywhere
 * except this one call. Mirrors netlify/functions/zoho-exchange.ts's shape,
 * but GitHub supports a real redirect URI (see src/lib/oauthPopup.ts +
 * src/routes/OAuthCallback.tsx for the popup flow that gets the grant code
 * here in the first place).
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

  let body: { clientId?: string; clientSecret?: string; code?: string; redirectUri?: string };
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad request body" }); }

  const clientId = (body.clientId || "").trim();
  const clientSecret = (body.clientSecret || "").trim();
  const code = (body.code || "").trim();
  const redirectUri = (body.redirectUri || "").trim();
  if (!clientId || !clientSecret || !code) return json(400, { error: "Client ID, Client Secret and the authorization code are all required." });

  let r: Response;
  try {
    r = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
    });
  } catch (e) {
    return json(502, { error: `Couldn't reach GitHub: ${(e as Error).message}` });
  }
  const j = await r.json().catch(() => ({} as Record<string, unknown>));

  if (!j.access_token) {
    console.error("[github-exchange] token exchange failed", j);
    const reason = (j as { error?: string }).error;
    const hint = reason === "bad_verification_code"
      ? "That authorization code is invalid, already used, or expired — try connecting again."
      : reason === "incorrect_client_credentials"
      ? "Client ID or Client Secret is incorrect — double-check them on your GitHub OAuth App page."
      : "GitHub didn't return an access token. Double-check your Client ID/Secret and try again.";
    return json(400, { error: hint });
  }

  const accessToken = (j as { access_token: string }).access_token;
  let login: string | null = null;
  let accountId: string | null = null;
  try {
    const me = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json", "User-Agent": "orbit-app" },
    });
    if (me.ok) {
      const mj = await me.json();
      login = mj.login ?? null;
      accountId = mj.id != null ? String(mj.id) : null;
    }
  } catch { /* non-fatal — connection still succeeds without the account label */ }

  return json(200, {
    access_token: accessToken,
    refresh_token: (j as { refresh_token?: string }).refresh_token ?? null,
    expires_in: (j as { expires_in?: number }).expires_in ?? null,
    scope: (j as { scope?: string }).scope ?? null,
    external_account_id: accountId,
    external_account_name: login,
  });
};
