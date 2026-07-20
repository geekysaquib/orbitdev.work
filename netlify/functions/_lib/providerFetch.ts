/**
 * Raw GitHub/GitLab/Azure DevOps/Sentry REST calls for the daily-brief and
 * anomaly-scan scheduled functions. NOT routed through github-api.ts /
 * gitlab-api.ts / azuredevops-api.ts / sentry-api.ts — those are JWT-gated
 * HTTP proxies meant for the browser to call, and a cron job has no caller
 * JWT. This file talks to each provider directly using the raw access
 * token/PAT already loaded from `provider_connections` via service-role
 * `dbSelect` (see _lib/db.ts), same idiom as _lib/anthropic.ts calling
 * Anthropic directly instead of going through src/lib/ai.ts.
 */

export type RepoProvider = "github" | "gitlab" | "azuredevops";

export interface RawPull { id: string | number; title: string; url: string; createdAt: string; updatedAt: string; }
export interface RawRun { status: string; conclusion: string | null; createdAt: string; }

/** Azure DevOps stores `repo_full_name` as "project/repoName" (org is implicit, one org per connection) — mirrors azuredevops-api.ts's own `splitFullName`. */
function splitAdoFullName(full: string): { project: string; repo: string } | null {
  const i = full.indexOf("/");
  if (i < 0) return null;
  return { project: full.slice(0, i), repo: full.slice(i + 1) };
}

export async function fetchOpenPulls(
  provider: RepoProvider, token: string, repoFullName: string, config: Record<string, unknown> = {},
): Promise<RawPull[]> {
  try {
    if (provider === "github") {
      const r = await fetch(`https://api.github.com/repos/${repoFullName}/pulls?state=open&per_page=50`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "orbit-app" },
      });
      if (!r.ok) return [];
      const body = (await r.json()) as any[];
      return body.map((x) => ({ id: x.number, title: x.title, url: x.html_url, createdAt: x.created_at, updatedAt: x.updated_at }));
    }
    if (provider === "gitlab") {
      const baseUrl = String(config.base_url || "https://gitlab.com").replace(/\/+$/, "");
      const r = await fetch(`${baseUrl}/api/v4/projects/${encodeURIComponent(repoFullName)}/merge_requests?state=opened&per_page=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return [];
      const body = (await r.json()) as any[];
      return body.map((x) => ({ id: x.iid, title: x.title, url: x.web_url, createdAt: x.created_at, updatedAt: x.updated_at }));
    }
    // azuredevops
    const org = String(config.organization || "");
    const split = splitAdoFullName(repoFullName);
    if (!org || !split) return [];
    const auth = Buffer.from(`:${token}`).toString("base64");
    const r = await fetch(
      `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(split.project)}/_apis/git/repositories/${encodeURIComponent(split.repo)}/pullrequests?searchCriteria.status=active&api-version=7.1`,
      { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } },
    );
    if (!r.ok) return [];
    const body = (await r.json()) as { value?: any[] };
    return (body.value ?? []).map((x) => ({ id: x.pullRequestId, title: x.title, url: `https://dev.azure.com/${org}/${split.project}/_git/${split.repo}/pullrequest/${x.pullRequestId}`, createdAt: x.creationDate, updatedAt: x.creationDate }));
  } catch (e) {
    console.error(`[providerFetch] fetchOpenPulls(${provider}) failed`, e);
    return [];
  }
}

export async function fetchRecentRuns(
  provider: RepoProvider, token: string, repoFullName: string, config: Record<string, unknown> = {},
): Promise<RawRun[]> {
  try {
    if (provider === "github") {
      const r = await fetch(`https://api.github.com/repos/${repoFullName}/actions/runs?per_page=15`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "orbit-app" },
      });
      if (!r.ok) return [];
      const body = (await r.json()) as { workflow_runs?: any[] };
      return (body.workflow_runs ?? []).map((x) => ({ status: x.status, conclusion: x.conclusion, createdAt: x.created_at }));
    }
    if (provider === "gitlab") {
      const baseUrl = String(config.base_url || "https://gitlab.com").replace(/\/+$/, "");
      const r = await fetch(`${baseUrl}/api/v4/projects/${encodeURIComponent(repoFullName)}/pipelines?per_page=15`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return [];
      const body = (await r.json()) as any[];
      return body.map((x) => ({ status: x.status, conclusion: x.status, createdAt: x.created_at }));
    }
    // azuredevops
    const org = String(config.organization || "");
    const split = splitAdoFullName(repoFullName);
    if (!org || !split) return [];
    const auth = Buffer.from(`:${token}`).toString("base64");
    const r = await fetch(
      `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(split.project)}/_apis/build/builds?repositoryId=${encodeURIComponent(split.repo)}&repositoryType=TfsGit&$top=15&api-version=7.1`,
      { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } },
    );
    if (!r.ok) return [];
    const body = (await r.json()) as { value?: any[] };
    return (body.value ?? []).map((x) => ({ status: x.status === "completed" ? "completed" : x.status, conclusion: x.result ?? null, createdAt: x.queueTime || x.startTime }));
  } catch (e) {
    console.error(`[providerFetch] fetchRecentRuns(${provider}) failed`, e);
    return [];
  }
}

/** Count of commits since `sinceIso` on the repo's default branch — used for the "hours logged, no commits" anomaly check. */
export async function fetchCommitCountSince(
  provider: RepoProvider, token: string, repoFullName: string, sinceIso: string, config: Record<string, unknown> = {},
): Promise<number> {
  try {
    if (provider === "github") {
      const r = await fetch(`https://api.github.com/repos/${repoFullName}/commits?since=${encodeURIComponent(sinceIso)}&per_page=100`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "orbit-app" },
      });
      if (!r.ok) return 0;
      return ((await r.json()) as any[]).length;
    }
    if (provider === "gitlab") {
      const baseUrl = String(config.base_url || "https://gitlab.com").replace(/\/+$/, "");
      const r = await fetch(`${baseUrl}/api/v4/projects/${encodeURIComponent(repoFullName)}/repository/commits?since=${encodeURIComponent(sinceIso)}&per_page=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return 0;
      return ((await r.json()) as any[]).length;
    }
    // azuredevops
    const org = String(config.organization || "");
    const split = splitAdoFullName(repoFullName);
    if (!org || !split) return 0;
    const auth = Buffer.from(`:${token}`).toString("base64");
    const r = await fetch(
      `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(split.project)}/_apis/git/repositories/${encodeURIComponent(split.repo)}/commits?searchCriteria.fromDate=${encodeURIComponent(sinceIso)}&api-version=7.1`,
      { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } },
    );
    if (!r.ok) return 0;
    const body = (await r.json()) as { value?: any[] };
    return (body.value ?? []).length;
  } catch (e) {
    console.error(`[providerFetch] fetchCommitCountSince(${provider}) failed`, e);
    return 0;
  }
}

export async function fetchSentryUnresolvedCount(token: string, orgSlug: string, project?: string): Promise<number | null> {
  try {
    const qs = project
      ? `?project=${encodeURIComponent(project)}&query=is:unresolved&statsPeriod=24h&limit=100`
      : "?query=is:unresolved&statsPeriod=24h&limit=100";
    const r = await fetch(`https://sentry.io/api/0/organizations/${encodeURIComponent(orgSlug)}/issues/${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    return ((await r.json()) as any[]).length;
  } catch (e) {
    console.error("[providerFetch] fetchSentryUnresolvedCount failed", e);
    return null;
  }
}
