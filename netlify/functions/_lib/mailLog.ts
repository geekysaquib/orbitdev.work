import { randomBytes } from "node:crypto";

/**
 * Observability wrapper for ORBIT's outbound email paths (RC1 task 8) — pure
 * logging/metrics, never changes what a send does or how its result/error
 * propagates to the caller. Every attempt gets a short correlation id so a
 * specific email (e.g. one a user reports as never arriving) can be traced
 * across the "attempt" / "sent" / "failed" log lines it produces.
 *
 * Metrics are in-memory only (same trade-off as _lib/rateLimit.ts — no new
 * infrastructure, resets on cold start, not shared across concurrent warm
 * instances). "Metrics" here means the sent/failed counters below, derivable
 * either by reading them directly (see getMailMetrics) or from the
 * structured `[mail]` log lines themselves via Netlify's log search/drain.
 */

export interface MailKindMetrics {
  sent: number;
  failed: number;
}

const metrics = new Map<string, MailKindMetrics>();

function bucket(kind: string): MailKindMetrics {
  let b = metrics.get(kind);
  if (!b) {
    b = { sent: 0, failed: 0 };
    metrics.set(kind, b);
  }
  return b;
}

export function newCorrelationId(): string {
  return randomBytes(6).toString("hex");
}

/** Same masking convention teams.ts already used for invite-preview responses — reused here, not reinvented. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return email;
  return `${user.slice(0, 1)}${"*".repeat(Math.max(user.length - 1, 1))}@${domain}`;
}

/**
 * Wraps a single outbound-email attempt. `kind` identifies which email this
 * is (e.g. "verify", "team_invite", "scheduled") for both the log lines and
 * the per-kind counters — pass something specific, not a generic label, or
 * the metrics collapse into one undifferentiated bucket.
 */
export async function withMailLog<T>(kind: string, to: string, send: () => Promise<T>): Promise<T> {
  const correlationId = newCorrelationId();
  const startedAt = Date.now();
  const maskedTo = maskEmail(to);
  console.log("[mail]", JSON.stringify({ event: "attempt", kind, correlationId, to: maskedTo }));
  try {
    const result = await send();
    bucket(kind).sent += 1;
    console.log("[mail]", JSON.stringify({ event: "sent", kind, correlationId, to: maskedTo, durationMs: Date.now() - startedAt }));
    return result;
  } catch (e) {
    bucket(kind).failed += 1;
    console.error("[mail]", JSON.stringify({
      event: "failed", kind, correlationId, to: maskedTo, durationMs: Date.now() - startedAt, error: (e as Error).message,
    }));
    throw e;
  }
}

/** In-memory counts since this container started — read access for tests and any future health check. */
export function getMailMetrics(): Record<string, MailKindMetrics> {
  return Object.fromEntries(metrics);
}

/** Test-only: clears counters so tests don't leak state into each other. */
export function _resetMailMetricsForTests(): void {
  metrics.clear();
}
