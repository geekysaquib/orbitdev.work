import type { IntegrationContext, IntegrationResult, IntegrationStatus } from "../types";
import type { ScmAdapter, ScmCommit, ScmPull, ScmRepo, ScmRun } from "../capabilities/scm";

const API_VERSION = "api-version=7.1";

async function ado(org: string, path: string, pat: string): Promise<{ ok: boolean; status: number; body: any }> {
  const auth = Buffer.from(`:${pat}`).toString("base64");
  const r = await fetch(`https://dev.azure.com/${encodeURIComponent(org)}${path}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

function fail<T>(r: { status: number; body: any }, fallback: string): IntegrationResult<T> {
  return { ok: false, status: r.status, error: r.body?.message || fallback };
}

/** `repo_full_name` for this provider is stored as "project/repoName" — org is implicit (one org per connection). */
function splitFullName(full: string): { project: string; repo: string } | null {
  const i = full.indexOf("/");
  if (i < 0) return null;
  return { project: full.slice(0, i), repo: full.slice(i + 1) };
}

function orgOf(ctx: IntegrationContext): string {
  return String(ctx.config?.organization || "");
}

/**
 * Azure DevOps adapter. Unlike GitHub/GitLab, the credential is a pasted
 * Personal Access Token (Basic auth, empty username) rather than an OAuth
 * access token — `ctx.auth.token` holds the PAT regardless; the Basic-vs-Bearer
 * difference is entirely internal to this adapter.
 */
export function createAzureDevOpsAdapter(): ScmAdapter {
  return {
    id: "azuredevops",
    displayName: "Azure DevOps",
    capabilities: ["scm"],

    async checkStatus(ctx: IntegrationContext): Promise<IntegrationStatus> {
      const org = orgOf(ctx);
      if (!ctx.auth.token || !org) return { connected: false, account: null };
      const r = await ado(org, `/_apis/projects?$top=1&${API_VERSION}`, ctx.auth.token);
      return { connected: r.ok, account: r.ok ? org : null, error: r.ok ? undefined : r.body?.message || `Azure DevOps ${r.status}` };
    },

    async listRepos(ctx): Promise<IntegrationResult<ScmRepo[]>> {
      const org = orgOf(ctx);
      const projRes = await ado(org, `/_apis/projects?$top=200&${API_VERSION}`, ctx.auth.token!);
      if (!projRes.ok) return fail(projRes, "Couldn't list projects");
      const projects = (projRes.body?.value ?? []) as { name: string }[];
      const perProject = await Promise.all(projects.map(async (p) => {
        const r = await ado(org, `/${encodeURIComponent(p.name)}/_apis/git/repositories?${API_VERSION}`, ctx.auth.token!);
        if (!r.ok) return [] as ScmRepo[];
        const repos = (r.body?.value ?? []) as { id: string; name: string; defaultBranch?: string }[];
        return repos.map((repo): ScmRepo => ({
          id: repo.id,
          fullName: `${p.name}/${repo.name}`,
          defaultBranch: (repo.defaultBranch || "refs/heads/main").replace(/^refs\/heads\//, ""),
        }));
      }));
      return { ok: true, data: perProject.flat() };
    },

    async listPulls(ctx, repoFullName): Promise<IntegrationResult<ScmPull[]>> {
      const org = orgOf(ctx);
      const split = splitFullName(repoFullName);
      if (!split) return { ok: false, status: 400, error: "repo required" };
      const { project, repo } = split;
      const r = await ado(org, `/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests?searchCriteria.status=active&${API_VERSION}`, ctx.auth.token!);
      if (!r.ok) return fail(r, "Couldn't list pull requests");
      const pulls = (r.body?.value ?? []) as any[];
      const mapped: ScmPull[] = pulls.map((x) => ({
        number: x.pullRequestId, title: x.title, user: x.createdBy?.displayName,
        // ADO's "active PRs" list endpoint doesn't return a separate last-updated
        // timestamp without a per-PR follow-up call, so updatedAt reuses creationDate.
        createdAt: x.creationDate, updatedAt: x.creationDate,
        url: `https://dev.azure.com/${org}/${project}/_git/${repo}/pullrequest/${x.pullRequestId}`,
      }));
      return { ok: true, data: mapped };
    },

    async listCommits(ctx, repoFullName, opts): Promise<IntegrationResult<ScmCommit[]>> {
      const org = orgOf(ctx);
      const split = splitFullName(repoFullName);
      if (!split) return { ok: false, status: 400, error: "repo required" };
      const { project, repo } = split;
      const qs = opts?.branch ? `&searchCriteria.itemVersion.version=${encodeURIComponent(opts.branch)}` : "";
      const r = await ado(org, `/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/commits?searchCriteria.$top=20${qs}&${API_VERSION}`, ctx.auth.token!);
      if (!r.ok) return fail(r, "Couldn't list commits");
      const commits = (r.body?.value ?? []) as any[];
      const mapped: ScmCommit[] = commits.map((x) => ({
        hash: x.commitId, author: x.author?.name, date: x.author?.date,
        subject: (x.comment || "").split("\n")[0],
        url: `https://dev.azure.com/${org}/${project}/_git/${repo}/commit/${x.commitId}`,
      }));
      return { ok: true, data: mapped };
    },

    async listRuns(ctx, repoFullName, opts): Promise<IntegrationResult<ScmRun[]>> {
      const org = orgOf(ctx);
      const split = splitFullName(repoFullName);
      if (!split) return { ok: false, status: 400, error: "repo required" };
      const { project, repo } = split;
      const limit = opts?.limit ?? 5;
      // repositoryId also accepts a repo name for TfsGit repos per Azure DevOps' Builds API.
      const r = await ado(org, `/${encodeURIComponent(project)}/_apis/build/builds?repositoryId=${encodeURIComponent(repo)}&repositoryType=TfsGit&$top=${limit}&${API_VERSION}`, ctx.auth.token!);
      if (!r.ok) return fail(r, "Couldn't list builds");
      const builds = (r.body?.value ?? []) as any[];
      const mapped: ScmRun[] = builds.map((x) => ({
        id: x.id, name: x.definition?.name || "Build", status: x.status === "completed" ? "completed" : x.status,
        conclusion: x.result ?? null, url: x._links?.web?.href || null, createdAt: x.queueTime || x.startTime,
      }));
      return { ok: true, data: mapped };
    },

    async countCommitsSince(ctx, repoFullName, sinceIso): Promise<IntegrationResult<number>> {
      const org = orgOf(ctx);
      const split = splitFullName(repoFullName);
      if (!split) return { ok: false, status: 400, error: "repo required" };
      const { project, repo } = split;
      const r = await ado(org, `/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/commits?searchCriteria.fromDate=${encodeURIComponent(sinceIso)}&${API_VERSION}`, ctx.auth.token!);
      if (!r.ok) return fail(r, "Couldn't count commits");
      return { ok: true, data: ((r.body?.value ?? []) as any[]).length };
    },
  };
}
