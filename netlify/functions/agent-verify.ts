import type { Handler } from "@netlify/functions";
import { verifySession } from "./_lib/verifyToken";

/**
 * Lets the local agent (agent/server.mjs) verify a caller's ORBIT session
 * without ever holding SUPABASE_JWT_SECRET itself — the packaged orbit.exe is
 * a public download, so the signing secret can't ship inside it. The agent
 * calls this on every request (with a short local cache) instead of doing
 * HS256 verification in-process.
 */
const json = (statusCode: number, data: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  const session = await verifySession(event.headers.authorization || event.headers.Authorization);
  if (!session) return json(401, { ok: false });

  return json(200, { ok: true, userId: session.userId, email: session.email });
};
