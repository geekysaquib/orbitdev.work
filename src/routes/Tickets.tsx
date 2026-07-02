import { useState } from "react";
import { Icon } from "../lib/icons";
import { Badge, ACCENT, prColor } from "../components/ui";
import { useTable } from "../hooks/useTable";
import { useToast } from "../context/Toast";
import { fetchZohoTickets } from "../lib/zoho";
import type { Ticket } from "../lib/types";

export default function Tickets() {
  const { rows, insert, update, reload } = useTable<Ticket>("tickets");
  const toast = useToast();
  const [sel, setSel] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const active = rows.find((t) => t.id === sel) ?? rows[0];

  async function syncZoho() {
    setSyncing(true);
    try {
      const z = await fetchZohoTickets();
      for (const t of z) {
        if (rows.some((r) => r.zoho_id === t.id)) continue;
        await insert({
          zoho_id: t.id, title: t.subject, status: t.status,
          priority: (t.priority?.toLowerCase() as Ticket["priority"]) || "med",
          synced_at: new Date().toISOString(),
        } as Partial<Ticket>);
      }
      toast(`Synced ${z.length} tickets from Zoho`);
      reload();
    } catch (e) {
      toast("Zoho not connected — add credentials in Settings");
    }
    setSyncing(false);
  }

  return (
    <main className="page" style={{ padding: 0, display: "flex", overflow: "hidden" }}>
      <div style={{ width: 380, borderRight: "1px solid var(--border)", overflowY: "auto", padding: "24px 18px", flexShrink: 0 }}>
        <div className="rowhead"><div className="h2">Zoho tickets</div>
          <button className="iconbtn" onClick={syncZoho}><Icon name="refresh" size={15} className={syncing ? "spin" : ""} /></button></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
          {rows.map((t) => (
            <button key={t.id} className="trow" style={t.id === (active?.id) ? { background: "var(--raised)", borderColor: "var(--border)" } : {}} onClick={() => setSel(t.id)}>
              <div className="meta"><span className="prdot" style={{ background: prColor(t.priority) }} />
                <span className="id">{t.zoho_id || "—"}</span>
                <Badge text={t.status} color={t.status === "Resolved" ? ACCENT.mint : t.status === "In progress" ? ACCENT.blue : ACCENT.muted} />
              </div>
              <div className="title">{t.title}</div>
            </button>
          ))}
          {rows.length === 0 && <div style={{ color: "var(--dim)", fontSize: 13, padding: 12 }}>No tickets. Hit sync to pull from Zoho.</div>}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "30px 34px" }}>
        {active ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="mono" style={{ color: "var(--muted)" }}>{active.zoho_id || "—"}</span>
              <Badge text={active.status} color={active.status === "Resolved" ? ACCENT.mint : ACCENT.muted} />
              <span className="prdot" style={{ background: prColor(active.priority) }} />
              <span style={{ fontSize: 12, color: "var(--dim)" }}>{active.priority} priority</span>
            </div>
            <h1 className="h1" style={{ marginTop: 14, maxWidth: 640, lineHeight: 1.3 }}>{active.title}</h1>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="btn" onClick={() => update(active.id, { status: "In progress" } as Partial<Ticket>).then(() => toast("Status updated"))}><Icon name="check" size={14} />In progress</button>
              <button className="btn" onClick={() => update(active.id, { status: "Resolved" } as Partial<Ticket>).then(() => toast("Marked resolved"))}><Icon name="check2" size={14} />Resolve</button>
              <button className="btn accent" onClick={() => toast("Task created from ticket")}><Icon name="plus" size={14} />To task</button>
            </div>
            <div className="card" style={{ padding: 20, marginTop: 22, maxWidth: 720 }}>
              <div className="eyebrow">Description</div>
              <p style={{ marginTop: 10, color: "var(--muted)", lineHeight: 1.7, fontSize: 13.5 }}>{active.body || "No description."}</p>
            </div>
          </>
        ) : <div style={{ color: "var(--dim)" }}>Select a ticket.</div>}
      </div>
    </main>
  );
}
