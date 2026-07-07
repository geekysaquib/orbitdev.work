import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { useAuth } from "../context/AuthContext";
import { useAgent } from "../context/Agent";
import { useZoho } from "../context/Zoho";
import { useToast } from "../context/Toast";
import { CommandPalette } from "./CommandPalette";
import { supabase } from "../lib/supabase";

const NAV = [
  { to: "/", label: "Dashboard", icon: "grid", end: true },
  { to: "/projects", label: "Projects", icon: "boxes" },
  { to: "/sprints", label: "Sprints", icon: "sprint" },
  { to: "/tasks", label: "Tasks", icon: "layers" },
  { to: "/docker", label: "Docker", icon: "container" },
  { to: "/mail", label: "Mail", icon: "mail" },
  { to: "/calendar", label: "Calendar", icon: "cal" },
  { to: "/automation", label: "Automation", icon: "zap" },
  { to: "/time", label: "Time", icon: "timer" },
  { to: "/notifications", label: "Notifications", icon: "bell" },
  { to: "/docs", label: "Docs", icon: "book" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

const CHANGELOG = [
  { v: "0.1.0", date: "Jul 2026", notes: ["Supabase auth + RLS-scoped projects, tasks, calendar, notifications", "Zoho Sprints work-item sync", "Local agent: launch VS Code / Visual Studio, native folder picker", "Configurable agent URL, auto-reconnect, status page", "Docs, profile menu, empty states"] },
  { v: "0.0.2", date: "Jun 2026", notes: ["Claude Design control-room system", "Start-Work ignition macro"] },
  { v: "0.0.1", date: "Jun 2026", notes: ["Initial prototype — dashboard, project bays, tickets"] },
];

export function Layout() {
  const { user, signOut } = useAuth();
  const { status, disconnect, reconnect } = useAgent();
  const zoho = useZoho();
  const toast = useToast();
  const nav = useNavigate();
  const [clock, setClock] = useState("");
  const [unread, setUnread] = useState(0);
  const [menu, setMenu] = useState(false);
  const [agentPop, setAgentPop] = useState(false);
  const [log, setLog] = useState(false);
  const [cmdk, setCmdk] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const agentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdk(true); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      const n = new Date();
      setClock(`${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("read", false)
      .then(({ count }) => setUnread(count ?? 0));
  }, []);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
      if (agentRef.current && !agentRef.current.contains(e.target as Node)) setAgentPop(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const name = (user?.user_metadata?.full_name as string | undefined) || user?.email?.split("@")[0] || "there";
  const initials = name.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

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
    <div className="app">
      <nav className="rail">
        <div className="logo"><Icon name="orbit" size={26} /></div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}
            className={({ isActive }) => "navbtn" + (isActive ? " on" : "")}>
            <Icon name={n.icon} size={20} />
            {n.to === "/notifications" && unread > 0 && <span className="dotbadge" />}
            <span className="tip">{n.label}</span>
          </NavLink>
        ))}
        <div className="rail-foot">
          <button className="rail-ver" onClick={() => setLog(true)} title="What's new">v0.1</button>
        </div>
      </nav>

      <div className="shell">
        <header className="topbar">
          <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
            <span className="wordmark">ORBIT</span><span className="ver">v0.1</span>
          </div>
          <button className="searchbar" onClick={() => setCmdk(true)}><Icon name="search" size={14} /><span>Jump to project or action</span><kbd style={{ color: "var(--muted)" }}>⌘K</kbd></button>
          <div className="spacer" />

          <div className="agent-wrap" ref={agentRef}>
            <button className={pillClass} onClick={onPill} title={status === "online" ? "Agent connected — click to disconnect" : status === "disconnected" ? "Disconnected — click to reconnect" : "Agent offline"}>
              <Icon name={pillIcon} size={15} />{pillLabel}
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

          <button className="btn-primary" onClick={() => nav("/automation")}>
            <Icon name="zap" size={16} fill /> Start Work
          </button>
          <div className="clock">{clock}</div>
          <div className="profile-wrap" ref={menuRef}>
            <button className="avatar" onClick={() => setMenu((m) => !m)} title="Account">{initials}</button>
            {menu && (
              <div className="profile-menu">
                <div className="profile-head">
                  <div className="pn">{name}</div>
                  <div className="pe">{user?.email}</div>
                </div>
                <button className="menu-item" onClick={() => { setMenu(false); nav("/settings"); }}>
                  <Icon name="user" size={16} />Profile &amp; settings
                </button>
                <button className="menu-item" onClick={() => { setMenu(false); setLog(true); }}>
                  <Icon name="bolt" size={16} />What's new
                </button>
                <button className="menu-item danger" onClick={() => signOut()}>
                  <Icon name="logout" size={16} />Sign out
                </button>
              </div>
            )}
          </div>
        </header>
        <div className="viewport" style={{ flexDirection: "column" }}>
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
              <span>Local agent is {status === "disconnected" ? "disconnected" : "offline"}. Launching apps, browsing paths, and the focus timer are disabled — <button onClick={() => nav("/settings")}>fix in Settings</button>.</span>
              <button className="za-x" onClick={() => reconnect()}><Icon name="refresh" size={14} /></button>
            </div>
          )}
          <div style={{ flex: 1, display: "flex", minHeight: 0 }}><Outlet /></div>
        </div>
      </div>

      {log && (
        <div className="modal-bg">
          <div className="modal" style={{ width: 480 }}>
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
          </div>
        </div>
      )}
      {cmdk && <CommandPalette onClose={() => setCmdk(false)} />}
    </div>
  );
}
