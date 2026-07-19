import { useEffect, useState } from "react";
import { Icon } from "../lib/icons";
import { KeyField } from "./KeyField";
import { useToast } from "../context/Toast";
import { recordAudit } from "../lib/audit";
import { connectAws, connectNetlify, connectVercel, disconnectCloud, fetchCloudStatus } from "../lib/cloud";
import { fetchProviderConnection } from "../lib/providerConnections";

type SubStatus = "checking" | "connected" | "disconnected";

function Pill({ status, label }: { status: SubStatus; label?: string }) {
  return status === "connected"
    ? <span className="pill live"><Icon name="zap" size={15} />Connected{label ? ` · ${label}` : ""}<span className="dotled" /></span>
    : status === "checking"
      ? <span className="pill"><Icon name="loader" size={15} className="spin" />Checking…<span className="dotled" /></span>
      : <span className="pill warn"><Icon name="plug" size={15} />Disconnected<span className="dotled warn" /></span>;
}

/** Three independently-connectable cloud sub-providers, all paste-token/paste-key — no OAuth. */
export function CloudSetupPanel() {
  const toast = useToast();

  const [netlifyToken, setNetlifyToken] = useState("");
  const [netlifyStatus, setNetlifyStatus] = useState<SubStatus>("checking");
  const [netlifyConnecting, setNetlifyConnecting] = useState(false);

  const [vercelToken, setVercelToken] = useState("");
  const [vercelStatus, setVercelStatus] = useState<SubStatus>("checking");
  const [vercelConnecting, setVercelConnecting] = useState(false);

  const [awsKeyId, setAwsKeyId] = useState("");
  const [awsSecret, setAwsSecret] = useState("");
  const [awsRegion, setAwsRegion] = useState("us-east-1");
  const [awsStatus, setAwsStatus] = useState<SubStatus>("checking");
  const [awsConnecting, setAwsConnecting] = useState(false);
  const [awsAccount, setAwsAccount] = useState<string | null>(null);

  async function refresh() {
    const [nConn, nLive] = await Promise.all([fetchProviderConnection("netlify"), fetchCloudStatus("netlify")]);
    if (nConn?.access_token) setNetlifyToken(nConn.access_token);
    setNetlifyStatus(nLive.connected ? "connected" : "disconnected");

    const [vConn, vLive] = await Promise.all([fetchProviderConnection("vercel"), fetchCloudStatus("vercel")]);
    if (vConn?.access_token) setVercelToken(vConn.access_token);
    setVercelStatus(vLive.connected ? "connected" : "disconnected");

    const [aConn, aLive] = await Promise.all([fetchProviderConnection("aws"), fetchCloudStatus("aws")]);
    const aCfg = (aConn?.config as { access_key_id?: string; region?: string }) || {};
    if (aCfg.access_key_id) setAwsKeyId(aCfg.access_key_id);
    if (aCfg.region) setAwsRegion(aCfg.region);
    setAwsAccount(aLive.account ?? null);
    setAwsStatus(aLive.connected ? "connected" : "disconnected");
  }
  useEffect(() => { refresh(); }, []);

  async function doConnectNetlify() {
    setNetlifyConnecting(true);
    const r = await connectNetlify(netlifyToken.trim());
    setNetlifyConnecting(false);
    if (!r.ok) { toast(`Netlify: ${r.error}`); return; }
    setNetlifyStatus("connected");
    recordAudit({ action: "integration.connect", entityType: "integration", entityId: "netlify" });
    toast("Netlify connected");
  }
  async function doConnectVercel() {
    setVercelConnecting(true);
    const r = await connectVercel(vercelToken.trim());
    setVercelConnecting(false);
    if (!r.ok) { toast(`Vercel: ${r.error}`); return; }
    setVercelStatus("connected");
    recordAudit({ action: "integration.connect", entityType: "integration", entityId: "vercel" });
    toast("Vercel connected");
  }
  async function doConnectAws() {
    setAwsConnecting(true);
    const r = await connectAws(awsKeyId.trim(), awsSecret.trim(), awsRegion.trim());
    setAwsConnecting(false);
    if (!r.ok) { toast(`AWS: ${r.error}`); return; }
    setAwsStatus("connected");
    recordAudit({ action: "integration.connect", entityType: "integration", entityId: "aws" });
    toast("AWS connected");
  }

  return (
    <>
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div><div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>Netlify</div><div className="ds" style={{ marginTop: 2 }}>Sites and deploys via a Personal Access Token (User settings → Applications → New access token).</div></div>
          <Pill status={netlifyStatus} />
        </div>
        <div className="kf-grid" style={{ marginTop: 12 }}>
          <KeyField span label="Personal Access Token" value={netlifyToken} onChange={setNetlifyToken} placeholder="Paste the token" />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn accent" onClick={doConnectNetlify} disabled={netlifyConnecting || !netlifyToken.trim()}>{netlifyConnecting ? "Connecting…" : "Save & connect"}</button>
          {netlifyStatus === "connected" && <button className="btn ghost" onClick={async () => { await disconnectCloud("netlify"); setNetlifyStatus("disconnected"); recordAudit({ action: "integration.disconnect", entityType: "integration", entityId: "netlify" }); toast("Netlify disconnected"); }}><Icon name="plug" size={15} />Disconnect</button>}
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div><div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>Vercel</div><div className="ds" style={{ marginTop: 2 }}>Projects and deployments via a Personal Access Token (Account Settings → Tokens).</div></div>
          <Pill status={vercelStatus} />
        </div>
        <div className="kf-grid" style={{ marginTop: 12 }}>
          <KeyField span label="Personal Access Token" value={vercelToken} onChange={setVercelToken} placeholder="Paste the token" />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn accent" onClick={doConnectVercel} disabled={vercelConnecting || !vercelToken.trim()}>{vercelConnecting ? "Connecting…" : "Save & connect"}</button>
          {vercelStatus === "connected" && <button className="btn ghost" onClick={async () => { await disconnectCloud("vercel"); setVercelStatus("disconnected"); recordAudit({ action: "integration.disconnect", entityType: "integration", entityId: "vercel" }); toast("Vercel disconnected"); }}><Icon name="plug" size={15} />Disconnect</button>}
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div><div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>AWS</div><div className="ds" style={{ marginTop: 2 }}>Cost Explorer via a read-only IAM Access Key — no OAuth exists for this on AWS. Scope the key to <span className="mono">ce:GetCostAndUsage</span> only.</div></div>
          <Pill status={awsStatus} label={awsAccount || undefined} />
        </div>
        <div className="kf-grid" style={{ marginTop: 12 }}>
          <KeyField label="Access Key ID" value={awsKeyId} onChange={setAwsKeyId} placeholder="AKIA..." />
          <KeyField label="Secret Access Key" value={awsSecret} onChange={setAwsSecret} placeholder="Paste the secret key" />
          <KeyField label="Region" value={awsRegion} onChange={setAwsRegion} placeholder="us-east-1" optional />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn accent" onClick={doConnectAws} disabled={awsConnecting || !awsKeyId.trim() || !awsSecret.trim()}>{awsConnecting ? "Connecting…" : "Save & connect"}</button>
          {awsStatus === "connected" && <button className="btn ghost" onClick={async () => { await disconnectCloud("aws"); setAwsStatus("disconnected"); setAwsAccount(null); recordAudit({ action: "integration.disconnect", entityType: "integration", entityId: "aws" }); toast("AWS disconnected"); }}><Icon name="plug" size={15} />Disconnect</button>}
        </div>
      </div>
    </>
  );
}
