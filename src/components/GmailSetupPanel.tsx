import { useEffect, useState } from "react";
import { KeyField } from "./KeyField";
import { useToast } from "../context/Toast";
import { fetchIntegrations, saveIntegrations } from "../lib/integrations";
import { recordAudit } from "../lib/audit";

/** Gmail app-password entry, shared by Settings and the onboarding wizard. */
export function GmailSetupPanel({ onConnected }: { onConnected?: () => void }) {
  const toast = useToast();
  const [gk, setGk] = useState({ gmail_user: "", gmail_app_password: "" });
  const [savingG, setSavingG] = useState(false);

  useEffect(() => {
    fetchIntegrations().then((i) => {
      if (!i) return;
      setGk({ gmail_user: i.gmail_user || "", gmail_app_password: i.gmail_app_password || "" });
    });
  }, []);

  async function save() {
    setSavingG(true);
    const { error } = await saveIntegrations(gk);
    setSavingG(false);
    if (!error) {
      recordAudit({ action: "integration.connect", entityType: "integration", entityId: "gmail" });
      onConnected?.();
    }
    toast(error ? `Couldn't save: ${error}` : "Gmail keys saved — open Mail to connect");
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="ds">Read-only inbox via IMAP. Needs a Google <b>App Password</b> (2-Step Verification &rarr; App passwords). Stored per-account; the local agent uses it to connect.</div>
      <div className="kf-grid">
        <KeyField label="Gmail address" value={gk.gmail_user} onChange={(v) => setGk({ ...gk, gmail_user: v })} placeholder="you@gmail.com" />
        <KeyField label="App password" value={gk.gmail_app_password} onChange={(v) => setGk({ ...gk, gmail_app_password: v })} placeholder="16-character app password" hint="Not your Google password — an app password, revocable at any time." />
      </div>
      <button className="btn accent" style={{ marginTop: 16 }} disabled={savingG || !gk.gmail_user || !gk.gmail_app_password} onClick={save}>{savingG ? "Saving…" : "Save Gmail keys"}</button>
    </div>
  );
}
