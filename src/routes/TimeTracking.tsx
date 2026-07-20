import { useEffect, useMemo, useState } from "react";
import { Icon } from "../lib/icons";
import { Select } from "../components/Select";
import { ACCENT, OrbitLoader, Empty, SetupRequired } from "../components/ui";
import { useToast } from "../context/Toast";
import { useZoho } from "../context/Zoho";
import { useAgent } from "../context/Agent";
import { useBreak } from "../context/Break";
import { useTable } from "../hooks/useTable";
import { fetchTimesheet, type Timesheet } from "../lib/zoho";
import { fetchOrbitHours, type OrbitHours } from "../lib/orbitHours";
import { TIMER_EVENT, readTimer, startTimer, stopTimer } from "../lib/timer";
import { fireAsync } from "../lib/automation";
import type { Project, Task } from "../lib/types";

export default function TimeTracking() {
  const toast = useToast();
  const zoho = useZoho();
  const { status: agentStatus } = useAgent();
  const { onBreak } = useBreak();
  const { rows: projects } = useTable<Project>("projects");
  const { rows: tasks } = useTable<Task>("tasks");
  const [running, setRunning] = useState(false);
  const [sec, setSec] = useState(0);
  const [ts, setTs] = useState<Timesheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [orbit, setOrbit] = useState<OrbitHours>({ todayH: 0, totalH: 0 });
  const [pickProject, setPickProject] = useState("");
  const [pickTask, setPickTask] = useState("");
  const [runningProjectId, setRunningProjectId] = useState<string | null>(null);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);

  // restore a running timer after a page refresh, and stay in sync when it's
  // started/paused/resumed elsewhere (break mode, another tab, Ask AI)
  useEffect(() => {
    const sync = () => {
      const t = readTimer();
      setRunning(t.startedAt !== null); setSec(t.seconds);
      setRunningProjectId(t.projectId); setRunningTaskId(t.taskId);
    };
    sync();
    window.addEventListener(TIMER_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(TIMER_EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);

  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => setSec(readTimer().seconds), 1000);
    return () => clearInterval(iv);
  }, [running]);

  useEffect(() => { fetchOrbitHours().then(setOrbit).catch(() => {}); }, []);
  useEffect(() => {
    if (zoho.status !== "connected") { setLoading(false); return; }
    setLoading(true);
    fetchTimesheet().then(setTs).catch(() => setTs(null)).finally(() => setLoading(false));
  }, [zoho.status]);

  const agentDown = agentStatus !== "online";

  const openTasks = useMemo(
    () => tasks.filter((t) => t.status !== "done" && (!pickProject || t.project_id === pickProject)),
    [tasks, pickProject],
  );
  const projName = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p.name])), [projects]);
  const taskTitle = useMemo(() => Object.fromEntries(tasks.map((t) => [t.id, t.title])), [tasks]);

  async function toggle() {
    if (running) {
      setRunning(false);
      // Read the session's project/task before stopTimer() clears them.
      const { projectId, taskId } = readTimer();
      const logged = await stopTimer();
      const h = await fetchOrbitHours(); setOrbit(h);
      toast(`Logged ${Math.floor(logged / 60)}m ${logged % 60}s to Orbit hours`);
      setSec(0);
      setPickProject(""); setPickTask("");
      fireAsync({ type: "timer_stopped", projectId, taskId, seconds: logged });
    } else {
      if (agentDown) { toast("Agent required — start the ORBIT agent to run the timer"); return; }
      startTimer(pickProject || null, pickTask || null);
      setRunning(true); toast("Timer started");
      fireAsync({ type: "timer_started", projectId: pickProject || null, taskId: pickTask || null });
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
        {running ? (
          (runningProjectId || runningTaskId) && (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Logging to {runningTaskId ? (taskTitle[runningTaskId] ?? "a task") : projName[runningProjectId!] ?? "a project"}
              {runningTaskId && runningProjectId && projName[runningProjectId] ? ` · ${projName[runningProjectId]}` : ""}
            </div>
          )
        ) : (
          <div style={{ display: "flex", gap: 8, width: "100%" }}>
            <Select value={pickProject} onChange={(e) => { setPickProject(e.target.value); setPickTask(""); }} full>
              <option value="">No project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Select value={pickTask} onChange={(e) => setPickTask(e.target.value)} full>
              <option value="">No task</option>
              {openTasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </Select>
          </div>
        )}
        <button className="btn-primary" onClick={toggle} disabled={(agentDown && !running) || (onBreak && !running)}>
          {running ? <Icon name="bolt" size={16} /> : <Icon name="play" size={14} fill />}{running ? "Stop & log" : "Start"}
        </button>
        {onBreak && !running && <div style={{ fontSize: 11.5, color: "var(--amber)", display: "flex", alignItems: "center", gap: 6 }}><Icon name="clock" size={13} />On a break — resume is disabled until you're refreshed.</div>}
        {agentDown && !running && !onBreak && <div style={{ fontSize: 11.5, color: "var(--amber)" }}>Agent required to start the timer.</div>}
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
