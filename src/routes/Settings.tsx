import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Icon } from "../lib/icons";
import { Select } from "../components/Select";
import { ACCENT } from "../components/ui";
import { useAgent } from "../context/Agent";
import { useZoho } from "../context/Zoho";
import { useToast } from "../context/Toast";
import { useAuth } from "../context/AuthContext";
import { useTimezone, allZones, tzOffset, tzClock, deviceTz } from "../context/Timezone";
import { fetchIntegrations, saveIntegrations } from "../lib/integrations";
import { fetchDocker } from "../lib/agent";
import { ORBIT_AGENT_DOWNLOAD_URL } from "../lib/downloads";
import { pgServers, pgDeleteServer, type PgServer } from "../lib/pg";
import { PgServerModal } from "../components/PgServerModal";
import { ChoresCard } from "../components/ChoresCard";
import { KeyField } from "../components/KeyField";

const CONNS: [string, string, string][] = [["GitHub", "git", "#ECEEF2"], ["Azure DevOps", "server", ACCENT.blue], ["Docker", "container", ACCENT.blue], ["Slack", "bell", ACCENT.violet]];

type SectionId = "account" | "agent" | "zoho" | "gmail" | "postgres" | "docker" | "chores" | "integrations" | "data";
const SECTIONS: { id: SectionId; label: string; icon: string; desc: string }[] = [
  { id: "account", label: "Account", icon: "user", desc: "Identity, timezone and session" },
  { id: "agent", label: "Local agent", icon: "plug", desc: "The companion service on this machine" },
  { id: "zoho", label: "Zoho Sprints", icon: "sprint", desc: "Projects, sprints, items and hours" },
  { id: "gmail", label: "Gmail", icon: "mail", desc: "Read-only inbox over IMAP" },
  { id: "postgres", label: "PostgreSQL", icon: "db", desc: "Servers you can browse and query" },
  { id: "docker", label: "Docker", icon: "container", desc: "Containers and images" },
  { id: "chores", label: "Break chores", icon: "zap", desc: "What the agent does while you sip" },
  { id: "integrations", label: "Integrations", icon: "layers", desc: "Other services and IDE paths" },
  { id: "data", label: "Data & security", icon: "shield", desc: "Where everything is stored" },
];
const SECTIONS_IDS = new Set<string>(SECTIONS.map((s) => s.id));

