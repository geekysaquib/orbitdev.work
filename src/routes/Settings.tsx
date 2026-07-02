import { useEffect, useState } from "react";
import { Icon } from "../lib/icons";
import { ACCENT } from "../components/ui";
import { useToast } from "../context/Toast";
import { pingAgent } from "../lib/agent";
import { useAuth } from "../context/AuthContext";

const CONNS: [string, string, string][] = [["Zoho Desk", "ticket", ACCENT.amber], ["GitHub", "git", "#ECEEF2"], ["Azure DevOps", "server", ACCENT.blue], ["Docker", "container", ACCENT.blue], ["Slack", "bell", ACCENT.violet]];

export default function Settings() {
  const toast = useToast();
  const { user, signOut } = useAuth();
  const [agent, setAgent] = useState(false);
  useEffect(() => { pingAgent().then(setAgent); }, []);

  return (
    <main className="page">
      <div className="h1">Settings</div><div className="sub">Wire up the agent, your integrations, and your data.</div>

      <div className="eyebrow" style={{ marginTop: 24 }}>Account</div>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="setrow"><div className="l"><div className="nm">{user?.email}</div><div className="ds">Signed in via Supabase</div></div>
          <button className="btn ghost" onClick={() => signOut()}><Icon name="logout" size={15} />Sign out</button></div>
      </div>

      <div className="eyebrow" style={{ marginTop: 30 }}>Local agent</div>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="setrow"><div className="l"><div className="nm">Companion agent</div><div className="ds">Background service that launches IDEs and runs macros on this machine.</div></div>
          <span className={"pill" + (agent ? " live" : "")}><Icon name={agent ? "zap" : "plug"} size={15} />{agent ? "Connected" : "Offline"}<span className="dotled" /></span></div>
        <div className="setrow"><div className="l"><div className="nm">Agent endpoint</div><div className="ds">HTTPS via locally-trusted cert (mkcert).</div></div>
          <input className="field" defaultValue={import.meta.env.VITE_AGENT_URL || "https://localhost:47600"} /></div>
        <div className="setrow"><div className="l"><div className="nm">Test connection</div><div className="ds">Ping the agent and verify the certificate.</div></div>
          <button className="btn accent" onClick={() => pingAgent().then((ok) => { setAgent(ok); toast(ok ? "Agent responded" : "No response — is the agent running?"); })}>Test</button></div>
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
    </main>
  );
}
