import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Global for the whole suite (not just jsdom-environment files) — cleanup()
// is a no-op when nothing was rendered, so this is harmless for the
// node-environment tests that make up most of the suite. Without this,
// component/hook tests that render more than once accumulate DOM across
// tests in the same file and break text-lookup uniqueness — see the
// ErrorBoundary.test.tsx / useOrbitInsights.test.tsx tests this was added
// alongside.
afterEach(() => { cleanup(); });
