import { useEffect, useState } from "react";
import { Icon } from "../lib/icons";
import { Select } from "./Select";
import { KeyField } from "./KeyField";
import { useZoho } from "../context/Zoho";
import { useToast } from "../context/Toast";
import { fetchIntegrations, saveIntegrations } from "../lib/integrations";
import { exchangeZohoCode } from "../lib/zoho";
import { recordAudit } from "../lib/audit";

const ZOHO_SCOPE = "ZohoSprints.teams.READ,ZohoSprints.projects.READ,ZohoSprints.sprints.READ,ZohoSprints.items.READ";

/** Zoho connect flow, shared by Settings and the onboarding wizard. */
export function ZohoSetupPanel({ onConnected }: { onConnected?: () => void }) {
  const zoho = useZoho();
  const toast = useToast();
  const [zk, setZk] = useState({ zoho_client_id: "", zoho_client_secret: "", zoho_refresh_token: "", zoho_dc: "in", zoho_team_id: "", zoho_project_id: "" });
  const [grantCode, setGrantCode] = useState("");
  const [savingZ, setSavingZ] = useState(false);
  const [exchanging, setExchanging] = useState(false);
  const [scopeCopied, setScopeCopied] = useState(false);

  useEffect(() => {
    fetchIntegrations().then((i) => {
      if (!i) return;
      setZk({
        zoho_client_id: i.zoho_client_id || "", zoho_client_secret: i.zoho_client_secret || "", zoho_refresh_token: i.zoho_refresh_token || "",
        zoho_dc: i.zoho_dc || "in", zoho_team_id: i.zoho_team_id || "", zoho_project_id: i.zoho_project_id || "",
      });
    });
  }, []);

  async function copyScope() {
    try { await navigator.clipboard.writeText(ZOHO_SCOPE); setScopeCopied(true); setTimeout(() => setScopeCopied(false), 1400); }
    catch { /* clipboard blocked */ }
  }

  async function doExchange() {
    setExchanging(true);
    const r = await exchangeZohoCode({ clientId: zk.zoho_client_id, clientSecret: zk.zoho_client_secret, code: grantCode, dc: zk.zoho_dc });
    setExchanging(false);
    if (r.error) { toast(`Couldn't exchange code: ${r.error}`); return; }
    setZk((z) => ({ ...z, zoho_refresh_token: r.refreshToken || "" }));
    setGrantCode("");
    toast("Tokens obtained — hit Save & connect below");
  }

  async function saveZoho() {
    setSavingZ(true);
    const { error } = await saveIntegrations(zk);
    setSavingZ(false);
    if (error) { toast(`Couldn't save: ${error}`); return; }
    zoho.connect(); zoho.recheck();
    recordAudit({ action: "integration.connect", entityType: "integration", entityId: "zoho" });
    toast("Zoho keys saved — checking connection…");
    onConnected?.();
  }

  const zohoPill = zoho.status === "connected"
    ? <span className="pill live"><Icon name="zap" size={15} />Connected<span className="dotled" /></span>
    : zoho.status === "checking"
      ? <span className="pill"><Icon name="loader" size={15} className="spin" />Checking…<span className="dotled" /></span>
      : <span className="pill warn"><Icon name="plug" size={15} />Disconnected<span className="dotled warn" /></span>;

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div className="ds">Your keys are stored per-account (row-level secured). The server uses them to pull projects, sprints, items, and hours.</div>
        {zohoPill}
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Quick connect — one-time Zoho setup</div>
        <ol style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--dim)", fontSize: 13, lineHeight: 1.9 }}>
          <li>Open <a href={`https://api-console.zoho.${zk.zoho_dc}/`} target="_blank" rel="noreferrer">the Zoho API Console</a> (pick the data center below first, then open the link — it must match) and sign in with the Zoho account that has access to your Sprints team.</li>
          <li>Click <b>Add Client</b> (or <b>Get Started</b> the first time), choose <b>Self Client</b> as the client type, then confirm/<b>CREATE</b>.</li>
          <li>You'll land on the <b>Client Secret</b> tab — that's your Client ID and Client Secret. Copy both into the matching fields below.</li>
          <li>Switch to the <b>Generate Code</b> tab. Paste the scope below into the <i>Scope</i> field, put anything in <i>Scope Description</i>, set <i>Time Duration</i> to a few minutes (you'll use the code right away), then <b>CREATE</b>:</li>
        </ol>
        <div className="cq-row">
          <div className="cq">{ZOHO_SCOPE}</div>
          <button type="button" className="btn ghost" onClick={copyScope}><Icon name={scopeCopied ? "check" : "copy"} size={14} />{scopeCopied ? "Copied" : "Copy"}</button>
        </div>
        <ol start={5} style={{ margin: "4px 0 0", paddingLeft: 18, color: "var(--dim)", fontSize: 13, lineHeight: 1.9 }}>
          <li>Zoho shows a generated <b>code</b> — it's single-use and expires in minutes. Copy it and paste it into <i>Grant code</i> below, alongside the Client ID/Secret, then hit <b>Exchange for tokens</b>. ORBIT does the token exchange for you — no terminal, no curl.</li>
        </ol>
      </div>

      <div className="kf-grid" style={{ marginTop: 12 }}>
        <KeyField label="Client ID" value={zk.zoho_client_id} onChange={(v) => setZk({ ...zk, zoho_client_id: v })} placeholder="1000.XXXX" />
        <KeyField label="Client Secret" value={zk.zoho_client_secret} onChange={(v) => setZk({ ...zk, zoho_client_secret: v })} placeholder="Paste the client secret" />
        <div className="kf">
          <label>Data center</label>
          <Select full className="kf-input" value={zk.zoho_dc} onChange={(e) => setZk({ ...zk, zoho_dc: e.target.value })}>
            {["in", "com", "eu", "com.au", "jp", "sa", "com.cn"].map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        </div>
        <KeyField label="Grant code" value={grantCode} onChange={setGrantCode} placeholder="1000.xxxx (paste, then exchange right away)" hint="One-time — only used to fetch the refresh token below, then it's spent." />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <button className="btn" onClick={doExchange} disabled={exchanging || !zk.zoho_client_id || !zk.zoho_client_secret || !grantCode}>{exchanging ? "Exchanging…" : "Exchange for tokens"}</button>
      </div>

      <div className="kf-grid" style={{ marginTop: 20 }}>
        <KeyField span label="Refresh Token" value={zk.zoho_refresh_token} onChange={(v) => setZk({ ...zk, zoho_refresh_token: v })} placeholder="Filled in automatically after you exchange a code above" hint="Long-lived — you only need to redo the exchange if this ever leaks." />
        <KeyField optional label="Team ID" value={zk.zoho_team_id} onChange={(v) => setZk({ ...zk, zoho_team_id: v })} placeholder="Auto-detected — pin it here only if you want to skip that lookup" />
        <KeyField span optional label="Default Project ID" value={zk.zoho_project_id} onChange={(v) => setZk({ ...zk, zoho_project_id: v })} placeholder="Auto-detected (first project) — pin it here to override" />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
        <button className="btn accent" onClick={saveZoho} disabled={savingZ || !zk.zoho_refresh_token}>{savingZ ? "Saving…" : "Save & connect"}</button>
        {zoho.status === "connected" && <button className="btn ghost" onClick={() => { zoho.disconnect(); recordAudit({ action: "integration.disconnect", entityType: "integration", entityId: "zoho" }); toast("Zoho disabled for this session"); }}><Icon name="plug" size={15} />Disable</button>}
        {zoho.status === "disconnected" && zoho.error && <span style={{ fontSize: 12, color: "var(--amber)" }}>{zoho.error}</span>}
      </div>
    </div>
  );
}
