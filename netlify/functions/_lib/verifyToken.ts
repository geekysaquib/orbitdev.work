import jwt from "jsonwebtoken";

/**
 * Verifies an ORBIT session JWT (see netlify/functions/auth.ts for how it's
 * signed). Only needed here — direct PostgREST calls never hit this code
 * because Postgres/PostgREST verifies the JWT itself for those. This function
 * isn't going through PostgREST, so it has to check the caller's identity on
 * its own before doing anything privileged with the service-role key.
 */
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || "";

export interface SessionClaims {
  userId: string;
  email: string;
}

export function verifySession(authHeader: string | undefined): SessionClaims | null {
  const token = (authHeader || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !JWT_SECRET) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"], audience: "authenticated" }) as jwt.JwtPayload;
    if (!payload.sub || typeof payload.email !== "string") return null;
    return { userId: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}
