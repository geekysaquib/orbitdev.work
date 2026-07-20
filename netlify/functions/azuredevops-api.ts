import type { Handler, HandlerEvent } from "@netlify/functions";
import { verifySession } from "./_lib/verifyToken";
import { loadConnection } from "./_lib/providerConnections";

/**
 * Azure DevOps REST API proxy. Unlike GitHub/GitLab, the credential here is a
 * Personal Access Token pasted by the user (see src/components/
 * AzureDevopsSetupPanel.tsx) rather than an OAuth access token — so auth is
 * HTTP Basic with an empty username, per Azure DevOps' documented PAT scheme,
 * and there is no separate "-exchange" function for this provider.
 */

const API_VERSION = "api-version=7.1";

const json = (statusCode: number, data: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

async function ado(org: string, path: string, pat: string): Promise<{ ok: boolean; status: number; body: any }> {
  const auth = Buffer.from(`:${pat}`).toString("base64");
  const r = await fetch(`https://dev.azure.com/${encodeURIComponent(org)}${path}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

/** repo_full_name for this provider is stored as "project/repoName" — org is implicit (one org per connection). */
function splitFullName(full: string): { project: string; repo: string } | null {
  const i = full.indexOf("/");
  if (i < 0) return null;
  return { project: full.slice(0, i), repo: full.slice(i + 1) };
}

export const handler: Handler = async (event: HandlerEvent) => {
  const session = await verifySession(event.headers.authorization || event.headers.Authorization);
  if (!session) return json(401, { error: "Sign in to ORBIT first." });

  const conn = await loadConnection(event, "azuredevops");
  const mode = event.queryStringParameters?.mode || "status";
  const org = (conn?.config?.organization as string | undefined) || "";

  if (mode === "status") {
    if (!conn?.access_token || !org) return json(200, { connected: false, account: null });
    const r = await ado(org, `/_apis/projects?$top=1&${API_VERSION}`, conn.access_token);
    return json(200, { connected: r.ok, account: r.ok ? org : null, error: r.ok ? undefined : r.body?.message || `Azure DevOps ${r.status}` });
  }

  if (!conn?.access_token || !org) return json(400, { error: "Azure DevOps isn't connected — connect it in Settings first." });
  const pat = conn.access_token;

  try {
    if (mode === "repos") {
      const projRes = await ado(org, `/_apis/projects?$top=200&${API_VERSION}`, pat);
      if (!projRes.ok) return json(projRes.status, { error: projRes.body?.message || "Couldn't list projects" });
      const projects = (projRes.body?.value ?? []) as { name: string }[];

      const perProject = await Promise.all(projects.map(async (p) => {
        const r = await ado(org, `/${encodeURIComponent(p.name)}/_apis/git/repositories?${API_VERSION}`, pat);
        if (!r.ok) return [];
        const repos = (r.body?.value ?? []) as { id: string; name: string; defaultBranch?: string }[];
        return repos.map((repo) => ({
          id: repo.id,
          fullName: `${p.name}/${repo.name}`,
          defaultBranch: (repo.defaultBranch || "refs/heads/main").replace(/^refs\/heads\//, ""),
        }));
      }));
      return json(200, { repos: perProject.flat() });
    }

    const repoParam = event.queryStringParameters?.repo || "";
    const split = splitFullName(repoParam);
    if (!split) return json(400, { error: "repo required" });
    const { project, repo } = split;
    const branch = event.queryStringParameters?.branch || "";

    if (mode === "pulls") {
      const r = await ado(org, `/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests?searchCriteria.status=active&${API_VERSION}`, pat);
      if (!r.ok) return json(r.status, { error: r.body?.message || "Couldn't list pull requests" });
      const pulls = (r.body?.value ?? []) as any[];
      return json(200, {
        pulls: pulls.map((x) => ({
          number: x.pullRequestId, title: x.title, user: x.createdBy?.displayName,
          // ADO's "active PRs" list endpoint doesn't return a separate last-updated
          // timestamp without a per-PR follow-up call, so updatedAt reuses creationDate.
          createdAt: x.creationDate, updatedAt: x.creationDate,
          url: `https://dev.azure.com/${org}/${project}/_git/${repo}/pullrequest/${x.pullRequestId}`,
        })),
      });
    }

    if (mode === "commits") {
      const qs = branch ? `&searchCriteria.itemVersion.version=${encodeURIComponent(branch)}` : "";
      const r = await ado(org, `/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/commits?searchCriteria.$top=20${qs}&${API_VERSION}`, pat);
      if (!r.ok) return json(r.status, { error: r.body?.message || "Couldn't list commits" });
      const commits = (r.body?.value ?? []) as any[];
      return json(200, {
        commits: commits.map((x) => ({
          hash: x.commitId, author: x.author?.name, date: x.author?.date,
          subject: (x.comment || "").split("\n")[0],
          url: `https://dev.azure.com/${org}/${project}/_git/${repo}/commit/${x.commitId}`,
        })),
      });
    }

    if (mode === "runs") {
      const r = await ado(org, `/${encodeURIComponent(project)}/_apis/build/builds?repositoryId=${encodeURIComponent(repo)}&repositoryType=TfsGit&$top=5&${API_VERSION}`, pat);
      // repositoryId also accepts a repo name for TfsGit repos per Azure DevOps' Builds API.
      if (!r.ok) return json(r.status, { error: r.body?.message || "Couldn't list builds" });
      const builds = (r.body?.value ?? []) as any[];
      return json(200, {
        runs: builds.map((x) => ({
          id: x.id, name: x.definition?.name || "Build", status: x.status === "completed" ? "completed" : x.status,
          conclusion: x.result ?? null, url: x._links?.web?.href || null, createdAt: x.queueTime || x.startTime,
        })),
      });
    }

    return json(400, { error: `Unknown mode "${mode}"` });
  } catch (e) {
    return json(502, { error: `Couldn't reach Azure DevOps: ${(e as Error).message}` });
  }
};
