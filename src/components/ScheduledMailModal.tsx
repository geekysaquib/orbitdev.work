import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { Icon } from "../lib/icons";
import { OrbitLoader } from "./ui";
import { useToast } from "../context/Toast";
import { useTimezone, tzDateTime } from "../context/Timezone";
import { scheduledEmails, cancelScheduledEmail, type ScheduledEmail } from "../lib/scheduledEmails";

const STATUS_LABEL: Record<ScheduledEmail["status"], string> = { pending: "Scheduled", sent: "Sent", failed: "Failed", canceled: "Canceled" };
const STATUS_COLOR: Record<ScheduledEmail["status"], string> = { pending: "var(--amber)", sent: "var(--mint)", failed: "var(--red)", canceled: "var(--dim)" };

/** Lists queued/sent scheduled messages, with cancel for anything still pending. */
export function ScheduledMailModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { tz } = useTimezone();
  const [rows, setRows] = useState<ScheduledEmail[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const r = await scheduledEmails();
    if (r.ok) setRows(r.emails);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  async function cancel(id: string) {
    const r = await cancelScheduledEmail(id);
    if (!r.ok) { toast(`Couldn't cancel: ${r.error}`); return; }
    refresh();
  }

  return (
    <Modal onClose={onClose} style={{ width: 560, maxWidth: "94vw" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ display: "flex", alignItems: "center", gap: 9 }}><Icon name="clock" size={17} />Scheduled mail</h3>
        <button className="iconbtn" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>
      {loading ? (
        <div style={{ marginTop: 14 }}><OrbitLoader label="Loading…" size={22} /></div>
      ) : rows.length === 0 ? (
        <div style={{ marginTop: 14, color: "var(--dim)", fontSize: 13 }}>Nothing scheduled. Use "Schedule…" in Compose to send later.</div>
      ) : (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((r) => (
            <div key={r.id} className="setrow">
              <div className="l">
                <div className="nm">{r.subject || "(no subject)"} <span style={{ color: "var(--dim)", fontWeight: 400 }}>→ {r.to}</span></div>
                <div className="ds">
                  <span style={{ color: STATUS_COLOR[r.status] }}>{STATUS_LABEL[r.status]}</span>
                  {" · "}{tzDateTime(tz, new Date(r.sendAt))}
                  {r.status === "failed" && r.error ? ` · ${r.error}` : ""}
                </div>
              </div>
              {r.status === "pending" && <button className="btn ghost" onClick={() => cancel(r.id)}><Icon name="x" size={14} />Cancel</button>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
