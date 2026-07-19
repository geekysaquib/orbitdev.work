import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../lib/icons";
import { Select } from "../components/Select";
import { Modal } from "../components/Modal";
import { ConfirmModal } from "../components/ConfirmModal";
import { ACCENT, OrbitLoader, Empty, SetupRequired } from "../components/ui";
import { useToast } from "../context/Toast";
import { useAgent } from "../context/Agent";
import { useTable } from "../hooks/useTable";
import {
  fetchDockerAll, fetchDockerImages, dockerSave, dockerBuild, pickPath,
  dockerStart, dockerStop, dockerRestart, dockerRemove, dockerLogs, dockerExec,
  dockerLogsStream, dockerLogsUnstream,
  dockerComposeLs, dockerComposeUp, dockerComposeDown,
  type DockerContainerFull, type DockerImage, type ComposeStack,
} from "../lib/agent";
import { DockerStatsPanel } from "../components/DockerStatsPanel";
import type { Project } from "../lib/types";

const slug = (s: string) => (s || "image").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "image";

function LogsModal({ name, onClose }: { name: string; onClose: () => void }) {
  const { subscribe } = useAgent();
  const [logs, setLogs] = useState("");
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const scrollRef = useRef<HTMLPreElement>(null);

  async function load() {
    setLoading(true);
    const r = await dockerLogs(name, 300);
    setLogs(r.ok ? (r.logs || "") : `Couldn't load logs: ${r.error}`);
    setLoading(false);
  }
  useEffect(() => { load(); }, []); // eslint-disable-line

  // Snapshot above, then tail live lines as they happen — started/stopped
  // with this modal's lifetime (agent/server.mjs's dockerLogStreams map).
  useEffect(() => {
    let cancelled = false;
    dockerLogsStream(name).then((r) => { if (!cancelled) setLive(r.ok); });
    const unsub = subscribe((event, payload) => {
      if (event !== "docker:log") return;
      const p = payload as { name?: string; line?: string };
      if (p.name !== name) return;
      setLogs((prev) => `${prev}${prev ? "\n" : ""}${p.line}`);
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
    });
    return () => { cancelled = true; unsub(); dockerLogsUnstream(name); };
  }, [name, subscribe]);

  return (
    <Modal onClose={onClose} style={{ width: 720, maxWidth: "90vw" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <Icon name="terminal" size={17} />Logs · <span className="mono">{name}</span>
          {live && <span className="pill live" style={{ fontSize: 10.5 }}><span className="dotled" />Live</span>}
        </h3>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="iconbtn" title="Refresh" onClick={load}><Icon name="refresh" size={14} className={loading ? "spin" : ""} /></button>
          <button className="iconbtn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
      </div>
      <pre ref={scrollRef} className="mono" style={{ marginTop: 14, maxHeight: "60vh", overflow: "auto", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 14, fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
        {loading ? "Loading…" : logs || "(no output)"}
      </pre>
    </Modal>
  );
}

function ExecModal({ name, onClose }: { name: string; onClose: () => void }) {
  const [cmd, setCmd] = useState("");
  const [output, setOutput] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    if (!cmd.trim() || running) return;
    setRunning(true);
    const r = await dockerExec(name, cmd.trim());
    setOutput(r.ok ? (r.output || "") : `Error: ${r.error}`);
    setRunning(false);
  }

  return (
    <Modal onClose={onClose} style={{ width: 560 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ display: "flex", alignItems: "center", gap: 9 }}><Icon name="terminal" size={17} />Exec · <span className="mono">{name}</span></h3>
        <button className="iconbtn" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 8 }}>Runs one command inside the container via <span className="mono">docker exec</span> — not an interactive shell.</p>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          className="dk-in mono" autoFocus value={cmd} placeholder="e.g. ls -la /app"
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") run(); }}
        />
        <button className="btn accent" disabled={!cmd.trim() || running} onClick={run}>
          {running ? <Icon name="loader" size={14} className="spin" /> : <Icon name="play" size={13} fill />}
        </button>
      </div>
      {output !== null && (
        <pre className="mono" style={{ marginTop: 14, maxHeight: "40vh", overflow: "auto", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 14, fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {output || "(no output)"}
        </pre>
      )}
    </Modal>
  );
}

export default function Docker() {
  const toast = useToast();
  const { status } = useAgent();
  const agentDown = status !== "online";
  const [containers, setContainers] = useState<DockerContainerFull[]>([]);
  const [images, setImages] = useState<DockerImage[]>([]);
  const [stacks, setStacks] = useState<ComposeStack[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const [execFor, setExecFor] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [composeFile, setComposeFile] = useState("");
  const [composeBusy, setComposeBusy] = useState(false);
  const [showStats, setShowStats] = useState(false);

  const { rows: projects } = useTable<Project>("projects");
  const [projId, setProjId] = useState("");
  const [tag, setTag] = useState("");
  const [source, setSource] = useState<"backend" | "frontend">("backend");
  const [context, setContext] = useState("");
  const [dockerfile, setDockerfile] = useState("");
  const [building, setBuilding] = useState(false);
  const selProject = useMemo(() => projects.find((p) => p.id === projId), [projects, projId]);

  // backend build context = the folder that holds the .sln (where the Dockerfile lives)
  const dirOf = (p?: string | null) => (p ? String(p).replace(/[\\/][^\\/]*$/, "") : "");
  const ctxFor = (p: Project | undefined, src: "backend" | "frontend") =>
    src === "backend" ? (dirOf(p?.sln_path) || p?.fe_path || "") : (p?.fe_path || "");

  function onPickProject(id: string) {
    setProjId(id);
    const p = projects.find((x) => x.id === id);
    if (!p) return;
    const src: "backend" | "frontend" = p.sln_path ? "backend" : "frontend";
    setSource(src);
    setTag(`${slug(p.name)}:latest`);
    setContext(ctxFor(p, src));
    setDockerfile("");
  }
  function onPickSource(src: "backend" | "frontend") {
    setSource(src);
    setContext(ctxFor(selProject, src));
  }
  async function browseContext() {
    const dir = await pickPath("folder");
    if (dir) setContext(dir);
  }
  async function browseDockerfile() {
    const f = await pickPath("file");
    if (f) setDockerfile(f);
  }
  async function buildImage() {
    if (!tag.trim() || !context.trim()) { toast("Pick a project and a build context first."); return; }
    setBuilding(true);
    toast(`Building ${tag}… this can take a while`);
    const r = await dockerBuild(tag.trim(), context.trim(), dockerfile.trim() || undefined);
    setBuilding(false);
    if (r.ok) { toast(`Built ${r.tag || tag}`); load(); }
    else toast(`Build failed: ${r.error}`);
  }

  async function load() {
    if (agentDown) { setLoading(false); return; }
    setLoading(true);
    const [c, im, cs] = await Promise.all([fetchDockerAll(), fetchDockerImages(), dockerComposeLs()]);
    setContainers(c.containers); setImages(im.images); setStacks(cs.stacks);
    setAvailable(c.available || im.available);
    setLoading(false);
  }
  useEffect(() => { load(); }, [status]); // eslint-disable-line

  async function lifecycle(action: (name: string) => Promise<{ ok: boolean; error?: string }>, name: string, verb: string) {
    setBusyName(name);
    const r = await action(name);
    setBusyName(null);
    if (!r.ok) { toast(`${verb} failed: ${r.error}`); return; }
    toast(`${name} ${verb.toLowerCase()}ed`);
    load();
  }
  async function confirmRemove() {
    if (!removeTarget) return;
    const name = removeTarget;
    setRemoveTarget(null);
    setBusyName(name);
    const r = await dockerRemove(name);
    setBusyName(null);
    if (!r.ok) { toast(`Remove failed: ${r.error}`); return; }
    toast(`Removed ${name}`);
    load();
  }

  async function browseComposeFile() {
    const f = await pickPath("file");
    if (f) setComposeFile(f);
  }
  async function composeUp() {
    if (!composeFile.trim()) return;
    setComposeBusy(true);
    const r = await dockerComposeUp(composeFile.trim());
    setComposeBusy(false);
    if (!r.ok) { toast(`Compose up failed: ${r.error}`); return; }
    toast("Stack is up");
    setComposeFile("");
    load();
  }
  async function composeDown(stack: ComposeStack) {
    setBusyName(`compose:${stack.name}`);
    const r = await dockerComposeDown(stack.name);
    setBusyName(null);
    if (!r.ok) { toast(`Compose down failed: ${r.error}`); return; }
    toast(`${stack.name} stopped`);
    load();
  }

  async function exportImage(img: DockerImage) {
    const name = img.tag && img.tag !== "<none>" ? `${img.repository}:${img.tag}` : img.id;
    const dir = await pickPath("folder");
    if (!dir) return;
    setSaving(name);
    toast(`Exporting ${name}… this can take a moment`);
    const r = await dockerSave(name, dir);
    setSaving(null);
    toast(r.ok ? `Saved → ${r.path}` : `Export failed: ${r.error}`);
  }

  return (
    <main className="page">
      <div className="rowhead">
        <div><div className="h1">Docker</div><div className="sub">Local containers and images via the ORBIT agent.</div></div>
        <button className="btn ghost" disabled={agentDown} onClick={load}><Icon name="refresh" size={14} />Refresh</button>
      </div>

      {agentDown ? (
        <SetupRequired icon="zap" title="Start the ORBIT agent" sub="Docker is read through the local agent on your machine. Start it, or set its URL in Settings." cta="Agent settings" to="/settings" />
      ) : loading ? (
        <div className="page-loader"><OrbitLoader label="Reading Docker…" /></div>
      ) : available === false ? (
        <Empty icon="container" title="Docker not detected" sub="Make sure Docker Desktop is running and `docker` is on your PATH." />
      ) : (
        <>
          <div className="eyebrow" style={{ marginTop: 8 }}>Create image</div>
          <div className="dk-build">
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Build a Docker image from a project. The context folder (or the file you point at) must contain a <span className="mono">Dockerfile</span> — for these projects that's usually the <b>backend</b>.</div>
            <div className="dk-build-grid">
              <div className="dk-field">
                <label>Project</label>
                <Select full value={projId} onChange={(e) => onPickProject(e.target.value)}>
                  <option value="">Select a project…</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </div>
              <div className="dk-field">
                <label>Image tag</label>
                <input className="dk-in mono" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="myapp:latest" />
              </div>
            </div>
            <div className="dk-field" style={{ marginTop: 12 }}>
              <label>Source</label>
              <div className="dk-seg">
                <button className={source === "backend" ? "on" : ""} onClick={() => onPickSource("backend")} disabled={!selProject}><Icon name="server" size={13} />Backend</button>
                <button className={source === "frontend" ? "on" : ""} onClick={() => onPickSource("frontend")} disabled={!selProject}><Icon name="code" size={13} />Frontend</button>
              </div>
            </div>
            <div className="dk-field" style={{ marginTop: 12 }}>
              <label>Build context {selProject && !context && <span style={{ color: ACCENT.amber }}>· no path on project, browse to pick</span>}</label>
              <div className="dk-ctx">
                <input className="dk-in" value={context} onChange={(e) => setContext(e.target.value)} placeholder="C:\path\to\backend" />
                <button className="btn ghost" onClick={browseContext} title="Pick folder"><Icon name="folderOpen" size={14} />Browse</button>
              </div>
            </div>
            <div className="dk-field" style={{ marginTop: 12 }}>
              <label>Dockerfile <span style={{ color: "var(--dim)" }}>· optional, only if it isn't named <span className="mono">Dockerfile</span> at the context root</span></label>
              <div className="dk-ctx">
                <input className="dk-in" value={dockerfile} onChange={(e) => setDockerfile(e.target.value)} placeholder="(defaults to <context>/Dockerfile)" />
                <button className="btn ghost" onClick={browseDockerfile} title="Pick Dockerfile"><Icon name="folder" size={14} />Browse</button>
              </div>
            </div>
            <div className="dk-build-foot">
              <span className="dk-hint">Runs <span className="mono">docker build -t {tag || "<tag>"}{dockerfile ? " -f <dockerfile>" : ""} {context ? "<context>" : "."}</span> on your machine.</span>
              <button className="btn accent" disabled={building || !tag.trim() || !context.trim()} onClick={buildImage}>
                {building ? <><Icon name="loader" size={14} className="spin" />Building…</> : <><Icon name="container" size={14} />Build image</>}
              </button>
            </div>
          </div>

          <div className="rowhead" style={{ marginTop: 30, alignItems: "center" }}>
            <div className="eyebrow" style={{ margin: 0 }}>Containers · {containers.length}</div>
            {containers.some((c) => c.running) && (
              <button className="btn ghost" onClick={() => setShowStats((v) => !v)}>
                <Icon name={showStats ? "chevL" : "chevR"} size={13} />Resource usage
              </button>
            )}
          </div>
          {showStats && (
            <div className="card" style={{ padding: 16, marginBottom: 16 }}>
              <DockerStatsPanel />
            </div>
          )}
          {containers.length === 0 ? <div style={{ color: "var(--dim)", fontSize: 13, padding: "10px 0" }}>No containers found.</div> : (
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Name</th><th>Image</th><th>Status</th><th></th></tr></thead>
              <tbody>{containers.map((c) => {
                const busy = busyName === c.name;
                return (
                  <tr key={c.name}>
                    <td style={{ fontFamily: "var(--display)", fontWeight: 600 }}><span style={{ color: c.running ? ACCENT.mint : ACCENT.dim, marginRight: 8 }}>●</span>{c.name}</td>
                    <td className="mono" style={{ color: "var(--muted)" }}>{c.image}</td>
                    <td style={{ color: "var(--muted)" }}>{c.status}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <div style={{ display: "inline-flex", gap: 4 }}>
                        {c.running ? (
                          <>
                            <button className="iconbtn" title="Stop" disabled={busy} onClick={() => lifecycle(dockerStop, c.name, "Stop")}><Icon name="pause" size={13} /></button>
                            <button className="iconbtn" title="Restart" disabled={busy} onClick={() => lifecycle(dockerRestart, c.name, "Restart")}><Icon name="refresh" size={13} className={busy ? "spin" : ""} /></button>
                          </>
                        ) : (
                          <button className="iconbtn" title="Start" disabled={busy} onClick={() => lifecycle(dockerStart, c.name, "Start")}><Icon name="play" size={13} fill /></button>
                        )}
                        <button className="iconbtn" title="Logs" disabled={busy} onClick={() => setLogsFor(c.name)}><Icon name="terminal" size={13} /></button>
                        <button className="iconbtn" title="Exec" disabled={busy || !c.running} onClick={() => setExecFor(c.name)}><Icon name="code" size={13} /></button>
                        <button className="iconbtn" title="Remove" disabled={busy} onClick={() => setRemoveTarget(c.name)}><Icon name="trash" size={13} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}</tbody></table></div>
          )}

          <div className="eyebrow" style={{ marginTop: 30 }}>Compose stacks · {stacks.length}</div>
          <div className="dk-build">
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Bring up a stack from a <span className="mono">docker-compose.yml</span> — runs <span className="mono">docker compose up -d</span> in that file's folder.</div>
            <div className="dk-ctx" style={{ marginTop: 10 }}>
              <input className="dk-in" value={composeFile} onChange={(e) => setComposeFile(e.target.value)} placeholder="C:\path\to\docker-compose.yml" />
              <button className="btn ghost" onClick={browseComposeFile} title="Pick compose file"><Icon name="folder" size={14} />Browse</button>
              <button className="btn accent" disabled={composeBusy || !composeFile.trim()} onClick={composeUp}>
                {composeBusy ? <><Icon name="loader" size={14} className="spin" />Starting…</> : <><Icon name="play" size={13} fill />Up</>}
              </button>
            </div>
          </div>
          {stacks.length === 0 ? <div style={{ color: "var(--dim)", fontSize: 13, padding: "10px 0" }}>No compose stacks found.</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {stacks.map((s) => (
                <div key={s.name} className="conn">
                  <span className="ico" style={{ color: ACCENT.blue }}><Icon name="layers" size={18} /></span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5 }}>{s.name}</div>
                    <div className="mono" style={{ fontSize: 11.5, color: "var(--dim)", marginTop: 2 }}>{s.status}</div>
                  </div>
                  <button className="btn ghost sm" disabled={busyName === `compose:${s.name}`} onClick={() => composeDown(s)}>
                    {busyName === `compose:${s.name}` ? <Icon name="loader" size={13} className="spin" /> : <><Icon name="pause" size={13} />Down</>}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="eyebrow" style={{ marginTop: 30 }}>Images · {images.length}</div>
          {images.length === 0 ? <div style={{ color: "var(--dim)", fontSize: 13, padding: "10px 0" }}>No images found.</div> : (
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Repository</th><th>Tag</th><th>Size</th><th>Created</th><th></th></tr></thead>
              <tbody>{images.map((img) => {
                const name = img.tag && img.tag !== "<none>" ? `${img.repository}:${img.tag}` : img.id;
                return (
                  <tr key={img.id + img.tag}>
                    <td style={{ fontFamily: "var(--display)", fontWeight: 600 }}>{img.repository}</td>
                    <td className="mono" style={{ color: "var(--muted)" }}>{img.tag}</td>
                    <td className="mono" style={{ color: "var(--muted)" }}>{img.size}</td>
                    <td style={{ color: "var(--dim)" }}>{img.created}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn ghost sm" disabled={saving === name} onClick={() => exportImage(img)}>
                        {saving === name ? <><Icon name="loader" size={13} className="spin" />Saving…</> : <><Icon name="folderOpen" size={13} />Export .tar</>}
                      </button>
                    </td>
                  </tr>
                );
              })}</tbody></table></div>
          )}
          <p style={{ fontSize: 11.5, color: "var(--dim)", marginTop: 14 }}>Export runs <span className="mono">docker save</span> and writes a .tar to the folder you pick. Large images can take a while.</p>
        </>
      )}

      {logsFor && <LogsModal name={logsFor} onClose={() => setLogsFor(null)} />}
      {execFor && <ExecModal name={execFor} onClose={() => setExecFor(null)} />}
      {removeTarget && (
        <ConfirmModal
          title="Remove container?"
          message={`This force-removes "${removeTarget}" (equivalent to docker rm -f). This can't be undone.`}
          confirmLabel="Remove" danger
          onConfirm={confirmRemove}
          onCancel={() => setRemoveTarget(null)}
        />
      )}
    </main>
  );
}
