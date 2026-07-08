import { useMemo, useState } from "react";
import { Icon } from "../lib/icons";
import { useToast } from "../context/Toast";
import { useAgent } from "../context/Agent";
import { useTable } from "../hooks/useTable";
import { gitPull, checkPort, devStart } from "../lib/agent";
import type { Project } from "../lib/types";

type Stage = "queued" | "pulling" | "checking" | "starting" | "running" | "skipped" | "error";
interface RunState { stage: Stage; message?: string; pull?: string; }

function detectRun(p: Project): { command: string; port: number } {
  const s = (p.stacks || []).map((x) => x.toLowerCase()).join(" ");
  const port = p.dev_port ?? (/vite/.test(s) ? 5173 : 3000);
  const command = /vite|next/.test(s) ? "npm run dev" : /react|angular|vue/.test(s) ? "npm start" : "npm run dev";
  return { command, port };
}

const STAGE_META: Record<Stage, { color: string; label: string; spin?: boolean }> = {
  queued: { color: "var(--dim)", label: "Queued" },
  pulling: { color: "var(--blue)", label: "Pulling…", spin: true },
  checking: { color: "var(--blue)", label: "Checking port…", spin: true },
  starting: { color: "var(--violet)", label: "Starting…", spin: true },
  running: { color: "var(--mint)", label: "Running" },
  skipped: { color: "var(--amber)", label: "Skipped" },
  error: { color: "var(--red)", label: "Failed" },
};

export function StartWorkModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { status } = useAgent();
  const agentDown = status !== "online";
  const { rows } = useTable<Project>("projects");
  const projects = useMemo(() => rows.filter((p) => p.status === "active"), [rows]);

  const [step, setStep] = useState<"select" | "run">("select");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => setPicked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setRun = (id: string, patch: RunState) => setRuns((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  async function start() {
    if (agentDown) { toast("Start the ORBIT agent first."); return; }
    const chosen = projects.filter((p) => picked.has(p.id));
    if (chosen.length === 0) { toast("Pick at least one project."); return; }
    setStep("run"); setBusy(true);
    setRuns(Object.fromEntries(chosen.map((p) => [p.id, { stage: "queued" as Stage }])));

    for (const p of chosen) {
      const path = p.fe_path;
      const { command, port } = detectRun(p);
      if (!path) { setRun(p.id, { stage: "error", message: "No frontend path set on this project." }); continue; }

      setRun(p.id, { stage: "pulling" });
      const pull = await gitPull(path);
      if (!pull.ok) { setRun(p.id, { stage: "error", message: `git pull: ${pull.error}` }); continue; }
      setRun(p.id, { stage: "checking", pull: pull.output });

      const pc = await checkPort(port);
      if (pc.inUse) {
        setRun(p.id, { stage: "skipped", pull: pull.output, message: `Port ${port} already in use${pc.ownedBy ? ` by ${pc.ownedBy}` : ""} — pulled, but not started.` });
        continue;
      }
      setRun(p.id, { stage: "starting", pull: pull.output });
      const ds = await devStart(path, command, port, p.name);
      if (ds.ok) setRun(p.id, { stage: "running", pull: pull.output, message: `${command} · http://localhost:${ds.port ?? port} · pid ${ds.pid}` });
      else setRun(p.id, { stage: "error", pull: pull.output, message: ds.error });
    }
    setBusy(false);
    toast("Start Work finished");
  }

  const chosen = projects.filter((p) => picked.has(p.id));

  return (
    <div className="modal-bg">
      <div className="modal sw-modal">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ display: "flex", alignItems: "center", gap: 9 }}><span style={{ color: "var(--mint)" }}><Icon name="zap" size={18} fill /></span>Start Work</h3>
          <button className="iconbtn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>

        {step === "select" ? (
          <>
            <div className="sw-sub">Pick the projects you're working on. ORBIT will <b>git pull</b> each, check its dev port, then start the UI based on its stack.</div>
            {agentDown && <div className="sw-warn"><Icon name="plug" size={14} />The local agent is offline — start it to pull and run projects.</div>}
            <div className="sw-list">
              {projects.length === 0 && <div className="sw-empty">No active projects. Mark a project active to work on it.</div>}
              {projects.map((p) => {
                const { command, port } = detectRun(p);
                const on = picked.has(p.id);
                return (
                  <button key={p.id} className={"sw-row" + (on ? " on" : "")} onClick={() => toggle(p.id)}>
                    <span className={"sw-check" + (on ? " on" : "")}>{on && <Icon name="check" size={12} />}</span>
                    <span className="sw-dot" style={{ background: p.accent || "var(--mint)" }} />
                    <div className="sw-info">
                      <div className="sw-name">{p.name}</div>
                      <div className="sw-meta mono">{(p.stacks || []).slice(0, 3).join(" · ") || "no stack"}{p.branch ? ` · ${p.branch}` : ""}</div>
                    </div>
                    <div className="sw-cmd mono">{command}<span className="sw-port">:{port}</span></div>
                  </button>
                );
              })}
            </div>
            <div className="sw-foot">
              <span className="sw-count">{picked.size} selected</span>
              <button className="btn accent" disabled={picked.size === 0 || agentDown} onClick={start}><Icon name="play" size={13} fill />Pull &amp; start</button>
            </div>
          </>
        ) : (
          <>
            <div className="sw-sub">{busy ? "Working through your projects…" : "Done. Dev servers keep running in the background."}</div>
            <div className="sw-list">
              {chosen.map((p) => {
                const r = runs[p.id] || { stage: "queued" as Stage };
                const m = STAGE_META[r.stage];
                return (
                  <div key={p.id} className="sw-runrow">
                    <span className="sw-dot" style={{ background: p.accent || "var(--mint)" }} />
                    <div className="sw-info">
                      <div className="sw-name">{p.name}</div>
                      {r.message && <div className="sw-runmsg mono" style={r.stage === "error" ? { color: "var(--red)" } : r.stage === "skipped" ? { color: "var(--amber)" } : {}}>{r.message}</div>}
                      {!r.message && r.pull && <div className="sw-runmsg mono">{r.pull}</div>}
                    </div>
                    <span className="sw-stage" style={{ color: m.color }}>
                      {m.spin ? <Icon name="loader" size={13} className="spin" /> : r.stage === "running" ? <Icon name="check" size={13} /> : null}
                      {m.label}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="sw-foot">
              <button className="btn ghost" onClick={() => { setStep("select"); setRuns({}); }} disabled={busy}>Back</button>
              <button className="btn accent" onClick={onClose} disabled={busy}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
