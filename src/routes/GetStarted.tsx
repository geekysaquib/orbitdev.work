import { useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "../lib/icons";
import { useAgent } from "../context/Agent";
import { useAuth } from "../context/AuthContext";
import { ORBIT_AGENT_DOWNLOAD_URL } from "../lib/downloads";

const STEPS = [
  "Click Download below — it's one file, no installer.",
  "Double-click orbit.exe. No console window opens; it runs quietly in the background.",
  "Your browser opens a small status page confirming it's running.",
  "Come back here — ORBIT connects automatically within a few seconds.",
];

export default function GetStarted() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/app";
  const { status } = useAgent();
  const { user } = useAuth();

  return (
    <main className="page">
      <div className="h1">Welcome to ORBIT, {user?.full_name?.split(" ")[0] || "there"}.</div>
      <div className="sub">One optional step before you start — install the local agent so ORBIT can launch your IDEs, Docker, and git.</div>

      <div className="card" style={{ maxWidth: 640, marginTop: 20 }}>
        <div className="setrow">
          <div className="l">
            <div className="nm">ORBIT Agent</div>
            <div className="ds">A small background service on this machine — it's what lets ORBIT open VS Code, run git pulls, and read Docker/Postgres for you. Windows, single file, no install.</div>
          </div>
          <a className="btn accent" href={ORBIT_AGENT_DOWNLOAD_URL}><Icon name="download" size={15} />Download for Windows</a>
        </div>
        <div className="setrow">
          <div className="l">
            <ol style={{ margin: 0, paddingLeft: 18, color: "var(--dim)", fontSize: 13, lineHeight: 1.9 }}>
              {STEPS.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 20 }}>
        {status === "online"
          ? <span className="pill live"><Icon name="zap" size={15} />Agent connected<span className="dotled" /></span>
          : <span className="pill"><Icon name="loader" size={15} className="spin" />Waiting for agent…<span className="dotled" /></span>}
        <button className="btn accent" onClick={() => nav(next)}><Icon name="chevR" size={15} />Continue to ORBIT</button>
        <button className="btn ghost" onClick={() => nav(next)}>I'll do this later</button>
      </div>
    </main>
  );
}
