/**
 * Azure DevOps access via the Netlify function proxy (the PAT stays
 * server-side once saved). See netlify/functions/azuredevops-api.ts.
 *
 * Unlike GitHub/GitLab this provider connects with a pasted Personal Access
 * Token rather than OAuth — there's no popup, no redirect URI, and no
 * "-exchange" function; connectAzureDevops() just validates the token
 * against the given organization and saves it straight to
 * provider_connections, the same way every other bring-your-own-credential
 * integration here works (see src/components/AzureDevopsSetupPanel.tsx).
 */
import { authHeader } from "./auth";
import { saveProviderConnection, deleteProviderConnection } from "./providerConnections";

const fn = "/.netlify/functions/azuredevops-api";

async function get<T>(qs = ""): Promise<T> {
  const r = await fetch(fn + qs, { headers: authHeader() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Azure DevOps fetch failed (${r.status})`);
  return j as T;
}

export async function fetchAzureDevopsStatus(): Promise<{ connected: boolean; account: string | null; error?: string }> {
  try { return await get("?mode=status"); }
  catch (e) { return { connected: false, account: null, error: (e as Error).message }; }
}

export interface AzureDevopsRepo { id: string; fullName: string; defaultBranch: string; }
export async function fetchAzureDevopsRepos(): Promise<AzureDevopsRepo[]> {
  const j = await get<{ repos: AzureDevopsRepo[] }>("?mode=repos");
  return j.repos ?? [];
}

export interface AzureDevopsPull { number: number; title: string; url: string; user: string; createdAt: string; updatedAt: string; }
export async function fetchAzureDevopsPulls(repoFullName: string): Promise<AzureDevopsPull[]> {
  const j = await get<{ pulls: AzureDevopsPull[] }>(`?mode=pulls&repo=${encodeURIComponent(repoFullName)}`);
  return j.pulls ?? [];
}

export interface AzureDevopsCommit { hash: string; author: string; date: string; subject: string; url: string; }
export async function fetchAzureDevopsCommits(repoFullName: string, branch?: string): Promise<AzureDevopsCommit[]> {
  const qs = `?mode=commits&repo=${encodeURIComponent(repoFullName)}${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`;
  const j = await get<{ commits: AzureDevopsCommit[] }>(qs);
  return j.commits ?? [];
}

export interface AzureDevopsRun { id: number; name: string; status: string; conclusion: string | null; url: string; createdAt: string; }
export async function fetchAzureDevopsRuns(repoFullName: string, branch?: string): Promise<AzureDevopsRun[]> {
  const qs = `?mode=runs&repo=${encodeURIComponent(repoFullName)}${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`;
  const j = await get<{ runs: AzureDevopsRun[] }>(qs);
  return j.runs ?? [];
}

/**
 * Validates the org+PAT against Azure DevOps (via the proxy's status mode,
 * which needs the credentials saved first to read them server-side) and
 * rolls the connection back if validation fails, so a bad PAT never lingers
 * as a false "connected" row.
 */
export async function connectAzureDevops(organization: string, pat: string): Promise<{ ok: boolean; account?: string | null; error?: string }> {
  const saved = await saveProviderConnection("azuredevops", {
    access_token: pat, config: { organization }, external_account_name: organization,
  });
  if (!saved.ok) return { ok: false, error: saved.error };

  const status = await fetchAzureDevopsStatus();
  if (!status.connected) {
    await deleteProviderConnection("azuredevops");
    return { ok: false, error: status.error || "Couldn't verify that organization/token — double-check both and try again." };
  }
  return { ok: true, account: organization };
}

export async function disconnectAzureDevops(): Promise<{ ok: boolean; error?: string }> {
  return deleteProviderConnection("azuredevops");
}
