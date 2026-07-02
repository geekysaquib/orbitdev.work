import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { useAuth } from "../context/AuthContext";
import { pingAgent } from "../lib/agent";
import { supabase } from "../lib/supabase";

const NAV = [
  { to: "/", label: "Dashboard", icon: "grid", end: true },
  { to: "/projects", label: "Projects", icon: "boxes" },
  { to: "/tickets", label: "Tickets", icon: "ticket" },
  { to: "/tasks", label: "Tasks", icon: "layers" },
  { to: "/calendar", label: "Calendar", icon: "cal" },
  { to: "/automation", label: "Automation", icon: "zap" },
  { to: "/time", label: "Time", icon: "timer" },
  { to: "/notifications", label: "Notifications", icon: "bell" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

export function Layout() {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const [agent, setAgent] = useState(false);
  const [clock, setClock] = useState("");
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      const n = new Date();
      setClock(`${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { pingAgent().then(setAgent); }, []);
  useEffect(() => {
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("read", false)
      .then(({ count }) => setUnread(count ?? 0));
  }, []);

  const initials = (user?.user_metadata?.full_name as string | undefined)?.split(" ")
    .map((s) => s[0]).slice(0, 2).join("").toUpperCase() ?? "SK";

  return (
    <div className="app">
      <nav className="rail">
        <div className="logo"><Icon name="rocket" size={19} /></div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}
            className={({ isActive }) => "navbtn" + (isActive ? " on" : "")}>
            <Icon name={n.icon} size={20} />
            {n.to === "/notifications" && unread > 0 && <span className="dotbadge" />}
            <span className="tip">{n.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="shell">
        <header className="topbar">
          <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
            <span className="wordmark">ORBIT</span><span className="ver">v0.1</span>
          </div>
          <div className="searchbar"><Icon name="search" size={14} /><span>Jump to project or action</span><kbd style={{ color: "var(--muted)" }}>⌘K</kbd></div>
          <div className="spacer" />
          <button className={"pill" + (agent ? " live" : "")} onClick={() => pingAgent().then(setAgent)}>
            <Icon name={agent ? "zap" : "plug"} size={15} />Agent {agent ? "connected" : "offline"}<span className="dotled" />
          </button>
          <button className="btn-primary" onClick={() => nav("/automation")}>
            <Icon name="zap" size={16} fill /> Start Work
          </button>
          <div className="clock">{clock}</div>
          <button className="avatar" title="Sign out" onClick={() => signOut()}>{initials}</button>
        </header>
        <div className="viewport"><Outlet /></div>
      </div>
    </div>
  );
}
