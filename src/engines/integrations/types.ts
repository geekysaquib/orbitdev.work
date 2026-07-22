/**
 * Shared contract for the Integration Engine (see
 * docs/architecture/integration-engine.md). Every external system — SCM,
 * issue tracker, chat, database, cloud, observability, AI provider — is
 * represented as an `IntegrationAdapter` implementing a small
 * identity/lifecycle contract, plus one or more typed "capability"
 * interfaces (see capabilities/*.ts) it declares via `capabilities`. No
 * caller should hand-roll a provider-specific request/response shape,
 * credential lookup, or a switch statement keyed on provider id.
 */

/** Provider identifier. An open string, not a closed union — adding an integration never requires editing a shared type. Current ids in use: "github" | "gitlab" | "azuredevops" | "sentry" | "msteams" | "zoho". */
export type IntegrationId = string;

/**
 * The families of operations an adapter can advertise. Open-ended by design —
 * new kinds get added as real adapters need them, not pre-approved centrally.
 * Only "scm" has a concrete capability interface + adapters today
 * (capabilities/scm.ts); the rest name the next intended slots (see
 * docs/architecture/integration-engine.md's migration strategy).
 */
export type IntegrationCapabilityKind = "scm" | "issues" | "cicd" | "monitoring" | "database" | "ai" | "chat";

export type IntegrationAuthKind = "bearer" | "basic" | "apiKey" | "none";

/** Normalizes however a provider's secret is stored (`provider_connections.access_token`, `integrations.*_api_key`, a pasted PAT) into one shape adapters read from. Built by a `CredentialManager`, never by an adapter or its caller reading a table directly. */
export interface IntegrationAuth {
  kind: IntegrationAuthKind;
  /** Bearer/apiKey token, or basic auth's password (Azure DevOps stores a PAT here with an empty username). */
  token?: string;
  /** Basic auth only. */
  username?: string;
}

/** Everything an adapter method needs to make one call — credentials plus provider-specific extras (self-hosted base_url, org/tenant id) that today live in `provider_connections.config`. */
export interface IntegrationContext {
  auth: IntegrationAuth;
  config: Record<string, unknown>;
}

export interface IntegrationStatus {
  connected: boolean;
  account?: string | null;
  error?: string;
}

export interface IntegrationResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  /** Remote HTTP status, when the failure came from the provider's API (or a request-validation failure, e.g. 400) — lets an HTTP-facing caller relay the real status instead of a generic 502. */
  status?: number;
}

/**
 * The one contract every integration implements, regardless of what it
 * does. Actual operations (list pull requests, send a message, run a query)
 * live in capability interfaces (e.g. `ScmAdapter`) that extend this — an
 * adapter implements only the capabilities relevant to what kind of system
 * it is, instead of one interface with every possible method on it.
 * `capabilities` is the runtime-introspectable list a registry filters on
 * (`listByCapability`) and capability type guards (`isScmAdapter`) check —
 * one source of truth so the declared list and the actual narrowing can't
 * drift apart.
 */
export interface IntegrationAdapter {
  readonly id: IntegrationId;
  readonly displayName: string;
  readonly capabilities: IntegrationCapabilityKind[];
  /** Cheap reachability/credential-validity check — same job `mode=status` does in today's per-provider proxy functions. */
  checkStatus(ctx: IntegrationContext): Promise<IntegrationStatus>;
}

// ---- Credentials --------------------------------------------------------

/**
 * Who's asking for credentials — the two access patterns already used
 * throughout netlify/functions: a browser request carrying the caller's own
 * JWT (RLS-scoped reads), or a scheduled/cron job acting as a specific user
 * via the service-role key (no caller JWT exists).
 */
export type CredentialPrincipal =
  | { kind: "request"; authHeader: string | null }
  | { kind: "service"; userId: string };

/**
 * Hides where/how a credential is stored (today: split across
 * `provider_connections` and `integrations` — see
 * docs/architecture/integration-engine.md's Authentication flow) behind one
 * lookup. Adapters and their callers only ever see the resulting
 * `IntegrationContext`, never a table row.
 */
export interface CredentialManager {
  getContext(integrationId: IntegrationId, principal: CredentialPrincipal): Promise<IntegrationContext | null>;
}

// ---- Events ---------------------------------------------------------------

/**
 * Forward-compatible event contract. Not yet wired to a dispatcher — there
 * is no existing event bus/pub-sub in the codebase to plug into today's
 * `audit_log`/`notifications` tables (both are written to directly, ad hoc,
 * from many call sites). See docs/architecture/integration-engine.md's Event
 * model section for the full rationale and the migration path.
 */
export type IntegrationEventType =
  | "connected"
  | "disconnected"
  | "sync_started"
  | "sync_completed"
  | "token_refreshed"
  | "webhook_received"
  | "rate_limited"
  | "authentication_failed";

export interface IntegrationEvent {
  integrationId: IntegrationId;
  type: IntegrationEventType;
  occurredAt: string;
  meta?: Record<string, unknown>;
}

// ---- Telemetry --------------------------------------------------------------

/**
 * Optional instrumentation hooks for future health monitoring, latency
 * tracking, and rate-limit/error observability. All methods optional and
 * unset by default — a registry with no telemetry sink configured behaves
 * identically to one with no telemetry support at all (see `IntegrationRegistry`).
 */
export interface IntegrationTelemetry {
  onCallStart?(info: { integrationId: IntegrationId; operation: string }): void;
  onCallEnd?(info: { integrationId: IntegrationId; operation: string; ok: boolean; durationMs: number; status?: number }): void;
  onRateLimited?(info: { integrationId: IntegrationId; retryAfterMs?: number }): void;
}