export default function Settings() {
  const toast = useToast();
  const { user, signOut } = useAuth();
  const { status, url, updateUrl, recheck } = useAgent();
  const zoho = useZoho();
  const [searchParams] = useSearchParams();
  const [section, setSection] = useState<SectionId>(() => {
    const s = searchParams.get("section");
    return (SECTIONS_IDS.has(s || "") ? s : "account") as SectionId;
  });
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
  const [pgEditing, setPgEditing] = useState<PgServer | null>(null);
  const loadPg = () => { pgServers().then((r) => setPgList(r.servers)); };
  useEffect(() => { loadPg(); }, []);

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

  const agentPill = status === "online"
    ? <span className="pill live"><Icon name="zap" size={15} />Connected<span className="dotled" /></span>
    : status === "disconnected"
      ? <span className="pill warn"><Icon name="plug" size={15} />Disconnected<span className="dotled warn" /></span>
      : <span className="pill"><Icon name="plug" size={15} />Offline<span className="dotled" /></span>;

  const zohoPill = zoho.status === "connected"
    ? <span className="pill live"><Icon name="zap" size={15} />Connected<span className="dotled" /></span>
    : zoho.status === "checking"
      ? <span className="pill"><Icon name="loader" size={15} className="spin" />Checking…<span className="dotled" /></span>
      : <span className="pill warn"><Icon name="plug" size={15} />Disconnected<span className="dotled warn" /></span>;

  const railState = (id: SectionId): "ok" | "warn" | null => {
    if (id === "agent") return status === "online" ? "ok" : "warn";
    if (id === "zoho") return zoho.status === "connected" ? "ok" : zoho.status === "checking" ? null : "warn";
    if (id === "gmail") return gk.gmail_user && gk.gmail_app_password ? "ok" : null;
    if (id === "docker") return status !== "online" ? null : docker?.available ? "ok" : "warn";
    if (id === "postgres") return pgList.length ? "ok" : null;
    return null;
  };

  const meta = SECTIONS.find((s) => s.id === section) as (typeof SECTIONS)[number];

  return (
    <main className="page set-page">
      <div className="h1">Settings</div>
      <div className="sub">Wire up the agent, your integrations, and your data.</div>

      <div className="set-shell">
        <nav className="set-rail">
          {SECTIONS.map((s) => {
            const st = railState(s.id);
            return (
              <button key={s.id} className={"set-navitem" + (section === s.id ? " on" : "")} onClick={() => setSection(s.id)}>
                <span className="sn-ic"><Icon name={s.icon} size={16} /></span>
                <span className="sn-label">{s.label}</span>
                {st && <span className={"sn-dot " + st} />}
              </button>
            );
          })}
        </nav>

        <section className="set-body">
          <div className="set-head">
            <div>
              <div className="set-title">{meta.label}</div>
              <div className="set-desc">{meta.desc}</div>
            </div>
            {section === "agent" && agentPill}
            {section === "zoho" && zohoPill}
          </div>

          {section === "account" && (
            <>
              <div className="card">
                <div className="setrow"><div className="l"><div className="nm">{user?.email}</div><div className="ds">{user?.email_verified ? "Verified · signed in with your ORBIT account" : "Signed in with your ORBIT account"}</div></div>
                  <button className="btn ghost" onClick={() => signOut()}><Icon name="logout" size={15} />Sign out</button></div>
              </div>
              <div className="card" style={{ marginTop: 12 }}>
                <div className="setrow">
                  <div className="l"><div className="nm">Display timezone</div><div className="ds">Clocks, greetings and timestamps across ORBIT follow this zone. Defaults to your device{tz === deviceTz() ? " (in use)" : ""}.</div></div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ textAlign: "right" }}>
                      <div className="mono" style={{ fontSize: 18, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{tzClock(tz, new Date(nowTick))}</div>
                      <div className="mono" style={{ fontSize: 11, color: "var(--dim)" }}>{tzOffset(tz)}</div>
                    </div>
                    <Select className="field" value={tz} onChange={(e) => { setTz(e.target.value); toast("Timezone updated"); }} style={{ minWidth: 240 }}>
                      {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
                    </Select>
                  </div>
                </div>
                {tz !== deviceTz() && (
                  <div className="setrow"><div className="l"><div className="nm">Reset to device timezone</div><div className="ds">Follow this machine's zone ({deviceTz().replace(/_/g, " ")}) again.</div></div>
                    <button className="btn ghost" onClick={() => { setTz(deviceTz()); toast("Using device timezone"); }}><Icon name="refresh" size={15} />Use device</button></div>
                )}
              </div>
            </>
          )}

          {section === "agent" && (
            <>
              {status !== "online" && (
                <div className="card">
                  <div className="setrow">
                    <div className="l"><div className="nm">Download the ORBIT Agent</div><div className="ds">The desktop companion that gives ORBIT hands on this machine — launches IDEs, runs git/Docker, and connects automatically. Windows, single file, no install.</div></div>
                    <a className="btn accent" href={ORBIT_AGENT_DOWNLOAD_URL}><Icon name="download" size={15} />Download for Windows</a>
                  </div>
                  <div className="setrow"><div className="l"><div className="ds">Double-click <code className="mono">orbit.exe</code> to run it — no install, no console window. It opens a status page in your browser and ORBIT connects automatically within a few seconds.</div></div></div>
                </div>
              )}
              <div className="card" style={{ marginTop: status !== "online" ? 12 : 0 }}>
                <div className="setrow"><div className="l"><div className="nm">Companion agent</div><div className="ds">Background service that launches IDEs, runs git and Docker, and powers break chores. It polls automatically and connects the moment it's running.</div></div>
                  {agentPill}</div>
                <div className="setrow"><div className="l"><div className="nm">Agent URL</div><div className="ds mono" style={{ fontSize: 11.5 }}>default http://localhost:47600</div></div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input className="field mono" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ minWidth: 240 }} />
                    <button className="btn" onClick={() => { updateUrl(draft); toast("Agent URL saved"); }}>Save</button>
                    <button className="btn" onClick={() => { recheck(); toast("Checking agent…"); }}><Icon name="refresh" size={15} />Test</button>
                  </div></div>
              </div>
            </>
          )}

          {section === "zoho" && (
            <div className="card" style={{ padding: 20 }}>
              <div className="ds">Your keys are stored per-account (row-level secured). The server uses them to pull projects, sprints, items, and hours.</div>
              <div className="kf-grid">
                <KeyField label="Client ID" value={zk.zoho_client_id} onChange={(v) => setZk({ ...zk, zoho_client_id: v })} placeholder="1000.XXXX" />
                <KeyField label="Client Secret" value={zk.zoho_client_secret} onChange={(v) => setZk({ ...zk, zoho_client_secret: v })} placeholder="paste the client secret" />
                <KeyField span label="Refresh Token" value={zk.zoho_refresh_token} onChange={(v) => setZk({ ...zk, zoho_refresh_token: v })} placeholder="1000.xxxx.yyyy" hint="Long-lived. Regenerate it in the Zoho API console if it ever leaks." />
                <div className="kf">
                  <label>Data center</label>
                  <Select full className="kf-input" value={zk.zoho_dc} onChange={(e) => setZk({ ...zk, zoho_dc: e.target.value })}>
                    {["in", "com", "eu", "com.au", "jp", "sa", "com.cn"].map((d) => <option key={d} value={d}>{d}</option>)}
                  </Select>
                </div>
                <KeyField optional label="Team ID" value={zk.zoho_team_id} onChange={(v) => setZk({ ...zk, zoho_team_id: v })} placeholder="60069474422" />
                <KeyField span optional label="Default Project ID" value={zk.zoho_project_id} onChange={(v) => setZk({ ...zk, zoho_project_id: v })} placeholder="45354000001026097" />
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
                <button className="btn accent" onClick={saveZoho} disabled={savingZ || !zk.zoho_refresh_token}>{savingZ ? "Saving…" : "Save & connect"}</button>
                {zoho.status === "connected" && <button className="btn ghost" onClick={() => { zoho.disconnect(); toast("Zoho disabled for this session"); }}><Icon name="plug" size={15} />Disable</button>}
                {zoho.status === "disconnected" && zoho.error && <span style={{ fontSize: 12, color: "var(--amber)" }}>{zoho.error}</span>}
              </div>
            </div>
          )}

          {section === "gmail" && (
            <div className="card" style={{ padding: 20 }}>
              <div className="ds">Read-only inbox via IMAP. Needs a Google <b>App Password</b> (2-Step Verification &rarr; App passwords). Stored per-account; the local agent uses it to connect.</div>
              <div className="kf-grid">
                <KeyField label="Gmail address" value={gk.gmail_user} onChange={(v) => setGk({ ...gk, gmail_user: v })} placeholder="you@gmail.com" />
                <KeyField label="App password" value={gk.gmail_app_password} onChange={(v) => setGk({ ...gk, gmail_app_password: v })} placeholder="16-character app password" hint="Not your Google password — an app password, revocable at any time." />
              </div>
              <button className="btn accent" style={{ marginTop: 16 }} disabled={savingG || !gk.gmail_user || !gk.gmail_app_password}
                onClick={async () => { setSavingG(true); const { error } = await saveIntegrations(gk); setSavingG(false); toast(error ? `Couldn't save: ${error}` : "Gmail keys saved — open Mail to connect"); }}>{savingG ? "Saving…" : "Save Gmail keys"}</button>
            </div>
          )}

          {section === "postgres" && (
            <div className="card">
              {status !== "online" && (
                <div className="setrow"><div className="l"><div className="nm">Local agent</div><div className="ds">Your machines are saved regardless \u2014 browsing tables and running queries just needs the agent running too.</div></div>
                  <span className="pill warn"><Icon name="plug" size={15} />Agent offline<span className="dotled warn" /></span></div>
              )}
              {pgList.length === 0 ? (
                <div className="setrow"><div className="l"><div className="nm">No servers configured</div><div className="ds">Add a Postgres connection to browse databases and run queries from the Postgres tab.</div></div>
                  <button className="btn accent" onClick={() => setPgAddOpen(true)}><Icon name="plus" size={15} />Add server</button></div>
              ) : (
                <>
                  {pgList.map((s) => (
                    <div className="setrow" key={s.id}>
                      <div className="l"><div className="nm" style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ color: "var(--mint)" }}><Icon name="db" size={15} /></span>{s.name}{s.ssl && <span className="mono" style={{ fontSize: 10, color: ACCENT.mint }}>SSL</span>}</div>
                        <div className="ds mono" style={{ fontSize: 11.5 }}>{s.user}@{s.host}:{s.port}{s.database ? ` \u00b7 ${s.database}` : ""}</div></div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn ghost" onClick={() => setPgEditing(s)}><Icon name="edit" size={15} />Edit</button>
                        <button className="btn ghost" onClick={async () => { const r = await pgDeleteServer(s.id); if (!r.ok) { toast(`Couldn't remove ${s.name}: ${r.error}`); return; } loadPg(); toast(`Removed ${s.name}`); }}><Icon name="x" size={15} />Remove</button>
                      </div>
                    </div>
                  ))}
                  <div className="setrow"><div className="l"><div className="ds">Saved to your ORBIT account, visible only to you.</div></div>
                    <button className="btn ghost" onClick={() => setPgAddOpen(true)}><Icon name="plus" size={15} />Add server</button></div>
                </>
              )}
            </div>
          )}

          {section === "docker" && (
            <div className="card">
              <div className="setrow">
                <div className="l"><div className="nm">Docker Desktop</div><div className="ds">Read via the local agent (<code className="mono">docker ps</code>). Requires Docker Desktop running and <code className="mono">docker</code> on your PATH.</div></div>
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
          )}

          {section === "chores" && <ChoresCard />}

          {section === "integrations" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
                {CONNS.map((c) => (
                  <div key={c[0]} className="conn"><span className="ico" style={{ color: c[2] }}><Icon name={c[1]} size={18} /></span>
                    <div style={{ flex: 1 }}><div style={{ fontSize: 13.5 }}>{c[0]}</div><div style={{ fontSize: 11.5, color: "var(--dim)", marginTop: 2 }}>Not connected</div></div>
                    <button className="btn ghost" onClick={() => toast(`Connect ${c[0]}`)}>Connect</button></div>
                ))}
              </div>
              <div className="eyebrow" style={{ marginTop: 26 }}>IDE &amp; tool paths</div>
              <div className="card" style={{ marginTop: 12 }}>
                {[["VS Code", "code"], ["Visual Studio", "devenv.exe"], ["Terminal", "wt.exe"], ["Browser", "chrome"]].map((p) => (
                  <div key={p[0]} className="setrow"><div className="l"><div className="nm">{p[0]}</div></div><input className="field mono" defaultValue={p[1]} /></div>
                ))}
              </div>
            </>
          )}

          {section === "data" && (
            <div className="card">
              <div className="setrow"><div className="l"><div className="nm">Data store</div><div className="ds">Supabase Postgres with row-level security. Auth is ORBIT's own — sign-in/sign-up, verification and password reset never touch Supabase Auth.</div></div>
                <span className="pill live"><Icon name="db" size={15} />Supabase</span></div>
              <div className="setrow"><div className="l"><div className="nm">Passwords</div><div className="ds">Hashed with bcrypt, verified server-side. Reset requires an emailed one-time code, never a plaintext link.</div></div>
                <span className="pill live"><Icon name="shield" size={15} />bcrypt</span></div>
              <div className="setrow"><div className="l"><div className="nm">Login alerts</div><div className="ds">Every sign-in emails you the time, approximate location and device — so you'd notice if it wasn't you.</div></div>
                <span className="pill live"><Icon name="mail" size={15} />Enabled</span></div>
              <div className="setrow"><div className="l"><div className="nm">Break history</div><div className="ds">Chore digests are written to <code className="mono">break_logs</code> when a break ends.</div></div>
                <span className="pill"><Icon name="clock" size={15} />Retained</span></div>
            </div>
          )}
        </section>
      </div>

      {pgAddOpen && <PgServerModal onClose={() => setPgAddOpen(false)} onSaved={() => { setPgAddOpen(false); loadPg(); }} />}
      {pgEditing && <PgServerModal editing={pgEditing} onClose={() => setPgEditing(null)} onSaved={() => { setPgEditing(null); loadPg(); }} />}
    </main>
  );
}
