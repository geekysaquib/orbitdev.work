/**
 * Cron-context entry point into the shared Integration Engine
 * (src/engines/integrations, see docs/architecture/integration-engine.md).
 * daily-brief.ts/anomaly-scan.ts already batch-load each user's
 * `provider_connections` rows themselves (one query covering github/gitlab/
 * azuredevops/sentry at once) and hand the resulting `token`/`config` pair
 * straight to the functions below — there's no separate credential lookup
 * for this file to do, so it doesn't go through `CredentialManager` (that
 * abstraction matters when *fetching* a credential from storage, not when
 * one has already been handed to you as a parameter). This file's only job
 * is translating those calls into the shared `ScmAdapter`s instead of
 * hand-rolling GitHub/GitLab/Azure DevOps REST calls a third time.
 */
import { createDefaultRegistry, isScmAdapter, type IntegrationContext } from "../../../src/engines/integrations";
import { serverEventEngine } from "./serverEvents";

export type RepoProvider = "github" | "gitlab" | "azuredevops";

export interface RawPull { id: string | number; title: string; url: string; createdAt: string; updatedAt: string; }
export interface RawRun { status: string; conclusion: string | null; createdAt: string; }

// Wired to the shared server `EventEngine` so `checkStatus` calls publish
// real domain events, same as the *-api.ts proxies — see
// docs/architecture/orbit-runtime.md. This file's own functions below don't
// call `checkStatus` themselves, but the registry is shared infrastructure.
const registry = createDefaultRegistry({ events: { engine: serverEventEngine } });

// Azure DevOps uses Basic auth (empty username, PAT as password) — see
// src/engines/integrations/adapters/azuredevops.ts. Everything else here is bearer.
function contextFor(provider: RepoProvider, token: string, config: Record<string, unknown>): IntegrationContext {
  return { auth: { kind: provider === "azuredevops" ? "basic" : "bearer", token }, config };
}

export async function fetchOpenPulls(
  provider: RepoProvider, token: string, repoFullName: string, config: Record<string, unknown> = {},
): Promise<RawPull[]> {
  try {
    const adapter = registry.getCapable(provider, isScmAdapter);
    if (!adapter) return [];
    const r = await adapter.listPulls(contextFor(provider, token, config), repoFullName);
    if (!r.ok || !r.data) { if (!r.ok) console.error(`[providerFetch] fetchOpenPulls(${provider}) failed`, r.error); return []; }
    return r.data.map((p) => ({ id: p.number, title: p.title, url: p.url, createdAt: p.createdAt, updatedAt: p.updatedAt }));
  } catch (e) {
    console.error(`[providerFetch] fetchOpenPulls(${provider}) failed`, e);
    return [];
  }
}

export async function fetchRecentRuns(
  provider: RepoProvider, token: string, repoFullName: string, config: Record<string, unknown> = {},
): Promise<RawRun[]> {
  try {
    const adapter = registry.getCapable(provider, isScmAdapter);
    if (!adapter) return [];
    const r = await adapter.listRuns(contextFor(provider, token, config), repoFullName, { limit: 15 });
    if (!r.ok || !r.data) { if (!r.ok) console.error(`[providerFetch] fetchRecentRuns(${provider}) failed`, r.error); return []; }
    return r.data.map((run) => ({ status: run.status, conclusion: run.conclusion, createdAt: run.createdAt }));
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
    const adapter = registry.getCapable(provider, isScmAdapter);
    if (!adapter) return 0;
    const r = await adapter.countCommitsSince(contextFor(provider, token, config), repoFullName, sinceIso);
    if (!r.ok || r.data == null) { if (!r.ok) console.error(`[providerFetch] fetchCommitCountSince(${provider}) failed`, r.error); return 0; }
    return r.data;
  } catch (e) {
    console.error(`[providerFetch] fetchCommitCountSince(${provider}) failed`, e);
    return 0;
  }
}

// Sentry isn't migrated to an Integration Engine adapter yet (no `MonitoringAdapter`
// capability exists — see docs/architecture/integration-engine.md's migration
// strategy), so this stays a direct REST call for now, same as before.
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
