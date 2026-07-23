/**
 * Drives the small "not production" badge in Layout.tsx's header — the one
 * code-level safety net for RC1 task 3 (staging environment): a human
 * looking at a staging deploy should never be able to mistake it for
 * production by sight. See docs/architecture/staging-environment.md.
 *
 * Deliberately opt-in, not opt-out: unset (today's production — nothing
 * changes for it unless it explicitly sets VITE_APP_ENV=production too) or
 * exactly "production" shows nothing; any other value is shown verbatim.
 * This can't detect misconfiguration on its own (this agent has no access
 * to real production credentials to compare against) — it only makes
 * whatever VITE_APP_ENV a site was actually given impossible to miss.
 */
export function nonProductionEnvLabel(appEnv: string | undefined): string | null {
  return appEnv && appEnv !== "production" ? appEnv : null;
}
