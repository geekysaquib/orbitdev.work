import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { orderedProviders, askAI, type ProviderKeys } from "./aiProviders";

describe("orderedProviders", () => {
  it("returns an empty list when no provider is configured", () => {
    expect(orderedProviders({})).toEqual([]);
  });

  it("puts the preferred provider first when it has a key", () => {
    const keys: ProviderKeys = { anthropic: "a", openai: "b" };
    expect(orderedProviders(keys, "openai")).toEqual(["openai", "anthropic"]);
  });

  it("falls back to CLOUD_PROVIDERS order when the preferred provider has no key", () => {
    const keys: ProviderKeys = { gemini: "g", grok: "x" };
    expect(orderedProviders(keys, "anthropic")).toEqual(["gemini", "grok"]);
  });
});

describe("askAI", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  function anthropicOk(text: string) {
    return { ok: true, json: async () => ({ content: [{ type: "text", text }] }) };
  }
  function anthropicFail() {
    return { ok: false, status: 400, json: async () => ({ error: { message: "no credit" } }) };
  }

  it("returns null text and null source when no provider is configured", async () => {
    const r = await askAI({}, undefined, "system", "prompt");
    expect(r).toEqual({ text: null, source: null, error: "No AI provider configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the first configured provider's answer", async () => {
    fetchMock.mockResolvedValueOnce(anthropicOk("hello from claude"));
    const r = await askAI({ anthropic: "key" }, undefined, "system", "prompt");
    expect(r).toEqual({ text: "hello from claude", source: "anthropic" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the next configured provider when the first fails", async () => {
    fetchMock
      .mockResolvedValueOnce(anthropicFail()) // anthropic (preferred) fails
      .mockResolvedValueOnce({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "hello from gemini" }] } }] }) }); // gemini succeeds
    const r = await askAI({ anthropic: "a", gemini: "g" }, "anthropic", "system", "prompt");
    expect(r).toEqual({ text: "hello from gemini", source: "gemini" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null when every configured provider fails, with the real reason in `error`", async () => {
    fetchMock.mockResolvedValue(anthropicFail());
    const r = await askAI({ anthropic: "a" }, undefined, "system", "prompt");
    expect(r).toEqual({ text: null, source: null, error: "All configured providers failed: anthropic — no credit" });
  });

  it("does not throw when a provider call itself throws (network error), and surfaces that reason too", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const r = await askAI({ anthropic: "a" }, undefined, "system", "prompt");
    expect(r).toEqual({ text: null, source: null, error: "All configured providers failed: anthropic — network down" });
  });
});
