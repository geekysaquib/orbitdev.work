import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Icon } from "../lib/icons";
import { ACCENT, Empty, OrbitLoader, SetupRequired } from "../components/ui";
import { useToast } from "../context/Toast";
import { useAgent } from "../context/Agent";
import { PgServerModal } from "../components/PgServerModal";
import { CreateDatabaseModal } from "../components/CreateDatabaseModal";
import { SchemaDiagram } from "../components/SchemaDiagram";
import { SeedDataModal } from "../components/SeedDataModal";
import {
  pgServers, pgDeleteServer, pgDatabases, pgTables, pgQuery, pgSchema,
  pgBackup, pgBackupAvailable,
  type PgServer, type PgResult, type PgTable, type PgSchema,
} from "../lib/pg";
import { SchemaDiffView } from "../components/SchemaDiffView";

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

const SCHEMA_COLORS = [ACCENT.violet, ACCENT.blue, ACCENT.amber, ACCENT.mint, ACCENT.red];
function schemaColor(schema: string) {
  let h = 0;
  for (let i = 0; i < schema.length; i++) h = (h * 31 + schema.charCodeAt(i)) >>> 0;
  return SCHEMA_COLORS[h % SCHEMA_COLORS.length];
}

interface Tab {
  id: string;
  schema: string | null;
  table: string | null;
  query: string;
  hasRun: boolean;
  running: boolean;
  result: PgResult | null;
  error: string | null;
}

