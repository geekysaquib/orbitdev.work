import { useEffect, useState } from "react";
import { Icon } from "../lib/icons";
import { KeyField } from "./KeyField";
import { useToast } from "../context/Toast";
import { recordAudit } from "../lib/audit";
import { connectGithub, disconnectGithub, fetchGithubStatus } from "../lib/github";
import { fetchProviderConnection } from "../lib/providerConnections";

/** GitHub connect flow — bring-your-own OAuth App, popup-based (see src/lib/oauthPopup.ts). */
export function GithubSetupPanel() {
  const toast = useToast();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [status, setStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const [account, setAccount] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setStatus("checking");
    const [conn, live] = await Promise.all([fetchProviderConnection("github"), fetchGithubStatus()]);
    if (conn?.client_id) setClientId(conn.client_id);
    if (conn?.client_secret) setClientSecret(conn.client_secret);
    setAccount(live.account ?? conn?.external_account_name ?? null);
    setStatus(live.connected ? "connected" : "disconnected");
  }
  useEffect(() => { refresh(); }, []);

  async function doConnect() {
    setConnecting(true); setError(null);
    const r = await connectGithub(clientId.trim(), clientSecret.trim());
    setConnecting(false);
    if (!r.ok) { setError(r.error || "Couldn't connect"); toast(`GitHub: ${r.error}`); return; }
    setAccount(r.account ?? null);
    setStatus("connected");
    recordAudit({ action: "integration.connect", entityType: "integration", entityId: "github" });
    toast("GitHub connected");
  }

  async function doDisconnect() {
    await disconnectGithub();
    setStatus("disconnected"); setAccount(null);
    recordAudit({ action: "integration.disconnect", entityType: "integration", entityId: "github" });
    toast("GitHub disconnected");
  }

  const pill = status === "connected"
    ? <span className="pill live"><Icon name="zap" size={15} />Connected{account ? ` · ${account}` : ""}<span className="dotled" /></span>
    : status === "checking"
      ? <span className="pill"><Icon name="loader" size={15} className="spin" />Checking…<span className="dotled" /></span>
      : <span className="pill warn"><Icon name="plug" size={15} />Disconnected<span className="dotled warn" /></span>;

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div className="ds">Bring your own GitHub OAuth App — the client secret is only ever sent to ORBIT's own server for the one-time token exchange.</div>
        {pill}
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Quick connect — one-time GitHub setup</div>
        <ol style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--dim)", fontSize: 13, lineHeight: 1.9 }}>
          <li>Open <a href="https://github.com/settings/developers" target="_blank" rel="noreferrer">GitHub's OAuth Apps settings</a> and click <b>New OAuth App</b>.</li>
          <li>Set <b>Authorization callback URL</b> to <span className="mono">{window.location.origin}/oauth/callback</span> exactly.</li>
          <li>After creating it, copy the <b>Client ID</b>, then click <b>Generate a new client secret</b> and copy that too.</li>
        </ol>
      </div>

      <div className="kf-grid" style={{ marginTop: 12 }}>
        <KeyField label="Client ID" value={clientId} onChange={setClientId} placeholder="Iv1.xxxxxxxx" />
        <KeyField label="Client Secret" value={clientSecret} onChange={setClientSecret} placeholder="Paste the client secret" />
      </div>
      {error && <div style={{ marginTop: 8, fontSize: 12, color: "var(--amber)" }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
        <button className="btn accent" onClick={doConnect} disabled={connecting || !clientId.trim() || !clientSecret.trim()}>{connecting ? "Connecting…" : "Connect GitHub"}</button>
        {status === "connected" && <button className="btn ghost" onClick={doDisconnect}><Icon name="plug" size={15} />Disconnect</button>}
      </div>
    </div>
  );
}
