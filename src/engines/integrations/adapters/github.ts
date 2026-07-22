import type { IntegrationContext, IntegrationResult, IntegrationStatus } from "../types";
import type { ScmAdapter, ScmCommit, ScmPull, ScmRepo, ScmRun } from "../capabilities/scm";

async function gh(path: string, token: string): Promise<{ ok: boolean; status: number; body: any }> {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "orbit-app" },
  });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

function fail<T>(r: { status: number; body: any }, fallback: string): IntegrationResult<T> {
  return { ok: false, status: r.status, error: r.body?.message || fallback };
}

/**
 * GitHub REST adapter. Consolidates what was previously duplicated between
 * netlify/functions/github-api.ts (browser proxy) and _lib/providerFetch.ts
 * (cron) — see docs/architecture/integration-engine.md.
 */
export function createGithubAdapter(): ScmAdapter {
  return {
    id: "github",
    displayName: "GitHub",
    capabilities: ["scm"],

    async checkStatus(ctx: IntegrationContext): Promise<IntegrationStatus> {
      return { connected: !!ctx.auth.token };
    },

    async listRepos(ctx): Promise<IntegrationResult<ScmRepo[]>> {
      const r = await gh("/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member", ctx.auth.token!);
      if (!r.ok) return fail(r, "Couldn't list repos");
      const repos: ScmRepo[] = (r.body as any[]).map((x) => ({ id: String(x.id), fullName: x.full_name, defaultBranch: x.default_branch, private: x.private }));
      return { ok: true, data: repos };
    },

    async listPulls(ctx, repoFullName): Promise<IntegrationResult<ScmPull[]>> {
      const r = await gh(`/repos/${repoFullName}/pulls?state=open&per_page=50`, ctx.auth.token!);
      if (!r.ok) return fail(r, "Couldn't list pull requests");
      const pulls: ScmPull[] = (r.body as any[]).map((x) => ({ number: x.number, title: x.title, url: x.html_url, user: x.user?.login, createdAt: x.created_at, updatedAt: x.updated_at }));
      return { ok: true, data: pulls };
    },

    async listCommits(ctx, repoFullName, opts): Promise<IntegrationResult<ScmCommit[]>> {
      const qs = opts?.branch ? `?sha=${encodeURIComponent(opts.branch)}&per_page=20` : "?per_page=20";
      const r = await gh(`/repos/${repoFullName}/commits${qs}`, ctx.auth.token!);
      if (!r.ok) return fail(r, "Couldn't list commits");
      const commits: ScmCommit[] = (r.body as any[]).map((x) => ({ hash: x.sha, author: x.commit?.author?.name, date: x.commit?.author?.date, subject: (x.commit?.message || "").split("\n")[0], url: x.html_url }));
      return { ok: true, data: commits };
    },

    async listRuns(ctx, repoFullName, opts): Promise<IntegrationResult<ScmRun[]>> {
      const limit = opts?.limit ?? 5;
      const qs = opts?.branch ? `?branch=${encodeURIComponent(opts.branch)}&per_page=${limit}` : `?per_page=${limit}`;
      const r = await gh(`/repos/${repoFullName}/actions/runs${qs}`, ctx.auth.token!);
      if (!r.ok) return fail(r, "Couldn't list workflow runs");
      const runs = (r.body?.workflow_runs ?? []) as any[];
      const mapped: ScmRun[] = runs.map((x) => ({ id: x.id, name: x.name, status: x.status, conclusion: x.conclusion, url: x.html_url, createdAt: x.created_at }));
      return { ok: true, data: mapped };
    },

    async countCommitsSince(ctx, repoFullName, sinceIso): Promise<IntegrationResult<number>> {
      const r = await gh(`/repos/${repoFullName}/commits?since=${encodeURIComponent(sinceIso)}&per_page=100`, ctx.auth.token!);
      if (!r.ok) return fail(r, "Couldn't count commits");
      return { ok: true, data: (r.body as any[]).length };
    },
  };
}
