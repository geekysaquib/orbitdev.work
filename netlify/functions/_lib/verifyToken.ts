import jwt from "jsonwebtoken";
import { dbSelect } from "./db";

/**
 * Verifies an ORBIT session JWT (see netlify/functions/auth.ts for how it's
 * signed). Only needed here — direct PostgREST calls never hit this code
 * because Postgres/PostgREST verifies the JWT itself for those (which means
 * the revocation check below only protects the endpoints that call this
 * function, not direct browser -> PostgREST CRUD on other tables). This
 * function isn't going through PostgREST, so it has to check the caller's
 * identity on its own before doing anything privileged with the service-role
 * key.
 */
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || "";

export interface SessionClaims {
  userId: string;
  email: string;
}

/**
 * Verifies signature + expiry, then rejects tokens issued before the user's
 * last password change — otherwise a 30-day JWT stays valid for its full
 * lifetime even after a reset (`auth.ts`'s "reset" action bumps
 * `password_changed_at`, see supabase/migrations.sql).
 */
export async function verifySession(authHeader: string | undefined): Promise<SessionClaims | null> {
  const token = (authHeader || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !JWT_SECRET) return null;
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"], audience: "authenticated" }) as jwt.JwtPayload;
  } catch {
    return null;
  }
  if (!payload.sub || typeof payload.email !== "string" || typeof payload.iat !== "number") return null;

  try {
    const rows = await dbSelect<{ password_changed_at: string }>(
      "users",
      `id=eq.${payload.sub}&select=password_changed_at&limit=1`,
    );
    const changedAt = rows[0]?.password_changed_at ? new Date(rows[0].password_changed_at).getTime() : 0;
    // 1s slack so a reset that happens in the same second a token was issued doesn't self-revoke.
    if (changedAt > payload.iat * 1000 + 1000) return null;
  } catch {
    // DB hiccup on the revocation check itself: fail open rather than locking everyone
    // out — the signature/expiry check above is still the primary guard.
  }

  return { userId: payload.sub, email: payload.email };
}
