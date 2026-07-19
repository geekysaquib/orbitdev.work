import type { Handler, HandlerEvent } from "@netlify/functions";
import { verifySession } from "./_lib/verifyToken";
import { loadConnection } from "./_lib/providerConnections";

/**
 * Sentry API proxy. No OAuth here — Sentry's own recommended path for
 * single-org use is an "Internal Integration" token (org settings ->
 * Developer Settings -> New Internal Integration), a non-expiring PAT. Same
 * trust model as github-api.ts/gitlab-api.ts otherwise: creds read strictly
 * from the caller's own `provider_connections` row.
 */

const json = (statusCode: number, data: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

async function sentry(org: string, path: string, token: string): Promise<{ ok: boolean; status: number; body: any }> {
  const r = await fetch(`https://sentry.io/api/0/organizations/${encodeURIComponent(org)}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

export const handler: Handler = async (event: HandlerEvent) => {
  const session = await verifySession(event.headers.authorization || event.headers.Authorization);
  if (!session) return json(401, { error: "Sign in to ORBIT first." });

  const conn = await loadConnection(event, "sentry");
  const org = String((conn?.config as { org_slug?: string })?.org_slug || "");
  const mode = event.queryStringParameters?.mode || "status";

  if (mode === "status") {
    if (!conn?.access_token || !org) return json(200, { connected: false });
    const r = await sentry(org, "/", conn.access_token);
    return json(200, { connected: r.ok, org });
  }
  if (!conn?.access_token) return json(400, { error: "Sentry isn't connected — connect it in Settings first." });
  if (!org) return json(400, { error: "No Sentry organization slug saved — reconnect in Settings." });
  const token = conn.access_token;

  const project = event.queryStringParameters?.project || "";

  try {
    switch (mode) {
      case "issues": {
        const qs = project ? `?project=${encodeURIComponent(project)}&query=is:unresolved&statsPeriod=14d` : "?query=is:unresolved&statsPeriod=14d";
        const r = await sentry(org, `/issues/${qs}`, token);
        if (!r.ok) return json(r.status, { error: r.body?.detail || "Couldn't list issues" });
        return json(200, {
          issues: (r.body as any[]).map((x) => ({ id: x.id, title: x.title, culprit: x.culprit, count: x.count, level: x.level, url: x.permalink, lastSeen: x.lastSeen })),
        });
      }
      case "releases": {
        const r = await sentry(org, "/releases/?per_page=10", token);
        if (!r.ok) return json(r.status, { error: r.body?.detail || "Couldn't list releases" });
        return json(200, { releases: (r.body as any[]).map((x) => ({ version: x.version, dateCreated: x.dateCreated, newGroups: x.newGroups })) });
      }
      default:
        return json(400, { error: `Unknown mode "${mode}"` });
    }
  } catch (e) {
    return json(502, { error: `Couldn't reach Sentry: ${(e as Error).message}` });
  }
};
