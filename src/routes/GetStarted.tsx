import { useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "../lib/icons";
import { useAuth } from "../context/AuthContext";
import { AgentSetupPanel } from "../components/AgentSetupPanel";

export default function GetStarted() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/app";
  const { user } = useAuth();

  return (
    <main className="page">
      <div className="h1">Welcome to ORBIT, {user?.full_name?.split(" ")[0] || "there"}.</div>
      <div className="sub">One optional step before you start — install the local agent so ORBIT can launch your IDEs, Docker, and git.</div>

      <div style={{ marginTop: 20 }}>
        <AgentSetupPanel />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 20 }}>
        <button className="btn accent" onClick={() => nav(next)}><Icon name="chevR" size={15} />Continue to ORBIT</button>
        <button className="btn ghost" onClick={() => nav(next)}>I'll do this later</button>
      </div>
    </main>
  );
}
