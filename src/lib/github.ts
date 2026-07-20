/**
 * GitHub access via the Netlify function proxy (secrets stay server-side).
 * See netlify/functions/github-api.ts + github-exchange.ts.
 */
import { authHeader } from "./auth";
import { postJson } from "./apiClient";
import { openOAuthPopup, randomState } from "./oauthPopup";
import { saveProviderConnection, deleteProviderConnection } from "./providerConnections";

const fn = "/.netlify/functions/github-api";

async function get<T>(qs = ""): Promise<T> {
  const r = await fetch(fn + qs, { headers: authHeader() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `GitHub fetch failed (${r.status})`);
  return j as T;
}

export async function fetchGithubStatus(): Promise<{ connected: boolean; account: string | null; error?: string }> {
  try { return await get("?mode=status"); }
  catch (e) { return { connected: false, account: null, error: (e as Error).message }; }
}

export interface GithubRepo { id: string; fullName: string; defaultBranch: string; private: boolean; }
export async function fetchGithubRepos(): Promise<GithubRepo[]> {
  const j = await get<{ repos: GithubRepo[] }>("?mode=repos");
  return j.repos ?? [];
}

export interface GithubPull { number: number; title: string; url: string; user: string; createdAt: string; updatedAt: string; }
export async function fetchGithubPulls(repo: string): Promise<GithubPull[]> {
  const j = await get<{ pulls: GithubPull[] }>(`?mode=pulls&repo=${encodeURIComponent(repo)}`);
  return j.pulls ?? [];
}

export interface GithubCommit { hash: string; author: string; date: string; subject: string; url: string; }
export async function fetchGithubCommits(repo: string, branch?: string): Promise<GithubCommit[]> {
  const qs = `?mode=commits&repo=${encodeURIComponent(repo)}${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`;
  const j = await get<{ commits: GithubCommit[] }>(qs);
  return j.commits ?? [];
}

export interface GithubRun { id: number; name: string; status: string; conclusion: string | null; url: string; createdAt: string; }
export async function fetchGithubRuns(repo: string, branch?: string): Promise<GithubRun[]> {
  const qs = `?mode=runs&repo=${encodeURIComponent(repo)}${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`;
  const j = await get<{ runs: GithubRun[] }>(qs);
  return j.runs ?? [];
}

/**
 * Full connect flow: opens a popup at GitHub's authorize URL, waits for the
 * grant code via src/routes/OAuthCallback.tsx (postMessage relay), exchanges
 * it server-side, and saves the resulting tokens to provider_connections.
 */
export async function connectGithub(clientId: string, clientSecret: string): Promise<{ ok: boolean; account?: string | null; error?: string }> {
  const redirectUri = `${window.location.origin}/oauth/callback`;
  const state = randomState();
  const authorizeUrl = `https://github.com/login/oauth/authorize?${new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, scope: "repo read:org workflow", state,
  })}`;
  const result = await openOAuthPopup(authorizeUrl, state);
  if ("error" in result) return { ok: false, error: result.error };

  const res = await postJson<{ access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; external_account_id?: string; external_account_name?: string }>(
    "/.netlify/functions/github-exchange",
    { clientId, clientSecret, code: result.code, redirectUri },
  );
  if (!res.ok) return { ok: false, error: res.error };

  const expiresAt = res.expires_in ? new Date(Date.now() + res.expires_in * 1000).toISOString() : null;
  const saved = await saveProviderConnection("github", {
    client_id: clientId, client_secret: clientSecret,
    access_token: res.access_token ?? null, refresh_token: res.refresh_token ?? null,
    expires_at: expiresAt, scope: res.scope ?? null,
    external_account_id: res.external_account_id ?? null, external_account_name: res.external_account_name ?? null,
  });
  if (!saved.ok) return { ok: false, error: saved.error };
  return { ok: true, account: res.external_account_name };
}

export async function disconnectGithub(): Promise<{ ok: boolean; error?: string }> {
  return deleteProviderConnection("github");
}
