import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Icon } from "../lib/icons";
import { Badge, ACCENT, prColor, Empty, OrbitLoader } from "../components/ui";
import { useTable } from "../hooks/useTable";
import { useToast } from "../context/Toast";
import { fetchZohoTickets } from "../lib/zoho";
import { fetchIntegrations } from "../lib/integrations";
import { ask, type AiSource } from "../lib/ai";
import { recordAudit } from "../lib/audit";
import type { Ticket } from "../lib/types";

const TRIAGE_SYSTEM = `You triage support/dev tickets. Given a title and description, respond with exactly three lines:
Priority: <low|med|high>
Summary: <one sentence, plain English>
Suggested next step: <one short actionable sentence>
No other text, no markdown.`;

export default function Tickets() {
  const { rows, insert, update, reload, loading } = useTable<Ticket>("tickets");
  const toast = useToast();
  const [sel, setSel] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [aiApiKey, setAiApiKey] = useState<string | null>(null);
  const [triage, setTriage] = useState<{ id: string; text: string; source: AiSource } | null>(null);
  const [triaging, setTriaging] = useState(false);
  const active = rows.find((t) => t.id === sel) ?? rows[0];

  // Deep link: /tickets?id=<uuid> selects a ticket (Ask AI's "open ticket" action,
  // and shareable links generally). Depends on `rows` because they load async —
  // the id usually arrives before the row it points at.
  const [searchParams] = useSearchParams();
  const wantId = searchParams.get("id");
  useEffect(() => {
    if (wantId && rows.some((r) => r.id === wantId)) setSel(wantId);
  }, [wantId, rows]);

  useEffect(() => { fetchIntegrations().then((i) => setAiApiKey(i?.anthropic_api_key || null)); }, []);

  async function runTriage(t: Ticket) {
    if (triaging) return;
    setTriaging(true); setTriage(null);
    const r = await ask(`Title: ${t.title}\n\nDescription: ${t.body || "(none)"}`, TRIAGE_SYSTEM, aiApiKey);
    setTriaging(false);
    if (!r.ok) { toast(`Triage failed: ${r.error}${r.source === "local" ? " — set up local AI in Settings, or add an Anthropic key" : ""}`); return; }
    setTriage({ id: t.id, text: r.text || "", source: r.source });
  }

  async function syncZoho() {
    setSyncing(true);
    try {
      const z = await fetchZohoTickets();
      let added = 0, updated = 0;
      for (const t of z) {
        const existing = rows.find((r) => r.zoho_id === t.id);
        const payload = {
          title: t.subject, status: t.status,
          priority: (t.priority?.toLowerCase() as Ticket["priority"]) || "med",
          body: t.description || null, synced_at: new Date().toISOString(),
        };
        if (existing) { await update(existing.id, payload as Partial<Ticket>); updated++; }
        else { await insert({ zoho_id: t.id, ...payload } as Partial<Ticket>); added++; }
      }
      toast(z.length === 0 ? "Zoho connected — no items found for this project" : `Synced ${z.length} items · ${added} new, ${updated} updated`);
      reload();
    } catch (e) {
      // Surface the real reason (bad DC, missing token, scope, etc.) instead of a generic message.
      toast((e as Error).message || "Zoho sync failed — check Settings");
    }
    setSyncing(false);
  }

  return (
    <main className="page split-shell" style={{ padding: 0, overflow: "hidden" }}>
      <div className="split-side" style={{ width: 380, borderRight: "1px solid var(--border)", overflowY: "auto", padding: "24px 18px", flexShrink: 0 }}>
        <div className="rowhead"><div className="h2">Work items</div>
          <button className="iconbtn" title="Sync from Zoho Sprints" onClick={syncZoho}><Icon name="refresh" size={15} className={syncing ? "spin" : ""} /></button></div>
        <div style={{ fontSize: 11.5, color: "var(--dim)", marginTop: 6 }}>Synced from Zoho Sprints · configure keys in Settings</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
          {loading ? <div className="page-loader"><OrbitLoader label="Loading…" size={22} /></div> : <>
          {rows.map((t) => (
            <button key={t.id} className="trow" style={t.id === (active?.id) ? { background: "var(--raised)", borderColor: "var(--border)" } : {}} onClick={() => setSel(t.id)}>
              <div className="meta"><span className="prdot" style={{ background: prColor(t.priority) }} />
                <span className="id">{t.zoho_id || "—"}</span>
                <Badge text={t.status} color={t.status === "Resolved" || t.status === "Closed" ? ACCENT.mint : t.status === "In Progress" ? ACCENT.blue : ACCENT.muted} />
              </div>
              <div className="title">{t.title}</div>
            </button>
          ))}
          {rows.length === 0 && <Empty icon="ticket" title="No work items yet" sub="Tap the sync icon to pull items from Zoho Sprints." mini />}
          </>}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "30px 34px" }}>
        {loading ? <div className="page-loader"><OrbitLoader label="Loading…" /></div> : active ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="mono" style={{ color: "var(--muted)" }}>{active.zoho_id || "—"}</span>
              <Badge text={active.status} color={active.status === "Resolved" || active.status === "Closed" ? ACCENT.mint : ACCENT.muted} />
              <span className="prdot" style={{ background: prColor(active.priority) }} />
              <span style={{ fontSize: 12, color: "var(--dim)" }}>{active.priority} priority</span>
            </div>
            <h1 className="h1" style={{ marginTop: 14, maxWidth: 640, lineHeight: 1.3 }}>{active.title}</h1>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="btn" onClick={() => update(active.id, { status: "In Progress" } as Partial<Ticket>).then(() => { recordAudit({ action: "ticket.update", entityType: "ticket", entityId: active.id, meta: { status: "In Progress" } }); toast("Status updated"); })}><Icon name="check" size={14} />In progress</button>
              <button className="btn" onClick={() => update(active.id, { status: "Closed" } as Partial<Ticket>).then(() => { recordAudit({ action: "ticket.update", entityType: "ticket", entityId: active.id, meta: { status: "Closed" } }); toast("Marked closed"); })}><Icon name="check2" size={14} />Close</button>
              <button className="btn accent" onClick={() => toast("Task created from item")}><Icon name="plus" size={14} />To task</button>
              <button className="btn ghost" disabled={triaging} onClick={() => runTriage(active)}>
                {triaging ? <><Icon name="loader" size={14} className="spin" />Triaging…</> : <><Icon name="sparkles" size={14} />AI triage</>}
              </button>
            </div>
            <div className="card" style={{ padding: 20, marginTop: 22, maxWidth: 720 }}>
              <div className="eyebrow">Description</div>
              <p style={{ marginTop: 10, color: "var(--muted)", lineHeight: 1.7, fontSize: 13.5 }}>{active.body || "No description synced for this item."}</p>
            </div>
            {triage && triage.id === active.id && (
              <div className="card" style={{ padding: 20, marginTop: 14, maxWidth: 720, borderColor: "rgba(55,223,160,.28)" }}>
                <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={{ color: "var(--mint)" }}><Icon name="sparkles" size={13} /></span>AI triage · {triage.source === "local" ? "local model" : "Claude"}</div>
                <p className="mono" style={{ marginTop: 10, color: "var(--muted)", lineHeight: 1.7, fontSize: 12.5, whiteSpace: "pre-wrap" }}>{triage.text}</p>
              </div>
            )}
          </>
        ) : <Empty icon="inbox" title="Nothing selected" sub="Pick a work item from the list, or sync from Zoho Sprints to get started." />}
      </div>
    </main>
  );
}
