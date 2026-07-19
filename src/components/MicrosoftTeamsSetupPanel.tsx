import { useEffect, useState } from "react";
import { Icon } from "../lib/icons";
import { KeyField } from "./KeyField";
import { useToast } from "../context/Toast";
import { recordAudit } from "../lib/audit";
import { connectMsTeams, disconnectMsTeams, fetchMsTeamsStatus } from "../lib/msTeams";
import { fetchProviderConnection } from "../lib/providerConnections";

/** Microsoft Teams connect flow — bring-your-own Entra ID app registration, popup-based (see src/lib/oauthPopup.ts). Used to create Teams meetings from Calendar events. */
export function MicrosoftTeamsSetupPanel() {
  const toast = useToast();
  const [tenant, setTenant] = useState("common");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [status, setStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const [account, setAccount] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setStatus("checking");
    const [conn, live] = await Promise.all([fetchProviderConnection("msteams"), fetchMsTeamsStatus()]);
    if (conn?.client_id) setClientId(conn.client_id);
    if (conn?.client_secret) setClientSecret(conn.client_secret);
    const savedTenant = (conn?.config as { tenant?: string })?.tenant;
    if (savedTenant) setTenant(savedTenant);
    setAccount(live.account ?? conn?.external_account_name ?? null);
    setStatus(live.connected ? "connected" : "disconnected");
  }
  useEffect(() => { refresh(); }, []);

  async function doConnect() {
    setConnecting(true); setError(null);
    const r = await connectMsTeams(clientId.trim(), clientSecret.trim(), tenant.trim());
    setConnecting(false);
    if (!r.ok) { setError(r.error || "Couldn't connect"); toast(`Microsoft Teams: ${r.error}`); return; }
    setAccount(r.account ?? null);
    setStatus("connected");
    recordAudit({ action: "integration.connect", entityType: "integration", entityId: "msteams" });
    toast("Microsoft Teams connected");
  }

  async function doDisconnect() {
    await disconnectMsTeams();
    setStatus("disconnected"); setAccount(null);
    recordAudit({ action: "integration.disconnect", entityType: "integration", entityId: "msteams" });
    toast("Microsoft Teams disconnected");
  }

  const pill = status === "connected"
    ? <span className="pill live"><Icon name="zap" size={15} />Connected{account ? ` · ${account}` : ""}<span className="dotled" /></span>
    : status === "checking"
      ? <span className="pill"><Icon name="loader" size={15} className="spin" />Checking…<span className="dotled" /></span>
      : <span className="pill warn"><Icon name="plug" size={15} />Disconnected<span className="dotled warn" /></span>;

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div className="ds">Bring your own Entra ID (Azure AD) app registration — lets ORBIT create real Teams meetings from Calendar events.</div>
        {pill}
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Quick connect — one-time Entra ID setup</div>
        <ol style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--dim)", fontSize: 13, lineHeight: 1.9 }}>
          <li>In the <span className="mono">Azure Portal</span>, go to <b>Entra ID → App registrations</b> and create a new registration.</li>
          <li>Set <b>Redirect URI</b> (platform: Web) to <span className="mono">{window.location.origin}/oauth/callback</span> exactly.</li>
          <li>Under <b>API permissions</b>, add Microsoft Graph delegated permissions <span className="mono">User.Read</span> and <span className="mono">OnlineMeetings.ReadWrite</span>.</li>
          <li>Under <b>Certificates &amp; secrets</b>, create a client secret. Copy the <b>Application (client) ID</b>, the secret, and the <b>Directory (tenant) ID</b> into the fields below.</li>
        </ol>
      </div>

      <div className="kf-grid" style={{ marginTop: 12 }}>
        <KeyField label="Tenant ID" value={tenant} onChange={setTenant} placeholder="common" hint="Your Directory (tenant) ID, or leave as 'common' for any Microsoft account." />
        <KeyField label="Application (client) ID" value={clientId} onChange={setClientId} placeholder="Paste the application id" />
        <KeyField label="Client secret" value={clientSecret} onChange={setClientSecret} placeholder="Paste the secret" />
      </div>
      {error && <div style={{ marginTop: 8, fontSize: 12, color: "var(--amber)" }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
        <button className="btn accent" onClick={doConnect} disabled={connecting || !clientId.trim() || !clientSecret.trim()}>{connecting ? "Connecting…" : "Connect Microsoft Teams"}</button>
        {status === "connected" && <button className="btn ghost" onClick={doDisconnect}><Icon name="plug" size={15} />Disconnect</button>}
      </div>
    </div>
  );
}
