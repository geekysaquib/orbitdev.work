import type { Handler, HandlerEvent } from "@netlify/functions";
import { verifySession } from "./_lib/verifyToken";
import { credentialManager } from "./_lib/credentialManager";
import { serverEventEngine } from "./_lib/serverEvents";
import { createDefaultRegistry, isScmAdapter, type IntegrationContext } from "../../src/engines/integrations";
import { rateLimit } from "./_lib/rateLimit";

/**
 * Azure DevOps REST API proxy. Unlike GitHub/GitLab, the credential here is a
 * Personal Access Token pasted by the user (see src/components/
 * AzureDevopsSetupPanel.tsx) rather than an OAuth access token — so auth is
 * HTTP Basic with an empty username, per Azure DevOps' documented PAT scheme
 * (handled inside the adapter itself), and there is no separate "-exchange"
 * function for this provider. Credentials come from the shared
 * `CredentialManager`, never read from `provider_connections` directly here.
 * Actual Azure DevOps REST calls live in the shared `ScmAdapter`
 * (src/engines/integrations) — see docs/architecture/integration-engine.md.
 * The registry is wired to the shared server `EventEngine`, same as
 * github-api.ts — see docs/architecture/orbit-runtime.md.
 */

const json = (statusCode: number, data: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

const EMPTY_CTX: IntegrationContext = { auth: { kind: "basic" }, config: {} };
const registry = createDefaultRegistry({ events: { engine: serverEventEngine } });
const adapter = registry.getCapable("azuredevops", isScmAdapter)!;

export const handler: Handler = async (event: HandlerEvent) => {
  const session = await verifySession(event.headers.authorization || event.headers.Authorization);
  if (!session) return json(401, { error: "Sign in to ORBIT first." });

  const rl = rateLimit(`azuredevops-api:${session.userId}`, 60, 60_000);
  if (!rl.allowed) return json(429, { error: `Too many requests — try again in ${rl.retryAfterSec}s.` });

  const authHeader = event.headers.authorization || event.headers.Authorization || null;
  const ctx = await credentialManager.getContext("azuredevops", { kind: "request", authHeader });
  const mode = event.queryStringParameters?.mode || "status";
  const org = (ctx?.config as { organization?: string } | undefined)?.organization || "";

  if (mode === "status") {
    const status = await adapter.checkStatus(ctx ?? EMPTY_CTX);
    return json(200, { connected: status.connected, account: status.account ?? null, error: status.error });
  }

  if (!ctx || !org) return json(400, { error: "Azure DevOps isn't connected — connect it in Settings first." });

  try {
    if (mode === "repos") {
      const r = await adapter.listRepos(ctx);
      if (!r.ok) return json(r.status || 502, { error: r.error || "Couldn't list projects" });
      return json(200, { repos: r.data });
    }

    const repoParam = event.queryStringParameters?.repo || "";
    if (!repoParam) return json(400, { error: "repo required" });
    const branch = event.queryStringParameters?.branch || "";

    if (mode === "pulls") {
      const r = await adapter.listPulls(ctx, repoParam);
      if (!r.ok) return json(r.status || 502, { error: r.error || "Couldn't list pull requests" });
      return json(200, { pulls: r.data });
    }

    if (mode === "commits") {
      const r = await adapter.listCommits(ctx, repoParam, { branch });
      if (!r.ok) return json(r.status || 502, { error: r.error || "Couldn't list commits" });
      return json(200, { commits: r.data });
    }

    if (mode === "runs") {
      const r = await adapter.listRuns(ctx, repoParam, { limit: 5 });
      if (!r.ok) return json(r.status || 502, { error: r.error || "Couldn't list builds" });
      return json(200, { runs: r.data });
    }

    return json(400, { error: `Unknown mode "${mode}"` });
  } catch (e) {
    return json(502, { error: `Couldn't reach Azure DevOps: ${(e as Error).message}` });
  }
};
