import { Icon } from "../lib/icons";
import { diffSchemas } from "../lib/pgDiff";
import type { PgSchema } from "../lib/pg";

/** Client-side diff over two /pg/schema snapshots — see src/lib/pgDiff.ts. Transient: the "before" snapshot lives only in Postgres.tsx's component state, not a stored history feature. */
export function SchemaDiffView({ snapshot, current, onSnapshot, onClear }: {
  snapshot: PgSchema | null; current: PgSchema | null; onSnapshot: () => void; onClear: () => void;
}) {
  if (!current) return <div style={{ padding: 20, color: "var(--dim)" }}>Loading schema…</div>;

  if (!snapshot) {
    return (
      <div style={{ padding: 20 }}>
        <div className="eyebrow">Schema diff</div>
        <p style={{ marginTop: 10, color: "var(--muted)", fontSize: 13, maxWidth: 480 }}>Take a snapshot of the current schema, make your changes, then come back here to see exactly which tables and columns changed.</p>
        <button className="btn accent" style={{ marginTop: 12 }} onClick={onSnapshot}><Icon name="db" size={14} />Take snapshot</button>
      </div>
    );
  }

  const diffs = diffSchemas(snapshot, current);
  return (
    <div style={{ padding: 20, overflowY: "auto", height: "100%" }}>
      <div className="rowhead" style={{ alignItems: "center" }}>
        <div className="eyebrow" style={{ margin: 0 }}>{diffs.length === 0 ? "No changes since the snapshot" : `${diffs.length} table${diffs.length === 1 ? "" : "s"} changed`}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn ghost" onClick={onSnapshot}><Icon name="refresh" size={13} />Re-snapshot from now</button>
          <button className="btn ghost" onClick={onClear}><Icon name="x" size={13} />Clear</button>
        </div>
      </div>

      {diffs.length > 0 && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          {diffs.map((d) => (
            <div key={d.key} className="card" style={{ padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--mono)", fontSize: 13 }}>
                <span className={"pill" + (d.status === "added" ? " live" : d.status === "changed" ? " warn" : "")} style={d.status === "removed" ? { color: "var(--red)" } : undefined}>
                  {d.status}
                </span>
                {d.key}
              </div>
              {d.addedColumns.map((c) => <div key={`a-${c.name}`} className="mono" style={{ fontSize: 12, color: "var(--mint)", marginTop: 6 }}>+ {c.name} {c.type}</div>)}
              {d.removedColumns.map((c) => <div key={`r-${c.name}`} className="mono" style={{ fontSize: 12, color: "var(--red)", marginTop: 6 }}>- {c.name} {c.type}</div>)}
              {d.changedColumns.map((c) => (
                <div key={`c-${c.name}`} className="mono" style={{ fontSize: 12, color: "var(--amber)", marginTop: 6 }}>
                  ~ {c.name}: {c.from.type}{c.from.nullable ? " (nullable)" : ""} → {c.to.type}{c.to.nullable ? " (nullable)" : ""}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
