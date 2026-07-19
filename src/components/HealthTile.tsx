import type { ReactNode } from "react";
import { Icon } from "../lib/icons";
import type { HealthState } from "../hooks/useIntegrationHealth";

const STATE_LABEL: Record<HealthState, string> = { ok: "Healthy", warn: "Needs attention", unknown: "Not set up" };
const STATE_CLASS: Record<HealthState, string> = { ok: "pill live", warn: "pill warn", unknown: "pill" };

/** One integration status tile, shared by the Health page. */
export function HealthTile({ icon, label, sub, state, cta, children }: {
  icon: string; label: string; sub?: string; state: HealthState;
  cta?: { label: string; onClick: () => void };
  children?: ReactNode;
}) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ color: state === "ok" ? "var(--mint)" : state === "warn" ? "var(--amber)" : "var(--dim)" }}><Icon name={icon} size={17} /></span>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</div>
        </div>
        <span className={STATE_CLASS[state]}>
          <span className={"dotled" + (state === "warn" ? " warn" : "")} />
          {STATE_LABEL[state]}
        </span>
      </div>
      {sub && <div className="ds" style={{ marginTop: 8 }}>{sub}</div>}
      {children}
      {cta && state !== "ok" && (
        <button className="btn ghost" style={{ marginTop: 12 }} onClick={cta.onClick}><Icon name="chevR" size={14} />{cta.label}</button>
      )}
    </div>
  );
}
