import { Icon } from "../lib/icons";
import { useAgent } from "../context/Agent";
import { ORBIT_AGENT_DOWNLOAD_URL } from "../lib/downloads";

const STEPS = [
  "Click Download below — it's one file, no installer.",
  "Double-click orbit.exe. No console window opens; it runs quietly in the background.",
  "Your browser opens a small status page confirming it's running.",
  "Come back here — ORBIT connects automatically within a few seconds.",
];

/** The agent download/poll card, shared by GetStarted.tsx and the onboarding wizard. */
export function AgentSetupPanel() {
  const { status } = useAgent();

  return (
    <>
      <div className="card" style={{ maxWidth: 640 }}>
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
      <div style={{ marginTop: 16 }}>
        {status === "online"
          ? <span className="pill live"><Icon name="zap" size={15} />Agent connected<span className="dotled" /></span>
          : <span className="pill"><Icon name="loader" size={15} className="spin" />Waiting for agent…<span className="dotled" /></span>}
      </div>
    </>
  );
}
