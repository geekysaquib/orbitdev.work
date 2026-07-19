import { useEffect, useState } from "react";
import { Icon } from "../lib/icons";
import { Modal } from "./Modal";

/** Shared display shell for the AI commit-message and PR-description writers — a title, the generated text, copy/regenerate/close. */
export function AiWriterModal({ title, loading, text, error, onClose, onRegenerate }: {
  title: string; loading: boolean; text: string; error?: string; onClose: () => void; onRegenerate: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* clipboard blocked */ }
  }

  return (
    <Modal onClose={onClose} style={{ width: 560, maxWidth: "94vw" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ display: "flex", alignItems: "center", gap: 9 }}><span style={{ color: "var(--mint)" }}><Icon name="sparkles" size={18} /></span>{title}</h3>
        <button className="iconbtn" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--dim)", fontSize: 13, marginTop: 18 }}>
          <Icon name="loader" size={15} className="spin" />Generating…
        </div>
      ) : error ? (
        <p style={{ marginTop: 14, color: "var(--amber)", fontSize: 13 }}>{error}</p>
      ) : (
        <textarea
          readOnly value={text} rows={10}
          style={{ width: "100%", marginTop: 14, resize: "vertical", fontFamily: "var(--mono)", fontSize: 12.5, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 9, padding: 12, color: "var(--text)" }}
        />
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button className="btn ghost" disabled={loading} onClick={onRegenerate}><Icon name="refresh" size={14} />Regenerate</button>
        <button className="btn-primary" disabled={loading || !text} onClick={copy}><Icon name={copied ? "check" : "copy"} size={14} />{copied ? "Copied" : "Copy"}</button>
      </div>
    </Modal>
  );
}
