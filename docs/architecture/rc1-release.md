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

**Risk**: Low. The boundary only activates on an already-broken render path — it cannot make a currently-working app misbehave, only change what happens when something was already about to crash. `StrictMode`'s double-render-in-dev behavior was not specifically probed beyond the existing test suite; worth a manual dev-mode smoke test (throw a deliberate error in a component, confirm the fallback shows correctly under `npm run dev`, not just in the vitest/jsdom environment).

**Deferred to later RC1 tasks**: Sentry initialization + wiring this boundary's `componentDidCatch` to report to it (next task per the Release Plan).
