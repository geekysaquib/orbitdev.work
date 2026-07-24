import type { Handler, HandlerEvent } from "@netlify/functions";
import { verifySession } from "./_lib/verifyToken";
import { credentialManager, accountNameOf } from "./_lib/credentialManager";
import { serverEventEngine } from "./_lib/serverEvents";
import { createDefaultRegistry, isScmAdapter } from "../../src/engines/integrations";
import { rateLimit } from "./_lib/rateLimit";

/**
 * GitHub REST API proxy. Credentials come from the shared `CredentialManager`
 * (RLS-scoped to the caller's own `provider_connections` row) — this file
 * never reads that table directly. Actual GitHub REST calls live in the
 * shared `ScmAdapter` (src/engines/integrations) — see
 * docs/architecture/integration-engine.md. The registry is wired to the
 * shared server `EventEngine` so `checkStatus` calls publish real
 * connected/disconnected/authentication_failed domain events — see
 * docs/architecture/orbit-runtime.md.
 */

const json = (statusCode: number, data: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

const registry = createDefaultRegistry({ events: { engine: serverEventEngine } });
const adapter = registry.getCapable("github", isScmAdapter)!;

export const handler: Handler = async (event: HandlerEvent) => {
  const session = await verifySession(event.headers.authorization || event.headers.Authorization);
  if (!session) return json(401, { error: "Sign in to ORBIT first." });

  const rl = rateLimit(`github-api:${session.userId}`, 60, 60_000);
  if (!rl.allowed) return json(429, { error: `Too many requests — try again in ${rl.retryAfterSec}s.` });

  const authHeader = event.headers.authorization || event.headers.Authorization || null;
  const ctx = await credentialManager.getContext("github", { kind: "request", authHeader });
  const mode = event.queryStringParameters?.mode || "status";

  if (mode === "status") {
    if (!ctx) return json(200, { connected: false, account: null });
    const status = await adapter.checkStatus(ctx);
    return json(200, { connected: status.connected, account: accountNameOf(ctx) });
  }
  if (!ctx) return json(400, { error: "GitHub isn't connected — connect it in Settings first." });

  const repo = event.queryStringParameters?.repo || "";
  const branch = event.queryStringParameters?.branch || "";

  try {
    switch (mode) {
      case "repos": {
        const r = await adapter.listRepos(ctx);
        if (!r.ok) return json(r.status || 502, { error: r.error || "Couldn't list repos" });
        return json(200, { repos: r.data });
      }
      case "pulls": {
        if (!repo) return json(400, { error: "repo required" });
        const r = await adapter.listPulls(ctx, repo);
        if (!r.ok) return json(r.status || 502, { error: r.error || "Couldn't list pull requests" });
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
        if (!r.ok) return json(r.status || 502, { error: r.error || "Couldn't list workflow runs" });
        return json(200, { runs: r.data });
      }
      default:
        return json(400, { error: `Unknown mode "${mode}"` });
    }
  } catch (e) {
    return json(502, { error: `Couldn't reach GitHub: ${(e as Error).message}` });
  }
};
