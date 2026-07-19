import { useState } from "react";
import { Icon } from "../lib/icons";
import { useToast } from "../context/Toast";
import { Modal } from "./Modal";
import { pgCreateDatabase, type PgServer } from "../lib/pg";

const SAFE_DB_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function CreateDatabaseModal({ server, onClose, onCreated }: {
  server: PgServer; onClose: () => void; onCreated: (name: string) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const trimmed = name.trim();
  const invalid = trimmed.length > 0 && !SAFE_DB_NAME.test(trimmed);

  async function create() {
    if (!trimmed || invalid) return;
    setCreating(true);
    const r = await pgCreateDatabase(server, trimmed);
    setCreating(false);
    if (r.ok) { toast(`Created database ${trimmed}`); onCreated(trimmed); }
    else toast(`Couldn't create database: ${r.error}`);
  }

  return (
    <Modal onClose={onClose} style={{ width: 400 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ display: "flex", alignItems: "center", gap: 9 }}><span style={{ color: "var(--mint)" }}><Icon name="db" size={18} /></span>New database</h3>
        <button className="iconbtn" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>
      <div className="dk-field" style={{ marginTop: 16 }}>
        <label>Database name</label>
        <input
          className="dk-in mono" autoFocus value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") create(); }}
          placeholder="my_new_db"
        />
        {invalid && <div style={{ fontSize: 11, color: "var(--red)", marginTop: 6 }}>Letters, digits, and underscores only — can't start with a digit.</div>}
      </div>
      <div style={{ fontSize: 11, color: "var(--dim)", marginTop: 12 }}>Created on {server.name} ({server.host}:{server.port}) as {server.user}.</div>
      <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn accent" disabled={!trimmed || invalid || creating} onClick={create}>
          {creating ? <><Icon name="loader" size={14} className="spin" />Creating…</> : "Create database"}
        </button>
      </div>
    </Modal>
  );
}
