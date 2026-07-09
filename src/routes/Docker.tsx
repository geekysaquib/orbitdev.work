import { useEffect, useMemo, useState } from "react";
import { Icon } from "../lib/icons";
import { ACCENT, OrbitLoader, Empty, SetupRequired } from "../components/ui";
import { useToast } from "../context/Toast";
import { useAgent } from "../context/Agent";
import { useTable } from "../hooks/useTable";
import { fetchDocker, fetchDockerImages, dockerSave, dockerBuild, pickPath, type DockerContainer, type DockerImage } from "../lib/agent";
import type { Project } from "../lib/types";

const slug = (s: string) => (s || "image").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "image";

export default function Docker() {
  const toast = useToast();
  const { status } = useAgent();
  const agentDown = status !== "online";
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [images, setImages] = useState<DockerImage[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

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
    const [c, im] = await Promise.all([fetchDocker(), fetchDockerImages()]);
    setContainers(c.containers); setImages(im.images);
    setAvailable(c.available || im.available);
    setLoading(false);
  }
  useEffect(() => { load(); }, [status]); // eslint-disable-line

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
                <select value={projId} onChange={(e) => onPickProject(e.target.value)}>
                  <option value="">Select a project…</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
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

          <div className="eyebrow" style={{ marginTop: 30 }}>Running containers · {containers.length}</div>
          {containers.length === 0 ? <div style={{ color: "var(--dim)", fontSize: 13, padding: "10px 0" }}>No containers running.</div> : (
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Name</th><th>Image</th><th>Status</th></tr></thead>
              <tbody>{containers.map((c) => (
                <tr key={c.name}>
                  <td style={{ fontFamily: "var(--display)", fontWeight: 600 }}><span style={{ color: ACCENT.mint, marginRight: 8 }}>●</span>{c.name}</td>
                  <td className="mono" style={{ color: "var(--muted)" }}>{c.image}</td>
                  <td style={{ color: "var(--muted)" }}>{c.status}</td>
                </tr>
              ))}</tbody></table></div>
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
    </main>
  );
}
