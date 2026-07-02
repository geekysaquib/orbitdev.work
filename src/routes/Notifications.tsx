import { Icon } from "../lib/icons";
import { ACCENT } from "../components/ui";
import { useTable } from "../hooks/useTable";
import type { Notification } from "../lib/types";

const ICON: Record<string, [string, string]> = {
  ticket: ["ticket", ACCENT.amber], deploy: ["upload", ACCENT.mint],
  git: ["git", ACCENT.blue], deadline: ["cal", ACCENT.red], system: ["bolt", ACCENT.violet],
};

export default function Notifications() {
  const { rows, update } = useTable<Notification>("notifications");
  const unread = rows.filter((n) => !n.read);

  const markAll = () => unread.forEach((n) => update(n.id, { read: true } as Partial<Notification>));
  const ago = (iso: string) => {
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 60) return `${m}m`; if (m < 1440) return `${Math.floor(m / 60)}h`; return `${Math.floor(m / 1440)}d`;
  };

  return (
    <main className="page">
      <div className="rowhead">
        <div><div className="h1">Notifications</div><div className="sub">{unread.length} unread</div></div>
        {unread.length > 0 && <button className="btn ghost" onClick={markAll}><Icon name="check" size={15} />Mark all read</button>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 22, maxWidth: 720 }}>
        {rows.map((n) => {
          const [icn, col] = ICON[n.kind] || ["bell", ACCENT.muted];
          return (
            <div key={n.id} className={"notif" + (n.read ? "" : " unread")} onClick={() => !n.read && update(n.id, { read: true } as Partial<Notification>)} style={{ cursor: n.read ? "default" : "pointer" }}>
              <span className="nicon" style={{ color: col }}><Icon name={icn} size={17} /></span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, color: "var(--text)" }}>{n.title}</div>
                {n.body && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3, lineHeight: 1.4 }}>{n.body}</div>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="mono" style={{ fontSize: 11, color: "var(--dim)" }}>{ago(n.created_at)}</span>
                {!n.read && <span className="prdot" style={{ background: ACCENT.mint }} />}
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <div style={{ color: "var(--dim)", padding: 20 }}>You're all caught up.</div>}
      </div>
    </main>
  );
}
