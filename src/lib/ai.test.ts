import { describe, it, expect } from "vitest";
import { orderedProviders, type ProviderKeys } from "./ai";

describe("orderedProviders", () => {
  it("returns an empty list when no provider is configured", () => {
    expect(orderedProviders({})).toEqual([]);
  });

  it("puts the preferred provider first when it has a key", () => {
    const keys: ProviderKeys = { anthropic: "a", openai: "b" };
    expect(orderedProviders(keys, "openai")).toEqual(["openai", "anthropic"]);
  });

  it("ignores a preferred provider with no key, falling back to CLOUD_PROVIDERS order", () => {
    const keys: ProviderKeys = { gemini: "g", grok: "x" };
    // preferred "anthropic" isn't configured, so the first configured provider
    // in CLOUD_PROVIDERS order (gemini) leads instead.
    expect(orderedProviders(keys, "anthropic")).toEqual(["gemini", "grok"]);
  });

  it("keeps only configured providers, in CLOUD_PROVIDERS order, when none is preferred", () => {
    const keys: ProviderKeys = { grok: "x", anthropic: "a" };
    expect(orderedProviders(keys)).toEqual(["anthropic", "grok"]);
  });

  it("returns a single-element list when only one provider is configured", () => {
    expect(orderedProviders({ openai: "b" }, "grok")).toEqual(["openai"]);
  });
});
