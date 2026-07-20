import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Icon } from "../lib/icons";
import { Badge, ACCENT, prColor, Empty, OrbitLoader } from "../components/ui";
import { useTable } from "../hooks/useTable";
import { useToast } from "../context/Toast";
import { fetchZohoTickets } from "../lib/zoho";
import { fetchIntegrations, providerKeys } from "../lib/integrations";
import { ask, type AiSource, type ProviderKeys, type CloudProvider } from "../lib/ai";
import { recordAudit } from "../lib/audit";
import { fireAsync } from "../lib/automation";
import type { Ticket, Project } from "../lib/types";

const TRIAGE_SYSTEM = `You triage support/dev tickets. Given a title, description, and a list of projects, respond with exactly four lines:
Priority: <low|med|high>
Project: <exact project name from the list, or "none">
Summary: <one sentence, plain English>
Suggested next step: <one short actionable sentence>
No other text, no markdown.`;

function parseTriageLine(text: string, label: string): string | null {
  const m = text.match(new RegExp(`^${label}:\\s*(.+)$`, "im"));
  return m ? m[1].trim() : null;
}

export default function Tickets() {
  const { rows, insert, update, reload, loading } = useTable<Ticket>("tickets");
  const { rows: projects } = useTable<Project>("projects");
  const toast = useToast();
  const [sel, setSel] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [aiKeys, setAiKeys] = useState<ProviderKeys>({});
  const [aiProvider, setAiProvider] = useState<CloudProvider | undefined>(undefined);
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

  useEffect(() => { fetchIntegrations().then((i) => { setAiKeys(providerKeys(i)); setAiProvider(i?.ai_provider ?? undefined); }); }, []);

  function triagePrompt(t: { title: string; body: string | null }): string {
    const projectNames = projects.map((p) => p.name).join(", ") || "(none)";
    return `Title: ${t.title}\n\nDescription: ${t.body || "(none)"}\n\nProjects: ${projectNames}`;
  }

  /** Parses the model's 4-line response and persists priority/project_id/ai_note — used both by the manual button and auto-triage on sync. Silently leaves fields unset when a line can't be parsed, rather than blocking. */
  async function applyTriageResult(ticketId: string, text: string) {
    const priorityRaw = (parseTriageLine(text, "Priority") || "").toLowerCase();
    const priority = priorityRaw === "low" || priorityRaw === "med" || priorityRaw === "high" ? (priorityRaw as Ticket["priority"]) : null;
    const projectName = parseTriageLine(text, "Project");
    const matched = projectName && projectName.toLowerCase() !== "none" ? projects.find((p) => p.name.toLowerCase() === projectName.toLowerCase()) : undefined;
    const note = [parseTriageLine(text, "Summary"), parseTriageLine(text, "Suggested next step")].filter(Boolean).join("\n");
    const patch: Partial<Ticket> = {};
    if (priority) patch.priority = priority;
    if (matched) patch.project_id = matched.id;
    if (note) patch.ai_note = note;
    if (Object.keys(patch).length > 0) await update(ticketId, patch);
  }

  /** Shared by the status buttons so audit, toast and automation stay in one place. */
  async function setTicketStatus(t: Ticket, status: string, message: string) {
    await update(t.id, { status } as Partial<Ticket>);
    recordAudit({ action: "ticket.update", entityType: "ticket", entityId: t.id, meta: { status } });
    fireAsync({ type: "ticket_status", ticketId: t.id, title: t.title, status, priority: t.priority, projectId: t.project_id });
    toast(message);
  }

  async function runTriage(t: Ticket) {
    if (triaging) return;
    setTriaging(true); setTriage(null);
    const r = await ask(triagePrompt(t), TRIAGE_SYSTEM, aiKeys, aiProvider);
    setTriaging(false);
    if (!r.ok) { toast(`Triage failed: ${r.error}${r.source === "local" ? " — set up local AI in Settings, or add a cloud AI key" : ""}`); return; }
    const text = r.text || "";
    setTriage({ id: t.id, text, source: r.source });
    await applyTriageResult(t.id, text);
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
        else {
          const { data } = await insert({ zoho_id: t.id, ...payload } as Partial<Ticket>);
          added++;
          // Auto-triage only brand-new items — resyncing an existing ticket never re-triages it.
          if (data) {
            fireAsync({ type: "ticket_created", ticketId: data.id, title: data.title, priority: data.priority, projectId: data.project_id });
            const r = await ask(triagePrompt(data), TRIAGE_SYSTEM, aiKeys, aiProvider);
            if (r.ok) await applyTriageResult(data.id, r.text || "");
          }
        }
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
              <button className="btn" onClick={() => setTicketStatus(active, "In Progress", "Status updated")}><Icon name="check" size={14} />In progress</button>
              <button className="btn" onClick={() => setTicketStatus(active, "Closed", "Marked closed")}><Icon name="check2" size={14} />Close</button>
              <button className="btn accent" onClick={() => toast("Task created from item")}><Icon name="plus" size={14} />To task</button>
              <button className="btn ghost" disabled={triaging} onClick={() => runTriage(active)}>
                {triaging ? <><Icon name="loader" size={14} className="spin" />Triaging…</> : <><Icon name="sparkles" size={14} />AI triage</>}
              </button>
            </div>
            <div className="card" style={{ padding: 20, marginTop: 22, maxWidth: 720 }}>
              <div className="eyebrow">Description</div>
              <p style={{ marginTop: 10, color: "var(--muted)", lineHeight: 1.7, fontSize: 13.5 }}>{active.body || "No description synced for this item."}</p>
            </div>
            {triage && triage.id === active.id ? (
              <div className="card" style={{ padding: 20, marginTop: 14, maxWidth: 720, borderColor: "rgba(55,223,160,.28)" }}>
                <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={{ color: "var(--mint)" }}><Icon name="sparkles" size={13} /></span>AI triage · {triage.source === "local" ? "local model" : "Claude"}</div>
                <p className="mono" style={{ marginTop: 10, color: "var(--muted)", lineHeight: 1.7, fontSize: 12.5, whiteSpace: "pre-wrap" }}>{triage.text}</p>
              </div>
            ) : active.ai_note && (
              <div className="card" style={{ padding: 20, marginTop: 14, maxWidth: 720, borderColor: "rgba(55,223,160,.28)" }}>
                <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={{ color: "var(--mint)" }}><Icon name="sparkles" size={13} /></span>AI triage</div>
                <p className="mono" style={{ marginTop: 10, color: "var(--muted)", lineHeight: 1.7, fontSize: 12.5, whiteSpace: "pre-wrap" }}>{active.ai_note}</p>
              </div>
            )}
          </>
        ) : <Empty icon="inbox" title="Nothing selected" sub="Pick a work item from the list, or sync from Zoho Sprints to get started." />}
      </div>
    </main>
  );
}
