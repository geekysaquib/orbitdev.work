import type { IntegrationAdapter, IntegrationContext, IntegrationResult } from "../types";

export interface ScmRepo { id: string; fullName: string; defaultBranch: string; private?: boolean; }
export interface ScmPull { number: number | string; title: string; url: string; user?: string | null; createdAt: string; updatedAt: string; }
export interface ScmCommit { hash: string; author?: string | null; date: string; subject: string; url: string; }
export interface ScmRun { id: number | string; name?: string; status: string; conclusion: string | null; url?: string | null; createdAt: string; }

export interface ScmListOptions {
  branch?: string;
  /** Caller-specific page size — the browser's status card and the cron anomaly scan intentionally ask for different windows (5 vs 15 runs), so this has no adapter-side default beyond "a reasonable one if omitted." */
  limit?: number;
}

/** Source-control capability — GitHub, GitLab, Azure DevOps, and (future) Bitbucket all implement this. */
export interface ScmAdapter extends IntegrationAdapter {
  listRepos(ctx: IntegrationContext): Promise<IntegrationResult<ScmRepo[]>>;
  listPulls(ctx: IntegrationContext, repoFullName: string): Promise<IntegrationResult<ScmPull[]>>;
  listCommits(ctx: IntegrationContext, repoFullName: string, opts?: ScmListOptions): Promise<IntegrationResult<ScmCommit[]>>;
  listRuns(ctx: IntegrationContext, repoFullName: string, opts?: ScmListOptions): Promise<IntegrationResult<ScmRun[]>>;
  /** Commit count since a timestamp — a distinct, cheaper operation from `listCommits` (used by the anomaly scan's "hours logged, no commits" check), not `listCommits` filtered client-side. */
  countCommitsSince(ctx: IntegrationContext, repoFullName: string, sinceIso: string): Promise<IntegrationResult<number>>;
}

export function isScmAdapter(adapter: IntegrationAdapter): adapter is ScmAdapter {
  return adapter.capabilities.includes("scm");
}
