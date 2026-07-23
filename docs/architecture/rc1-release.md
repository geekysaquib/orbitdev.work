# Release Candidate 1 — Execution Log

Tracks RC1 of the closed-beta Release Plan (see the Beta Readiness Review and Release Plan in the session history this originated from). One section per completed task, appended as each lands — RC1 ships as a sequence of small, independently-verified, independently-revertible changes, not one big release commit.

## 1. Top-level React error boundary

**Problem**: `src/main.tsx` had no error boundary — any render-time throw anywhere in the component tree unmounted the whole app, leaving the user with a blank white screen and no recovery path. Beta Readiness Review, Reliability §10 / Error recovery §4, Critical.

**Change**: `src/components/ErrorBoundary.tsx` (new) — a class component (`componentDidCatch`/`getDerivedStateFromError`; React has no hook equivalent) wrapping `<App/>` in `src/main.tsx`. The fallback UI is deliberately context-free (no `useAuth`/`useToast`/`useOrbitRuntime` — any of those could be what's broken) and reuses existing patterns: the `.center-load` full-viewport-centering class already used by `Login.tsx`/`Landing.tsx`/`OAuthCallback.tsx`, and the existing `btn`/`Icon` primitives. Recovery is a hard reload (`window.location.reload()`), not an in-place retry — safer than risking a re-render into the same broken state. A "Copy error details" button lets a user hand a support request the error message + stack even before Sentry exists.

**Explicitly not done here**: error reporting is `console.error` only. Wiring this boundary's catch to Sentry is RC1's next task, not this one — `componentDidCatch` has a comment marking that boundary so it's obvious where to hook in.

**Side fix**: writing this task's tests surfaced that the project's vitest+`@testing-library/react` setup (added in the Ambient Intelligence milestone) had no RTL cleanup wired between test renders — `vitest.config.ts` had no `test.globals` and no `setupFiles`, so RTL's auto-cleanup detection silently no-ops. Multiple `render()` calls in one test file accumulate DOM across tests and eventually break `getByText`'s uniqueness assumption (this is exactly how `ErrorBoundary.test.tsx`'s 5th test failed on first run). Fixed globally, not just locally, via a new `src/testSetup.ts` (`afterEach(() => cleanup())`) wired through `vitest.config.ts`'s new `setupFiles` entry — a one-line, purely-additive config change that fixes this for every current and future component/hook test, not just this one file.

**Files changed**:
- `src/components/ErrorBoundary.tsx` (new)
- `src/components/ErrorBoundary.test.tsx` (new, 5 tests)
- `src/main.tsx` (wraps `<App/>`)
- `src/testSetup.ts` (new)
- `vitest.config.ts` (`+setupFiles: ["./src/testSetup.ts"]`)

**Verification**: `npx tsc -b` clean. `npx vitest run` — 148/148 (143 prior + 5 new). `npm run build` clean (main chunk +~2KB — the boundary is necessarily part of the eager bundle since it wraps the app root, can't be lazy-loaded).

**Rollback**: Pure code change, no data/schema/config-service involved. `git revert` the commit, or restore the previous Netlify deploy. The `testSetup.ts`/`vitest.config.ts` change is test-only and has zero production runtime effect either way.

**Risk**: Low. The boundary only activates on an already-broken render path — it cannot make a currently-working app misbehave, only change what happens when something was already about to crash.

**Manual smoke test (real `npm run dev` build, real headless Chromium via Playwright — already an installed browser, no new dependency)**: temporarily added `throw new Error(...)` as the first line of `App()`, confirmed via screenshot + DOM assertions that (1) the full-screen fallback renders exactly as designed, (2) "Copy error details" flips to "Copied" and the clipboard genuinely contains the thrown error's message, (3) "Reload Orbit" triggers a real reload and consistently re-shows the fallback while the bug is still present (not a worse/blank screen), (4) after reverting the deliberate throw, a fresh reload boots the app normally (Landing page, zero console errors) — confirming the boundary leaves no residual corruption once whatever tripped it is fixed. The throw and its revert left zero diff in git history; the driver script was a throwaway file outside the repo's tracked tree, deleted after use.

**Deferred to later RC1 tasks**: Sentry initialization + wiring this boundary's `componentDidCatch` to report to it (next task per the Release Plan).

## 2. Initialize Sentry, wire it to the error boundary

**Problem**: `@sentry/react` was already a dependency but never initialized anywhere — zero production error visibility. Beta Readiness Review, Observability §11, Critical.

**Important discovery before writing anything**: `src/lib/sentry.ts` already existed — but it's a completely unrelated, already-shipped feature (Sentry as a per-user *integration*, reading a connected team's own Sentry org issues through `netlify/functions/sentry-api.ts`, surfaced in Settings). Reading it before writing (the Write tool's own guard forced this) caught what would have been a serious mistake — overwriting a real, working feature because of a filename collision with what I was about to build. New code went into `src/lib/errorReporting.ts` instead, with a header comment explicitly cross-referencing the two so a future reader doesn't make the same assumption.

**Change**:
- `src/lib/errorReporting.ts` (new) — `initErrorReporting()`, an explicit function (not an import-time side effect like `supabase.ts`'s client — Sentry's init is inherently a "call once at startup" action, and an explicit function is what makes this directly unit-testable). Reads `VITE_SENTRY_DSN`; warns and no-ops if absent (same convention as `supabase.ts`'s missing-config handling), otherwise calls `Sentry.init({dsn, environment})`. No performance tracing, no session replay, no PII opt-in — pure error capture only.
- `src/main.tsx` calls `initErrorReporting()` before the first render.
- `src/components/ErrorBoundary.tsx`'s `componentDidCatch` now also calls `Sentry.captureException(error, {contexts:{react:{componentStack}}})`, imported directly from `@sentry/react` (not through my wrapper — `captureException` is always safe to call even if `init()` never ran, so `ErrorBoundary` doesn't need to know whether reporting is actually configured). `console.error` stays alongside it, not replaced.
- `.env.example` documents the new `VITE_SENTRY_DSN` var, with a note distinguishing it from the unrelated Settings-page Sentry integration.

**Explicitly not done here**: source-map upload (`@sentry/vite-plugin` + a Sentry auth token, so stack traces resolve to real file/line instead of minified output) — needs real Sentry org credentials this agent doesn't have, and is a separate build-pipeline change. Also not done: enabling `sendDefaultPii`, performance tracing, or session replay — none were asked for, all add bundle weight and data-collection surface beyond "wire up error capture."

**Files changed**:
- `src/lib/errorReporting.ts` (new)
- `src/lib/errorReporting.test.ts` (new, 2 tests)
- `src/components/ErrorBoundary.tsx` (`+Sentry.captureException` in `componentDidCatch`)
- `src/components/ErrorBoundary.test.tsx` (+1 test, asserts `captureException` is called on catch)
- `src/main.tsx` (calls `initErrorReporting()` before render)
- `.env.example` (`+VITE_SENTRY_DSN`)

**Verification**: `npx tsc -b` clean. `npx vitest run` — 151/151 (148 prior + 3 new). `npm run build` clean (main chunk +~12KB gzipped-equivalent — the SDK is necessarily eager since it must initialize before the first render, same reasoning as the boundary itself).

**Rollback**: Pure code change, no data/schema involved. `git revert`, or restore the previous Netlify deploy. Leaving `VITE_SENTRY_DSN` unset in Netlify env is itself a safe "soft disable" — `initErrorReporting()` warns and no-ops rather than breaking anything.

**Risk**: Low. Everything is additive and gated behind a missing-by-default env var; without a DSN configured, this release is behaviorally identical to before it.

**Operational step required, not code**: a real Sentry project + DSN need to exist and `VITE_SENTRY_DSN` needs to be set in Netlify's production env for this to actually report anything — this agent can't create a Sentry account/project. Until that's done, `console.warn("[ORBIT] Missing VITE_SENTRY_DSN...")` will show in every browser console, which is the intended, honest signal that this step is still outstanding.

**Deferred**: source-map upload (see above) — worth revisiting once a Sentry org/token exists to configure it against.
