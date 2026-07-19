import { useEffect, useState } from "react";
import { Icon } from "../lib/icons";
import { Select } from "../components/Select";
import { ACCENT, Empty } from "../components/ui";
import { fetchAuditLog, type AuditEntry } from "../lib/audit";

const ACTIONS = [
  "sign_in", "sign_out",
  "integration.connect", "integration.disconnect", "integration.update",
  "task.create", "task.update", "task.delete",
  "ticket.create", "ticket.update", "ticket.delete",
  "project.create", "project.update", "project.delete",
  "pg_server.create", "pg_server.update", "pg_server.delete",
  "team.invite", "team.join", "team.remove_member", "team.transfer_ownership",
  "onboarding.completed", "onboarding.skipped",
];
const ENTITY_TYPES = ["session", "integration", "task", "ticket", "project", "pg_server", "team", "onboarding"];
const PAGE_SIZE = 50;

const ACTION_ICON: Record<string, [string, string]> = {
  sign_in: ["zap", ACCENT.mint], sign_out: ["logout", ACCENT.dim],
  "integration.connect": ["plug", ACCENT.mint], "integration.disconnect": ["plug", ACCENT.amber], "integration.update": ["key", ACCENT.blue],
  "onboarding.completed": ["check", ACCENT.mint], "onboarding.skipped": ["chevR", ACCENT.dim],
};
const iconFor = (action: string): [string, string] => {
  if (ACTION_ICON[action]) return ACTION_ICON[action];
  if (action.endsWith(".create")) return ["plus", ACCENT.mint];
  if (action.endsWith(".update")) return ["edit", ACCENT.blue];
  if (action.endsWith(".delete") || action.endsWith("_member")) return ["x", ACCENT.red];
  return ["activity", ACCENT.muted];
};
const actionLabel = (action: string) => action.replace(/[._]/g, " ");
const fmtWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export default function AuditLog() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [action, setAction] = useState("all");
  const [entityType, setEntityType] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAuditLog({
      page, pageSize: PAGE_SIZE,
      action: action === "all" ? undefined : action,
      entityType: entityType === "all" ? undefined : entityType,
    }).then((r) => {
      if (cancelled) return;
      setLoading(false);
      if (r.error) { setError(r.error); return; }
      setError(null);
      setRows(r.rows);
      setTotal(r.total);
    });
    return () => { cancelled = true; };
  }, [page, action, entityType]);

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <main className="page">
      <div className="rowhead">
        <div><div className="h1">Audit log</div><div className="sub">A durable record of sign-ins, integration changes, and work-item edits on your account.</div></div>
      </div>

      <div className="board-filter">
        <Select className="bf-sel" value={action} onChange={(e) => { setAction(e.target.value); setPage(0); }}>
          <option value="all">All actions</option>
          {ACTIONS.map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
        </Select>
        <Select className="bf-sel" value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(0); }}>
          <option value="all">All entity types</option>
          {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
        {(action !== "all" || entityType !== "all") && (
          <button className="bf-clear" onClick={() => { setAction("all"); setEntityType("all"); setPage(0); }}>Clear</button>
        )}
      </div>

      {error && <div style={{ fontSize: 12.5, color: "var(--red)", marginTop: 16 }}>{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div style={{ marginTop: 16 }}>
          <Empty icon="activity" title="Nothing logged yet" sub="Sign-ins, integration changes, and work-item edits will show up here." />
        </div>
      )}
      {(rows.length > 0 || (loading && !error)) && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Action</th><th>Entity</th><th>ID</th><th>When</th></tr></thead>
            <tbody>
              {loading && rows.length === 0 && <tr><td colSpan={4} style={{ color: "var(--dim)" }}>Loading…</td></tr>}
              {rows.map((r) => {
                const [icn, col] = iconFor(r.action);
                return (
                  <tr key={r.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <span style={{ color: col, flexShrink: 0, display: "flex" }}><Icon name={icn} size={15} /></span>
                        <span style={{ fontFamily: "var(--display)", fontWeight: 600, textTransform: "capitalize" }}>{actionLabel(r.action)}</span>
                      </div>
                    </td>
                    <td style={{ color: "var(--muted)", textTransform: "capitalize" }}>{r.entity_type}</td>
                    <td className="mono" style={{ color: "var(--dim)" }}>{r.entity_id || "—"}</td>
                    <td className="mono" style={{ color: "var(--dim)", whiteSpace: "nowrap" }}>{fmtWhen(r.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZE && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
          <button className="btn ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><Icon name="chevL" size={14} />Prev</button>
          <span style={{ fontSize: 12, color: "var(--dim)" }}>{from}–{to} of {total}</span>
          <button className="btn ghost" disabled={to >= total} onClick={() => setPage((p) => p + 1)}>Next<Icon name="chevR" size={14} /></button>
        </div>
      )}
    </main>
  );
}
