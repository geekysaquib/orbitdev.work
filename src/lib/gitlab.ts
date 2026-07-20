/**
 * GitLab access via the Netlify function proxy (secrets stay server-side).
 * See netlify/functions/gitlab-api.ts + gitlab-exchange.ts.
 */
import { authHeader } from "./auth";
import { postJson } from "./apiClient";
import { openOAuthPopup, randomState } from "./oauthPopup";
import { saveProviderConnection, deleteProviderConnection } from "./providerConnections";

const fn = "/.netlify/functions/gitlab-api";

async function get<T>(qs = ""): Promise<T> {
  const r = await fetch(fn + qs, { headers: authHeader() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `GitLab fetch failed (${r.status})`);
  return j as T;
}

export async function fetchGitlabStatus(): Promise<{ connected: boolean; account: string | null; baseUrl?: string; error?: string }> {
  try { return await get("?mode=status"); }
  catch (e) { return { connected: false, account: null, error: (e as Error).message }; }
}

export interface GitlabRepo { id: string; fullName: string; defaultBranch: string; private: boolean; }
export async function fetchGitlabRepos(): Promise<GitlabRepo[]> {
  const j = await get<{ repos: GitlabRepo[] }>("?mode=repos");
  return j.repos ?? [];
}

export interface GitlabMergeRequest { number: number; title: string; url: string; user: string; createdAt: string; updatedAt: string; }
export async function fetchGitlabPulls(repo: string): Promise<GitlabMergeRequest[]> {
  const j = await get<{ pulls: GitlabMergeRequest[] }>(`?mode=pulls&repo=${encodeURIComponent(repo)}`);
  return j.pulls ?? [];
}

export interface GitlabCommit { hash: string; author: string; date: string; subject: string; url: string; }
export async function fetchGitlabCommits(repo: string, branch?: string): Promise<GitlabCommit[]> {
  const qs = `?mode=commits&repo=${encodeURIComponent(repo)}${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`;
  const j = await get<{ commits: GitlabCommit[] }>(qs);
  return j.commits ?? [];
}

export interface GitlabPipeline { id: number; name: string; status: string; conclusion: string | null; url: string; createdAt: string; }
export async function fetchGitlabRuns(repo: string, branch?: string): Promise<GitlabPipeline[]> {
  const qs = `?mode=runs&repo=${encodeURIComponent(repo)}${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`;
  const j = await get<{ runs: GitlabPipeline[] }>(qs);
  return j.runs ?? [];
}

/**
 * Full connect flow: opens a popup at the GitLab instance's authorize URL,
 * waits for the grant code via src/routes/OAuthCallback.tsx, exchanges it
 * server-side, and saves the resulting tokens to provider_connections.
 */
export async function connectGitlab(clientId: string, clientSecret: string, baseUrl: string): Promise<{ ok: boolean; account?: string | null; error?: string }> {
  const cleanBase = (baseUrl || "https://gitlab.com").trim().replace(/\/+$/, "");
  const redirectUri = `${window.location.origin}/oauth/callback`;
  const state = randomState();
  const authorizeUrl = `${cleanBase}/oauth/authorize?${new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "api read_repository", state,
  })}`;
  const result = await openOAuthPopup(authorizeUrl, state);
  if ("error" in result) return { ok: false, error: result.error };

  const res = await postJson<{ access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; external_account_id?: string; external_account_name?: string; base_url?: string }>(
    "/.netlify/functions/gitlab-exchange",
    { clientId, clientSecret, code: result.code, redirectUri, baseUrl: cleanBase },
  );
  if (!res.ok) return { ok: false, error: res.error };

  const expiresAt = res.expires_in ? new Date(Date.now() + res.expires_in * 1000).toISOString() : null;
  const saved = await saveProviderConnection("gitlab", {
    client_id: clientId, client_secret: clientSecret,
    access_token: res.access_token ?? null, refresh_token: res.refresh_token ?? null,
    expires_at: expiresAt, scope: res.scope ?? null,
    external_account_id: res.external_account_id ?? null, external_account_name: res.external_account_name ?? null,
    config: { base_url: res.base_url ?? cleanBase },
  });
  if (!saved.ok) return { ok: false, error: saved.error };
  return { ok: true, account: res.external_account_name };
}

export async function disconnectGitlab(): Promise<{ ok: boolean; error?: string }> {
  return deleteProviderConnection("gitlab");
}
