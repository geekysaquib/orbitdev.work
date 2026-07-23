// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

const captureException = vi.fn();
vi.mock("@sentry/react", () => ({ captureException: (...a: unknown[]) => captureException(...a) }));

function Bomb(): never {
  throw new Error("boom");
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // React (and our own componentDidCatch) log to console.error when a
  // boundary catches something — expected noise for these tests, silenced
  // so it doesn't look like an unexpected failure in test output.
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  captureException.mockReset();
});
afterEach(() => { consoleErrorSpy.mockRestore(); }); // DOM cleanup between renders is global — see src/testSetup.ts

describe("ErrorBoundary", () => {
  it("renders children normally when nothing throws", () => {
    render(<ErrorBoundary><div>All good</div></ErrorBoundary>);
    expect(screen.getByText("All good")).toBeTruthy();
  });

  it("renders a fallback instead of a blank screen when a child throws", () => {
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.queryByText("All good")).toBeNull();
  });

  it("logs the caught error", () => {
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[ORBIT] Unhandled render error",
      expect.any(Error),
      expect.anything(),
    );
  });

  it("reports the caught error to Sentry", () => {
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "boom" }),
      expect.objectContaining({ contexts: expect.objectContaining({ react: expect.anything() }) }),
    );
  });

  it("reloads the page when \"Reload Orbit\" is clicked", () => {
    // jsdom's window.location.reload isn't configurable enough for
    // vi.spyOn — replace the whole location object for this one test.
    const originalLocation = window.location;
    const reload = vi.fn();
    Object.defineProperty(window, "location", { value: { ...originalLocation, reload }, writable: true, configurable: true });

    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    fireEvent.click(screen.getByText("Reload Orbit"));
    expect(reload).toHaveBeenCalledTimes(1);

    Object.defineProperty(window, "location", { value: originalLocation, writable: true, configurable: true });
  });

  it("copies error details to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    fireEvent.click(screen.getByText("Copy error details"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("boom")));
  });
});
