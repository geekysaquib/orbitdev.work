import type { Handler, HandlerEvent } from "@netlify/functions";
import { verifySession } from "./_lib/verifyToken";
import { loadConnection } from "./_lib/providerConnections";

/**
 * GitHub REST API proxy. Credentials are read strictly from the caller's own
 * row in `provider_connections` (via their JWT + RLS) — no environment
 * fallback, same trust model as netlify/functions/zoho-sprints.ts.
 */

const json = (statusCode: number, data: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

async function gh(path: string, token: string): Promise<{ ok: boolean; status: number; body: any }> {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "orbit-app" },
  });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

export const handler: Handler = async (event: HandlerEvent) => {
  const session = await verifySession(event.headers.authorization || event.headers.Authorization);
  if (!session) return json(401, { error: "Sign in to ORBIT first." });

  const conn = await loadConnection(event, "github");
  const mode = event.queryStringParameters?.mode || "status";

  if (mode === "status") {
    return json(200, { connected: !!conn?.access_token, account: conn?.external_account_name ?? null });
  }
  if (!conn?.access_token) return json(400, { error: "GitHub isn't connected — connect it in Settings first." });
  const token = conn.access_token;

  const repo = event.queryStringParameters?.repo || "";
  const branch = event.queryStringParameters?.branch || "";

  try {
    switch (mode) {
      case "repos": {
        const r = await gh("/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member", token);
        if (!r.ok) return json(r.status, { error: r.body?.message || "Couldn't list repos" });
        return json(200, { repos: (r.body as any[]).map((x) => ({ id: String(x.id), fullName: x.full_name, defaultBranch: x.default_branch, private: x.private })) });
      }
      case "pulls": {
        if (!repo) return json(400, { error: "repo required" });
        const r = await gh(`/repos/${repo}/pulls?state=open&per_page=50`, token);
        if (!r.ok) return json(r.status, { error: r.body?.message || "Couldn't list pull requests" });
        return json(200, { pulls: (r.body as any[]).map((x) => ({ number: x.number, title: x.title, url: x.html_url, user: x.user?.login, createdAt: x.created_at, updatedAt: x.updated_at })) });
      }
      case "commits": {
        if (!repo) return json(400, { error: "repo required" });
        const qs = branch ? `?sha=${encodeURIComponent(branch)}&per_page=20` : "?per_page=20";
        const r = await gh(`/repos/${repo}/commits${qs}`, token);
        if (!r.ok) return json(r.status, { error: r.body?.message || "Couldn't list commits" });
        return json(200, {
          commits: (r.body as any[]).map((x) => ({
            hash: x.sha, author: x.commit?.author?.name, date: x.commit?.author?.date, subject: (x.commit?.message || "").split("\n")[0], url: x.html_url,
          })),
        });
      }
      case "runs": {
        if (!repo) return json(400, { error: "repo required" });
        const qs = branch ? `?branch=${encodeURIComponent(branch)}&per_page=5` : "?per_page=5";
        const r = await gh(`/repos/${repo}/actions/runs${qs}`, token);
        if (!r.ok) return json(r.status, { error: r.body?.message || "Couldn't list workflow runs" });
        const runs = (r.body?.workflow_runs ?? []) as any[];
        return json(200, {
          runs: runs.map((x) => ({ id: x.id, name: x.name, status: x.status, conclusion: x.conclusion, url: x.html_url, createdAt: x.created_at })),
        });
      }
      default:
        return json(400, { error: `Unknown mode "${mode}"` });
    }
  } catch (e) {
    return json(502, { error: `Couldn't reach GitHub: ${(e as Error).message}` });
  }
};
