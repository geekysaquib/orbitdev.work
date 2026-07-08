import { useEffect, useMemo, useState } from "react";
import { Icon } from "../lib/icons";
import { ACCENT } from "../components/ui";
import { useAgent } from "../context/Agent";
import { useZoho } from "../context/Zoho";
import { useToast } from "../context/Toast";
import { useAuth } from "../context/AuthContext";
import { useTimezone, allZones, tzOffset, tzClock, deviceTz } from "../context/Timezone";
import { fetchIntegrations, saveIntegrations } from "../lib/integrations";
import { fetchDocker } from "../lib/agent";
import { pgServers, pgDeleteServer, type PgServer } from "../lib/pg";
import { PgServerModal } from "../components/PgServerModal";

const CONNS: [string, string, string][] = [["GitHub", "git", "#ECEEF2"], ["Azure DevOps", "server", ACCENT.blue], ["Docker", "container", ACCENT.blue], ["Slack", "bell", ACCENT.violet]];

export default function Settings() {
  const toast = useToast();
  const { user, signOut } = useAuth();
  const { status, url, updateUrl, recheck } = useAgent();
  const zoho = useZoho();
  const [draft, setDraft] = useState(url);
  const [zk, setZk] = useState({ zoho_client_id: "", zoho_client_secret: "", zoho_refresh_token: "", zoho_dc: "in", zoho_team_id: "", zoho_project_id: "" });
  const [gk, setGk] = useState({ gmail_user: "", gmail_app_password: "" });
  const [savingZ, setSavingZ] = useState(false);
  const [savingG, setSavingG] = useState(false);
  const [docker, setDocker] = useState<{ available: boolean; count: number } | null>(null);
  const [dockerChecking, setDockerChecking] = useState(false);

  const { tz, setTz } = useTimezone();
  const zones = useMemo(() => allZones(), []);
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNowTick(Date.now()), 1000); return () => clearInterval(t); }, []);

  const [pgList, setPgList] = useState<PgServer[]>([]);
  const [pgAddOpen, setPgAddOpen] = useState(false);
  const loadPg = () => { pgServers().then((r) => setPgList(r.servers)); };
  useEffect(() => { if (status === "online") loadPg(); else setPgList([]); }, [status]);

  async function checkDocker() {
    if (status !== "online") { setDocker(null); return; }
    setDockerChecking(true);
    const d = await fetchDocker();
    setDocker({ available: d.available, count: d.containers.length });
    setDockerChecking(false);
  }
  useEffect(() => { checkDocker(); }, [status]); // eslint-disable-line

  useEffect(() => {
    fetchIntegrations().then((i) => {
      if (!i) return;
      setZk({
        zoho_client_id: i.zoho_client_id || "", zoho_client_secret: i.zoho_client_secret || "", zoho_refresh_token: i.zoho_refresh_token || "",
        zoho_dc: i.zoho_dc || "in", zoho_team_id: i.zoho_team_id || "", zoho_project_id: i.zoho_project_id || "",
      });
      setGk({ gmail_user: i.gmail_user || "", gmail_app_password: i.gmail_app_password || "" });
    });
  }, []);

  async function saveZoho() {
    setSavingZ(true);
    const { error } = await saveIntegrations(zk);
    setSavingZ(false);
    if (error) { toast(`Couldn't save: ${error}`); return; }
    zoho.connect(); zoho.recheck();
    toast("Zoho keys saved — checking connection…");
  }

  const statusPill = status === "online"
    ? <span className="pill live"><Icon name="zap" size={15} />Connected<span className="dotled" /></span>
    : status === "disconnected"
      ? <span className="pill warn"><Icon name="plug" size={15} />Disconnected<span className="dotled warn" /></span>
      : <span className="pill"><Icon name="plug" size={15} />Offline<span className="dotled" /></span>;

  return (
    <main className="page">
      <div className="h1">Settings</div><div className="sub">Wire up the agent, your integrations, and your data.</div>

      <div className="eyebrow" style={{ marginTop: 24 }}>Account</div>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="setrow"><div className="l"><div className="nm">{user?.email}</div><div className="ds">Signed in via Supabase</div></div>
          <button className="btn ghost" onClick={() => signOut()}><Icon name="logout" size={15} />Sign out</button></div>
      </div>

      <div className="eyebrow" style={{ marginTop: 30 }}>Timezone</div>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="setrow">
          <div className="l"><div className="nm">Display timezone</div><div className="ds">Clocks, greetings and timestamps across ORBIT follow this zone. Defaults to your device{tz === deviceTz() ? " (in use)" : ""}.</div></div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ textAlign: "right" }}>
              <div className="mono" style={{ fontSize: 18, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{tzClock(tz, new Date(nowTick))}</div>
              <div className="mono" style={{ fontSize: 11, color: "var(--dim)" }}>{tzOffset(tz)}</div>
            </div>
            <select className="field" value={tz} onChange={(e) => { setTz(e.target.value); toast("Timezone updated"); }} style={{ minWidth: 240 }}>
              {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
            </select>
          </div>
        </div>
        {tz !== deviceTz() && (
          <div className="setrow"><div className="l"><div className="nm">Reset to device timezone</div><div className="ds">Follow this machine's zone ({deviceTz().replace(/_/g, " ")}) again.</div></div>
            <button className="btn ghost" onClick={() => { setTz(deviceTz()); toast("Using device timezone"); }}><Icon name="refresh" size={15} />Use device</button></div>
        )}
      </div>

      <div className="eyebrow" style={{ marginTop: 30 }}>Local agent</div>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="setrow"><div className="l"><div className="nm">Companion agent</div><div className="ds">Background service that launches IDEs and runs macros on this machine. It polls automatically and connects the moment it's running.</div></div>
          {statusPill}</div>
        <div className="setrow">
          <div className="l"><div className="nm">Agent URL</div><div className="ds">Where ORBIT reaches the agent. Use <code style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}>http://localhost:47600</code> when running ORBIT locally, or an <code style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}>https://</code> URL (mkcert) for a deployed site.</div></div>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="field" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="http://localhost:47600" style={{ minWidth: 250 }} />
            <button className="btn accent" onClick={() => { updateUrl(draft); toast("Agent URL saved"); }}>Save</button>
          </div>
        </div>
        <div className="setrow"><div className="l"><div className="nm">Test connection</div><div className="ds">Ping the agent now instead of waiting for the next auto-check.</div></div>
          <button className="btn" onClick={() => { recheck(); toast("Checking agent…"); }}><Icon name="refresh" size={15} />Test</button></div>
      </div>

      <div className="eyebrow" style={{ marginTop: 30 }}>Docker</div>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="setrow">
          <div className="l"><div className="nm">Docker Desktop</div><div className="ds">Read via the local agent (<code style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}>docker ps</code>). Requires Docker Desktop running and <code style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}>docker</code> on your PATH.</div></div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {status !== "online"
              ? <span className="pill warn"><Icon name="plug" size={15} />Agent offline<span className="dotled warn" /></span>
              : dockerChecking ? <span className="pill"><Icon name="loader" size={15} className="spin" />Checking…<span className="dotled" /></span>
              : docker?.available ? <span className="pill live"><Icon name="container" size={15} />Connected · {docker.count} running<span className="dotled" /></span>
              : <span className="pill warn"><Icon name="container" size={15} />Not detected<span className="dotled warn" /></span>}
            <button className="btn" disabled={status !== "online"} onClick={checkDocker}><Icon name="refresh" size={15} />Test</button>
          </div>
        </div>
      </div>

      <div className="eyebrow" style={{ marginTop: 30, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>PostgreSQL</span>
        <button className="btn ghost" style={{ height: 28, padding: "0 10px", fontSize: 12 }} disabled={status !== "online"} onClick={() => setPgAddOpen(true)}><Icon name="plus" size={13} />Add server</button>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        {status !== "online" ? (
          <div className="setrow"><div className="l"><div className="nm">Postgres servers</div><div className="ds">Connections run through the local agent. Start the agent to manage them.</div></div>
            <span className="pill warn"><Icon name="plug" size={15} />Agent offline<span className="dotled warn" /></span></div>
        ) : pgList.length === 0 ? (
          <div className="setrow"><div className="l"><div className="nm">No servers configured</div><div className="ds">Add a Postgres connection to browse databases and run queries from the Postgres tab.</div></div>
            <button className="btn accent" onClick={() => setPgAddOpen(true)}><Icon name="plus" size={15} />Add server</button></div>
        ) : (
          pgList.map((s) => (
            <div className="setrow" key={s.id}>
              <div className="l"><div className="nm" style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ color: "var(--mint)" }}><Icon name="db" size={15} /></span>{s.name}{s.ssl && <span className="mono" style={{ fontSize: 10, color: ACCENT.mint }}>SSL</span>}</div>
                <div className="ds mono" style={{ fontSize: 11.5 }}>{s.user}@{s.host}:{s.port}{s.database ? ` · ${s.database}` : ""}</div></div>
              <button className="btn ghost" onClick={async () => { await pgDeleteServer(s.id); loadPg(); toast(`Removed ${s.name}`); }}><Icon name="x" size={15} />Remove</button>
            </div>
          ))
        )}
      </div>

      <div className="eyebrow" style={{ marginTop: 30 }}>Zoho Sprints</div>
      <div className="card" style={{ marginTop: 12, padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div className="ds">Your keys are stored per-account (row-level secured). The server uses them to pull projects, sprints, items, and hours.</div>
          {zoho.status === "connected" && <span className="pill live"><Icon name="zap" size={15} />Connected<span className="dotled" /></span>}
          {zoho.status === "checking" && <span className="pill"><Icon name="loader" size={15} className="spin" />Checking…<span className="dotled" /></span>}
          {zoho.status === "disconnected" && <span className="pill warn"><Icon name="plug" size={15} />Disconnected<span className="dotled warn" /></span>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
          <div className="fld"><label>Client ID</label><input value={zk.zoho_client_id} onChange={(e) => setZk({ ...zk, zoho_client_id: e.target.value.trim() })} placeholder="1000.XXXX" /></div>
          <div className="fld"><label>Client Secret</label><input type="password" value={zk.zoho_client_secret} onChange={(e) => setZk({ ...zk, zoho_client_secret: e.target.value.trim() })} placeholder="••••••••" /></div>
          <div className="fld" style={{ gridColumn: "1 / -1" }}><label>Refresh Token</label><input type="password" value={zk.zoho_refresh_token} onChange={(e) => setZk({ ...zk, zoho_refresh_token: e.target.value.trim() })} placeholder="1000.xxxx.yyyy" /></div>
          <div className="fld"><label>Data center</label>
            <select value={zk.zoho_dc} onChange={(e) => setZk({ ...zk, zoho_dc: e.target.value })}>
              {["in", "com", "eu", "com.au", "jp", "sa", "com.cn"].map((d) => <option key={d} value={d}>{d}</option>)}
            </select></div>
          <div className="fld"><label>Team ID <span style={{ color: "var(--dim)" }}>(optional)</span></label><input value={zk.zoho_team_id} onChange={(e) => setZk({ ...zk, zoho_team_id: e.target.value.trim() })} placeholder="60069474422" /></div>
          <div className="fld" style={{ gridColumn: "1 / -1" }}><label>Default Project ID <span style={{ color: "var(--dim)" }}>(optional)</span></label><input value={zk.zoho_project_id} onChange={(e) => setZk({ ...zk, zoho_project_id: e.target.value.trim() })} placeholder="45354000001026097" /></div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
          <button className="btn accent" onClick={saveZoho} disabled={savingZ || !zk.zoho_refresh_token}>{savingZ ? "Saving…" : "Save & connect"}</button>
          {zoho.status === "connected" && <button className="btn ghost" onClick={() => { zoho.disconnect(); toast("Zoho disabled for this session"); }}><Icon name="plug" size={15} />Disable</button>}
          {zoho.status === "disconnected" && zoho.error && <span style={{ fontSize: 12, color: "var(--amber)" }}>{zoho.error}</span>}
        </div>
      </div>

      <div className="eyebrow" style={{ marginTop: 30 }}>Gmail</div>
      <div className="card" style={{ marginTop: 12, padding: 20 }}>
        <div className="ds">Read-only inbox via IMAP. Needs a Google <b>App Password</b> (2-Step Verification → App passwords). Stored per-account; the local agent uses it to connect.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
          <div className="fld"><label>Gmail address</label><input value={gk.gmail_user} onChange={(e) => setGk({ ...gk, gmail_user: e.target.value.trim() })} placeholder="you@gmail.com" /></div>
          <div className="fld"><label>App password</label><input type="password" value={gk.gmail_app_password} onChange={(e) => setGk({ ...gk, gmail_app_password: e.target.value })} placeholder="16-character app password" /></div>
        </div>
        <button className="btn accent" style={{ marginTop: 6 }} disabled={savingG || !gk.gmail_user || !gk.gmail_app_password}
          onClick={async () => { setSavingG(true); const { error } = await saveIntegrations(gk); setSavingG(false); toast(error ? `Couldn't save: ${error}` : "Gmail keys saved — open Mail to connect"); }}>{savingG ? "Saving…" : "Save Gmail keys"}</button>
      </div>

      <div className="eyebrow" style={{ marginTop: 30 }}>Integrations</div>
      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
        {CONNS.map((c) => (
          <div key={c[0]} className="conn"><span className="ico" style={{ color: c[2] }}><Icon name={c[1]} size={18} /></span>
            <div style={{ flex: 1 }}><div style={{ fontSize: 13.5 }}>{c[0]}</div><div style={{ fontSize: 11.5, color: "var(--dim)", marginTop: 2 }}>Not connected</div></div>
            <button className="btn ghost" onClick={() => toast(`Connect ${c[0]}`)}>Connect</button></div>
        ))}
      </div>

      <div className="eyebrow" style={{ marginTop: 30 }}>IDE &amp; tool paths</div>
      <div className="card" style={{ marginTop: 12 }}>
        {[["VS Code", "code"], ["Visual Studio", "devenv.exe"], ["Terminal", "wt.exe"], ["Browser", "chrome"]].map((p) => (
          <div key={p[0]} className="setrow"><div className="l"><div className="nm">{p[0]}</div></div><input className="field" defaultValue={p[1]} /></div>
        ))}
      </div>

      <div className="eyebrow" style={{ marginTop: 30 }}>Data &amp; security</div>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="setrow"><div className="l"><div className="nm">Data store</div><div className="ds">Supabase Postgres with row-level security.</div></div>
          <span className="pill live"><Icon name="db" size={15} />Supabase</span></div>
        <div className="setrow"><div className="l"><div className="nm">Secrets vault</div><div className="ds">AES-256 encrypted, unlocked per session.</div></div>
          <span className="pill live"><Icon name="shield" size={15} />Encrypted</span></div>
      </div>

      {pgAddOpen && <PgServerModal onClose={() => setPgAddOpen(false)} onAdded={() => { setPgAddOpen(false); loadPg(); }} />}
    </main>
  );
}
