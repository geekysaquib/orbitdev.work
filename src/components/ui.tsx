import type { ReactNode } from "react";
import { Icon } from "../lib/icons";

export const STACK: Record<string, string> = {
  React: "#61DAFB", ".NET": "#B692FF", Python: "#F5C542", "Next.js": "#ECEEF2",
  TS: "#5B8DEF", PyTorch: "#EE7C4C", PySide6: "#42D392",
};
export const ACCENT = { mint: "#37DFA0", blue: "#5B8DEF", amber: "#E4A951", red: "#EF6D6D", violet: "#A98BF5", muted: "#8B92A0", dim: "#565C68" };

export const prColor = (p: string) => (p === "high" ? ACCENT.red : p === "med" ? ACCENT.amber : ACCENT.dim);

export function Chip({ name }: { name: string }) {
  const c = STACK[name] ?? ACCENT.muted;
  return <span className="chip" style={{ color: c, background: c + "16", border: `1px solid ${c}30` }}>{name}</span>;
}
export function Badge({ text, color }: { text: string; color: string }) {
  return <span className="badge" style={{ color, background: color + "16", border: `1px solid ${color}30` }}>{text}</span>;
}
export function Stat({ icon, label, value, tone, sub }:
  { icon: string; label: string; value: string; tone: string; sub?: string }) {
  return (
    <div className="card stat fade">
      <div className="lab"><span style={{ color: tone }}><Icon name={icon} size={15} /></span>{label}</div>
      <div className="val">{value}</div>
      {sub && <div className="subv">{sub}</div>}
    </div>
  );
}
export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}
