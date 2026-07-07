import { useEffect, useState } from "react";
import { Icon } from "../lib/icons";
import { ACCENT, OrbitLoader, Empty, SetupRequired } from "../components/ui";
import { useToast } from "../context/Toast";
import { useZoho } from "../context/Zoho";
import { useAgent } from "../context/Agent";
import { fetchTimesheet, type Timesheet } from "../lib/zoho";
import { logOrbitSession, fetchOrbitHours, type OrbitHours } from "../lib/orbitHours";

export default function TimeTracking() {
  const toast = useToast();
  const zoho = useZoho();
  const { status: agentStatus } = useAgent();
  const [running, setRunning] = useState(false);
  const [sec, setSec] = useState(0);
  const [ts, setTs] = useState<Timesheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [orbit, setOrbit] = useState<OrbitHours>({ todayH: 0, totalH: 0 });
  const TIMER_KEY = "orbit.timerStart";

  // restore a running timer after a page refresh
  useEffect(() => {
    const saved = localStorage.getItem(TIMER_KEY);
    if (saved && Number(saved) > 0) { setRunning(true); setSec(Math.floor((Date.now() - Number(saved)) / 1000)); }
  }, []);

  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => {
      const saved = localStorage.getItem(TIMER_KEY);
      const start = saved ? Number(saved) : Date.now();
      setSec(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, [running]);

  useEffect(() => { fetchOrbitHours().then(setOrbit).catch(() => {}); }, []);
  useEffect(() => {
    if (zoho.status !== "connected") { setLoading(false); return; }
    setLoading(true);
    fetchTimesheet().then(setTs).catch(() => setTs(null)).finally(() => setLoading(false));
  }, [zoho.status]);

  const agentDown = agentStatus !== "online";

  async function toggle() {
    if (running) {
      setRunning(false);
      localStorage.removeItem(TIMER_KEY);
      await logOrbitSession(sec);
      const h = await fetchOrbitHours(); setOrbit(h);
      toast(`Logged ${Math.floor(sec / 60)}m ${sec % 60}s to Orbit hours`);
      setSec(0);
    } else {
      if (agentDown) { toast("Agent required — start the ORBIT agent to run the timer"); return; }
      localStorage.setItem(TIMER_KEY, String(Date.now()));
      setRunning(true); toast("Timer started");
    }
  }

  const mm = String(Math.floor(sec / 60)).padStart(2, "0"), ss = String(sec % 60).padStart(2, "0");
  const zTodayH = ts ? (ts.byDate[new Date().toISOString().slice(0, 10)] ?? 0) : 0;

  return (
    <main className="page">
      <div className="h1">Time</div><div className="sub">Orbit focus hours and Zoho Sprints logged hours, side by side.</div>

      {/* Orbit vs Zoho summary */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, margin: "22px 0" }}>
        <div className="card" style={{ padding: 20, borderColor: "rgba(55,223,160,.28)" }}>
          <div className="lab" style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--mint)", fontSize: 13 }}><Icon name="orbit" size={16} />Orbit Hours</div>
          <div style={{ display: "flex", gap: 26, marginTop: 14 }}>
            <div><div className="val" style={{ fontSize: 30 }}>{orbit.todayH}h</div><div className="subv">Today</div></div>
            <div><div className="val" style={{ fontSize: 30 }}>{orbit.totalH}h</div><div className="subv">Total</div></div>
          </div>
        </div>
        <div className="card" style={{ padding: 20, borderColor: "rgba(91,141,239,.28)" }}>
          <div className="lab" style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--blue)", fontSize: 13 }}><Icon name="ticket" size={16} />Zoho Hours</div>
          <div style={{ display: "flex", gap: 26, marginTop: 14 }}>
            <div><div className="val" style={{ fontSize: 30 }}>{ts ? `${zTodayH}h` : "—"}</div><div className="subv">Today</div></div>
            <div><div className="val" style={{ fontSize: 30 }}>{ts ? `${ts.totalHours}h` : "—"}</div><div className="subv">Total{ts ? ` · ${ts.billableHours}h billable` : ""}</div></div>
          </div>
        </div>
      </div>

      {/* focus timer */}
      <div className="card" style={{ padding: 24, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, maxWidth: 460 }}>
        <div className="eyebrow">Orbit focus timer</div>
        <div className="timerbig" style={{ color: running ? ACCENT.mint : "var(--text)" }}>00:{mm}:{ss}</div>
        <button className="btn-primary" onClick={toggle} disabled={agentDown && !running}>
          {running ? <Icon name="bolt" size={16} /> : <Icon name="play" size={14} fill />}{running ? "Stop & log" : "Start"}
        </button>
        {agentDown && !running && <div style={{ fontSize: 11.5, color: "var(--amber)" }}>Agent required to start the timer.</div>}
      </div>

      {/* Zoho hours by project */}
      <div className="eyebrow" style={{ marginTop: 30 }}>Zoho hours by project</div>
      {zoho.status === "disconnected"
        ? <SetupRequired icon="ticket" title="Connect Zoho Sprints" sub="Add your Zoho keys in Settings to pull logged and billable hours." />
        : loading ? <OrbitLoader label="Loading hours…" /> : ts ? (
        <table className="tbl"><thead><tr><th>Project</th><th>Logged hours</th></tr></thead>
          <tbody>{ts.byProject.map((r) => (
            <tr key={r.name}><td style={{ fontFamily: "var(--display)", fontWeight: 600 }}>{r.name}</td><td className="mono" style={{ color: "var(--muted)" }}>{r.hours} h</td></tr>
          ))}
          {ts.byProject.length === 0 && <tr><td colSpan={2} style={{ color: "var(--dim)" }}>No logged hours.</td></tr>}
          </tbody></table>
      ) : <Empty icon="plug" title="Zoho not connected" sub="Connect Zoho in Settings to see logged hours." mini />}

      {ts && ts.byUser.length > 0 && <>
        <div className="eyebrow" style={{ marginTop: 30 }}>Zoho hours by person</div>
        <table className="tbl"><thead><tr><th>Person</th><th>Logged hours</th></tr></thead>
          <tbody>{ts.byUser.map((r) => (
            <tr key={r.name}><td>{r.name}</td><td className="mono" style={{ color: "var(--muted)" }}>{r.hours} h</td></tr>
          ))}</tbody></table>
      </>}
    </main>
  );
}
