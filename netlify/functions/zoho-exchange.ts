import type { Handler } from "@netlify/functions";
import { verifySession } from "./_lib/verifyToken";
import { rateLimit } from "./_lib/rateLimit";

/**
 * Does the "grant code -> refresh token" exchange for Zoho's Self Client flow
 * server-side, so setting up Zoho in Settings never requires a terminal/curl.
 * The user still has to create a Self Client and generate a short-lived grant
 * code in the Zoho API Console (that step is Zoho's, not ours), but everything
 * after that — the token exchange — happens in-app.
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

  const rl = rateLimit(`zoho-exchange:${session.userId}`, 5, 300_000);
  if (!rl.allowed) return json(429, { error: `Too many attempts — try again in ${rl.retryAfterSec}s.` });

  let body: { clientId?: string; clientSecret?: string; code?: string; dc?: string };
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad request body" }); }

  const clientId = (body.clientId || "").trim();
  const clientSecret = (body.clientSecret || "").trim();
  const code = (body.code || "").trim();
  const dc = (body.dc || "in").trim();
  if (!clientId || !clientSecret || !code) return json(400, { error: "Client ID, Client Secret and the grant code are all required." });

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
  });

  let r: Response;
  try {
    r = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token`, { method: "POST", body: params });
  } catch (e) {
    return json(502, { error: `Couldn't reach Zoho: ${(e as Error).message}` });
  }
  const j = await r.json().catch(() => ({} as Record<string, unknown>));

  if (!j.refresh_token) {
    console.error("[zoho-exchange] token exchange failed", j);
    const reason = (j as { error?: string }).error;
    const hint = reason === "invalid_code"
      ? "That code is invalid, already used, or expired — grant codes are single-use and only last a few minutes. Generate a fresh one and try again right away."
      : reason === "invalid_client"
      ? "Client ID or Client Secret is incorrect — double-check them in the Zoho API Console."
      : "Zoho didn't return a refresh token. Double-check your Client ID/Secret/DC and try generating a fresh grant code.";
    return json(400, { error: hint });
  }

  return json(200, {
    refresh_token: (j as { refresh_token: string }).refresh_token,
    access_token: (j as { access_token?: string }).access_token,
    expires_in: (j as { expires_in?: number }).expires_in,
  });
};
