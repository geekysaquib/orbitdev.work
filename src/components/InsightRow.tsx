import type { Insight, InsightSeverity } from "../lib/insights";
import { Icon } from "../lib/icons";
import { alpha } from "./ui";
import { EvidenceDisclosure } from "./EvidenceDisclosure";

export const SEVERITY_COLOR: Record<InsightSeverity, string> = { info: "var(--mint)", warning: "var(--amber)", critical: "var(--red)" };
export const SEVERITY_LABEL: Record<InsightSeverity, string> = { info: "Info", warning: "Warning", critical: "Critical" };
const SEVERITY_ICON: Record<InsightSeverity, string> = { info: "sparkles", warning: "alert", critical: "alert" };

/**
 * One row per proactive `Insight` (`src/lib/insights.ts`'s nine detectors).
 * Shared by `/intelligence` and `/ai-mode` — extracted so neither page
 * reimplements severity styling or evidence disclosure. A severity-tinted
 * left edge + icon badge make the list scannable by eye before reading any
 * text, rather than relying on a small pill in the corner.
 */
export function InsightRow({ insight, expanded, onToggle, onDismiss, onUndismiss }: {
  insight: Insight; expanded: boolean; onToggle: () => void;
  onDismiss: (id: string) => void; onUndismiss: (id: string) => void;
}) {
  const color = SEVERITY_COLOR[insight.severity];
  return (
    <div
      className="card insight-card" style={{ padding: 16, borderLeft: `3px solid ${color}`, opacity: insight.dismissed ? .6 : 1 }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }} onClick={onToggle}>
        <span className="insight-badge" style={{ background: alpha(color, 14), color }}>
          <Icon name={SEVERITY_ICON[insight.severity]} size={15} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{insight.title}</span>
            <span className="pill" style={{ height: 22, padding: "0 9px", fontSize: 10.5, color, borderColor: alpha(color, 34), background: alpha(color, 10) }}>
              {SEVERITY_LABEL[insight.severity]}
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3, lineHeight: 1.5 }}>{insight.summary}</div>
        </div>
        <span style={{ color: "var(--dim)", flexShrink: 0, marginTop: 4 }}><Icon name={expanded ? "chevD" : "chevR"} size={13} /></span>
      </div>
      {expanded && (
        <div style={{ marginTop: 12, marginLeft: 46, paddingTop: 12, borderTop: "1px solid var(--border-soft)" }}>
          <EvidenceDisclosure entities={insight.entities} />
          <div style={{ marginTop: 10 }}>
            {insight.dismissed
              ? <button className="btn ghost sm" onClick={() => onUndismiss(insight.id)}><Icon name="refresh" size={12} />Restore</button>
              : <button className="btn ghost sm" onClick={() => onDismiss(insight.id)}><Icon name="x" size={12} />Dismiss</button>}
          </div>
        </div>
      )}
    </div>
  );
}
