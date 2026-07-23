import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initErrorReporting } from "./errorReporting";

const init = vi.fn();
vi.mock("@sentry/react", () => ({ init: (...a: unknown[]) => init(...a) }));

beforeEach(() => { init.mockReset(); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("initErrorReporting", () => {
  it("initializes Sentry when a DSN is configured", () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@o0.ingest.sentry.io/1");
    initErrorReporting();
    expect(init).toHaveBeenCalledWith(expect.objectContaining({ dsn: "https://public@o0.ingest.sentry.io/1" }));
  });

  it("does not initialize Sentry, and warns, when no DSN is configured", () => {
    vi.stubEnv("VITE_SENTRY_DSN", "");
    initErrorReporting();
    expect(init).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("VITE_SENTRY_DSN"));
  });
});
