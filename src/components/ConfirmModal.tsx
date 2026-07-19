import { Icon } from "../lib/icons";
import { Modal } from "./Modal";

export function ConfirmModal({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", danger, onConfirm, onCancel }: {
  title: string; message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal onClose={onCancel} style={{ width: 420 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ color: danger ? "var(--red)" : "var(--amber)" }}><Icon name="alert" size={18} /></span>
        <h3>{title}</h3>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 10, lineHeight: 1.5 }}>{message}</p>
      <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
        <button className="btn ghost" onClick={onCancel}>{cancelLabel}</button>
        <button className={"btn" + (danger ? " danger" : " accent")} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
