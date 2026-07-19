import { useEffect, type CSSProperties, type ReactNode } from "react";

/**
 * Shared modal shell — backdrop-click-to-close and Escape-to-close in one
 * place, so every modal behaves the same instead of each one reimplementing
 * (or forgetting) this handling individually.
 */
export function Modal({ onClose, style, className, children }: {
  onClose: () => void; style?: CSSProperties; className?: string; children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={"modal" + (className ? ` ${className}` : "")} style={style}>
        {children}
      </div>
    </div>
  );
}
