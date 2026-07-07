import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { OrbitLoader, SetupRequired } from "../components/ui";
import { useToast } from "../context/Toast";
import { useAgent } from "../context/Agent";
import { gmailStatus, gmailConfigure, gmailDisconnect, gmailList, gmailMessage, type GmailMsg, type GmailFull } from "../lib/agent";
import { fetchIntegrations } from "../lib/integrations";

const REFRESH_MS = 120000; // 2 minutes

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
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (agentDown) { setConfigured(null); return; }
    (async () => {
      const intg = await fetchIntegrations();
      if (intg?.gmail_user && intg?.gmail_app_password) {
        const s = await gmailStatus();
        if (!s.configured || s.user !== intg.gmail_user) await gmailConfigure(intg.gmail_user, intg.gmail_app_password);
        setConfigured(true); setUser(intg.gmail_user);
      } else {
        const s = await gmailStatus();
        setConfigured(s.configured); setUser(s.user);
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

  async function disconnect() { await gmailDisconnect(); setConfigured(false); setUser(null); setMsgs([]); setSel(null); toast("Gmail disconnected on this machine"); }

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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 26px 0" }}>
        <div>
          <div className="h1" style={{ display: "flex", alignItems: "center", gap: 10 }}>Mail {refreshing && <Icon name="loader" size={15} className="spin" />}</div>
          <div className="sub">{user} · inbox (read-only)</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn ghost" onClick={() => loadInbox(true)}><Icon name="refresh" size={14} />Refresh</button>
          <button className="btn ghost" onClick={disconnect}><Icon name="plug" size={14} />Disconnect</button>
        </div>
      </div>

      {/* tabs + search */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 26px 12px", flexWrap: "wrap" }}>
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
                <h2>{full.subject}</h2>
                <div className="mail-metaline">
                  <span className="mailava lg">{initials(full.from)}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{full.from}</div>
                    <div style={{ fontSize: 11.5, color: "var(--dim)" }}>{full.date ? new Date(full.date).toLocaleString() : ""}</div>
                  </div>
                </div>
              </div>
              {full.html
                ? <EmailFrame html={full.html} />
                : <div className="mail-textbody">{full.text || "(no content)"}</div>}
            </div>
          ) : <div className="mail-none"><Icon name="plug" size={30} /><p>Couldn't load this message.</p></div>}
        </div>
      </div>
    </main>
  );
}
