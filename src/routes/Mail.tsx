import { useEffect, useMemo, useRef, useState, type ChangeEvent, type RefObject } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "../lib/icons";
import { Modal } from "../components/Modal";
import { Select } from "../components/Select";
import { OrbitLoader, SetupRequired } from "../components/ui";
import { useToast } from "../context/Toast";
import { useAgent } from "../context/Agent";
import { useTimezone, tzDateTime } from "../context/Timezone";
import { useTable } from "../hooks/useTable";
import { gmailConfigure, gmailDisconnect, gmailList, gmailMessage, gmailSend, type GmailMsg, type GmailFull } from "../lib/agent";
import { fetchIntegrations, saveIntegrations, providerKeys } from "../lib/integrations";
import { fetchSettings } from "../lib/settings";
import { mailTemplates, type MailTemplate } from "../lib/mailTemplates";
import { scheduleEmail } from "../lib/scheduledEmails";
import { ask } from "../lib/ai";
import { recordAudit } from "../lib/audit";
import type { Ticket } from "../lib/types";
import { MailTemplatesModal } from "../components/MailTemplatesModal";
import { ScheduledMailModal } from "../components/ScheduledMailModal";
import { MailRulesModal } from "../components/MailRulesModal";

const REFRESH_MS = 120000; // 2 minutes
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20MB per file — Gmail's own limit is 25MB total, this leaves headroom

interface ComposeDraft { to: string; subject: string; body: string; inReplyTo?: string; references?: string[]; }
interface PendingAttachment { filename: string; contentType: string; size: number; data: string /* base64 */; }

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
/** Plain-text fallback derived from the rich editor's HTML — sent as the multipart text/plain alternative. */
function htmlToText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.innerText || div.textContent || "").trim();
}
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const RTE_COMMANDS: { cmd: string; icon: string; title: string }[] = [
  { cmd: "bold", icon: "bold", title: "Bold" },
  { cmd: "italic", icon: "italic", title: "Italic" },
  { cmd: "underline", icon: "underline", title: "Underline" },
  { cmd: "insertUnorderedList", icon: "listBullet", title: "Bulleted list" },
  { cmd: "insertOrderedList", icon: "listNumber", title: "Numbered list" },
];

/** Minimal contentEditable rich-text body — no library, matches how the rest of ORBIT hand-rolls its UI. */
function RichTextEditor({ editorRef, initialHtml, onChange }: { editorRef: RefObject<HTMLDivElement | null>; initialHtml: string; onChange: () => void }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const initedRef = useRef(false);

  useEffect(() => {
    if (initedRef.current || !editorRef.current) return;
    editorRef.current.innerHTML = initialHtml;
    initedRef.current = true;
    onChange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHtml]);

  function exec(cmd: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
    onChange();
  }

  function insertLink() {
    if (!linkUrl.trim()) return;
    const url = /^https?:\/\//i.test(linkUrl.trim()) ? linkUrl.trim() : `https://${linkUrl.trim()}`;
    exec("createLink", url);
    setLinkUrl("");
    setLinkOpen(false);
  }

  return (
    <div className="fld">
      <label>Message</label>
      <div className="rte-toolbar">
        {RTE_COMMANDS.map((c) => (
          <button key={c.cmd} type="button" className="iconbtn" title={c.title} onMouseDown={(e) => { e.preventDefault(); exec(c.cmd); }}>
            <Icon name={c.icon} size={14} />
          </button>
        ))}
        <button type="button" className="iconbtn" title="Link" onMouseDown={(e) => { e.preventDefault(); setLinkOpen((v) => !v); }}>
          <Icon name="link" size={14} />
        </button>
      </div>
      {linkOpen && (
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://example.com" autoFocus
            onKeyDown={(e) => e.key === "Enter" && insertLink()} style={{ flex: 1 }} />
          <button type="button" className="btn ghost" onClick={insertLink}>Insert</button>
        </div>
      )}
      <div
        ref={editorRef}
        contentEditable
        onInput={onChange}
        className="rte-body"
        data-placeholder="Write your message…"
      />
    </div>
  );
}

