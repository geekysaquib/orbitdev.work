import type { Handler } from "@netlify/functions";

/**
 * Deliberately unauthenticated and DB-free — used by src/lib/offline.ts as a
 * connectivity heartbeat. A Supabase-scoped query would conflate "internet is
 * up" with "Supabase specifically is up" (or an expired token), which isn't
 * what "you're offline" should mean.
 */
export const handler: Handler = async () => ({
  statusCode: 200,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ok: true }),
});
