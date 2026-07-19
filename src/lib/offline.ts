/**
 * Non-React source of truth for connectivity, mirroring src/lib/auth.ts's
 * plain-accessor-plus-event pattern. Non-hook call sites (apiClient, useTable,
 * lib/integrations.ts, lib/pg.ts, lib/settings.ts) read getOnline() directly;
 * src/context/Offline.tsx mirrors this into React state for UI.
 */

let online = typeof navigator === "undefined" ? true : navigator.onLine;
const listeners = new Set<(online: boolean) => void>();

export function getOnline(): boolean {
  return online;
}

export function setOnline(v: boolean): void {
  if (v === online) return;
  online = v;
  for (const fn of listeners) fn(online);
}

export function subscribeOnline(fn: (online: boolean) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Hits a trivial, unauthenticated Netlify function to verify real connectivity. */
export async function pingBackend(timeoutMs = 4000): Promise<boolean> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch("/.netlify/functions/ping", { signal: controller.signal, cache: "no-store" });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export const OFFLINE_ERROR = "You're offline — changes can't be saved until your connection is back.";
