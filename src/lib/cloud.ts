/**
 * Cloud provider access (Netlify, Vercel, AWS) via the shared Netlify
 * function proxy. See netlify/functions/cloud-api.ts. None of these are
 * OAuth — Netlify/Vercel use pasted Personal Access Tokens, AWS uses a
 * pasted IAM Access Key/Secret pair.
 */
import { authHeader } from "./auth";
import { saveProviderConnection, deleteProviderConnection } from "./providerConnections";
import type { ProviderId } from "./types";

type CloudProvider = Extract<ProviderId, "netlify" | "vercel" | "aws">;

const fn = "/.netlify/functions/cloud-api";

async function get<T>(provider: CloudProvider, qs = ""): Promise<T> {
  const r = await fetch(`${fn}?provider=${provider}${qs}`, { headers: authHeader() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `${provider} fetch failed (${r.status})`);
  return j as T;
}

export async function fetchCloudStatus(provider: CloudProvider): Promise<{ connected: boolean; account?: string | null; error?: string }> {
  try { return await get(provider, "&mode=status"); }
  catch (e) { return { connected: false, error: (e as Error).message }; }
}

export interface CloudSite { id: string; name: string; url: string | null; updatedAt: string; }
export async function fetchCloudSites(provider: "netlify" | "vercel"): Promise<CloudSite[]> {
  const j = await get<{ sites: CloudSite[] }>(provider, "&mode=sites");
  return j.sites ?? [];
}

export interface AwsCost { amount: string; unit: string; periodStart: string; periodEnd: string; }
export async function fetchAwsCost(): Promise<AwsCost | null> {
  try { return await get<AwsCost>("aws", "&mode=cost"); } catch { return null; }
}

export async function connectNetlify(token: string): Promise<{ ok: boolean; error?: string }> {
  const saved = await saveProviderConnection("netlify", { access_token: token });
  if (!saved.ok) return saved;
  const status = await fetchCloudStatus("netlify");
  if (!status.connected) { await deleteProviderConnection("netlify"); return { ok: false, error: "Couldn't verify that token." }; }
  return { ok: true };
}
export async function connectVercel(token: string): Promise<{ ok: boolean; error?: string }> {
  const saved = await saveProviderConnection("vercel", { access_token: token });
  if (!saved.ok) return saved;
  const status = await fetchCloudStatus("vercel");
  if (!status.connected) { await deleteProviderConnection("vercel"); return { ok: false, error: "Couldn't verify that token." }; }
  return { ok: true };
}
export async function connectAws(accessKeyId: string, secretAccessKey: string, region: string): Promise<{ ok: boolean; error?: string }> {
  const saved = await saveProviderConnection("aws", { config: { access_key_id: accessKeyId, secret_access_key: secretAccessKey, region: region || "us-east-1" } });
  if (!saved.ok) return saved;
  const status = await fetchCloudStatus("aws");
  if (!status.connected) { await deleteProviderConnection("aws"); return { ok: false, error: status.error || "Couldn't verify those keys." }; }
  return { ok: true };
}

export async function disconnectCloud(provider: CloudProvider): Promise<{ ok: boolean; error?: string }> {
  return deleteProviderConnection(provider);
}
