import { useEffect, useState } from "react";
import { Icon } from "../lib/icons";
import { KeyField } from "./KeyField";
import { Select } from "./Select";
import { useToast } from "../context/Toast";
import { fetchIntegrations, saveIntegrations, providerKeys, type Integrations } from "../lib/integrations";
import { recordAudit } from "../lib/audit";
import { askLocalAI, orderedProviders, PROVIDER_LABEL, CLOUD_PROVIDERS, type CloudProvider } from "../lib/ai";

const PROVIDER_PLACEHOLDER: Record<CloudProvider, string> = {
  anthropic: "sk-ant-…", gemini: "AIza…", openai: "sk-…", grok: "xai-…",
};
const PROVIDER_CONSOLE: Record<CloudProvider, string> = {
  anthropic: "console.anthropic.com", gemini: "aistudio.google.com/apikey", openai: "platform.openai.com/api-keys", grok: "console.x.ai",
};

/** Cloud provider keys + local-AI fallback, shared by Settings and the onboarding wizard. */
export function AiKeySetupPanel({ onConnected }: { onConnected?: () => void }) {
  const toast = useToast();
  const [keys, setKeys] = useState<Record<CloudProvider, string>>({ anthropic: "", gemini: "", openai: "", grok: "" });
  const [preferred, setPreferred] = useState<CloudProvider>("anthropic");
  const [savingA, setSavingA] = useState(false);
  const [localAiTest, setLocalAiTest] = useState<{ busy: boolean; ok: boolean | null; message: string | null }>({ busy: false, ok: null, message: null });

  useEffect(() => {
    fetchIntegrations().then((i) => {
      if (!i) return;
      const pk = providerKeys(i);
      setKeys({ anthropic: pk.anthropic || "", gemini: pk.gemini || "", openai: pk.openai || "", grok: pk.grok || "" });
      setPreferred(i.ai_provider || "anthropic");
    });
  }, []);

  async function saveAi() {
    setSavingA(true);
    const patch: Integrations = {
      anthropic_api_key: keys.anthropic, gemini_api_key: keys.gemini, openai_api_key: keys.openai, grok_api_key: keys.grok,
      ai_provider: preferred,
    };
    const { error } = await saveIntegrations(patch);
    setSavingA(false);
    if (!error) {
      recordAudit({ action: "integration.update", entityType: "integration", entityId: "ai_provider_keys" });
      onConnected?.();
    }
    toast(error ? `Couldn't save: ${error}` : "AI provider keys saved");
  }

  async function testLocalAi() {
    setLocalAiTest({ busy: true, ok: null, message: null });
    const r = await askLocalAI("Reply with only the word: ready.");
    setLocalAiTest({ busy: false, ok: r.ok, message: r.ok ? (r.text || "").trim() : r.error || "Couldn't reach the local model" });
  }

  const configured = orderedProviders({ anthropic: keys.anthropic, gemini: keys.gemini, openai: keys.openai, grok: keys.grok });

  return (
    <>
      <div className="card" style={{ padding: 20 }}>
        <div className="ds">
          ORBIT's cloud AI features (schema Q&amp;A, ticket triage, standup summaries, and Ask AI) can use any of the
          providers below. Add as many as you like — if your preferred provider is out of credit, rate-limited, or its
          key stops working, ORBIT automatically tries the next configured one before falling back to the free local
          model. Keys are stored per-account and only ever leave your machine when an AI feature actually runs.
        </div>
        <div className="kf-grid" style={{ marginTop: 14 }}>
          {CLOUD_PROVIDERS.map((p) => (
            <KeyField
              key={p} span
              label={`${PROVIDER_LABEL[p]} API key`}
              value={keys[p]}
              onChange={(v) => setKeys((k) => ({ ...k, [p]: v }))}
              placeholder={PROVIDER_PLACEHOLDER[p]}
              hint={`From ${PROVIDER_CONSOLE[p]}. Optional — every AI feature works without it.`}
              optional
            />
          ))}
        </div>
        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <label style={{ fontSize: 12.5, color: "var(--muted)" }}>Preferred provider</label>
          <Select value={preferred} onChange={(e) => setPreferred(e.target.value as CloudProvider)} style={{ minWidth: 140 }}>
            {CLOUD_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
          </Select>
          <span style={{ fontSize: 11.5, color: "var(--dim)" }}>
            {configured.length > 0
              ? `Tries: ${configured.map((p) => PROVIDER_LABEL[p]).join(" → ")} → local`
              : "No keys set yet — falls straight through to the local model."}
          </span>
        </div>
        <button className="btn accent" style={{ marginTop: 16 }} disabled={savingA} onClick={saveAi}>{savingA ? "Saving…" : "Save keys"}</button>
      </div>

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ color: "var(--mint)" }}><Icon name="sparkles" size={16} /></span>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>Local AI (free, no key)</div>
        </div>
        <div className="ds" style={{ marginTop: 8 }}>
          Whenever no cloud provider above is configured — or every configured one fails — ORBIT's AI features fall
          back to a small open-weight model (Llama 3.2 1B, via llama-cpp-python) running entirely on this machine
          through the local agent — genuinely free, no API key, no data leaving your computer. One-time setup:
        </div>
        <ol style={{ marginTop: 10, paddingLeft: 18, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.8 }}>
          <li>Install Python 3, if it isn't already.</li>
          <li>Run <span className="mono">pip install llama-cpp-python</span>.</li>
          <li>Restart the ORBIT agent, then click Test below — the first run downloads a small model (a few hundred MB) and caches it, so it can take a minute.</li>
        </ol>
        <button className="btn ghost" style={{ marginTop: 14 }} disabled={localAiTest.busy} onClick={testLocalAi}>
          {localAiTest.busy ? <><Icon name="loader" size={14} className="spin" />Testing…</> : <><Icon name="play" size={13} fill />Test local AI</>}
        </button>
        {localAiTest.ok === true && <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--mint)" }}>Working — model replied: "{localAiTest.message}"</div>}
        {localAiTest.ok === false && <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--red)" }}>{localAiTest.message}</div>}
      </div>
    </>
  );
}
