import { useState } from "react";
import type { Entity } from "../engines/knowledge";
import { Icon } from "../lib/icons";

export function attrList(attributes: Record<string, unknown>): string {
  return Object.entries(attributes)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
}

/** Collapsed-by-default evidence list — the actual entities an `IntelligenceAnswer`/`Insight` was computed from. Shared by `AnswerDetail` and `InsightRow`. */
export function EvidenceDisclosure({ entities }: { entities: Entity[] }) {
  const [open, setOpen] = useState(false);
  if (entities.length === 0) return null;
  const byType = new Map<string, Entity[]>();
  for (const e of entities) {
    const list = byType.get(e.ref.type) ?? [];
    list.push(e);
    byType.set(e.ref.type, list);
  }
  return (
    <div style={{ marginTop: 10 }}>
      <button className="btn ghost sm" onClick={() => setOpen((o) => !o)} style={{ color: "var(--dim)" }}>
        <Icon name={open ? "chevD" : "chevR"} size={11} />Show evidence ({entities.length})
      </button>
      {open && (
        <div className="card" style={{ marginTop: 8, padding: 12 }}>
          <div className="ds" style={{ marginBottom: 6 }}>The data this answer was computed from</div>
          {[...byType.entries()].map(([type, list]) => (
            <div key={type} style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--dim)", textTransform: "uppercase" }}>{type}</div>
              {list.map((e) => (
                <div key={`${e.ref.type}:${e.ref.id}`} style={{ display: "flex", gap: 8, fontSize: 12, padding: "2px 0" }}>
                  <span style={{ color: "var(--text)" }}>{e.label}</span>
                  {attrList(e.attributes) && <span style={{ color: "var(--dim)" }}>— {attrList(e.attributes)}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
