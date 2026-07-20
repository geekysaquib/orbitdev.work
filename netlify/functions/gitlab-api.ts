import type { Handler, HandlerEvent } from "@netlify/functions";
import { verifySession } from "./_lib/verifyToken";
import { loadConnection } from "./_lib/providerConnections";

/**
 * GitLab REST API proxy (v4). Mirrors github-api.ts's shape and trust model —
 * credentials read strictly from the caller's own `provider_connections` row.
 * Supports self-hosted instances via `config.base_url` (default gitlab.com).
 */

const json = (statusCode: number, data: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

async function gl(baseUrl: string, path: string, token: string): Promise<{ ok: boolean; status: number; body: any }> {
  const r = await fetch(`${baseUrl}/api/v4${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

export const handler: Handler = async (event: HandlerEvent) => {
  const session = await verifySession(event.headers.authorization || event.headers.Authorization);
  if (!session) return json(401, { error: "Sign in to ORBIT first." });

  const conn = await loadConnection(event, "gitlab");
  const baseUrl = String((conn?.config as { base_url?: string })?.base_url || "https://gitlab.com").replace(/\/+$/, "");
  const mode = event.queryStringParameters?.mode || "status";

  if (mode === "status") {
    return json(200, { connected: !!conn?.access_token, account: conn?.external_account_name ?? null, baseUrl });
  }
  if (!conn?.access_token) return json(400, { error: "GitLab isn't connected — connect it in Settings first." });
  const token = conn.access_token;

  const repo = event.queryStringParameters?.repo || ""; // GitLab project id
  const branch = event.queryStringParameters?.branch || "";

  try {
    switch (mode) {
      case "repos": {
        const r = await gl(baseUrl, "/projects?membership=true&per_page=100&order_by=last_activity_at", token);
        if (!r.ok) return json(r.status, { error: r.body?.message || "Couldn't list projects" });
        return json(200, { repos: (r.body as any[]).map((x) => ({ id: String(x.id), fullName: x.path_with_namespace, defaultBranch: x.default_branch, private: x.visibility !== "public" })) });
      }
      case "pulls": {
        if (!repo) return json(400, { error: "repo required" });
        const r = await gl(baseUrl, `/projects/${encodeURIComponent(repo)}/merge_requests?state=opened&per_page=50`, token);
        if (!r.ok) return json(r.status, { error: r.body?.message || "Couldn't list merge requests" });
        return json(200, { pulls: (r.body as any[]).map((x) => ({ number: x.iid, title: x.title, url: x.web_url, user: x.author?.username, createdAt: x.created_at, updatedAt: x.updated_at })) });
      }
      case "commits": {
        if (!repo) return json(400, { error: "repo required" });
        const qs = branch ? `?ref_name=${encodeURIComponent(branch)}&per_page=20` : "?per_page=20";
        const r = await gl(baseUrl, `/projects/${encodeURIComponent(repo)}/repository/commits${qs}`, token);
        if (!r.ok) return json(r.status, { error: r.body?.message || "Couldn't list commits" });
        return json(200, {
          commits: (r.body as any[]).map((x) => ({ hash: x.id, author: x.author_name, date: x.authored_date, subject: (x.title || ""), url: x.web_url })),
        });
      }
      case "runs": {
        if (!repo) return json(400, { error: "repo required" });
        const qs = branch ? `?ref=${encodeURIComponent(branch)}&per_page=5` : "?per_page=5";
        const r = await gl(baseUrl, `/projects/${encodeURIComponent(repo)}/pipelines${qs}`, token);
        if (!r.ok) return json(r.status, { error: r.body?.message || "Couldn't list pipelines" });
        return json(200, {
          runs: (r.body as any[]).map((x) => ({ id: x.id, name: `Pipeline #${x.id}`, status: x.status, conclusion: x.status, url: x.web_url, createdAt: x.created_at })),
        });
      }
      default:
        return json(400, { error: `Unknown mode "${mode}"` });
    }
  } catch (e) {
    return json(502, { error: `Couldn't reach ${baseUrl}: ${(e as Error).message}` });
  }
};
