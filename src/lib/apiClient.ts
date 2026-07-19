import { authHeader } from "./auth";
import { getOnline } from "./offline";

/**
 * Shared POST-JSON-and-shape-the-result helper for our own Netlify functions
 * (auth.ts, teams.ts, zoho-exchange.ts) — they were each reimplementing this
 * fetch/parse/error-shape logic slightly differently.
 */
export type ApiResult<T> = ({ ok: true } & T) | { ok: false; error: string };

export async function postJson<T = Record<string, never>>(
  url: string,
  payload: Record<string, unknown>,
): Promise<ApiResult<T>> {
  if (!getOnline()) return { ok: false, error: "You're offline — check your connection and try again." };
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: (j as { error?: string }).error || `Request failed (${r.status})` };
    return { ok: true, ...(j as T) };
  } catch {
    return { ok: false, error: "Couldn't reach ORBIT — check your connection and try again." };
  }
}
