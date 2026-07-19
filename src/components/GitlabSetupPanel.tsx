import { useEffect, useState } from "react";
import { Icon } from "../lib/icons";
import { KeyField } from "./KeyField";
import { useToast } from "../context/Toast";
import { recordAudit } from "../lib/audit";
import { connectGitlab, disconnectGitlab, fetchGitlabStatus } from "../lib/gitlab";
import { fetchProviderConnection } from "../lib/providerConnections";

/** GitLab connect flow — bring-your-own OAuth Application, popup-based (see src/lib/oauthPopup.ts). Supports self-hosted instances. */
export function GitlabSetupPanel() {
  const toast = useToast();
  const [baseUrl, setBaseUrl] = useState("https://gitlab.com");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [status, setStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const [account, setAccount] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setStatus("checking");
    const [conn, live] = await Promise.all([fetchProviderConnection("gitlab"), fetchGitlabStatus()]);
    if (conn?.client_id) setClientId(conn.client_id);
    if (conn?.client_secret) setClientSecret(conn.client_secret);
    const savedBase = (conn?.config as { base_url?: string })?.base_url;
    if (savedBase) setBaseUrl(savedBase);
    setAccount(live.account ?? conn?.external_account_name ?? null);
    setStatus(live.connected ? "connected" : "disconnected");
  }
  useEffect(() => { refresh(); }, []);

  async function doConnect() {
    setConnecting(true); setError(null);
    const r = await connectGitlab(clientId.trim(), clientSecret.trim(), baseUrl.trim());
    setConnecting(false);
    if (!r.ok) { setError(r.error || "Couldn't connect"); toast(`GitLab: ${r.error}`); return; }
    setAccount(r.account ?? null);
    setStatus("connected");
    recordAudit({ action: "integration.connect", entityType: "integration", entityId: "gitlab" });
    toast("GitLab connected");
  }

  async function doDisconnect() {
    await disconnectGitlab();
    setStatus("disconnected"); setAccount(null);
    recordAudit({ action: "integration.disconnect", entityType: "integration", entityId: "gitlab" });
    toast("GitLab disconnected");
  }

  const pill = status === "connected"
    ? <span className="pill live"><Icon name="zap" size={15} />Connected{account ? ` · ${account}` : ""}<span className="dotled" /></span>
    : status === "checking"
      ? <span className="pill"><Icon name="loader" size={15} className="spin" />Checking…<span className="dotled" /></span>
      : <span className="pill warn"><Icon name="plug" size={15} />Disconnected<span className="dotled warn" /></span>;

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div className="ds">Bring your own GitLab OAuth Application — works with gitlab.com or a self-hosted instance.</div>
        {pill}
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Quick connect — one-time GitLab setup</div>
        <ol style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--dim)", fontSize: 13, lineHeight: 1.9 }}>
          <li>Set the instance URL below first if you're on a self-hosted GitLab (defaults to gitlab.com).</li>
          <li>Open <span className="mono">{baseUrl.trim().replace(/\/+$/, "") || "https://gitlab.com"}/-/user_settings/applications</span> and create a new application.</li>
          <li>Set <b>Redirect URI</b> to <span className="mono">{window.location.origin}/oauth/callback</span> exactly, and check the <span className="mono">api</span> and <span className="mono">read_repository</span> scopes.</li>
          <li>Copy the generated <b>Application ID</b> and <b>Secret</b> into the fields below.</li>
        </ol>
      </div>

      <div className="kf-grid" style={{ marginTop: 12 }}>
        <KeyField span label="Instance URL" value={baseUrl} onChange={setBaseUrl} placeholder="https://gitlab.com" hint="Change this for a self-hosted GitLab instance." />
        <KeyField label="Application ID" value={clientId} onChange={setClientId} placeholder="Paste the application id" />
        <KeyField label="Secret" value={clientSecret} onChange={setClientSecret} placeholder="Paste the secret" />
      </div>
      {error && <div style={{ marginTop: 8, fontSize: 12, color: "var(--amber)" }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
        <button className="btn accent" onClick={doConnect} disabled={connecting || !clientId.trim() || !clientSecret.trim()}>{connecting ? "Connecting…" : "Connect GitLab"}</button>
        {status === "connected" && <button className="btn ghost" onClick={doDisconnect}><Icon name="plug" size={15} />Disconnect</button>}
      </div>
    </div>
  );
}
