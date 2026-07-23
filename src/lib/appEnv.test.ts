import { describe, it, expect } from "vitest";
import { nonProductionEnvLabel } from "./appEnv";

describe("nonProductionEnvLabel", () => {
  it("returns null when unset — today's production behavior, unchanged", () => {
    expect(nonProductionEnvLabel(undefined)).toBeNull();
  });

  it("returns null when explicitly \"production\"", () => {
    expect(nonProductionEnvLabel("production")).toBeNull();
  });

  it("returns the label verbatim for staging", () => {
    expect(nonProductionEnvLabel("staging")).toBe("staging");
  });

  it("returns the label verbatim for any other non-production value", () => {
    expect(nonProductionEnvLabel("development")).toBe("development");
  });
});
