import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { useAuth } from "../context/AuthContext";
import { useAgent } from "../context/Agent";
import { useZoho } from "../context/Zoho";
import { useOffline } from "../context/Offline";
import { useToast } from "../context/Toast";
import { useTimezone, tzClock, allZones, tzOffset, zoneMatches } from "../context/Timezone";
import { useBreak } from "../context/Break";
import { PresenceProvider } from "../context/Presence";
import { useSignOutGuard } from "../hooks/useSignOutGuard";
import { useVscodeBridge } from "../hooks/useVscodeBridge";
import { CommandPalette } from "./CommandPalette";
import { StartWorkModal } from "./StartWorkModal";
import { AskAiModal } from "./AskAiModal";
import { Modal } from "./Modal";
import { supabase } from "../lib/supabase";
import { ACCENT } from "./ui";
import { NOTIF_ICON, notifAgo, fireDesktopNotification, DEFAULT_NOTIF_PREFS, type NotificationPrefs } from "../lib/notifications";
import { fetchSettings } from "../lib/settings";
import { fetchIntegrations } from "../lib/integrations";
import { logFocusEvent } from "../lib/focusEvents";
import { TIMER_PROJECT_KEY, ls as timerLs } from "../lib/timer";
import { gmailList, gmailConfigure } from "../lib/agent";
import { mailRules, matchesRule } from "../lib/mailRules";
import { fireAsync } from "../lib/automation";
import { ORBIT_AGENT_DOWNLOAD_URL } from "../lib/downloads";
import type { Notification } from "../lib/types";

// The handful of routes opened every day, plus Team/Infra (promoted back out
// of the "More" popover on request), get a permanent rail icon — the rest
// (Time/Docs/Audit/Health/Settings) still live behind the single "More"
// trigger. `.rail` keeps its own overflow-y:auto (see the CSS) as a fallback
// for short viewports now that this list is longer again.
const NAV_PRIMARY: { to: string; label: string; icon: string; end?: boolean }[] = [
  { to: "/app", label: "Dashboard", icon: "grid", end: true },
  { to: "/projects", label: "Projects", icon: "boxes" },
  { to: "/tasks", label: "Tasks", icon: "layers" },
  { to: "/sprints", label: "Sprints", icon: "sprint" },
  { to: "/insights", label: "Insights", icon: "gauge" },
  { to: "/teams", label: "Teams", icon: "users" },
  { to: "/mail", label: "Mail", icon: "mail" },
  { to: "/calendar", label: "Calendar", icon: "cal" },
  { to: "/postgres", label: "Postgres", icon: "db" },
  { to: "/docker", label: "Docker", icon: "container" },
];
const NAV_MORE_GROUPS: { label: string; items: { to: string; label: string; icon: string }[] }[] = [
  { label: "Time & more", items: [
    { to: "/intelligence", label: "Intelligence", icon: "sparkles" },
    { to: "/ai-mode", label: "AI Mode", icon: "cpu" },
    { to: "/time", label: "Time", icon: "timer" },
    { to: "/automation", label: "Automation", icon: "zap" },
    { to: "/docs", label: "Docs", icon: "book" },
    { to: "/audit", label: "Audit log", icon: "activity" },
    { to: "/health", label: "Health", icon: "checkc" },
    { to: "/settings", label: "Settings", icon: "settings" },
  ] },
];
const NAV_MORE_ROUTES = NAV_MORE_GROUPS.flatMap((g) => g.items.map((i) => i.to));

const CHANGELOG = [
  { v: "0.1.0", date: "Jul 2026", notes: ["Secure sign-in, with your projects, tasks, calendar, and notifications kept private to your team", "Two-way sync with Zoho Sprints for tickets and sprints", "Open projects straight into VS Code or Visual Studio with a native folder picker", "More reliable connection to your local agent, with auto-reconnect and a status page", "New docs, a profile menu, and friendlier empty states throughout"] },
  { v: "0.0.2", date: "Jun 2026", notes: ["Refreshed look and feel across the app", "One-click Start Work to jump straight into a task"] },
  { v: "0.0.1", date: "Jun 2026", notes: ["First look: dashboard, projects, and tickets"] },
];

