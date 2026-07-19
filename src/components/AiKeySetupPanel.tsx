import { useEffect, useState } from "react";
import { Icon } from "../lib/icons";
import { KeyField } from "./KeyField";
import { useToast } from "../context/Toast";
import { fetchIntegrations, saveIntegrations } from "../lib/integrations";
import { recordAudit } from "../lib/audit";
import { askLocalAI } from "../lib/ai";

/** Anthropic key + local-AI fallback, shared by Settings and the onboarding wizard. */
export function AiKeySetupPanel({ onConnected }: { onConnected?: () => void }) {
  const toast = useToast();
  const [ak, setAk] = useState({ anthropic_api_key: "" });
  const [savingA, setSavingA] = useState(false);
  const [localAiTest, setLocalAiTest] = useState<{ busy: boolean; ok: boolean | null; message: string | null }>({ busy: false, ok: null, message: null });

  useEffect(() => {
    fetchIntegrations().then((i) => { if (i) setAk({ anthropic_api_key: i.anthropic_api_key || "" }); });
  }, []);

  async function saveAi() {
    setSavingA(true);
    const { error } = await saveIntegrations(ak);
    setSavingA(false);
    if (!error) {
      recordAudit({ action: "integration.update", entityType: "integration", entityId: "anthropic_api_key" });
      onConnected?.();
    }
    toast(error ? `Couldn't save: ${error}` : "Anthropic API key saved");
  }

  async function testLocalAi() {
    setLocalAiTest({ busy: true, ok: null, message: null });
    const r = await askLocalAI("Reply with only the word: ready.");
    setLocalAiTest({ busy: false, ok: r.ok, message: r.ok ? (r.text || "").trim() : r.error || "Couldn't reach the local model" });
  }

  return (
    <>
      <div className="card" style={{ padding: 20 }}>
        <div className="ds">
          When seeding dummy data into Postgres, you can describe your project and ORBIT will ask Claude for
          domain-specific sample values (e.g. real-looking cuisines for a food app, genres for a media app)
          instead of generic placeholder text. Your key is stored per-account and only ever leaves your
          machine when you start a seed job with a project description filled in. This same key also powers
          schema Q&amp;A, ticket triage, and standup summaries elsewhere in ORBIT.
        </div>
        <div className="kf-grid">
          <KeyField span label="Anthropic API key" value={ak.anthropic_api_key} onChange={(v) => setAk({ anthropic_api_key: v })} placeholder="sk-ant-…" hint="From console.anthropic.com. Optional — every AI feature works without it, using the free local model below instead." />
        </div>
        <button className="btn accent" style={{ marginTop: 16 }} disabled={savingA} onClick={saveAi}>{savingA ? "Saving…" : "Save key"}</button>
      </div>

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ color: "var(--mint)" }}><Icon name="sparkles" size={16} /></span>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>Local AI (free, no key)</div>
        </div>
        <div className="ds" style={{ marginTop: 8 }}>
          Whenever no Anthropic key is set, ORBIT's AI features fall back to a small open-weight model
          (Llama 3.2 1B, via llama-cpp-python) running entirely on this machine through the local agent —
          genuinely free, no API key, no data leaving your computer. One-time setup:
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
