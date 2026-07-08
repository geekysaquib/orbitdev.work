import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../lib/icons";
import { ACCENT, OrbitLoader, Empty, SetupRequired } from "../components/ui";
import { useToast } from "../context/Toast";
import { useAgent } from "../context/Agent";
import { PgServerModal } from "../components/PgServerModal";
import {
  pgServers, pgDeleteServer, pgDatabases, pgTables, pgQuery,
  type PgServer, type PgResult, type PgTable,
} from "../lib/pg";

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

export default function Postgres() {
  const toast = useToast();
  const { status } = useAgent();
  const agentDown = status !== "online";

  const [servers, setServers] = useState<PgServer[]>([]);
  const [loadingS, setLoadingS] = useState(true);
  const [selId, setSelId] = useState("");
  const [dbs, setDbs] = useState<string[]>([]);
  const [loadingDb, setLoadingDb] = useState(false);
  const [db, setDb] = useState("");
  const [sql, setSql] = useState("SELECT table_schema, table_name\nFROM information_schema.tables\nWHERE table_schema NOT IN ('pg_catalog','information_schema')\nORDER BY 1, 2\nLIMIT 100;");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PgResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [tables, setTables] = useState<PgTable[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [tableQuery, setTableQuery] = useState("");
  const [activeTable, setActiveTable] = useState("");

  const sel = useMemo(() => servers.find((s) => s.id === selId), [servers, selId]);
  const grouped = useMemo(() => {
    const q = tableQuery.trim().toLowerCase();
    const map: Record<string, PgTable[]> = {};
    for (const t of tables) {
      if (q && !`${t.schema}.${t.name}`.toLowerCase().includes(q)) continue;
      (map[t.schema] ||= []).push(t);
    }
    return map;
  }, [tables, tableQuery]);

  async function loadServers(preferId?: string) {
    setLoadingS(true);
    const r = await pgServers();
    setServers(r.servers);
    setLoadingS(false);
    if (!r.ok) { toast(r.error || "Couldn't reach the agent"); return; }
    const next = preferId || selId || r.servers[0]?.id || "";
    setSelId(r.servers.some((s) => s.id === next) ? next : (r.servers[0]?.id || ""));
  }
  useEffect(() => { if (!agentDown) loadServers(); else setLoadingS(false); }, [status]); // eslint-disable-line

  useEffect(() => {
    if (!selId) { setDbs([]); setDb(""); return; }
    setLoadingDb(true); setDbs([]); setResult(null); setError(null);
    pgDatabases(selId).then((r) => {
      setDbs(r.databases);
      const server = servers.find((s) => s.id === selId);
      setDb(server?.database && r.databases.includes(server.database) ? server.database : r.databases[0] || "");
      if (!r.ok) toast(r.error || "Couldn't list databases");
    }).finally(() => setLoadingDb(false));
  }, [selId]); // eslint-disable-line

  // Load the table catalogue whenever the selected database changes.
  useEffect(() => {
    if (!selId || !db) { setTables([]); return; }
    setLoadingTables(true); setActiveTable("");
    pgTables(selId, db).then((r) => { setTables(r.tables); if (!r.ok) toast(r.error || "Couldn't list tables"); }).finally(() => setLoadingTables(false));
  }, [selId, db]); // eslint-disable-line

  async function run(text?: string) {
    const q = (text ?? sql).trim();
    if (!selId || !db) { toast("Pick a server and database first."); return; }
    if (!q) return;
    setRunning(true); setError(null); setResult(null);
    const r = await pgQuery(selId, db, q);
    setRunning(false);
    if (r.ok && r.result) setResult(r.result); else setError(r.error || "Query failed");
  }
  function openTable(t: PgTable) {
    const s = `SELECT * FROM "${t.schema}"."${t.name}" LIMIT 100;`;
    setSql(s);
    setActiveTable(`${t.schema}.${t.name}`);
    run(s);
  }
  async function removeServer(s: PgServer) {
    await pgDeleteServer(s.id);
    if (selId === s.id) { setSelId(""); setResult(null); setError(null); }
    loadServers();
    toast(`Removed ${s.name}`);
  }

  if (agentDown) return (
    <main className="page">
      <div className="h1">Postgres</div>
      <SetupRequired icon="zap" title="Start the ORBIT agent" sub="Postgres runs through the local agent on your machine. Start it, or set its URL in Settings." cta="Agent settings" to="/settings" />
    </main>
  );

  return (
    <main className="page" style={{ padding: 0, display: "flex", overflow: "hidden" }}>
      {/* servers */}
      <div className="pg-servers">
        <div className="rowhead">
          <div className="h2">Servers</div>
          <button className="iconbtn" title="Add server" onClick={() => setAddOpen(true)}><Icon name="plus" size={16} /></button>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--dim)", marginTop: 6 }}>Postgres connections on this machine</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 16 }}>
          {loadingS && <OrbitLoader label="Loading servers…" size={22} />}
          {!loadingS && servers.length === 0 && <Empty icon="db" title="No servers yet" sub="Add a Postgres connection to get started." mini />}
          {servers.map((s) => (
            <div key={s.id} className="pg-srow" style={s.id === selId ? { background: "var(--raised)", borderColor: "var(--border)" } : {}} onClick={() => setSelId(s.id)}>
              <span style={{ color: s.id === selId ? "var(--mint)" : "var(--dim)" }}><Icon name="db" size={15} /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontFamily: "var(--display)", fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.user}@{s.host}:{s.port}</div>
              </div>
              <button className="pg-srow-x" title="Remove" onClick={(e) => { e.stopPropagation(); removeServer(s); }}><Icon name="x" size={13} /></button>
            </div>
          ))}
        </div>

        {sel && (
          <div className="pg-tables">
            <div className="pg-tables-head">
              <span>Tables</span>
              <span className="mono" title="Selected database">{db || "—"}</span>
            </div>
            {tables.length > 6 && (
              <div className="pg-tsearch"><Icon name="search" size={12} /><input value={tableQuery} onChange={(e) => setTableQuery(e.target.value)} placeholder="Filter tables…" /></div>
            )}
            <div className="pg-tlist">
              {loadingTables ? <div style={{ padding: "16px 0" }}><OrbitLoader label="Loading tables…" size={20} /></div>
                : tables.length === 0 ? <div className="pg-tempty">No tables in this database.</div>
                : Object.keys(grouped).length === 0 ? <div className="pg-tempty">No tables match.</div>
                : Object.entries(grouped).map(([schema, list]) => (
                  <div key={schema} className="pg-tgroup">
                    <div className="pg-tschema">{schema} <span>{list.length}</span></div>
                    {list.map((t) => (
                      <button key={`${t.schema}.${t.name}`} className={"pg-titem" + (activeTable === `${t.schema}.${t.name}` ? " on" : "")} onClick={() => openTable(t)} title={`SELECT * FROM ${t.schema}.${t.name}`}>
                        <Icon name={t.type === "VIEW" ? "layers" : "boxes"} size={12} />
                        <span className="mono">{t.name}</span>
                      </button>
                    ))}
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
      <div className="pg-main">
        {!sel ? (
          <div className="pg-none"><Icon name="db" size={40} /><p>Select a server to browse its databases and run queries.</p></div>
        ) : (
          <>
            <div className="pg-head">
              <div>
                <div className="h1" style={{ fontSize: 21 }}>{sel.name}</div>
                <div className="sub" style={{ marginTop: 3 }}>{sel.user}@{sel.host}:{sel.port}{sel.ssl ? " · SSL" : ""}</div>
              </div>
              <DbSelect dbs={dbs} value={db} loading={loadingDb} onChange={setDb} />
            </div>

            <div className="pg-editor">
              <textarea
                value={sql} spellCheck={false}
                onChange={(e) => setSql(e.target.value)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); run(); } }}
                placeholder="SELECT * FROM …"
              />
              <div className="pg-editor-foot">
                <span className="dk-hint">Runs on <span className="mono">{db || "—"}</span> · <kbd>⌘/Ctrl</kbd> + <kbd>Enter</kbd> to run · results capped at 1000 rows</span>
                <button className="btn accent" disabled={running || !db} onClick={() => run()}>
                  {running ? <><Icon name="loader" size={14} className="spin" />Running…</> : <><Icon name="play" size={13} fill />Run</>}
                </button>
              </div>
            </div>

            <div className="pg-results">
              {running ? <div className="page-loader"><OrbitLoader label="Running query…" /></div>
                : error ? (
                  <div className="pg-error"><Icon name="plug" size={16} /><div><div style={{ fontWeight: 600, marginBottom: 4 }}>Query failed</div><div className="mono" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{error}</div></div></div>
                ) : !result ? (
                  <Empty icon="db" title="No results yet" sub="Write a query above and hit Run." mini />
                ) : result.fields.length === 0 ? (
                  <div className="pg-ok"><span style={{ color: ACCENT.mint, display: "inline-flex" }}><Icon name="check" size={16} /></span><span>{result.command || "OK"} · {result.rowCount} row{result.rowCount === 1 ? "" : "s"} affected · {result.ms} ms</span></div>
                ) : (
                  <>
                    <div className="pg-meta"><span>{result.rows.length} row{result.rows.length === 1 ? "" : "s"}{result.truncated ? " (capped at 1000)" : ""}</span><span>{result.ms} ms</span></div>
                    <div className="pg-tablewrap">
                      <table className="pg-table">
                        <thead><tr>{result.fields.map((f) => <th key={f}>{f}</th>)}</tr></thead>
                        <tbody>
                          {result.rows.map((row, i) => (
                            <tr key={i}>{result.fields.map((f) => {
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
          </>
        )}
      </div>

      {addOpen && <PgServerModal onClose={() => setAddOpen(false)} onAdded={(id) => { setAddOpen(false); loadServers(id); }} />}
    </main>
  );
}

function DbSelect({ dbs, value, loading, onChange }: { dbs: string[]; value: string; loading: boolean; onChange: (d: string) => void }) {
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
    <div className="pg-dbpick" ref={ref}>
      <button className="pg-dbbtn" onClick={() => { setOpen((o) => !o); setQ(""); }} disabled={loading || dbs.length === 0}>
        <Icon name="boxes" size={14} />
        <span className="mono">{loading ? "Loading databases…" : (value || "No databases")}</span>
        <Icon name="chevD" size={13} />
      </button>
      {open && (
        <div className="pg-dbmenu">
          {dbs.length > 8 && (
            <div className="pg-dbsearch"><Icon name="search" size={12} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" /></div>
          )}
          <div className="pg-dblist">
            {filtered.map((d) => (
              <button key={d} className={"pg-dbitem" + (d === value ? " on" : "")} onClick={() => { onChange(d); setOpen(false); }}>
                <Icon name="db" size={13} /><span className="mono">{d}</span>
                {d === value && <Icon name="check" size={13} />}
              </button>
            ))}
            {filtered.length === 0 && <div className="pg-dbempty">No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}
