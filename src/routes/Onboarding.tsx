import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "../lib/icons";
import { useAuth } from "../context/AuthContext";
import { AgentSetupPanel } from "../components/AgentSetupPanel";
import { ZohoSetupPanel } from "../components/ZohoSetupPanel";
import { GmailSetupPanel } from "../components/GmailSetupPanel";
import { AiKeySetupPanel } from "../components/AiKeySetupPanel";
import { saveSettings } from "../lib/settings";
import { recordAudit } from "../lib/audit";

type StepId = "agent" | "zoho" | "gmail" | "ai";
const STEPS: { id: StepId; label: string; optional?: boolean }[] = [
  { id: "agent", label: "Local agent" },
  { id: "zoho", label: "Zoho Sprints" },
  { id: "gmail", label: "Gmail" },
  { id: "ai", label: "AI key", optional: true },
];

export default function Onboarding() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/app";
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;

  async function finish(skipped: boolean) {
    await saveSettings({ onboarded_at: new Date().toISOString() });
    recordAudit({ action: skipped ? "onboarding.skipped" : "onboarding.completed", entityType: "onboarding" });
    nav(next);
  }

  function advance() {
    if (last) finish(false);
    else setStep((s) => s + 1);
  }

  const current = STEPS[step];

  return (
    <main className="page">
      <div className="h1">Let's get ORBIT set up, {user?.full_name?.split(" ")[0] || "there"}.</div>
      <div className="sub">A few optional steps to connect the local agent, Zoho, Gmail, and AI. Skip anything you'll do later — you can always finish it from Settings.</div>

      <div className="pill-row" style={{ marginTop: 20 }}>
        {STEPS.map((s, i) => (
          <button key={s.id} className={"pill-opt" + (step === i ? " on" : "")} onClick={() => setStep(i)}>
            {i + 1}. {s.label}{s.optional ? " (optional)" : ""}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 16, maxWidth: 720 }}>
        {current.id === "agent" && <AgentSetupPanel />}
        {current.id === "zoho" && <ZohoSetupPanel onConnected={advance} />}
        {current.id === "gmail" && <GmailSetupPanel onConnected={advance} />}
        {current.id === "ai" && <AiKeySetupPanel onConnected={advance} />}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 24 }}>
        {step > 0 && <button className="btn ghost" onClick={() => setStep((s) => s - 1)}><Icon name="chevL" size={15} />Back</button>}
        <button className="btn accent" onClick={advance}>{last ? <><Icon name="check" size={15} />Finish setup</> : <><Icon name="chevR" size={15} />Next</>}</button>
        <button className="btn ghost" onClick={() => (last ? finish(true) : setStep((s) => s + 1))}>{last ? "Skip & finish" : "Skip this step"}</button>
      </div>
    </main>
  );
}