function ComposeModal({ draft, onClose, onSent }: { draft: ComposeDraft; onClose: () => void; onSent: () => void }) {
  const toast = useToast();
  const [to, setTo] = useState(draft.to);
  const [subject, setSubject] = useState(draft.subject);
  const editorRef = useRef<HTMLDivElement>(null);
  const [hasText, setHasText] = useState(!!draft.body.trim());
  const [sending, setSending] = useState(false);
  const [templates, setTemplates] = useState<MailTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const initialHtml = useMemo(() => (draft.body ? escapeHtml(draft.body).replace(/\n/g, "<br>") : ""), [draft.body]);

  function syncBody() {
    setHasText(!!(editorRef.current?.innerText || "").trim());
  }

  useEffect(() => {
    (async () => {
      const [t, s] = await Promise.all([mailTemplates(), fetchSettings()]);
      if (t.ok) setTemplates(t.templates);
      const sig = s.mail_signature?.trim();
      // Only auto-append to an empty draft — an AI draft or a reply someone's
      // already typed into shouldn't get a signature spliced in unasked.
      if (sig && editorRef.current && !editorRef.current.innerText.trim()) {
        editorRef.current.innerHTML += `<br><br>-- <br>${escapeHtml(sig).replace(/\n/g, "<br>")}`;
        syncBody();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t || !editorRef.current) return;
    editorRef.current.innerHTML = escapeHtml(t.body).replace(/\n/g, "<br>");
    if (t.subject) setSubject(t.subject);
    syncBody();
  }

  function onPickFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    for (const f of files) {
      if (f.size > MAX_ATTACHMENT_BYTES) { toast(`${f.name} is larger than ${fmtBytes(MAX_ATTACHMENT_BYTES)} — skipped`); continue; }
      const reader = new FileReader();
      reader.onload = () => {
        const data = String(reader.result || "").split(",")[1] || "";
        setAttachments((prev) => [...prev, { filename: f.name, contentType: f.type || "application/octet-stream", size: f.size, data }]);
      };
      reader.readAsDataURL(f);
    }
  }
  function removeAttachment(i: number) { setAttachments((prev) => prev.filter((_, idx) => idx !== i)); }

  async function send() {
    const html = editorRef.current?.innerHTML || "";
    const text = htmlToText(html);
    if (!to.trim() || !text.trim() || sending) return;
    setSending(true);
    const r = await gmailSend({
      to: to.trim(), subject: subject.trim(), text, html,
      inReplyTo: draft.inReplyTo, references: draft.references,
      attachments: attachments.length ? attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, content: a.data })) : undefined,
    });
    setSending(false);
    if (!r.ok) { toast(`Couldn't send: ${r.error}`); return; }
    toast("Message sent");
    onSent();
  }

  async function doSchedule() {
    const html = editorRef.current?.innerHTML || "";
    const text = htmlToText(html);
    if (!to.trim() || !text.trim() || !scheduleAt || scheduling) return;
    const when = new Date(scheduleAt);
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) { toast("Pick a time in the future"); return; }
    setScheduling(true);
    const r = await scheduleEmail({ to: to.trim(), subject: subject.trim(), body: text, html, inReplyTo: draft.inReplyTo, references: draft.references, sendAt: when.toISOString() });
    setScheduling(false);
    if (!r.ok) { toast(`Couldn't schedule: ${r.error}`); return; }
    toast(`Scheduled for ${when.toLocaleString()}`);
    onSent();
  }

  return (
    <Modal onClose={onClose} style={{ width: 600 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ display: "flex", alignItems: "center", gap: 9 }}><Icon name="mail" size={17} />{draft.inReplyTo ? "Reply" : "New message"}</h3>
        <button className="iconbtn" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>
      <div className="fld" style={{ marginTop: 14 }}><label>To</label><input value={to} autoFocus onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" /></div>
      <div className="fld"><label>Subject</label><input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" /></div>
      {templates.length > 0 && (
        <div className="fld">
          <label>Template</label>
          <Select full value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
            <option value="">None</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </div>
      )}

      <RichTextEditor editorRef={editorRef} initialHtml={initialHtml} onChange={syncBody} />

      <div style={{ marginTop: 4 }}>
        <input ref={fileInputRef} type="file" multiple hidden onChange={onPickFiles} />
        <button type="button" className="btn ghost sm" onClick={() => fileInputRef.current?.click()}><Icon name="paperclip" size={13} />Attach files</button>
        {attachments.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {attachments.map((a, i) => (
              <span key={i} className="badge" style={{ background: "var(--raised)", border: "1px solid var(--border)", color: "var(--muted)" }}>
                <Icon name="paperclip" size={11} />{a.filename} <span style={{ color: "var(--dim)" }}>· {fmtBytes(a.size)}</span>
                <button type="button" className="iconbtn" style={{ width: 16, height: 16 }} onClick={() => removeAttachment(i)}><Icon name="x" size={10} /></button>
              </span>
            ))}
          </div>
        )}
      </div>

      {scheduleOpen && (
        <div className="fld">
          <label>Send at</label>
          <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
          {attachments.length > 0 && <div className="kf-hint">Scheduled messages can't include attachments yet — remove {attachments.length === 1 ? "it" : "them"} to schedule, or send now instead.</div>}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        {!scheduleOpen ? (
          <button className="btn ghost" onClick={() => setScheduleOpen(true)}><Icon name="clock" size={14} />Schedule…</button>
        ) : (
          <button className="btn ghost" disabled={scheduling || !scheduleAt || attachments.length > 0} onClick={doSchedule}>{scheduling ? "Scheduling…" : "Confirm schedule"}</button>
        )}
        <button className="btn-primary" disabled={!to.trim() || !hasText || sending} onClick={send}>
          {sending ? <><Icon name="loader" size={14} className="spin" />Sending…</> : <><Icon name="upload" size={14} />Send</>}
        </button>
      </div>
    </Modal>
  );
}

