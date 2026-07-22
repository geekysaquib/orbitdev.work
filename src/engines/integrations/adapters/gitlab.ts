import type { IntegrationContext, IntegrationResult, IntegrationStatus } from "../types";
import type { ScmAdapter, ScmCommit, ScmPull, ScmRepo, ScmRun } from "../capabilities/scm";

function baseUrlOf(ctx: IntegrationContext): string {
  return String((ctx.config as { base_url?: string })?.base_url || "https://gitlab.com").replace(/\/+$/, "");
}

async function gl(baseUrl: string, path: string, token: string): Promise<{ ok: boolean; status: number; body: any }> {
  const r = await fetch(`${baseUrl}/api/v4${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

function fail<T>(r: { status: number; body: any }, fallback: string): IntegrationResult<T> {
  return { ok: false, status: r.status, error: r.body?.message || fallback };
}

/**
 * GitLab (v4) adapter — supports self-hosted instances via `ctx.config.base_url`
 * (default gitlab.com), same as the provider_connections `config` jsonb did
 * for the pre-engine github-api.ts/gitlab-api.ts split.
 */
export function createGitlabAdapter(): ScmAdapter {
  return {
    id: "gitlab",
    displayName: "GitLab",
    capabilities: ["scm"],

    async checkStatus(ctx: IntegrationContext): Promise<IntegrationStatus> {
      return { connected: !!ctx.auth.token };
    },

    async listRepos(ctx): Promise<IntegrationResult<ScmRepo[]>> {
      const baseUrl = baseUrlOf(ctx);
      const r = await gl(baseUrl, "/projects?membership=true&per_page=100&order_by=last_activity_at", ctx.auth.token!);
      if (!r.ok) return fail(r, "Couldn't list projects");
      const repos: ScmRepo[] = (r.body as any[]).map((x) => ({ id: String(x.id), fullName: x.path_with_namespace, defaultBranch: x.default_branch, private: x.visibility !== "public" }));
      return { ok: true, data: repos };
    },

    async listPulls(ctx, repoFullName): Promise<IntegrationResult<ScmPull[]>> {
      const baseUrl = baseUrlOf(ctx);
      const r = await gl(baseUrl, `/projects/${encodeURIComponent(repoFullName)}/merge_requests?state=opened&per_page=50`, ctx.auth.token!);
      if (!r.ok) return fail(r, "Couldn't list merge requests");
      const pulls: ScmPull[] = (r.body as any[]).map((x) => ({ number: x.iid, title: x.title, url: x.web_url, user: x.author?.username, createdAt: x.created_at, updatedAt: x.updated_at }));
      return { ok: true, data: pulls };
    },

    async listCommits(ctx, repoFullName, opts): Promise<IntegrationResult<ScmCommit[]>> {
      const baseUrl = baseUrlOf(ctx);
      const qs = opts?.branch ? `?ref_name=${encodeURIComponent(opts.branch)}&per_page=20` : "?per_page=20";
      const r = await gl(baseUrl, `/projects/${encodeURIComponent(repoFullName)}/repository/commits${qs}`, ctx.auth.token!);
      if (!r.ok) return fail(r, "Couldn't list commits");
      const commits: ScmCommit[] = (r.body as any[]).map((x) => ({ hash: x.id, author: x.author_name, date: x.authored_date, subject: x.title || "", url: x.web_url }));
      return { ok: true, data: commits };
    },

    async listRuns(ctx, repoFullName, opts): Promise<IntegrationResult<ScmRun[]>> {
      const baseUrl = baseUrlOf(ctx);
      const limit = opts?.limit ?? 5;
      const qs = opts?.branch ? `?ref=${encodeURIComponent(opts.branch)}&per_page=${limit}` : `?per_page=${limit}`;
      const r = await gl(baseUrl, `/projects/${encodeURIComponent(repoFullName)}/pipelines${qs}`, ctx.auth.token!);
      if (!r.ok) return fail(r, "Couldn't list pipelines");
      const runs: ScmRun[] = (r.body as any[]).map((x) => ({ id: x.id, name: `Pipeline #${x.id}`, status: x.status, conclusion: x.status, url: x.web_url, createdAt: x.created_at }));
      return { ok: true, data: runs };
    },

    async countCommitsSince(ctx, repoFullName, sinceIso): Promise<IntegrationResult<number>> {
      const baseUrl = baseUrlOf(ctx);
      const r = await gl(baseUrl, `/projects/${encodeURIComponent(repoFullName)}/repository/commits?since=${encodeURIComponent(sinceIso)}&per_page=100`, ctx.auth.token!);
      if (!r.ok) return fail(r, "Couldn't count commits");
      return { ok: true, data: (r.body as any[]).length };
    },
  };
}
