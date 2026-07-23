import * as Sentry from "@sentry/react";

/**
 * Orbit's OWN crash reporting via the `@sentry/react` SDK — NOT to be
 * confused with `src/lib/sentry.ts`, which is a per-user *integration*
 * (reads a connected team's own Sentry org issues through
 * netlify/functions/sentry-api.ts). This file has nothing to do with that
 * feature; it exists so Orbit's own render/runtime errors are visible to
 * Orbit's operators, regardless of whether any given user has a Sentry
 * integration connected.
 *
 * Called once, at app bootstrap (`src/main.tsx`), before the first render —
 * so `ErrorBoundary.tsx`'s `captureException` calls always have a real
 * client to report through. RC1 task 2 — see docs/architecture/rc1-release.md.
 *
 * Same "warn, never throw, on missing config" convention as
 * `src/lib/supabase.ts`: a missing DSN means zero production error
 * visibility (a real gap), not a broken app — this must never block local
 * dev, where nobody wants Sentry configured.
 *
 * Deliberately minimal: no performance tracing, no session replay — pure
 * error capture, matching the browser SDK's own privacy-conscious default
 * (`sendDefaultPii` is false unless explicitly opted into, which this
 * doesn't). Source-map upload (so stack traces resolve to real file/line
 * instead of minified output) needs the separate `@sentry/vite-plugin` and
 * a Sentry auth token — deferred, see docs/architecture/rc1-release.md.
 */
export function initErrorReporting(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) {
    console.warn("[ORBIT] Missing VITE_SENTRY_DSN — error tracking is disabled. Set it in Netlify env for production.");
    return;
  }
  Sentry.init({ dsn, environment: import.meta.env.MODE });
}
