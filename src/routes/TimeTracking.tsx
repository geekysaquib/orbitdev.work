import { useEffect, useState } from "react";
import { Icon } from "../lib/icons";
import { ACCENT } from "../components/ui";
import { useToast } from "../context/Toast";

const WEEK = [["Mon", 5.5], ["Tue", 7.2], ["Wed", 3.7], ["Thu", 6.1], ["Fri", 4.4], ["Sat", 2.0], ["Sun", 0.5]] as [string, number][];
const BILL = [["Obayashi", 22.4], ["Lizera (Japan)", 14.1], ["Personal", 9.8]] as [string, number][];

export default function TimeTracking() {
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(iv);
  }, [running]);
  const max = Math.max(...WEEK.map((w) => w[1]));
  const total = WEEK.reduce((a, w) => a + w[1], 0).toFixed(1);
  const mm = String(Math.floor(sec / 60)).padStart(2, "0"), ss = String(sec % 60).padStart(2, "0");

  return (
    <main className="page">
      <div className="h1">Time</div><div className="sub">Track focus per project, and turn it into client-ready hours.</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 18, marginTop: 24 }}>
        <div className="card" style={{ padding: 24, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
          <div className="eyebrow">monoZTrack</div>
          <div className="timerbig" style={{ color: running ? ACCENT.mint : "var(--text)" }}>00:{mm}:{ss}</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn-primary" onClick={() => { setRunning(!running); toast(running ? "Timer stopped" : "Timer started"); }}>
              {running ? <Icon name="bolt" size={16} /> : <Icon name="play" size={14} fill />}{running ? "Stop" : "Start"}</button>
            <button className="btn" onClick={() => toast("Pomodoro 25:00 armed")}><Icon name="timer" size={15} />Pomodoro</button>
          </div>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div className="eyebrow">This week</div><div className="mono" style={{ color: "var(--muted)", fontSize: 12 }}>{total} h</div></div>
          <div className="bars">{WEEK.map((w) => (
            <div key={w[0]} className="barwrap"><div className="bar" style={{ height: `${(w[1] / max) * 130}px` }} /><span className="barlab">{w[0]}</span></div>
          ))}</div>
        </div>
      </div>
      <div className="eyebrow" style={{ marginTop: 30 }}>Billable hours by client</div>
      <table className="tbl"><thead><tr><th>Client</th><th>Hours (month)</th><th></th></tr></thead>
        <tbody>{BILL.map((b) => (
          <tr key={b[0]}><td style={{ fontFamily: "var(--display)", fontWeight: 600 }}>{b[0]}</td>
            <td className="mono" style={{ color: "var(--muted)" }}>{b[1]} h</td>
            <td style={{ textAlign: "right" }}><button className="btn ghost" onClick={() => toast(`Exported ${b[0]} timesheet`)}><Icon name="upload" size={14} />Export</button></td></tr>
        ))}</tbody></table>
    </main>
  );
}
