import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { ACCENT, Empty, OrbitLoader } from "../components/ui";
import { useTable } from "../hooks/useTable";
import { useToast } from "../context/Toast";
import { fetchSettings, saveSettings } from "../lib/settings";
import {
  NOTIF_ICON, NOTIF_KIND_LABEL, NOTIF_KINDS, notifAgo, buildDigest,
  isDesktopSupported, requestDesktopPermission, DEFAULT_NOTIF_PREFS, type NotificationPrefs,
} from "../lib/notifications";
import type { Notification } from "../lib/types";

export default function Notifications() {
  const { rows, update, loading } = useTable<Notification>("notifications");
  const toast = useToast();
  const nav = useNavigate();
  const unread = rows.filter((n) => !n.read);
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIF_PREFS);
  const [prefsOpen, setPrefsOpen] = useState(false);

  useEffect(() => { fetchSettings().then((s) => setPrefs(s.notifications || DEFAULT_NOTIF_PREFS)); }, []);

  async function updatePrefs(next: NotificationPrefs) {
    setPrefs(next);
    await saveSettings({ notifications: next });
  }
  async function toggleDesktop() {
    if (!prefs.desktop) {
      const granted = await requestDesktopPermission();
      if (!granted) { toast("Desktop notifications were blocked — allow them in your browser's site settings."); return; }
    }
    updatePrefs({ ...prefs, desktop: !prefs.desktop });
  }
  function toggleMute(kind: string) {
    const muted = prefs.muted.includes(kind) ? prefs.muted.filter((k) => k !== kind) : [...prefs.muted, kind];
    updatePrefs({ ...prefs, muted });
  }

  const markAll = () => unread.forEach((n) => update(n.id, { read: true } as Partial<Notification>));
  const digest = buildDigest(rows);

  return (
    <main className="page">
      <div className="rowhead">
        <div><div className="h1">Notifications</div><div className="sub">{loading ? "Loading…" : `${unread.length} unread`}</div></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={"btn ghost" + (prefsOpen ? " on" : "")} onClick={() => setPrefsOpen((o) => !o)}><Icon name="settings" size={14} />Preferences</button>
          {unread.length > 0 && <button className="btn ghost" onClick={markAll}><Icon name="check" size={15} />Mark all read</button>}
        </div>
      </div>

      {prefsOpen && (
        <div className="card" style={{ padding: 18, marginTop: 18, maxWidth: 720 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Desktop notifications</div>
              <div style={{ fontSize: 12, color: "var(--dim)", marginTop: 2 }}>
                {isDesktopSupported() ? "Get a native alert when a new notification arrives while ORBIT is open." : "Not supported in this browser."}
              </div>
            </div>
            <span className={"toggle" + (prefs.desktop ? " on" : "")} onClick={isDesktopSupported() ? toggleDesktop : undefined} />
          </div>
          <div className="eyebrow" style={{ marginTop: 18 }}>Mute by type</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
            {NOTIF_KINDS.map((kind) => {
              const [icn, col] = NOTIF_ICON[kind] || ["bell", ACCENT.muted];
              const muted = prefs.muted.includes(kind);
              return (
                <div key={kind} className="conn">
                  <span className="ico" style={{ color: muted ? "var(--dim)" : col }}><Icon name={icn} size={16} /></span>
                  <div style={{ flex: 1, fontSize: 13, color: muted ? "var(--dim)" : "var(--text)" }}>{NOTIF_KIND_LABEL[kind]}</div>
                  <span className={"toggle" + (!muted ? " on" : "")} onClick={() => toggleMute(kind)} title={muted ? "Muted" : "Unmuted"} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loading && <div className="page-loader"><OrbitLoader label="Loading notifications…" /></div>}

      {!loading && digest.length > 0 && (
        <>
          <div className="eyebrow" style={{ marginTop: 24 }}>Today's digest</div>
          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            {digest.map((g) => (
              <div key={g.kind} className="conn" style={{ minWidth: 200, flex: "1 0 200px" }}>
                <span className="ico" style={{ color: g.color }}><Icon name={g.icon} size={16} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{g.label} · {g.count}</div>
                  <div style={{ fontSize: 11.5, color: "var(--dim)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.latest.title}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {!loading && <>
      <div className="eyebrow" style={{ marginTop: 24 }}>All notifications</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12, maxWidth: 720 }}>
        {rows.map((n) => {
          const [icn, col] = NOTIF_ICON[n.kind] || ["bell", ACCENT.muted];
          return (
            <div key={n.id} className={"notif" + (n.read ? "" : " unread")} onClick={() => { if (!n.read) update(n.id, { read: true } as Partial<Notification>); if (n.link) nav(n.link); }} style={{ cursor: n.read && !n.link ? "default" : "pointer" }}>
              <span className="nicon" style={{ color: col }}><Icon name={icn} size={17} /></span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, color: "var(--text)" }}>{n.title}</div>
                {n.body && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3, lineHeight: 1.4 }}>{n.body}</div>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="mono" style={{ fontSize: 11, color: "var(--dim)" }}>{notifAgo(n.created_at)}</span>
                {!n.read && <span className="prdot" style={{ background: ACCENT.mint }} />}
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <Empty icon="bell" title="You're all caught up" sub="Ticket assignments, deploys, and deadline reminders will show up here." />}
      </div>
      </>}
    </main>
  );
}
