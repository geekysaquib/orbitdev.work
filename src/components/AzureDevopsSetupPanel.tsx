import { useEffect, useState } from "react";
import { Icon } from "../lib/icons";
import { KeyField } from "./KeyField";
import { useToast } from "../context/Toast";
import { recordAudit } from "../lib/audit";
import { connectAzureDevops, disconnectAzureDevops, fetchAzureDevopsStatus } from "../lib/azureDevops";
import { fetchProviderConnection } from "../lib/providerConnections";

/** Azure DevOps connect flow — a pasted Personal Access Token, not OAuth (see src/lib/azureDevops.ts). */
export function AzureDevopsSetupPanel() {
  const toast = useToast();
  const [organization, setOrganization] = useState("");
  const [pat, setPat] = useState("");
  const [status, setStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const [account, setAccount] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setStatus("checking");
    const [conn, live] = await Promise.all([fetchProviderConnection("azuredevops"), fetchAzureDevopsStatus()]);
    if (conn?.config?.organization) setOrganization(String(conn.config.organization));
    if (conn?.access_token) setPat(conn.access_token);
    setAccount(live.account ?? conn?.external_account_name ?? null);
    setStatus(live.connected ? "connected" : "disconnected");
  }
  useEffect(() => { refresh(); }, []);

  async function doConnect() {
    setConnecting(true); setError(null);
    const r = await connectAzureDevops(organization.trim(), pat.trim());
    setConnecting(false);
    if (!r.ok) { setError(r.error || "Couldn't connect"); toast(`Azure DevOps: ${r.error}`); return; }
    setAccount(r.account ?? null);
    setStatus("connected");
    recordAudit({ action: "integration.connect", entityType: "integration", entityId: "azuredevops" });
    toast("Azure DevOps connected");
  }

  async function doDisconnect() {
    await disconnectAzureDevops();
    setStatus("disconnected"); setAccount(null);
    recordAudit({ action: "integration.disconnect", entityType: "integration", entityId: "azuredevops" });
    toast("Azure DevOps disconnected");
  }

  const pill = status === "connected"
    ? <span className="pill live"><Icon name="zap" size={15} />Connected{account ? ` · ${account}` : ""}<span className="dotled" /></span>
    : status === "checking"
      ? <span className="pill"><Icon name="loader" size={15} className="spin" />Checking…<span className="dotled" /></span>
      : <span className="pill warn"><Icon name="plug" size={15} />Disconnected<span className="dotled warn" /></span>;

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div className="ds">A Personal Access Token, not OAuth — it's the standard way third-party tools connect to Azure DevOps, and it works with company-managed organizations that block third-party OAuth apps.</div>
        {pill}
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Quick connect — one-time Azure DevOps setup</div>
        <ol style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--dim)", fontSize: 13, lineHeight: 1.9 }}>
          <li>In Azure DevOps, open <b>User settings → Personal access tokens</b> and click <b>New Token</b>.</li>
          <li>Grant it <b>Code (Read)</b> and <b>Build (Read)</b> scopes, and copy the token — it's only shown once.</li>
          <li>Enter your organization name below (the <span className="mono">dev.azure.com/&#123;organization&#125;</span> segment) and paste the token.</li>
        </ol>
      </div>

      <div className="kf-grid" style={{ marginTop: 12 }}>
        <KeyField label="Organization" value={organization} onChange={setOrganization} placeholder="my-company" />
        <KeyField label="Personal Access Token" value={pat} onChange={setPat} placeholder="Paste the token" />
      </div>
      {error && <div style={{ marginTop: 8, fontSize: 12, color: "var(--amber)" }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
        <button className="btn accent" onClick={doConnect} disabled={connecting || !organization.trim() || !pat.trim()}>{connecting ? "Connecting…" : "Connect Azure DevOps"}</button>
        {status === "connected" && <button className="btn ghost" onClick={doDisconnect}><Icon name="plug" size={15} />Disconnect</button>}
      </div>
    </div>
  );
}