export function Layout() {
  const { user } = useAuth();
  const { status, disconnect, reconnect } = useAgent();
  const zoho = useZoho();
  const { online } = useOffline();
  const toast = useToast();
  const { tz, setTz } = useTimezone();
  const { onBreak, endBreak, idlePaused } = useBreak();
  const { requestSignOut, signOutGuardModal } = useSignOutGuard();
  useVscodeBridge();  // publishes the work list to the agent and runs VS Code's relayed commands
  const nav = useNavigate();
  const location = useLocation();
  const [clock, setClock] = useState("");
  const [unread, setUnread] = useState(0);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [tzOpen, setTzOpen] = useState(false);
  const [tzQuery, setTzQuery] = useState("");
  const zones = useMemo(() => allZones(), []);
  const tzRef = useRef<HTMLDivElement>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [agentPop, setAgentPop] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [morePos, setMorePos] = useState<{ left: number; bottom: number } | null>(null);
  const [log, setLog] = useState(false);
  const [cmdk, setCmdk] = useState(false);
  const [startWork, setStartWork] = useState(false);
  const [askAi, setAskAi] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const agentRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Popover is portaled to <body> (see the render below) so it's never clipped
  // by `.rail`'s own overflow-y:auto — it's positioned from the trigger
  // button's real screen coordinates instead of relying on a CSS anchor
  // relative to an ancestor, since on mobile `.rail` gets a `transform` for
  // its slide-in animation, which would otherwise hijack the containing
  // block for a plain `position:fixed` descendant.
  function toggleMore() {
    if (!moreOpen && moreBtnRef.current) {
      const r = moreBtnRef.current.getBoundingClientRect();
      const width = 210;
      const left = Math.min(r.right + 8, window.innerWidth - width - 8);
      setMorePos({ left: Math.max(8, left), bottom: window.innerHeight - r.bottom });
    }
    setMoreOpen((v) => !v);
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdk(true); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Logs a focus_events "route_change" row whenever the top-level section
  // changes (e.g. /projects -> /postgres), not on every sub-navigation within
  // the same section — that's the granularity context-switching-cost analysis
  // needs, without a row per click. See src/lib/focusEvents.ts.
  const lastSectionRef = useRef<string | null>(null);
  useEffect(() => {
    const section = location.pathname.split("/")[1] || "app";
    if (section === lastSectionRef.current) return;
    lastSectionRef.current = section;
    logFocusEvent("route_change", { route: section, projectId: timerLs.get(TIMER_PROJECT_KEY) });
  }, [location.pathname]);

  useEffect(() => {
    const tick = () => setClock(tzClock(tz));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [tz]);

  const notifPrefs = useRef<NotificationPrefs>(DEFAULT_NOTIF_PREFS);
  const seenNotifIds = useRef<Set<string> | null>(null); // null until the first load, so the existing backlog never fires on mount

  const loadNotifs = async () => {
    const [{ data }, settings] = await Promise.all([
      supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(15),
      fetchSettings(),
    ]);
    notifPrefs.current = settings.notifications || DEFAULT_NOTIF_PREFS;
    const list = (data ?? []) as Notification[];
    setNotifs(list);
    const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).eq("read", false);
    setUnread(count ?? list.filter((n) => !n.read).length);

    if (seenNotifIds.current) {
      for (const n of list) if (!n.read && !seenNotifIds.current.has(n.id)) fireDesktopNotification(n, notifPrefs.current);
    }
    seenNotifIds.current = new Set(list.map((n) => n.id));
  };
  useEffect(() => {
    loadNotifs();
    const t = setInterval(loadNotifs, 60000); // keep the bell fresh
    return () => clearInterval(t);
  }, []);

  // "Rules -> notifications": checked here (rather than only in Mail.tsx) so a
  // match fires even when the user isn't on the Mail page — same constraint
  // as the rest of Gmail though: needs the agent's IMAP session, so it only
  // runs while ORBIT + the agent are both open.
  const seenMailUids = useRef<Set<number> | null>(null); // null until the first check, so the existing inbox backlog never fires on mount
  async function checkMailRules() {
    if (status !== "online" || !user) return;
    const intg = await fetchIntegrations();
    if (!intg?.gmail_user || !intg?.gmail_app_password) return;
    const rulesRes = await mailRules();
    const active = rulesRes.ok ? rulesRes.rules.filter((r) => r.enabled) : [];
    if (active.length === 0) { seenMailUids.current = null; return; }
    await gmailConfigure(intg.gmail_user, intg.gmail_app_password);
    const listRes = await gmailList(20);
    if (!listRes.ok) return;
    const isFirstRun = seenMailUids.current === null;
    const seen = seenMailUids.current ?? new Set<number>();
    let matched = false;
    for (const m of listRes.messages) {
      if (seen.has(m.uid)) continue;
      seen.add(m.uid);
      if (isFirstRun) continue;
      const hit = active.find((r) => matchesRule(r, m));
      if (hit) {
        matched = true;
        await supabase.from("notifications").insert({
          user_id: user.id, kind: "mail",
          title: `Mail rule: ${hit.field === "from" ? "sender" : "subject"} contains "${hit.value}"`,
          body: `${m.subject} — ${m.from || m.fromAddr}`,
        });
        fireAsync({ type: "mail_rule_matched", ruleId: hit.id, field: hit.field, value: hit.value, title: m.subject });
      }
    }
    seenMailUids.current = seen;
    if (matched) loadNotifs();
  }
  useEffect(() => {
    checkMailRules();
    const t = setInterval(checkMailRules, 120000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function markRead(n: Notification) {
    if (n.read) return;
    setNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    setUnread((u) => Math.max(0, u - 1));
    await supabase.from("notifications").update({ read: true }).eq("id", n.id);
  }
  async function markAll() {
    const ids = notifs.filter((n) => !n.read).map((n) => n.id);
    if (ids.length === 0) return;
    setNotifs((prev) => prev.map((x) => ({ ...x, read: true })));
    setUnread(0);
    await supabase.from("notifications").update({ read: true }).in("id", ids);
  }

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
      if (agentRef.current && !agentRef.current.contains(e.target as Node)) setAgentPop(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (tzRef.current && !tzRef.current.contains(e.target as Node)) setTzOpen(false);
      const insideMoreBtn = moreBtnRef.current?.contains(e.target as Node);
      const insideMoreMenu = moreMenuRef.current?.contains(e.target as Node);
      if (!insideMoreBtn && !insideMoreMenu) setMoreOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const name = user?.full_name || user?.email?.split("@")[0] || "there";
  const initials = name.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  const verified = !!user?.email_verified;

  const pillClass = status === "online" ? "pill live" : status === "disconnected" ? "pill warn" : "pill";
  const pillLabel = status === "online" ? "Agent connected" : status === "disconnected" ? "Agent disconnected" : "Agent offline";
  const pillIcon = status === "online" ? "zap" : status === "disconnected" ? "plug" : "plug";

  function onPill() {
    if (status === "offline") {
      setAgentPop(false);
      toast("Agent is offline — it'll connect automatically once it's running.");
      return;
    }
    setAgentPop((v) => !v);   // online or disconnected → open popover
  }

  return (
    <PresenceProvider>
    <div className="app">
      <nav className={"rail" + (navOpen ? " open" : "")}>
        <NavLink to="/app" className="logo" style={{ display: "grid", placeItems: "center" }} onClick={() => setNavOpen(false)}><Icon name="orbit" size={22} /></NavLink>
        <div className="rail-group">
          {NAV_PRIMARY.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setNavOpen(false)}
              className={({ isActive }) => "navbtn" + (isActive ? " on" : "")}>
              <Icon name={n.icon} size={18} />
              <span className="tip">{n.label}</span>
            </NavLink>
          ))}
        </div>
        <div className="rail-foot">
          <button ref={moreBtnRef} className={"navbtn" + (moreOpen || NAV_MORE_ROUTES.some((r) => location.pathname.startsWith(r)) ? " on" : "")}
            onClick={toggleMore}>
            <Icon name="more" size={18} />
            <span className="tip">More</span>
          </button>
          {moreOpen && morePos && createPortal(
            <div className="rail-more-menu" ref={moreMenuRef} style={{ left: morePos.left, bottom: morePos.bottom }}>
              {NAV_MORE_GROUPS.map((g) => (
                <div key={g.label}>
                  <div className="rail-more-group-label">{g.label}</div>
                  {g.items.map((n) => (
                    <NavLink key={n.to} to={n.to} onClick={() => { setMoreOpen(false); setNavOpen(false); }}
                      className={({ isActive }) => "menu-item" + (isActive ? " on" : "")}>
                      <Icon name={n.icon} size={16} />{n.label}
                    </NavLink>
                  ))}
                </div>
              ))}
            </div>,
            document.body,
          )}
        </div>
      </nav>
      {navOpen && <div className="rail-backdrop" onClick={() => setNavOpen(false)} />}

      <div className="shell">
        <header className="topbar">
          <button className="hamburger" onClick={() => setNavOpen((v) => !v)} aria-label="Open navigation"><Icon name="menu" size={20} /></button>
          <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
            <span className="wordmark">ORBIT</span><span className="ver">v0.1</span>
          </div>
          <button className="searchbar" onClick={() => setCmdk(true)}><Icon name="search" size={14} /><span>Jump to project or action</span><kbd style={{ color: "var(--muted)" }}>⌘K</kbd></button>
          <div className="spacer" />

          <button className="btn ghost" onClick={() => setAskAi(true)} title="Ask AI about your projects, tasks, tickets and sprints">
            <Icon name="sparkles" size={14} /><span className="btn-label">Ask AI</span>
          </button>

          <div className="agent-wrap" ref={agentRef}>
            <button className={pillClass} onClick={onPill} title={status === "online" ? "Agent connected — click to disconnect" : status === "disconnected" ? "Disconnected — click to reconnect" : "Agent offline"}>
              <Icon name={pillIcon} size={15} /><span className="pill-label">{pillLabel}</span>
              <span className={"dotled" + (status === "online" ? "" : status === "disconnected" ? " warn" : "")} />
            </button>
            {agentPop && status === "online" && (
              <div className="agent-menu">
                <div className="agent-head"><span className="dotled" style={{ background: "var(--mint)", boxShadow: "0 0 8px var(--mint)" }} />Connected</div>
                <div className="agent-sub">The agent stays running on your machine; this only stops ORBIT from using it.</div>
                <button className="menu-item danger" onClick={() => { disconnect(); setAgentPop(false); toast("Disconnected from agent"); }}>
                  <Icon name="plug" size={16} />Disconnect
                </button>
              </div>
            )}
            {agentPop && status === "disconnected" && (
              <div className="agent-menu">
                <div className="agent-head"><span className="dotled warn" />Disconnected</div>
                <div className="agent-sub">Resume using the agent running at your configured URL.</div>
                <button className="menu-item" onClick={() => { reconnect(); setAgentPop(false); toast("Reconnecting to agent…"); }}>
                  <Icon name="refresh" size={16} />Reconnect
                </button>
              </div>
            )}
          </div>

          <button className="btn-primary" onClick={() => setStartWork(true)}>
            <Icon name="zap" size={16} fill /><span className="btn-label">Start Work</span>
          </button>
          <div className="tz-wrap" ref={tzRef}>
            <button className="clock clock-btn" title="Change timezone" onClick={() => { setTzOpen((v) => !v); setTzQuery(""); }}>
              {clock}<Icon name="globe" size={12} />
            </button>
            {tzOpen && (
              <div className="tz-menu">
                <div className="tz-menu-head">
                  <div>
                    <div className="tz-now mono">{clock}</div>
                    <div className="tz-cur mono">{tz.replace(/_/g, " ")} · {tzOffset(tz)}</div>
                  </div>
                </div>
                <div className="tz-search"><Icon name="search" size={13} /><input autoFocus value={tzQuery} onChange={(e) => setTzQuery(e.target.value)} placeholder="Search timezone…" /></div>
                <div className="tz-list">
                  {(() => {
                    const matches = zones.filter((z) => zoneMatches(z, tzQuery));
                    if (matches.length === 0) return <div className="tz-empty">No timezone matches “{tzQuery}”.</div>;
                    return matches.map((z) => (
                      <button key={z} className={"tz-item" + (z === tz ? " on" : "")} onClick={() => { setTz(z); setTzOpen(false); }}>
                        <span>{z.replace(/_/g, " ")}</span>
                        <span className="mono tz-off">{tzOffset(z)}</span>
                      </button>
                    ));
                  })()}
                </div>
              </div>
            )}
          </div>

          <div className="notif-wrap" ref={notifRef}>
            <button className="notif-btn" title="Notifications" onClick={() => { setNotifOpen((v) => { if (!v) loadNotifs(); return !v; }); }}>
              <Icon name="bell" size={18} />
              {unread > 0 && <span className="notif-count">{unread > 9 ? "9+" : unread}</span>}
            </button>
            {notifOpen && (
              <div className="notif-menu">
                <div className="notif-menu-head">
                  <span>Notifications{unread > 0 ? ` · ${unread} new` : ""}</span>
                  {unread > 0 && <button className="notif-readall" onClick={markAll}>Mark all read</button>}
                </div>
                <div className="notif-menu-list">
                  {notifs.length === 0 ? (
                    <div className="notif-menu-empty"><Icon name="bell" size={22} /><span>You're all caught up.</span></div>
                  ) : notifs.map((n) => {
                    const [icn, col] = NOTIF_ICON[n.kind] || ["bell", ACCENT.muted];
                    return (
                      <button key={n.id} className={"notif-menu-item" + (n.read ? "" : " unread")} onClick={() => { markRead(n); if (n.link) { setNotifOpen(false); nav(n.link); } }}>
                        <span className="nm-ic" style={{ color: col }}><Icon name={icn} size={15} /></span>
                        <span className="nm-body">
                          <span className="nm-title">{n.title}</span>
                          {n.body && <span className="nm-sub">{n.body}</span>}
                        </span>
                        <span className="nm-meta">
                          <span className="mono">{notifAgo(n.created_at)}</span>
                          {!n.read && <span className="nm-dot" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <button className="notif-menu-foot" onClick={() => { setNotifOpen(false); nav("/notifications"); }}>
                  See all notifications<Icon name="chevR" size={14} />
                </button>
              </div>
            )}
          </div>

          <div className="profile-wrap" ref={menuRef}>
            <button className="avatar" onClick={() => setMenu((m) => !m)} title={verified ? "Account · verified" : "Account"}>
              {initials}
              {verified && <span className="avatar-verified" title="Email verified"><Icon name="check" size={9} /></span>}
            </button>
            {menu && (
              <div className="profile-menu">
                <div className="profile-head">
                  <div className="pn">{name}{verified && <span className="pn-verified" title="Verified"><Icon name="checkc" size={14} /></span>}</div>
                  <div className="pe">{user?.email}</div>
                </div>
                <button className="menu-item" onClick={() => { setMenu(false); nav("/settings"); }}>
                  <Icon name="user" size={16} />Profile &amp; settings
                </button>
                <button className="menu-item" onClick={() => { setMenu(false); setLog(true); }}>
                  <Icon name="bolt" size={16} />What's new
                </button>
                <button className="menu-item danger" onClick={() => { setMenu(false); requestSignOut(); }}>
                  <Icon name="logout" size={16} />Sign out
                </button>
              </div>
            )}
          </div>
        </header>
        <div className="viewport" style={{ flexDirection: "column" }}>
          {!online && (
            <div className="zoho-alert offline-alert">
              <Icon name="wifiOff" size={15} />
              <span>You're offline — showing cached data. Changes won't save until you're back online.</span>
            </div>
          )}
          {zoho.status === "disconnected" && (
            <div className="zoho-alert">
              <Icon name="plug" size={15} />
              <span>Zoho is disconnected. Sprints and tickets won't sync — <button onClick={() => nav("/settings")}>reconnect in Settings</button>.</span>
              <button className="za-x" onClick={() => nav("/settings")}><Icon name="chevR" size={15} /></button>
            </div>
          )}
          {status !== "online" && (
            <div className="zoho-alert agent-alert">
              <Icon name="zap" size={15} />
              <span>Local agent is {status === "disconnected" ? "disconnected" : "offline"}. Launching apps, browsing paths, and the focus timer are disabled — <button onClick={() => nav("/settings")}>fix in Settings</button>, or <a href={ORBIT_AGENT_DOWNLOAD_URL}>download the agent</a> if you haven't set it up yet.</span>
              <button className="za-x" onClick={() => reconnect()}><Icon name="refresh" size={14} /></button>
            </div>
          )}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            {onBreak && (
              <div className="break-bar">
                <span className="bb-ic">☕</span>
                <span>You're on a break — Orbit timer paused, resume disabled until you're refreshed.</span>
                <div className="break-bar-actions">
                  <button onClick={() => nav("/app")}>Back to break</button>
                  <button className="primary" onClick={endBreak}><Icon name="check" size={13} />I'm refreshed</button>
                </div>
              </div>
            )}
            {!onBreak && idlePaused && (
              <div className="break-bar idle">
                <span className="bb-ic"><Icon name="timer" size={15} /></span>
                <span>Timer paused — no activity on this tab. It'll resume the moment you're back.</span>
              </div>
            )}
            <div key={location.pathname} className="page-transition"><Outlet /></div>
          </div>
        </div>
      </div>

      {log && (
        <Modal onClose={() => setLog(false)} style={{ width: 480, maxWidth: "94vw" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ display: "flex", alignItems: "center", gap: 9 }}><span style={{ color: "var(--mint)" }}><Icon name="orbit" size={18} /></span>What's new</h3>
            <button className="iconbtn" onClick={() => setLog(false)}><Icon name="x" size={16} /></button>
          </div>
          <div style={{ marginTop: 8, maxHeight: 380, overflowY: "auto" }}>
            {CHANGELOG.map((c) => (
              <div key={c.v} style={{ padding: "14px 0", borderTop: "1px solid var(--border-soft)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span className="badge" style={{ color: "var(--mint)", background: "rgba(55,223,160,.12)", border: "1px solid rgba(55,223,160,.3)" }}>v{c.v}</span>
                  <span style={{ fontSize: 11.5, color: "var(--dim)" }}>{c.date}</span>
                </div>
                <ul style={{ margin: "10px 0 0 18px", color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
                  {c.notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {cmdk && <CommandPalette onClose={() => setCmdk(false)} onAskAi={() => setAskAi(true)} />}
      {startWork && <StartWorkModal onClose={() => setStartWork(false)} />}
      {/* Always mounted: it prefetches the workspace snapshot so the first open is
          instant, and keeps the conversation thread across close/reopen. */}
      <AskAiModal open={askAi} onClose={() => setAskAi(false)} />
      {signOutGuardModal}
    </div>
    </PresenceProvider>
  );
}
