import { useEffect, useState } from "react";
import { Icon } from "../lib/icons";
import { ACCENT, OrbitLoader, Empty, SetupRequired } from "../components/ui";
import { useToast } from "../context/Toast";
import { useAgent } from "../context/Agent";
import { fetchDocker, fetchDockerImages, dockerSave, pickPath, type DockerContainer, type DockerImage } from "../lib/agent";

export default function Docker() {
  const toast = useToast();
  const { status } = useAgent();
  const agentDown = status !== "online";
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [images, setImages] = useState<DockerImage[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

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
          <div className="eyebrow" style={{ marginTop: 8 }}>Running containers · {containers.length}</div>
          {containers.length === 0 ? <div style={{ color: "var(--dim)", fontSize: 13, padding: "10px 0" }}>No containers running.</div> : (
            <table className="tbl"><thead><tr><th>Name</th><th>Image</th><th>Status</th></tr></thead>
              <tbody>{containers.map((c) => (
                <tr key={c.name}>
                  <td style={{ fontFamily: "var(--display)", fontWeight: 600 }}><span style={{ color: ACCENT.mint, marginRight: 8 }}>●</span>{c.name}</td>
                  <td className="mono" style={{ color: "var(--muted)" }}>{c.image}</td>
                  <td style={{ color: "var(--muted)" }}>{c.status}</td>
                </tr>
              ))}</tbody></table>
          )}

          <div className="eyebrow" style={{ marginTop: 30 }}>Images · {images.length}</div>
          {images.length === 0 ? <div style={{ color: "var(--dim)", fontSize: 13, padding: "10px 0" }}>No images found.</div> : (
            <table className="tbl"><thead><tr><th>Repository</th><th>Tag</th><th>Size</th><th>Created</th><th></th></tr></thead>
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
              })}</tbody></table>
          )}
          <p style={{ fontSize: 11.5, color: "var(--dim)", marginTop: 14 }}>Export runs <span className="mono">docker save</span> and writes a .tar to the folder you pick. Large images can take a while.</p>
        </>
      )}
    </main>
  );
}
