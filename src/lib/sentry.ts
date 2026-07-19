/**
 * Sentry access via the Netlify function proxy (secrets stay server-side).
 * See netlify/functions/sentry-api.ts. Paste-token connect (Internal
 * Integration token) — no OAuth popup, unlike GitHub/GitLab.
 */
import { authHeader } from "./auth";
import { saveProviderConnection, deleteProviderConnection } from "./providerConnections";

const fn = "/.netlify/functions/sentry-api";

async function get<T>(qs = ""): Promise<T> {
  const r = await fetch(fn + qs, { headers: authHeader() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Sentry fetch failed (${r.status})`);
  return j as T;
}

export async function fetchSentryStatus(): Promise<{ connected: boolean; org?: string; error?: string }> {
  try { return await get("?mode=status"); }
  catch (e) { return { connected: false, error: (e as Error).message }; }
}

export interface SentryIssue { id: string; title: string; culprit: string; count: string; level: string; url: string; lastSeen: string; }
export async function fetchSentryIssues(project?: string): Promise<SentryIssue[]> {
  const qs = project ? `?mode=issues&project=${encodeURIComponent(project)}` : "?mode=issues";
  const j = await get<{ issues: SentryIssue[] }>(qs);
  return j.issues ?? [];
}

export interface SentryRelease { version: string; dateCreated: string; newGroups: number; }
export async function fetchSentryReleases(): Promise<SentryRelease[]> {
  const j = await get<{ releases: SentryRelease[] }>("?mode=releases");
  return j.releases ?? [];
}

export async function connectSentry(orgSlug: string, token: string): Promise<{ ok: boolean; error?: string }> {
  const saved = await saveProviderConnection("sentry", { access_token: token, config: { org_slug: orgSlug } });
  if (!saved.ok) return saved;
  const status = await fetchSentryStatus();
  if (!status.connected) {
    await deleteProviderConnection("sentry");
    return { ok: false, error: "Couldn't verify that org/token — double-check the organization slug and Internal Integration token." };
  }
  return { ok: true };
}

export async function disconnectSentry(): Promise<{ ok: boolean; error?: string }> {
  return deleteProviderConnection("sentry");
}