const timeAgo = (d: string) => {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const initials = (s: string) => (s || "?").trim().charAt(0).toUpperCase();

const PROMO_RE = /(noreply|no-reply|newsletter|campaign|promo|marketing|deals?|offers?|coursera|udemy|unsubscribe)/i;
const isPromo = (m: GmailMsg) => PROMO_RE.test(m.fromAddr) || PROMO_RE.test(m.from) || /sale|% off|deal|offer|webinar|pick of the week/i.test(m.subject);

/** Renders an HTML email inside a sandboxed iframe filling the reading pane —
 *  isolated CSS, white reading surface, scripts blocked. */
function EmailFrame({ html }: { html: string }) {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
    <style>html,body{margin:0;padding:26px 30px;background:#fff;color:#1a1a1a;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.65;word-break:break-word}
    img{max-width:100%!important;height:auto}a{color:#1a56db}table{max-width:100%!important}*{max-width:100%}
    ::-webkit-scrollbar{width:10px}::-webkit-scrollbar-thumb{background:#d4d4d4;border-radius:5px}</style>
    </head><body>${html}</body></html>`;
  return <iframe title="email" sandbox="allow-same-origin allow-popups" srcDoc={doc} className="mail-iframe" />;
}

type Tab = "all" | "unread" | "promotions";

export default function Mail() {
  const toast = useToast();
  const nav = useNavigate();
  const { status: agentStatus } = useAgent();
  const { tz } = useTimezone();
  const agentDown = agentStatus !== "online";
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [user, setUser] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<GmailMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<GmailMsg | null>(null);
  const [full, setFull] = useState<GmailFull | null>(null);
  const [loadingMsg, setLoadingMsg] = useState(false);
  const [compose, setCompose] = useState<ComposeDraft | null>(null);
  const [aiDrafting, setAiDrafting] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [scheduledOpen, setScheduledOpen] = useState(false);
  const { insert: insertTicket } = useTable<Ticket>("tickets");
  const timer = useRef<number | null>(null);
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    if (params.get("compose") !== "1") return;
    setCompose({ to: "", subject: "", body: "" });
    setParams((p) => { p.delete("compose"); return p; }, { replace: true });
  }, []); // eslint-disable-line

  // Supabase's `integrations` row (this account's own, RLS-scoped) is the only
  // source of truth for "is Gmail connected." We never trust the agent's own
  // gmailStatus() on its own — the agent is just a runtime cache the browser
  // pushes into; falling back to whatever it already has cached is how one
  // account's Gmail used to leak into another's.
  useEffect(() => {
    if (agentDown) { setConfigured(null); return; }
    (async () => {
      const intg = await fetchIntegrations();
      if (intg?.gmail_user && intg?.gmail_app_password) {
        await gmailConfigure(intg.gmail_user, intg.gmail_app_password);
        setConfigured(true); setUser(intg.gmail_user);
      } else {
        setConfigured(false); setUser(null);
      }
    })();
  }, [agentStatus]);

  useEffect(() => { if (configured) loadInbox(true); /* eslint-disable-next-line */ }, [configured]);

  // auto-refresh every 2 min (silent)
  useEffect(() => {
    if (!configured) return;
    timer.current = window.setInterval(() => loadInbox(false), REFRESH_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
    // eslint-disable-next-line
  }, [configured]);

  async function loadInbox(withSpinner: boolean) {
    if (withSpinner) setLoading(true); else setRefreshing(true);
    setErr(null);
    const r = await gmailList(40);
    if (r.ok) setMsgs(r.messages); else if (withSpinner) setErr(r.error || "Couldn't load inbox");
    setLoading(false); setRefreshing(false);
  }

  async function openMsg(m: GmailMsg) {
    setSel(m); setFull(null); setLoadingMsg(true);
    const r = await gmailMessage(m.uid);
    setFull(r.ok ? r.message! : null); setLoadingMsg(false);
    if (!m.seen) setMsgs((prev) => prev.map((x) => (x.uid === m.uid ? { ...x, seen: true } : x)));
  }

  async function disconnect() {
    await gmailDisconnect(); // clears the agent's local cache for this account
    await saveIntegrations({ gmail_user: null, gmail_app_password: null }); // clears the durable record so it doesn't silently reconnect next visit
    setConfigured(false); setUser(null); setMsgs([]); setSel(null);
    toast("Gmail disconnected");
  }

  /** Grounds the draft in the open thread only — the model never sees anything beyond what's rendered here. */
  async function aiDraftReply() {
    if (!sel || !full || aiDrafting) return;
    setAiDrafting(true);
    const intg = await fetchIntegrations();
    const system = "You draft concise, professional email replies. Ground your reply ONLY in the quoted thread the user provides — never invent facts, commitments, names or details that aren't in it. Match the sender's tone. Output only the reply body text, with no subject line and no preamble like \"Here's a draft\".";
    const prompt = `Reply to this email thread.\n\nFrom: ${full.from}\nSubject: ${full.subject}\n\n${(full.text || "").slice(0, 6000)}`;
    const r = await ask(prompt, system, providerKeys(intg), intg?.ai_provider ?? undefined);
    setAiDrafting(false);
    if (!r.ok) { toast(`Couldn't draft a reply: ${r.error}`); return; }
    setCompose({
      to: sel.fromAddr || "", subject: full.subject.startsWith("Re:") ? full.subject : `Re: ${full.subject}`,
      body: r.text || "",
      inReplyTo: full.messageId, references: [...(full.references || []), ...(full.messageId ? [full.messageId] : [])],
    });
  }

  async function createTicketFromEmail() {
    if (!sel || !full) return;
    const attachNote = full.attachments?.length ? `\n\nAttachments: ${full.attachments.map((a) => a.filename).join(", ")}` : "";
    const body = `From: ${full.from}\n\n${(full.text || "").slice(0, 4000)}${attachNote}`;
    const { error } = await insertTicket({ zoho_id: null, project_id: null, title: full.subject || "(no subject)", body, priority: "med", status: "Open" } as Partial<Ticket>);
    if (error) { toast(`Couldn't create ticket: ${error}`); return; }
    recordAudit({ action: "ticket.create", entityType: "ticket", meta: { source: "mail", subject: full.subject } });
    toast("Ticket created from email");
  }

  const filtered = useMemo(() => {
    let list = msgs;
    if (tab === "unread") list = list.filter((m) => !m.seen);
    else if (tab === "promotions") list = list.filter(isPromo);
    if (query.trim()) { const q = query.toLowerCase(); list = list.filter((m) => `${m.from} ${m.fromAddr} ${m.subject}`.toLowerCase().includes(q)); }
    return list;
  }, [msgs, tab, query]);

  const unreadCount = msgs.filter((m) => !m.seen).length;
  const promoCount = msgs.filter(isPromo).length;

  if (agentDown) return <main className="page"><div className="h1">Mail</div><SetupRequired icon="zap" title="Start the ORBIT agent" sub="Gmail runs through the local agent on your machine. Start it, or set its URL in Settings." cta="Agent settings" to="/settings" /></main>;
  if (configured === false) return <main className="page"><div className="h1">Mail</div><SetupRequired icon="mail" title="Connect Gmail" sub="Add your Gmail address and app password in Settings → Gmail, then come back here." /></main>;

  return (
    <main className="page" style={{ padding: 0, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 24px 0" }}>
        <div>
          <div className="h1" style={{ display: "flex", alignItems: "center", gap: 10 }}>Mail {refreshing && <Icon name="loader" size={15} className="spin" />}</div>
          <div className="sub" style={{ marginTop: 2 }}>{user} · inbox</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-primary" onClick={() => setCompose({ to: "", subject: "", body: "" })}><Icon name="plus" size={14} />Compose</button>
          <button className="btn ghost" onClick={() => loadInbox(true)}><Icon name="refresh" size={14} />Refresh</button>
          <button className="btn ghost" onClick={() => setTemplatesOpen(true)}><Icon name="edit" size={14} />Templates</button>
          <button className="btn ghost" onClick={() => setRulesOpen(true)}><Icon name="bell" size={14} />Rules</button>
          <button className="btn ghost" onClick={() => setScheduledOpen(true)}><Icon name="clock" size={14} />Scheduled</button>
          <button className="btn ghost" onClick={disconnect}><Icon name="plug" size={14} />Disconnect</button>
        </div>
      </div>

      {/* tabs + search */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 24px 8px", flexWrap: "wrap" }}>
        <div className="mail-tabs">
          <button className={"mail-tab" + (tab === "all" ? " on" : "")} onClick={() => setTab("all")}>All <span>{msgs.length}</span></button>
          <button className={"mail-tab" + (tab === "unread" ? " on" : "")} onClick={() => setTab("unread")}>Unread <span>{unreadCount}</span></button>
          <button className={"mail-tab" + (tab === "promotions" ? " on" : "")} onClick={() => setTab("promotions")}>Promotions <span>{promoCount}</span></button>
        </div>
        <div className="bf-search" style={{ marginLeft: "auto" }}><Icon name="search" size={13} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search mail…" /></div>
      </div>

      {/* two-pane */}
      <div className="mail-split">
        <div className="mail-listpane">
          {loading ? <div className="page-loader"><OrbitLoader label="Loading inbox…" /></div>
            : err ? <div style={{ padding: 24 }}><SetupRequired icon="plug" title="Couldn't load inbox" sub={err} cta="Open Settings" /></div>
            : filtered.length === 0 ? <div className="mail-empty">No messages{tab !== "all" ? ` in ${tab}` : ""}.</div>
            : filtered.map((m) => (
              <button key={m.uid} className={"mailrow2" + (m.seen ? "" : " unread") + (sel?.uid === m.uid ? " active" : "")} onClick={() => openMsg(m)}>
                <span className="mailava">{initials(m.from)}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="mailfrom">{m.from || m.fromAddr}</span>
                    {!m.seen && <span className="mailunread-dot" />}
                    <span className="mailtime">{m.date ? timeAgo(m.date) : ""}</span>
                  </div>
                  <div className="mailsubj">{m.subject}</div>
                </div>
              </button>
            ))}
        </div>

        <div className="mail-readpane">
          {!sel ? (
            <div className="mail-none"><Icon name="mail" size={40} /><p>Select a message to read it here.</p></div>
          ) : loadingMsg ? <div className="page-loader"><OrbitLoader label="Loading message…" /></div>
          : full ? (
            <div className="mail-reader">
              <div className="mail-reader-head">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <h2>{full.subject}</h2>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button className="btn ghost sm" disabled={aiDrafting} onClick={aiDraftReply}>
                      {aiDrafting ? <><Icon name="loader" size={13} className="spin" />Drafting…</> : <><Icon name="sparkles" size={13} />AI draft</>}
                    </button>
                    <button
                      className="btn ghost sm"
                      onClick={() => setCompose({
                        to: sel?.fromAddr || "", subject: full.subject.startsWith("Re:") ? full.subject : `Re: ${full.subject}`, body: "",
                        inReplyTo: full.messageId, references: [...(full.references || []), ...(full.messageId ? [full.messageId] : [])],
                      })}
                    ><Icon name="back" size={13} />Reply</button>
                  </div>
                </div>
                <div className="mail-metaline">
                  <span className="mailava lg">{initials(full.from)}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{full.from}</div>
                    <div style={{ fontSize: 11.5, color: "var(--dim)" }}>{full.date ? tzDateTime(tz, new Date(full.date)) : ""}</div>
                  </div>
                </div>
                {!!full.attachments?.length && (
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 10 }}>
                    {full.attachments.map((a, i) => (
                      <span key={i} className="badge" style={{ background: "var(--raised)", border: "1px solid var(--border)", color: "var(--muted)" }}><Icon name="folder" size={12} />{a.filename}</span>
                    ))}
                    <button className="btn ghost sm" onClick={createTicketFromEmail}><Icon name="ticket" size={13} />Create ticket</button>
                  </div>
                )}
              </div>
              {full.html
                ? <EmailFrame html={full.html} />
                : <div className="mail-textbody">{full.text || "(no content)"}</div>}
            </div>
          ) : <div className="mail-none"><Icon name="plug" size={30} /><p>Couldn't load this message.</p></div>}
        </div>
      </div>

      {compose && <ComposeModal draft={compose} onClose={() => setCompose(null)} onSent={() => setCompose(null)} />}
      {templatesOpen && <MailTemplatesModal onClose={() => setTemplatesOpen(false)} />}
      {rulesOpen && <MailRulesModal onClose={() => setRulesOpen(false)} />}
      {scheduledOpen && <ScheduledMailModal onClose={() => setScheduledOpen(false)} />}
    </main>
  );
}
