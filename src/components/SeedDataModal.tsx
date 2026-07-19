import { useEffect, useMemo, useState } from "react";
import { Icon } from "../lib/icons";
import { useToast } from "../context/Toast";
import { useSeed } from "../context/Seed";
import { Modal } from "./Modal";
import { MAX_ROWS_PER_TABLE, type PgServer, type PgTable } from "../lib/pg";
import { fetchIntegrations } from "../lib/integrations";

export function SeedDataModal({ server, database, tables, onClose }: { server: PgServer; database: string; tables: PgTable[]; onClose: () => void }) {
  const toast = useToast();
  const { startSeed, activeJob } = useSeed();
  const [rows, setRows] = useState(50);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [showExclude, setShowExclude] = useState(false);
  const [starting, setStarting] = useState(false);
  const [projectPrompt, setProjectPrompt] = useState("");
  const [aiApiKey, setAiApiKey] = useState<string | null>(null);

  useEffect(() => {
    fetchIntegrations().then((i) => setAiApiKey(i?.anthropic_api_key || null));
  }, []);

  const groups = useMemo(() => {
    const map: Record<string, PgTable[]> = {};
    for (const t of tables) (map[t.schema] ||= []).push(t);
    return Object.entries(map);
  }, [tables]);

  function toggle(key: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function start() {
    if (rows < 1) { toast("Rows per table must be at least 1."); return; }
    setStarting(true);
    const excludeTables = [...excluded].map((k) => {
      const [schema, name] = k.split(".");
      return { schema, name };
    });
    const r = await startSeed(server, database, rows, excludeTables, projectPrompt, aiApiKey || undefined);
    setStarting(false);
    if (!r.ok) { toast(`Couldn't start seeding: ${r.error}`); return; }
    toast(`Seeding ${database}…`);
    onClose();
  }

  const busy = activeJob?.status === "running";

  return (
    <Modal onClose={onClose} style={{ width: 460 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ color: "var(--mint)" }}><Icon name="sparkles" size={18} /></span>Seed dummy data
        </h3>
        <button className="iconbtn" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 8 }}>
        Inserts realistic-looking rows into <span className="mono">{database}</span>, respecting keys and
        foreign keys already defined in the schema.
      </p>

      <div className="dk-field" style={{ marginTop: 16 }}>
        <label>Rows per table</label>
        <input
          className="dk-in mono" type="number" min={1} max={MAX_ROWS_PER_TABLE} value={rows}
          onChange={(e) => setRows(Math.max(1, Math.min(MAX_ROWS_PER_TABLE, Number(e.target.value) || 1)))}
        />
        {rows > 500 && <div className="seed-warn">Large batches take longer — the progress bar will show live status.</div>}
      </div>

      <div className="dk-field" style={{ marginTop: 14 }}>
        <label>Describe your project (optional)</label>
        <textarea
          className="dk-in" rows={3}
          style={{ height: "auto", minHeight: 64, padding: "8px 11px", resize: "vertical", fontFamily: "inherit", lineHeight: 1.4 }}
          placeholder="e.g. a restaurant delivery app with restaurants, menu items and orders"
          value={projectPrompt} onChange={(e) => setProjectPrompt(e.target.value)}
          disabled={!aiApiKey}
        />
        <div className="seed-note" style={{ marginTop: 6 }}>
          <Icon name="sparkles" size={14} />
          {aiApiKey
            ? <span>Claude will suggest domain-specific values for columns like status, category or type.</span>
            : <span>Add an Anthropic API key in Settings → AI-assisted seeding to enable this.</span>}
        </div>
      </div>

      <div className="seed-toggle" onClick={() => setShowExclude((o) => !o)}>
        <Icon name={showExclude ? "chevD" : "chevR"} size={11} />
        Exclude tables{excluded.size > 0 ? ` (${excluded.size})` : ""}
      </div>
      {showExclude && (
        <div className="seed-exclude" style={{ marginTop: 8 }}>
          {groups.map(([schema, list]) => (
            <div key={schema}>
              <div className="seed-exclude-group">{schema}</div>
              {list.map((t) => {
                const key = `${t.schema}.${t.name}`;
                return (
                  <label key={key} className="seed-exclude-row">
                    <input type="checkbox" checked={excluded.has(key)} onChange={() => toggle(key)} />
                    <span className="mono">{t.name}</span>
                  </label>
                );
              })}
            </div>
          ))}
          {groups.length === 0 && <div style={{ padding: 10, color: "var(--dim)", fontSize: 12 }}>No tables found.</div>}
        </div>
      )}

      <div className="seed-note">
        <Icon name="check" size={14} />
        <span>Only inserts new rows — existing data is never modified or deleted.</span>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn accent" disabled={starting || busy} onClick={start}>
          {starting ? <><Icon name="loader" size={14} className="spin" />Starting…</> : busy ? "A job is already running" : <><Icon name="sparkles" size={14} />Start seeding</>}
        </button>
      </div>
    </Modal>
  );
}
