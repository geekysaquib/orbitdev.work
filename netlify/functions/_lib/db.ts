/**
 * Minimal Supabase REST (PostgREST) client using the service-role key, so
 * these calls bypass RLS entirely. Only ever import this from server code
 * (Netlify functions) — the service-role key must never reach the browser.
 */
const URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function headers(extra?: Record<string, string>): Record<string, string> {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...extra };
}

function assertConfigured() {
  if (!URL || !SERVICE_KEY) throw new Error("Server misconfigured — set SUPABASE_SERVICE_ROLE_KEY (and VITE_SUPABASE_URL) in the function environment.");
}

/** `query` is a raw PostgREST query string, e.g. `email=eq.foo@bar.com&limit=1`. */
export async function dbSelect<T = Record<string, unknown>>(table: string, query: string): Promise<T[]> {
  assertConfigured();
  const r = await fetch(`${URL}/rest/v1/${table}?${query}`, { headers: headers() });
  if (!r.ok) throw new Error(`db select ${table} failed: ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`);
  return r.json();
}

export async function dbInsert<T = Record<string, unknown>>(table: string, row: Record<string, unknown>): Promise<T> {
  assertConfigured();
  const r = await fetch(`${URL}/rest/v1/${table}`, {
    method: "POST", headers: headers({ Prefer: "return=representation" }), body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`db insert ${table} failed: ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`);
  const j = await r.json();
  return Array.isArray(j) ? j[0] : j;
}

export async function dbUpdate(table: string, query: string, patch: Record<string, unknown>): Promise<void> {
  assertConfigured();
  const r = await fetch(`${URL}/rest/v1/${table}?${query}`, { method: "PATCH", headers: headers(), body: JSON.stringify(patch) });
  if (!r.ok) throw new Error(`db update ${table} failed: ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`);
}
