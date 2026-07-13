import { Children, isValidElement, useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../lib/icons";

interface OptionData { value: string; label: ReactNode; disabled?: boolean }

function childrenToText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(childrenToText).join("");
  return "";
}

/** Drop-in replacement for a native <select> with a dark, app-themed popup (native option lists can't be restyled). */
export function Select({ value, onChange, children, className, style, title, onClick, disabled, chevron = true, full = false }: {
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
  onClick?: (e: MouseEvent) => void;
  disabled?: boolean;
  chevron?: boolean;
  full?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const options: OptionData[] = Children.toArray(children)
    .filter((c): c is ReactElement<{ value?: string; disabled?: boolean; children?: ReactNode }> => isValidElement(c) && c.type === "option")
    .map((c) => {
      // Mirrors native <option>: an omitted value attribute defaults to the option's text content.
      const value = c.props.value !== undefined ? String(c.props.value) : childrenToText(c.props.children);
      return { value, label: c.props.children, disabled: c.props.disabled };
    });

  const current = options.find((o) => o.value === value) ?? options[0];

  function place() {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 160) });
  }

  function toggle(e: MouseEvent<HTMLButtonElement>) {
    onClick?.(e);
    if (disabled) return;
    setOpen((o) => {
      if (!o) place();
      return !o;
    });
  }

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: globalThis.MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  function pick(o: OptionData) {
    if (o.disabled) return;
    setOpen(false);
    onChange({ target: { value: o.value } });
  }

  return (
    <div className={"uisel" + (full ? " full" : "") + (open ? " open" : "")}>
      <button
        type="button"
        ref={triggerRef}
        className={"uisel-trigger" + (className ? " " + className : "")}
        style={style}
        title={title}
        disabled={disabled}
        onClick={toggle}
      >
        <span className="uisel-label">{current?.label ?? ""}</span>
        {chevron && <span className="uisel-chev"><Icon name="chevD" size={11} /></span>}
      </button>
      {open && pos && createPortal(
        <div ref={popRef} className="uisel-pop" style={{ top: pos.top, left: pos.left, minWidth: pos.width }}>
          {options.length === 0 && <div className="uisel-empty">No options</div>}
          {options.map((o) => (
            <div
              key={o.value}
              className={"uisel-opt" + (o.value === value ? " sel" : "") + (o.disabled ? " off" : "")}
              onClick={() => pick(o)}
            >
              {o.label}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
