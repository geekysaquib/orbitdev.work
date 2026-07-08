import { useState } from "react";
import { Icon } from "../lib/icons";
import { useToast } from "../context/Toast";
import { pgAddServer, pgTestServer, type PgServerInput } from "../lib/pg";

export function PgServerModal({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const toast = useToast();
  const [f, setF] = useState<PgServerInput>({ name: "", host: "localhost", port: 5432, user: "postgres", password: "", database: "", ssl: false });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const set = (k: keyof PgServerInput, v: unknown) => setF((prev) => ({ ...prev, [k]: v }));

  async function test() {
    if (!f.host || !f.user) { toast("Host and user are required."); return; }
    setTesting(true);
    const r = await pgTestServer(f);
    setTesting(false);
    toast(r.ok ? `Connected · ${(r.version || "").split(" ").slice(0, 2).join(" ")}` : `Failed: ${r.error}`);
  }
  async function save() {
    if (!f.host || !f.user) { toast("Host and user are required."); return; }
    setSaving(true);
    const r = await pgAddServer(f);
    setSaving(false);
    if (r.ok && r.server) { toast(`Added ${r.server.name}`); onAdded(r.server.id); }
    else toast(`Couldn't add: ${r.error}`);
  }

  return (
    <div className="modal-bg">
      <div className="modal" style={{ width: 460 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ display: "flex", alignItems: "center", gap: 9 }}><span style={{ color: "var(--mint)" }}><Icon name="db" size={18} /></span>Add Postgres server</h3>
          <button className="iconbtn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="dk-field" style={{ marginTop: 16 }}>
          <label>Name</label>
          <input className="dk-in" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Local Postgres" />
        </div>
        <div className="dk-build-grid" style={{ marginTop: 12 }}>
          <div className="dk-field"><label>Host</label><input className="dk-in mono" value={f.host} onChange={(e) => set("host", e.target.value)} placeholder="localhost" /></div>
          <div className="dk-field"><label>Port</label><input className="dk-in mono" value={f.port} onChange={(e) => set("port", Number(e.target.value) || 5432)} placeholder="5432" /></div>
        </div>
        <div className="dk-build-grid" style={{ marginTop: 12 }}>
          <div className="dk-field"><label>User</label><input className="dk-in mono" value={f.user} onChange={(e) => set("user", e.target.value)} placeholder="postgres" /></div>
          <div className="dk-field"><label>Password</label><input className="dk-in mono" type="password" value={f.password} onChange={(e) => set("password", e.target.value)} placeholder="••••••" /></div>
        </div>
        <div className="dk-field" style={{ marginTop: 12 }}>
          <label>Default database <span style={{ color: "var(--dim)" }}>· optional</span></label>
          <input className="dk-in mono" value={f.database} onChange={(e) => set("database", e.target.value)} placeholder="postgres" />
        </div>
        <label className="pg-ssl">
          <input type="checkbox" checked={!!f.ssl} onChange={(e) => set("ssl", e.target.checked)} />
          Use SSL (required by many hosted providers)
        </label>
        <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
          <button className="btn ghost" disabled={testing} onClick={test}>{testing ? <><Icon name="loader" size={14} className="spin" />Testing…</> : <><Icon name="plug" size={14} />Test</>}</button>
          <button className="btn accent" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save server"}</button>
        </div>
        <div style={{ fontSize: 11, color: "var(--dim)", marginTop: 12 }}>Credentials are stored by the local agent on your machine (<span className="mono">agent/pg-config.json</span>), never sent to ORBIT's servers.</div>
      </div>
    </div>
  );
}
