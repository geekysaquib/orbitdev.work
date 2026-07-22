import type { Insight, InsightSeverity } from "../lib/insights";
import { Icon } from "../lib/icons";
import { EvidenceDisclosure } from "./EvidenceDisclosure";

export const SEVERITY_COLOR: Record<InsightSeverity, string> = { info: "var(--mint)", warning: "var(--amber)", critical: "var(--red)" };
export const SEVERITY_LABEL: Record<InsightSeverity, string> = { info: "Info", warning: "Warning", critical: "Critical" };

/**
 * One row per proactive `Insight` (`src/lib/insights.ts`'s nine detectors).
 * Shared by `/intelligence` and the `/home` dashboard's condensed insight
 * feed — extracted so neither page reimplements severity styling or evidence
 * disclosure.
 */
export function InsightRow({ insight, expanded, onToggle, onDismiss, onUndismiss }: {
  insight: Insight; expanded: boolean; onToggle: () => void;
  onDismiss: (id: string) => void; onUndismiss: (id: string) => void;
}) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, cursor: "pointer" }} onClick={onToggle}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <span style={{ color: "var(--dim)", flexShrink: 0, marginTop: 3 }}><Icon name={expanded ? "chevD" : "chevR"} size={11} /></span>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{insight.title}</div>
            <div style={{ fontSize: 12, color: "var(--dim)", marginTop: 2 }}>{insight.summary}</div>
          </div>
        </div>
        <span
          className="pill" style={{ flexShrink: 0, color: SEVERITY_COLOR[insight.severity], borderColor: SEVERITY_COLOR[insight.severity] }}
        >
          {SEVERITY_LABEL[insight.severity]}
        </span>
      </div>
      {expanded && (
        <div style={{ marginTop: 10, marginLeft: 19 }}>
          <EvidenceDisclosure entities={insight.entities} />
          <div style={{ marginTop: 8 }}>
            {insight.dismissed
              ? <button className="btn ghost sm" onClick={() => onUndismiss(insight.id)}>Restore</button>
              : <button className="btn ghost sm" onClick={() => onDismiss(insight.id)}>Dismiss</button>}
          </div>
        </div>
      )}
    </div>
  );
}
