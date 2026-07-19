import { useEffect, useState } from "react";
import { Icon } from "../lib/icons";
import { KeyField } from "./KeyField";
import { useToast } from "../context/Toast";
import { recordAudit } from "../lib/audit";
import { connectSentry, disconnectSentry, fetchSentryStatus } from "../lib/sentry";
import { fetchProviderConnection } from "../lib/providerConnections";

/** Sentry connect flow — paste an Internal Integration token, no OAuth popup. */
export function SentrySetupPanel() {
  const toast = useToast();
  const [orgSlug, setOrgSlug] = useState("");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setStatus("checking");
    const [conn, live] = await Promise.all([fetchProviderConnection("sentry"), fetchSentryStatus()]);
    if (conn?.access_token) setToken(conn.access_token);
    const savedOrg = (conn?.config as { org_slug?: string })?.org_slug;
    if (savedOrg) setOrgSlug(savedOrg);
    setStatus(live.connected ? "connected" : "disconnected");
  }
  useEffect(() => { refresh(); }, []);

  async function doConnect() {
    setConnecting(true); setError(null);
    const r = await connectSentry(orgSlug.trim(), token.trim());
    setConnecting(false);
    if (!r.ok) { setError(r.error || "Couldn't connect"); toast(`Sentry: ${r.error}`); return; }
    setStatus("connected");
    recordAudit({ action: "integration.connect", entityType: "integration", entityId: "sentry" });
    toast("Sentry connected");
  }

  async function doDisconnect() {
    await disconnectSentry();
    setStatus("disconnected");
    recordAudit({ action: "integration.disconnect", entityType: "integration", entityId: "sentry" });
    toast("Sentry disconnected");
  }

  const pill = status === "connected"
    ? <span className="pill live"><Icon name="zap" size={15} />Connected{orgSlug ? ` · ${orgSlug}` : ""}<span className="dotled" /></span>
    : status === "checking"
      ? <span className="pill"><Icon name="loader" size={15} className="spin" />Checking…<span className="dotled" /></span>
      : <span className="pill warn"><Icon name="plug" size={15} />Disconnected<span className="dotled warn" /></span>;

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div className="ds">Read-only error tracking — an Internal Integration token, not OAuth.</div>
        {pill}
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Quick connect — one-time Sentry setup</div>
        <ol style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--dim)", fontSize: 13, lineHeight: 1.9 }}>
          <li>In Sentry, go to <b>Organization Settings → Developer Settings → New Internal Integration</b>.</li>
          <li>Grant it <span className="mono">Project: Read</span> and <span className="mono">Issue &amp; Event: Read</span> permissions, then save.</li>
          <li>Copy the generated token into <i>Token</i> below, and your organization slug (from your Sentry URL) into <i>Organization slug</i>.</li>
        </ol>
      </div>

      <div className="kf-grid" style={{ marginTop: 12 }}>
        <KeyField label="Organization slug" value={orgSlug} onChange={setOrgSlug} placeholder="my-org" />
        <KeyField label="Token" value={token} onChange={setToken} placeholder="Paste the internal integration token" />
      </div>
      {error && <div style={{ marginTop: 8, fontSize: 12, color: "var(--amber)" }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
        <button className="btn accent" onClick={doConnect} disabled={connecting || !orgSlug.trim() || !token.trim()}>{connecting ? "Connecting…" : "Save & connect"}</button>
        {status === "connected" && <button className="btn ghost" onClick={doDisconnect}><Icon name="plug" size={15} />Disconnect</button>}
      </div>
    </div>
  );
}
