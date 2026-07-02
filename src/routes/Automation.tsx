import { useState } from "react";
import { Icon } from "../lib/icons";
import { ACCENT } from "../components/ui";
import { useToast } from "../context/Toast";
import { runMacro } from "../lib/agent";

const START = ["git pull + rebase", "docker compose up", "Postgres + dev server", "VS Code (UI)", "Visual Studio (backend)", "Sync Zoho tickets", "Start timer + session log"];
const END = ["Commit reminder + stash check", "docker compose down", "Stop timer + write time log", "Generate standup summary", "Backup changed projects"];
const RULES = [["New Zoho ticket assigned to me", "Desktop notify + create task"], ["Pull request merged", "Move linked task to Done"], ["Branch pushed with ticket id", "Set ticket → In progress"], ["Dev server unreachable 60s", "Alert + attempt restart"]];
const JOBS = [["Morning Zoho sync", "Weekdays · 08:45"], ["Nightly project backup", "Daily · 02:00"], ["Deadline reminders", "Daily · 09:00"], ["Dependency drift check", "Mondays · 07:00"]];

export default function Automation() {
  const toast = useToast();
  const [ign, setIgn] = useState(false);
  const [step, setStep] = useState(-1);
  const [rules, setRules] = useState(RULES.map((_, i) => i < 3));
  const [jobs, setJobs] = useState(JOBS.map((_, i) => i < 3));

  function start() {
    if (ign) return;
    runMacro("start-work", {});
    setIgn(true); setStep(0);
    let s = 0;
    const iv = setInterval(() => {
      s++;
      if (s > START.length) { clearInterval(iv); setTimeout(() => { setIgn(false); setStep(-1); toast("Environment ready · agent connected"); }, 550); return; }
      setStep(s);
    }, 620);
  }

  return (
    <main className="page">
      <div className="h1">Automation</div>
      <div className="sub">The macros, schedules, and rules that run your day so you don't have to.</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 24 }}>
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="h2" style={{ display: "flex", alignItems: "center", gap: 9 }}><span style={{ color: ACCENT.mint }}><Icon name="zap" size={18} fill /></span>Start Work</div>
            <button className="btn accent" onClick={start}>Run</button>
          </div>
          <div className="macro" style={{ marginTop: 16 }}>{START.map((s, i) => <div key={i} className="step"><span className="n">{i + 1}</span>{s}</div>)}</div>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="h2" style={{ display: "flex", alignItems: "center", gap: 9 }}><span style={{ color: ACCENT.red }}><Icon name="bolt" size={18} /></span>End Work</div>
            <button className="btn" onClick={() => { runMacro("end-work", {}); toast("Wrapping up session…"); }}>Run</button>
          </div>
          <div className="macro" style={{ marginTop: 16 }}>{END.map((s, i) => <div key={i} className="step"><span className="n">{i + 1}</span>{s}</div>)}</div>
        </div>
      </div>

      <div className="eyebrow" style={{ marginTop: 32 }}>Rules — if this, then that</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
        {RULES.map((r, i) => (
          <div key={i} className="rule"><span className="when">{r[0]}</span><span className="arrow"><Icon name="chevR" size={14} /></span><span className="then">{r[1]}</span>
            <span className={"toggle" + (rules[i] ? " on" : "")} style={{ marginLeft: "auto" }} onClick={() => setRules(rules.map((v, j) => j === i ? !v : v))} /></div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 32 }}>
        <div><div className="eyebrow">Scheduled jobs</div>
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            {JOBS.map((j, i) => (
              <div key={i} className="conn"><span className="ico" style={{ color: ACCENT.blue }}><Icon name="clock" size={18} /></span>
                <div style={{ flex: 1 }}><div style={{ fontSize: 13.5 }}>{j[0]}</div><div style={{ fontSize: 11.5, color: "var(--dim)", marginTop: 2 }}>{j[1]}</div></div>
                <span className={"toggle" + (jobs[i] ? " on" : "")} onClick={() => setJobs(jobs.map((v, k) => k === i ? !v : v))} /></div>
            ))}
          </div></div>
        <div><div className="eyebrow">Scaffolding templates</div>
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            {[["monoZTrack CRUD module", "ModuleMint — 10 files + 7 patches"], ["React + Vite + TS", "Tailwind, router baseline"], [".NET minimal API", "EF Core, PostgreSQL, JWT"]].map((t, i) => (
              <div key={i} className="conn"><span className="ico" style={{ color: ACCENT.violet }}><Icon name="layers" size={18} /></span>
                <div style={{ flex: 1 }}><div style={{ fontSize: 13.5 }}>{t[0]}</div><div style={{ fontSize: 11.5, color: "var(--dim)", marginTop: 2 }}>{t[1]}</div></div>
                <button className="btn ghost" onClick={() => toast(`Scaffolding ${t[0]}`)}><Icon name="plus" size={14} /></button></div>
            ))}
          </div></div>
      </div>

      {ign && (
        <div className="overlay">
          <div className="ig">
            <div className="head"><div className="badge2"><Icon name="zap" size={22} fill /></div>
              <div><div style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 17 }}>Booting work session</div>
                <div className="mono" style={{ fontSize: 12.5, color: "var(--muted)" }}>monoZTrack · Obayashi</div></div></div>
            <div>{START.map((s, i) => {
              const st = i < step ? "done" : i === step ? "run" : "wait";
              return <div key={i} className={"igstep " + st}><span style={{ width: 20, display: "grid", placeItems: "center" }}>
                {st === "done" ? <span style={{ color: ACCENT.mint }}><Icon name="checkc" size={17} /></span>
                  : st === "run" ? <span style={{ color: ACCENT.blue }} className="spin"><Icon name="loader" size={16} /></span>
                    : <span style={{ color: ACCENT.dim }}><Icon name="bolt" size={16} /></span>}</span>
                <span style={{ color: st === "wait" ? "var(--dim)" : "var(--text)" }}>{s}</span></div>;
            })}</div>
          </div>
        </div>
      )}
    </main>
  );
}
