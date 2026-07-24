import type { Handler, HandlerEvent } from "@netlify/functions";
import { verifySession } from "./_lib/verifyToken";
import { credentialManager, accountNameOf } from "./_lib/credentialManager";
import { serverEventEngine } from "./_lib/serverEvents";
import { createDefaultRegistry, isScmAdapter } from "../../src/engines/integrations";
import { rateLimit } from "./_lib/rateLimit";

/**
 * GitLab REST API proxy (v4). Mirrors github-api.ts's shape and trust model —
 * credentials come from the shared `CredentialManager`, never read from
 * `provider_connections` directly here. Supports self-hosted instances via
 * `config.base_url` (default gitlab.com). Actual GitLab REST calls live in
 * the shared `ScmAdapter` (src/engines/integrations) — see
 * docs/architecture/integration-engine.md. The registry is wired to the
 * shared server `EventEngine`, same as github-api.ts — see
 * docs/architecture/orbit-runtime.md.
 */

const json = (statusCode: number, data: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

const registry = createDefaultRegistry({ events: { engine: serverEventEngine } });
const adapter = registry.getCapable("gitlab", isScmAdapter)!;

export const handler: Handler = async (event: HandlerEvent) => {
  const session = await verifySession(event.headers.authorization || event.headers.Authorization);
  if (!session) return json(401, { error: "Sign in to ORBIT first." });

  const rl = rateLimit(`gitlab-api:${session.userId}`, 60, 60_000);
  if (!rl.allowed) return json(429, { error: `Too many requests — try again in ${rl.retryAfterSec}s.` });

  const authHeader = event.headers.authorization || event.headers.Authorization || null;
  const ctx = await credentialManager.getContext("gitlab", { kind: "request", authHeader });
  const baseUrl = String((ctx?.config as { base_url?: string } | undefined)?.base_url || "https://gitlab.com").replace(/\/+$/, "");
  const mode = event.queryStringParameters?.mode || "status";

  if (mode === "status") {
    if (!ctx) return json(200, { connected: false, account: null, baseUrl });
    const status = await adapter.checkStatus(ctx);
    return json(200, { connected: status.connected, account: accountNameOf(ctx), baseUrl });
  }
  if (!ctx) return json(400, { error: "GitLab isn't connected — connect it in Settings first." });

  const repo = event.queryStringParameters?.repo || ""; // GitLab project id
  const branch = event.queryStringParameters?.branch || "";

  try {
    switch (mode) {
      case "repos": {
        const r = await adapter.listRepos(ctx);
        if (!r.ok) return json(r.status || 502, { error: r.error || "Couldn't list projects" });
        return json(200, { repos: r.data });
      }
      case "pulls": {
        if (!repo) return json(400, { error: "repo required" });
        const r = await adapter.listPulls(ctx, repo);
        if (!r.ok) return json(r.status || 502, { error: r.error || "Couldn't list merge requests" });
        return json(200, { pulls: r.data });
      }
      case "commits": {
        if (!repo) return json(400, { error: "repo required" });
        const r = await adapter.listCommits(ctx, repo, { branch });
        if (!r.ok) return json(r.status || 502, { error: r.error || "Couldn't list commits" });
        return json(200, { commits: r.data });
      }
      case "runs": {
        if (!repo) return json(400, { error: "repo required" });
        const r = await adapter.listRuns(ctx, repo, { branch, limit: 5 });
        if (!r.ok) return json(r.status || 502, { error: r.error || "Couldn't list pipelines" });
        return json(200, { runs: r.data });
      }
      default:
        return json(400, { error: `Unknown mode "${mode}"` });
    }
  } catch (e) {
    return json(502, { error: `Couldn't reach ${baseUrl}: ${(e as Error).message}` });
  }
};