export default function Postgres() {
  const toast = useToast();
  const { status } = useAgent();
  const agentDown = status !== "online";
  const [params, setParams] = useSearchParams();

  const [servers, setServers] = useState<PgServer[]>([]);
  const [loadingS, setLoadingS] = useState(true);
  const [selId, setSelId] = useState("");
  const [dbs, setDbs] = useState<string[]>([]);
  const [loadingDb, setLoadingDb] = useState(false);
  const [db, setDb] = useState("");
  const [tables, setTables] = useState<PgTable[]>([]);
  const [schema, setSchema] = useState<PgSchema | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [createDbOpen, setCreateDbOpen] = useState(false);
  const [seedOpen, setSeedOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<PgServer | null>(null);
  const [mode, setMode] = useState<"query" | "diagram" | "diff">("query");
  const [schemaSnapshot, setSchemaSnapshot] = useState<PgSchema | null>(null);
  const [backupAvailable, setBackupAvailable] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  useEffect(() => { pgBackupAvailable().then(setBackupAvailable); }, []);

  async function doBackup() {
    if (!sel || !db || backingUp) return;
    setBackingUp(true);
    const r = await pgBackup(sel, db);
    setBackingUp(false);
    if (!r.ok || !r.blob) { toast(`Backup failed: ${r.error}`); return; }
    const url = URL.createObjectURL(r.blob);
    const a = document.createElement("a");
    a.href = url; a.download = r.filename || `${db}.sql`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Backed up ${db}`);
  }

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteActive, setPaletteActive] = useState(0);
  const paletteInputRef = useRef<HTMLInputElement>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId) || null;
  const sel = servers.find((s) => s.id === selId) || null;

  async function loadServers(preferId?: string) {
    setLoadingS(true);
    const r = await pgServers();
    setServers(r.servers);
    setLoadingS(false);
    if (!r.ok) { toast(r.error || "Couldn't load your saved servers"); return; }
    const next = preferId || selId || r.servers[0]?.id || "";
    setSelId(r.servers.some((s) => s.id === next) ? next : (r.servers[0]?.id || ""));
  }
  useEffect(() => { loadServers(); }, []); // eslint-disable-line

  async function loadDbs(preferDb?: string) {
    if (!sel) { setDbs([]); setDb(""); return; }
    setLoadingDb(true); setDbs([]);
    const r = await pgDatabases(sel);
    setDbs(r.databases);
    setDb(preferDb && r.databases.includes(preferDb) ? preferDb : sel.database && r.databases.includes(sel.database) ? sel.database : r.databases[0] || "");
    if (!r.ok) toast(r.error || "Couldn't list databases");
    setLoadingDb(false);
  }
  useEffect(() => { loadDbs(); }, [selId]); // eslint-disable-line

  // Table catalogue (for the find-table palette + table picker) and full schema (for the column inspector).
  useEffect(() => {
    setTabs([]); setActiveTabId(null); setInspectorOpen(false);
    setSchemaSnapshot(null); // a snapshot from a different server/db wouldn't mean anything to diff against
    if (!sel || !db) { setTables([]); setSchema(null); return; }
    const wantsNew = params.get("new") === "1";
    if (wantsNew) setParams((p) => { p.delete("new"); return p; }, { replace: true });
    pgTables(sel, db).then((r) => {
      setTables(r.tables);
      if (!r.ok) toast(r.error || "Couldn't list tables");
      else if (wantsNew) addBlankTab();
      else if (r.tables.length > 0) addTab(r.tables[0]); // default to the first table so the view isn't empty
    });
    pgSchema(sel, db).then((r) => { if (r.ok) setSchema(r.schema || null); });
  }, [selId, db]); // eslint-disable-line

  // Re-fetch the live schema each time Diff mode is opened, so "current" reflects
  // anything changed since the last time (not just since the last server/db switch).
  useEffect(() => {
    if (mode === "diff" && sel && db) pgSchema(sel, db).then((r) => { if (r.ok) setSchema(r.schema || null); });
  }, [mode]); // eslint-disable-line

  function patchTab(id: string, patch: Partial<Tab>) {
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  /** Opens (or focuses) a tab for the table, without touching the current mode. */
  function addTab(t: PgTable) {
    setTabs((ts) => {
      const existing = ts.find((x) => x.schema === t.schema && x.table === t.name);
      if (existing) { setActiveTabId(existing.id); return ts; }
      const id = "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const query = `SELECT * FROM "${t.schema}"."${t.name}" LIMIT 100;`;
      setActiveTabId(id);
      return [...ts, { id, schema: t.schema, table: t.name, query, hasRun: false, running: false, result: null, error: null }];
    });
  }
  function openTable(t: PgTable) {
    setMode("query");
    addTab(t);
    setPaletteOpen(false);
  }
  /** Opens a fresh, unbound query tab (e.g. for CREATE TABLE on an empty database). */
  function addBlankTab() {
    const id = "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    setMode("query");
    setActiveTabId(id);
    setTabs((ts) => [...ts, { id, schema: null, table: null, query: "", hasRun: false, running: false, result: null, error: null }]);
  }
  function closeTab(id: string, e?: { stopPropagation: () => void }) {
    e?.stopPropagation();
    setTabs((ts) => {
      const idx = ts.findIndex((t) => t.id === id);
      const next = ts.filter((t) => t.id !== id);
      if (activeTabId === id) {
        const nb = next[idx] || next[idx - 1];
        setActiveTabId(nb ? nb.id : null);
      }
      return next;
    });
  }
  async function runQuery(tab: Tab) {
    if (!sel || !db) { toast("Pick a server and database first."); return; }
    const q = tab.query.trim();
    if (!q) return;
    patchTab(tab.id, { running: true });
    const r = await pgQuery(sel, db, q);
    if (r.ok && r.result) patchTab(tab.id, { running: false, hasRun: true, result: r.result, error: null });
    else patchTab(tab.id, { running: false, hasRun: true, result: null, error: r.error || "Query failed" });
  }
  async function removeServer(s: PgServer) {
    const r = await pgDeleteServer(s.id);
    if (!r.ok) { toast(`Couldn't remove ${s.name}: ${r.error}`); return; }
    if (selId === s.id) setSelId("");
    loadServers();
    toast(`Removed ${s.name}`);
  }

  // Find-table palette (⌘T)
  const paletteGroups = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase();
    const map: Record<string, PgTable[]> = {};
    for (const t of tables) {
      if (q && !`${t.schema}.${t.name}`.toLowerCase().includes(q)) continue;
      (map[t.schema] ||= []).push(t);
    }
    return Object.entries(map);
  }, [tables, paletteQuery]);
  const paletteFlat = useMemo(() => paletteGroups.flatMap(([, list]) => list), [paletteGroups]);
  useEffect(() => { setPaletteActive(0); }, [paletteQuery, paletteOpen]);
  useEffect(() => { if (paletteOpen) paletteInputRef.current?.focus(); }, [paletteOpen]);
  useEffect(() => {
    function h(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "t") { e.preventDefault(); setPaletteOpen(true); return; }
      if (!paletteOpen) return;
      if (e.key === "Escape") setPaletteOpen(false);
      else if (e.key === "ArrowDown") { e.preventDefault(); setPaletteActive((a) => Math.min(paletteFlat.length - 1, a + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setPaletteActive((a) => Math.max(0, a - 1)); }
      else if (e.key === "Enter") { e.preventDefault(); const t = paletteFlat[paletteActive]; if (t) openTable(t); }
    }
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [paletteOpen, paletteFlat, paletteActive]); // eslint-disable-line

  const schemaTable = activeTab && schema ? schema.tables.find((t) => t.schema === activeTab.schema && t.name === activeTab.table) : null;

  return (
    <main className="page" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div className="pg-toolbar">
        <ServerPicker servers={servers} value={selId} loading={loadingS} onChange={setSelId} onAdd={() => setAddOpen(true)} onEdit={setEditingServer} onRemove={removeServer} />
        <span className="pg-sep">/</span>
        <DbPicker dbs={dbs} value={db} loading={loadingDb} onChange={setDb} onAdd={() => sel && setCreateDbOpen(true)} />
        <span className="pg-sep">/</span>
        <TablePicker tables={tables} value={activeTab?.schema && activeTab.table ? `${activeTab.schema}.${activeTab.table}` : null} onChange={openTable} />
        <div className="pg-modetabs">
          <button className={"pg-modetab" + (mode === "query" ? " on" : "")} onClick={() => setMode("query")}><Icon name="terminal" size={13} />Query</button>
          <button className={"pg-modetab" + (mode === "diagram" ? " on" : "")} onClick={() => setMode("diagram")}><Icon name="layers" size={13} />Diagram</button>
          <button className={"pg-modetab" + (mode === "diff" ? " on" : "")} onClick={() => setMode("diff")}><Icon name="activity" size={13} />Diff</button>
        </div>
        <div style={{ flex: 1 }} />
        {sel && db && backupAvailable && (
          <button className="pg-findbtn" disabled={backingUp} onClick={doBackup}>
            {backingUp ? <Icon name="loader" size={14} className="spin" /> : <Icon name="download" size={14} />}Backup
          </button>
        )}
        {sel && db && (
          <button className="pg-findbtn" onClick={() => setSeedOpen(true)}>
            <Icon name="sparkles" size={14} />Seed dummy data
          </button>
        )}
        {mode === "query" && sel && db && (
          <button className="pg-findbtn" onClick={addBlankTab}>
            <Icon name="plus" size={14} />New query
          </button>
        )}
        {mode === "query" && (
          <button className="pg-findbtn" onClick={() => setPaletteOpen(true)}>
            <Icon name="search" size={14} />Find table<kbd>⌘T</kbd>
          </button>
        )}
      </div>

      {mode === "query" && tabs.length > 0 && (
        <div className="pg-tabstrip">
          {tabs.map((t) => (
            <div key={t.id} className={"pg-tab" + (t.id === activeTabId ? " on" : "")} onClick={() => setActiveTabId(t.id)}>
              <span className="pg-tab-dot" style={{ background: t.schema ? schemaColor(t.schema) : "var(--dim)" }} />
              <span className="mono">{t.table || "New query"}</span>
              <button className="pg-tab-x" onClick={(e) => closeTab(t.id, e)}><Icon name="x" size={11} /></button>
            </div>
          ))}
          <button className="pg-tab-add" title="New query" onClick={addBlankTab}><Icon name="plus" size={14} /></button>
        </div>
      )}

      {loadingS ? (
        <div className="page-loader"><OrbitLoader label="Loading servers…" /></div>
      ) : !selId ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <SetupRequired icon="db" title="No Postgres servers yet" sub="Add a connection to start browsing tables and running queries." cta="Add server" onCta={() => setAddOpen(true)} />
        </div>
      ) : agentDown ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <SetupRequired icon="zap" title="Start the ORBIT agent" sub="Your machines are saved — browsing tables and running queries just needs the local agent running too." cta="Agent settings" to="/settings" />
        </div>
      ) : !db ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Empty icon="db" title="No databases" sub="This server has no databases, or they haven't loaded yet." />
        </div>
      ) : !sel ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <OrbitLoader label="Loading server…" />
        </div>
      ) : mode === "diagram" ? (
        <SchemaDiagram server={sel} database={db} />
      ) : mode === "diff" ? (
        <SchemaDiffView
          snapshot={schemaSnapshot} current={schema}
          onSnapshot={() => setSchemaSnapshot(schema)}
          onClear={() => setSchemaSnapshot(null)}
        />
      ) : !activeTab ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <SetupRequired
            icon="terminal"
            title="Nothing open"
            sub={tables.length > 0 ? "Search for a table to start querying it, or start a blank query." : "This database has no tables yet — start a blank query to create one."}
            cta="New query"
            onCta={addBlankTab}
          />
        </div>
      ) : (
        <div className="pg-content">
          <div className="pg-tabhead">
            <div>
              <h2 className="pg-tabtitle">{activeTab.schema && activeTab.table ? `${activeTab.schema}.${activeTab.table}` : "New query"}</h2>
              <p className="pg-tabsub">{activeTab.hasRun ? `Query executed against ${db}` : `Not run yet · ${db}`}</p>
            </div>
            {activeTab.schema && activeTab.table && (
              <button className={"pg-colbtn" + (inspectorOpen ? " on" : "")} onClick={() => setInspectorOpen((o) => !o)}>
                <Icon name="grid" size={13} />Columns
              </button>
            )}
          </div>

          <div className="pg-editor2">
            <textarea
              value={activeTab.query} spellCheck={false}
              onChange={(e) => patchTab(activeTab.id, { query: e.target.value })}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); runQuery(activeTab); } }}
            />
          </div>
          <div className="pg-editor-foot2">
            <span className="dk-hint"><kbd>⌘/Ctrl</kbd> + <kbd>Enter</kbd> to run · results capped at 1000 rows</span>
            <button className="btn-primary" disabled={activeTab.running} onClick={() => runQuery(activeTab)}>
              {activeTab.running ? <><Icon name="loader" size={13} className="spin" />Running…</> : <><Icon name="play" size={12} fill />Run query</>}
            </button>
          </div>

          <div className="pg-body">
            <div className="pg-resultswrap">
              {activeTab.error ? (
                <div className="pg-error"><Icon name="plug" size={16} /><div><div style={{ fontWeight: 600, marginBottom: 4 }}>Query failed</div><div className="mono" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{activeTab.error}</div></div></div>
              ) : !activeTab.hasRun ? (
                <div className="pg-norun"><Icon name="play" size={22} /><span>Run the query to see results</span></div>
              ) : !activeTab.result ? null : activeTab.result.fields.length === 0 ? (
                <div className="pg-ok"><span style={{ color: ACCENT.mint, display: "inline-flex" }}><Icon name="check" size={16} /></span><span>{activeTab.result.command || "OK"} · {activeTab.result.rowCount} row{activeTab.result.rowCount === 1 ? "" : "s"} affected · {activeTab.result.ms} ms</span></div>
              ) : (
                <>
                  <div className="pg-meta2">
                    <span>{activeTab.result.rows.length} row{activeTab.result.rows.length === 1 ? "" : "s"}{activeTab.result.truncated ? " (capped at 1000)" : ""}</span>
                    <span>·</span>
                    <span style={{ color: "var(--mint)" }}>ran in {activeTab.result.ms}ms</span>
                  </div>
                  <div className="pg-tablewrap">
                    <table className="pg-table">
                      <thead><tr>{activeTab.result.fields.map((f) => <th key={f}>{f}</th>)}</tr></thead>
                      <tbody>
                        {activeTab.result.rows.map((row, i) => (
                          <tr key={i}>{activeTab.result!.fields.map((f) => {
                            const v = row[f];
                            return <td key={f} className={v === null || v === undefined ? "pg-null" : ""}>{v === null || v === undefined ? "NULL" : cell(v)}</td>;
                          })}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            {inspectorOpen && activeTab.schema && activeTab.table && (
              <div className="pg-inspector">
                <div className="pg-inspector-head">COLUMNS</div>
                {schemaTable ? schemaTable.columns.map((c) => (
                  <div key={c.name} className="pg-inspector-row">
                    <span className="pg-inspector-name">{c.isPrimaryKey && <span style={{ color: "var(--mint)", flexShrink: 0, display: "inline-flex" }}><Icon name="key" size={10} /></span>}{c.name}</span>
                    <span className="pg-inspector-type">{c.type}</span>
                  </div>
                )) : (
                  <p className="pg-inspector-empty">Couldn't load columns for this table.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {paletteOpen && (
        <div className="cmdk-bg" onClick={(e) => e.target === e.currentTarget && setPaletteOpen(false)}>
          <div className="cmdk">
            <div className="cmdk-input">
              <Icon name="search" size={16} />
              <input ref={paletteInputRef} value={paletteQuery} onChange={(e) => setPaletteQuery(e.target.value)} placeholder="Find a table across every schema…" />
              <kbd style={{ color: "var(--dim)", fontSize: 11 }}>ESC</kbd>
            </div>
            <div className="cmdk-list">
              {paletteFlat.length === 0 && <div className="cmdk-empty">{tables.length === 0 ? "No tables in this database." : `No matches for “${paletteQuery}”.`}</div>}
              {paletteGroups.map(([schemaName, list]) => (
                <div key={schemaName}>
                  <div className="cmdk-sec">{schemaName.toUpperCase()}</div>
                  {list.map((t) => {
                    const isOpen = tabs.some((tb) => tb.schema === t.schema && tb.table === t.name);
                    return (
                      <div key={`${t.schema}.${t.name}`} className={"cmdk-item" + (paletteFlat[paletteActive] === t ? " on" : "")}
                        onMouseEnter={() => setPaletteActive(paletteFlat.indexOf(t))} onClick={() => openTable(t)}>
                        <span className="ci-ic"><Icon name={t.type === "VIEW" ? "layers" : "boxes"} size={15} /></span>
                        <span className="mono">{t.name}</span>
                        {isOpen && <span className="ci-hint" style={{ color: "var(--mint)" }}>OPEN</span>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {seedOpen && sel && db && <SeedDataModal server={sel} database={db} tables={tables} onClose={() => setSeedOpen(false)} />}
      {createDbOpen && sel && (
        <CreateDatabaseModal server={sel} onClose={() => setCreateDbOpen(false)} onCreated={(name) => { setCreateDbOpen(false); loadDbs(name); }} />
      )}
      {addOpen && <PgServerModal onClose={() => setAddOpen(false)} onSaved={(id) => { setAddOpen(false); loadServers(id); }} />}
      {editingServer && (
        <PgServerModal editing={editingServer} onClose={() => setEditingServer(null)} onSaved={(id) => { setEditingServer(null); loadServers(id); }} />
      )}
    </main>
  );
}

function ServerPicker({ servers, value, loading, onChange, onAdd, onEdit, onRemove }: {
  servers: PgServer[]; value: string; loading: boolean; onChange: (id: string) => void; onAdd: () => void; onEdit: (s: PgServer) => void; onRemove: (s: PgServer) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const active = servers.find((s) => s.id === value);
  return (
    <div className="pg-pick" ref={ref}>
      <button className="pg-pickbtn" onClick={() => setOpen((o) => !o)} disabled={loading}>
        <span className="pg-pickdot" style={{ background: active ? "var(--mint)" : "var(--dim)" }} />
        <span>{loading ? "Loading…" : active ? active.name : "No servers"}</span>
        <Icon name="chevD" size={11} />
      </button>
      {open && (
        <div className="pg-pickmenu">
          {loading ? <div style={{ padding: 16 }}><OrbitLoader label="Loading…" size={20} /></div> : (
            <>
              {servers.map((s) => (
                <div key={s.id} className="pg-pickrow" onClick={() => { onChange(s.id); setOpen(false); }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="pg-pickrow-name">{s.name}</div>
                    <div className="pg-pickrow-conn mono">{s.user}@{s.host}:{s.port}</div>
                  </div>
                  <button className="pg-pickrow-x edit" title="Edit" onClick={(e) => { e.stopPropagation(); setOpen(false); onEdit(s); }}><Icon name="edit" size={12} /></button>
                  <button className="pg-pickrow-x" title="Remove" onClick={(e) => { e.stopPropagation(); onRemove(s); }}><Icon name="x" size={12} /></button>
                </div>
              ))}
              <button className="pg-pickadd" onClick={() => { setOpen(false); onAdd(); }}><Icon name="plus" size={13} />Add machine</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DbPicker({ dbs, value, loading, onChange, onAdd }: { dbs: string[]; value: string; loading: boolean; onChange: (d: string) => void; onAdd: () => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const filtered = dbs.filter((d) => d.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="pg-pick" ref={ref}>
      <button className="pg-pickbtn mono" onClick={() => { setOpen((o) => !o); setQ(""); }} disabled={loading}>
        <Icon name="db" size={13} />
        <span>{loading ? "Loading databases…" : (value || "No databases")}</span>
        <Icon name="chevD" size={11} />
      </button>
      {open && (
        <div className="pg-pickmenu" style={{ minWidth: 230 }}>
          {dbs.length > 8 && (
            <div className="pg-picksearch"><Icon name="search" size={12} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" /></div>
          )}
          <div className="pg-pickscroll">
            {filtered.map((d) => (
              <button key={d} className={"pg-pickitem" + (d === value ? " on" : "")} onClick={() => { onChange(d); setOpen(false); }}>
                <Icon name="db" size={13} /><span className="mono">{d}</span>
                {d === value && <Icon name="check" size={13} />}
              </button>
            ))}
            {filtered.length === 0 && <div className="pg-pickempty">No matches</div>}
          </div>
          <button className="pg-pickadd" onClick={() => { setOpen(false); onAdd(); }}><Icon name="plus" size={13} />New database</button>
        </div>
      )}
    </div>
  );
}

function TablePicker({ tables, value, onChange }: { tables: PgTable[]; value: string | null; onChange: (t: PgTable) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const active = tables.find((t) => `${t.schema}.${t.name}` === value) || null;
  const groups = useMemo(() => {
    const query = q.trim().toLowerCase();
    const map: Record<string, PgTable[]> = {};
    for (const t of tables) {
      if (query && !`${t.schema}.${t.name}`.toLowerCase().includes(query)) continue;
      (map[t.schema] ||= []).push(t);
    }
    return Object.entries(map);
  }, [tables, q]);
  return (
    <div className="pg-pick" ref={ref}>
      <button className="pg-pickbtn mono" onClick={() => { setOpen((o) => !o); setQ(""); }} disabled={tables.length === 0}>
        <Icon name={active?.type === "VIEW" ? "layers" : "boxes"} size={13} />
        <span>{active ? active.name : tables.length === 0 ? "No tables" : "Select a table"}</span>
        <Icon name="chevD" size={11} />
      </button>
      {open && (
        <div className="pg-pickmenu" style={{ minWidth: 250 }}>
          {tables.length > 8 && (
            <div className="pg-picksearch"><Icon name="search" size={12} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter tables…" /></div>
          )}
          <div className="pg-pickscroll">
            {groups.map(([schemaName, list]) => (
              <div key={schemaName}>
                <div className="pg-pickgroup">{schemaName}</div>
                {list.map((t) => {
                  const key = `${t.schema}.${t.name}`;
                  return (
                    <button key={key} className={"pg-pickitem" + (key === value ? " on" : "")} onClick={() => { onChange(t); setOpen(false); }}>
                      <Icon name={t.type === "VIEW" ? "layers" : "boxes"} size={13} /><span className="mono">{t.name}</span>
                      {key === value && <Icon name="check" size={13} />}
                    </button>
                  );
                })}
              </div>
            ))}
            {groups.length === 0 && <div className="pg-pickempty">No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}
