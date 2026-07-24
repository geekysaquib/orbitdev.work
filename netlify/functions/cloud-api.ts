import type { Handler, HandlerEvent } from "@netlify/functions";
import { CostExplorerClient, GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { verifySession } from "./_lib/verifyToken";
import { loadConnection } from "./_lib/providerConnections";
import { rateLimit } from "./_lib/rateLimit";

/**
 * One proxy for all three cloud connectors (Netlify, Vercel, AWS) — routing
 * logic is thin enough (a handful of REST calls each) that three near-
 * duplicate files would be pure repetition. None of these are OAuth: Netlify/
 * Vercel use Personal Access Tokens, AWS uses an IAM Access Key/Secret pair
 * (Cost Explorer has no user-facing OAuth flow) — same plaintext-credential
 * trust model as pg_servers. AWS calls go through the SDK (SigV4 signing)
 * rather than hand-rolled — this codebase never hand-rolls crypto/signing.
 */

const json = (statusCode: number, data: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

async function netlifyApi(path: string, token: string) {
  const r = await fetch(`https://api.netlify.com/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}
async function vercelApi(path: string, token: string) {
  const r = await fetch(`https://api.vercel.com${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

export const handler: Handler = async (event: HandlerEvent) => {
  const session = await verifySession(event.headers.authorization || event.headers.Authorization);
  if (!session) return json(401, { error: "Sign in to ORBIT first." });

  const rl = rateLimit(`cloud-api:${session.userId}`, 60, 60_000);
  if (!rl.allowed) return json(429, { error: `Too many requests — try again in ${rl.retryAfterSec}s.` });

  const provider = event.queryStringParameters?.provider || "";
  const mode = event.queryStringParameters?.mode || "status";
  if (!["netlify", "vercel", "aws"].includes(provider)) return json(400, { error: "provider must be netlify, vercel or aws" });

  const conn = await loadConnection(event, provider);

  try {
    if (provider === "netlify") {
      if (mode === "status") return json(200, { connected: !!conn?.access_token });
      if (!conn?.access_token) return json(400, { error: "Netlify isn't connected — connect it in Settings first." });
      if (mode === "sites") {
        const r = await netlifyApi("/sites?per_page=50", conn.access_token);
        if (!r.ok) return json(r.status, { error: r.body?.message || "Couldn't list sites" });
        return json(200, { sites: (r.body as any[]).map((x) => ({ id: x.site_id, name: x.name, url: x.url, updatedAt: x.updated_at })) });
      }
      return json(400, { error: `Unknown mode "${mode}"` });
    }

    if (provider === "vercel") {
      if (mode === "status") return json(200, { connected: !!conn?.access_token });
      if (!conn?.access_token) return json(400, { error: "Vercel isn't connected — connect it in Settings first." });
      if (mode === "sites") {
        const r = await vercelApi("/v9/projects?limit=50", conn.access_token);
        if (!r.ok) return json(r.status, { error: r.body?.error?.message || "Couldn't list projects" });
        return json(200, { sites: (r.body?.projects ?? []).map((x: any) => ({ id: x.id, name: x.name, url: x.link?.repo || null, updatedAt: new Date(x.updatedAt).toISOString() })) });
      }
      return json(400, { error: `Unknown mode "${mode}"` });
    }

    // aws
    const cfg = (conn?.config as { access_key_id?: string; secret_access_key?: string; region?: string }) || {};
    if (mode === "status") {
      if (!cfg.access_key_id || !cfg.secret_access_key) return json(200, { connected: false });
      const sts = new STSClient({ region: cfg.region || "us-east-1", credentials: { accessKeyId: cfg.access_key_id, secretAccessKey: cfg.secret_access_key } });
      try {
        const id = await sts.send(new GetCallerIdentityCommand({}));
        return json(200, { connected: true, account: id.Account ?? null });
      } catch (e) {
        return json(200, { connected: false, error: (e as Error).message });
      }
    }
    if (!cfg.access_key_id || !cfg.secret_access_key) return json(400, { error: "AWS isn't connected — connect it in Settings first." });
    if (mode === "cost") {
      // AWS Cost Explorer bills ~$0.01 per API call (unlike every other mode
      // here, which is free) — a tighter, separate limit than the general
      // one above so a loop against this specific path can't run up a real
      // bill even within the general limit's allowance.
      const costRl = rateLimit(`cloud-api-cost:${session.userId}`, 5, 300_000);
      if (!costRl.allowed) return json(429, { error: `Too many cost lookups — try again in ${costRl.retryAfterSec}s.` });
      const ce = new CostExplorerClient({ region: "us-east-1", credentials: { accessKeyId: cfg.access_key_id, secretAccessKey: cfg.secret_access_key } });
      const end = new Date();
      const start = new Date(end.getFullYear(), end.getMonth(), 1);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      const r = await ce.send(new GetCostAndUsageCommand({
        TimePeriod: { Start: fmt(start), End: fmt(end) },
        Granularity: "MONTHLY",
        Metrics: ["UnblendedCost"],
      }));
      const total = r.ResultsByTime?.[0]?.Total?.UnblendedCost;
      return json(200, { amount: total?.Amount ?? "0", unit: total?.Unit ?? "USD", periodStart: fmt(start), periodEnd: fmt(end) });
    }
    return json(400, { error: `Unknown mode "${mode}"` });
  } catch (e) {
    return json(502, { error: `Couldn't reach ${provider}: ${(e as Error).message}` });
  }
};
