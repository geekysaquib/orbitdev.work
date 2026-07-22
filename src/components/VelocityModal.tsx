import { useEffect, useState } from "react";
import { Icon } from "../lib/icons";
import { Modal } from "./Modal";
import { VelocityChart } from "./VelocityChart";
import { explainVelocity, type SprintVelocity } from "../lib/velocity";
import type { ProviderKeys, CloudProvider } from "../lib/ai";

/** Velocity chart in its own popup, with an AI-generated read of the trend underneath. */
export function VelocityModal({ rows, keys, preferred, onClose }: {
  rows: SprintVelocity[]; keys: ProviderKeys; preferred?: CloudProvider; onClose: () => void;
}) {
  const [ai, setAi] = useState<{ loading: boolean; text: string; error?: string }>({ loading: true, text: "" });

  async function explain() {
    setAi({ loading: true, text: "" });
    const r = await explainVelocity(rows, keys, preferred);
    setAi({ loading: false, text: r.text || "", error: r.error });
  }

  useEffect(() => {
    explain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal onClose={onClose} style={{ width: 640, maxWidth: "94vw" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ display: "flex", alignItems: "center", gap: 9 }}><Icon name="activity" size={18} />Velocity</h3>
        <button className="iconbtn" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>

      <div style={{ marginTop: 14 }}>
        <VelocityChart rows={rows} />
      </div>

      <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border-soft)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 600, color: "var(--muted)" }}>
          <span style={{ color: "var(--mint)" }}><Icon name="sparkles" size={14} /></span>What this means
        </div>
        {ai.loading ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--dim)", fontSize: 13, marginTop: 10 }}>
            <Icon name="loader" size={15} className="spin" />Asking AI…
          </div>
        ) : ai.error ? (
          <p style={{ marginTop: 10, color: "var(--amber)", fontSize: 13 }}>{ai.error}</p>
        ) : (
          <p style={{ marginTop: 10, color: "var(--text)", fontSize: 13, lineHeight: 1.6 }}>{ai.text}</p>
        )}
        <button className="btn ghost" disabled={ai.loading} onClick={explain} style={{ marginTop: 12 }}>
          <Icon name="refresh" size={13} />Regenerate
        </button>
      </div>
    </Modal>
  );
}
