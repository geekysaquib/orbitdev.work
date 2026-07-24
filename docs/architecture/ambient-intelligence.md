# Ambient Intelligence — Wave 1

## Purpose

Orbit's Knowledge Engine, Event Engine, and 9 Insight detectors were real and correct, but invisible unless a user specifically navigated to `/intelligence` or `/ai-mode`. This milestone (Wave 1 of the broader Orbit Adoption Plan) makes Insights ambient across the app — visible from the global header, the actual default landing page (`/app`), Time Tracking, and Teams — without a new engine, a new route, or any change to how Insights/Intelligence/AI Mode themselves work.

**Explicitly out of scope for this wave**: the Health page (`/health`). It was part of the original Wave 1 proposal but dropped from the approved requirements — left untouched here.

## The shared hook: `src/hooks/useOrbitInsights.ts`

Obtains and exposes `Insight[]` — nothing more. It does **no page-specific filtering** (by detector, by subject, by count); that decision belongs entirely to each consuming page. This was a deliberate correction from the first draft of this plan, which would have baked filtering into the hook.

Called once, at `Layout.tsx`'s level, and shared down to routed pages via React Router's built-in `<Outlet context={...}>` — not a new Context Provider, not new state management. This matters for cost: the underlying `useKnowledgeBootstrap()` call (which runs `syncTimeEntries()`/`syncIntegrationStatus()` — the two syncs `docs/architecture/orbit-intelligence.md` originally scoped to "only visiting `/intelligence` pays for this") now runs once per session at `Layout` mount, not per-page. That's a real, deliberate cost increase — every authenticated page now pays a one-time sync it didn't before — accepted explicitly in exchange for "ambient."

### Temporary synchronization mechanism (flagged, not hidden)

The bootstrap/sync runs once. `runInsights()` — a cheap, in-memory detector pass over already-synced graph data — re-runs on every route change (keyed off `location.pathname`), so a dismissal made on `/intelligence` or `/ai-mode` shows up in the ambient surfaces within one navigation instead of staying stale for the rest of the session.

This is explicitly a stopgap, documented as such in the hook's own header comment. The correct long-term design is to recompute when the Knowledge Engine's data actually changes, or when a relevant `domain_events` row lands — driven by the Knowledge Engine / Event Engine, not by React Router's location object, which has nothing intrinsic to do with why the insight list went stale. Revisit once there's a cheap "the graph changed" signal to subscribe to instead of polling on navigation.

## Where insights surface

- **Global header** (`Layout.tsx`) — a small button next to the existing notification bell, severity-colored, showing a count when `insights.length > 0`. No dropdown, no preview — click navigates straight to `/intelligence`. The lightest of the four surfaces, by design.
- **Dashboard** (`/app`) — top 3 by severity (`runInsights()` already sorts), rendered via the new `InsightPreviewRow` component in a card between the greeting and the widget grid. Renders nothing at all when there are zero insights — no empty-state clutter on the app's busiest page.
- **Time Tracking** (`/time`) — `summarizeToday()` (existing function from `intelligence.ts`, called directly, unrelated to the shared hook) plus insights filtered, by the page itself, to `missing-daily-work`/`long-running-time-entry`/`declining-project-activity` — the three genuinely time-based detectors.
- **Teams** (`/teams`) — insights filtered, by the page itself, to `team-no-updates` (subject is the team, filters cleanly by `subject.id === teamId`) and `overloaded-developer` (subject is a user, not a team — scoped by intersecting with `members`, data the page already loads via `listMembers()`, not by adding team-awareness to the detector itself).

Every embedded surface includes a "View all in Intelligence" link. None of them reproduce dismiss/undismiss or evidence disclosure — that stays exclusive to `/intelligence` and `/ai-mode`.

## New shared component: `src/components/InsightPreviewRow.tsx`

Severity dot + title, click-through to `/intelligence`. Used identically by Dashboard, Time Tracking, and Teams so the three embeds read as one consistent pattern rather than three different implementations.

## What this milestone did not touch

- `Intelligence.tsx` and `AiMode.tsx` — unchanged. They keep their own independent bootstrap, `runInsights()` call, and full dismiss-state management. A user visiting either page after seeing an ambient preview will trigger one additional `runInsights()` call there — a minor, accepted redundancy, safer than lifting shared mutable state across pages for this wave.
- `Health.tsx` — explicitly deferred, see above.
- No new engine, table, or route. `src/engines/*`, `src/runtime/*` untouched.

## Test infrastructure

`useOrbitInsights.test.tsx` needed to exercise real React effect timing (bootstrap-runs-once vs. insights-recompute-per-navigation), which isn't testable as a pure function. Added `@testing-library/react`, `@testing-library/dom`, and `jsdom` as devDependencies — scoped to this one test file via the `// @vitest-environment jsdom` pragma, so the other 140+ existing tests keep running in the default `node` environment unchanged. This is the first component/hook-level test in the repo; the audit's "zero component-level test coverage" finding no longer applies to this one hook.

Three tests: dismissed insights are filtered out; `syncTimeEntries`/`syncIntegrationStatus` (the real bootstrap dependencies, only the network-touching parts mocked) are each called exactly once across multiple simulated navigations; `runInsights()` re-runs once per navigation while the bootstrap does not.

## Verification

`npx vitest run` (143/143, up from 140), `npx tsc -b` clean, `npm run build` clean. Noted: the main JS chunk grew (~617KB → ~632KB) since `Layout.tsx` is eager-loaded (not a lazy route) and now imports `useOrbitInsights`/`InsightRow`'s severity constants — an expected, direct consequence of making Insights ambient from the header on every page, not a regression to chase down separately.

No live click-through available in this session (standing limitation, same as every prior UI milestone) — the four surfaces should be manually verified against a workspace with real outstanding insights before considering this done.
