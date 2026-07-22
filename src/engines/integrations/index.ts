export * from "./types";
export { IntegrationRegistry, type IntegrationEventsSink } from "./registry";
export * from "./capabilities/scm";
export { createGithubAdapter } from "./adapters/github";
export { createGitlabAdapter } from "./adapters/gitlab";
export { createAzureDevOpsAdapter } from "./adapters/azuredevops";

import { IntegrationRegistry, type IntegrationEventsSink } from "./registry";
import type { IntegrationTelemetry } from "./types";
import { createGithubAdapter } from "./adapters/github";
import { createGitlabAdapter } from "./adapters/gitlab";
import { createAzureDevOpsAdapter } from "./adapters/azuredevops";

/**
 * Registry pre-populated with today's SCM adapters. Sentry, MS Teams, Zoho,
 * and Netlify/Vercel/AWS aren't migrated yet — see
 * docs/architecture/integration-engine.md's migration strategy for the plan.
 * Callers needing just one adapter can import it directly instead of going
 * through a registry (e.g. a Netlify function that only ever talks to GitHub).
 * `events` is how this engine becomes a publisher on the Event Engine — see
 * docs/architecture/event-engine.md; omit it and nothing changes (fully
 * backward compatible with every existing caller of this factory).
 */
export function createDefaultRegistry(opts?: { telemetry?: IntegrationTelemetry; events?: IntegrationEventsSink }): IntegrationRegistry {
  const registry = new IntegrationRegistry(opts);
  registry.register(createGithubAdapter());
  registry.register(createGitlabAdapter());
  registry.register(createAzureDevOpsAdapter());
  return registry;
}
