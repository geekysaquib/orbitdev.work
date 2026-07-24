import { useNavigate } from "react-router-dom";
import type { Insight } from "../lib/insights";
import { SEVERITY_COLOR } from "./InsightRow";
import { Icon } from "../lib/icons";
import { alpha } from "./ui";

/**
 * The lightweight, ambient form of an `Insight` — a severity-colored icon
 * and a title, nothing else. Used by pages that surface Insights in passing
 * (Dashboard, Time Tracking, Teams) without reproducing the full
 * expandable/dismissible experience that belongs to `/intelligence` and
 * `/ai-mode` alone. Always navigates to `/intelligence` — this is a preview,
 * not a place to act on the insight.
 */
export function InsightPreviewRow({ insight }: { insight: Insight }) {
  const nav = useNavigate();
  const color = SEVERITY_COLOR[insight.severity];
  const icon = insight.severity === "info" ? "sparkles" : "alert";
  return (
    <button className="insight-row" onClick={() => nav("/intelligence")} title={insight.summary}>
      <span className="ir-ic" style={{ color, background: alpha(color, 14) }}><Icon name={icon} size={12} /></span>
      <span className="ir-title">{insight.title}</span>
      <span className="ir-chev"><Icon name="chevR" size={12} /></span>
    </button>
  );
}
