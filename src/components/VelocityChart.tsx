import { useMemo } from "react";
import { ACCENT } from "./ui";
import { velocityMetric, type SprintVelocity } from "../lib/velocity";

const W = 640, H = 160, PAD_L = 8, PAD_R = 8, PAD_T = 22, PAD_B = 28, BAR_GAP = 10;

export function VelocityChart({ rows }: { rows: SprintVelocity[] }) {
  const { values, label } = velocityMetric(rows);

  const { bars, avgY, avg } = useMemo(() => {
    const max = Math.max(1, ...values);
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;
    const barW = Math.min(48, (plotW - BAR_GAP * (values.length - 1)) / Math.max(values.length, 1));
    const totalW = barW * values.length + BAR_GAP * Math.max(values.length - 1, 0);
    const startX = PAD_L + Math.max(0, (plotW - totalW) / 2);
    const bars = values.map((v, i) => {
      const h = (v / max) * plotH;
      const x = startX + i * (barW + BAR_GAP);
      return { x, y: PAD_T + plotH - h, w: barW, h: Math.max(h, v > 0 ? 2 : 0), value: v, name: rows[i].sprintName };
    });
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const avgY = PAD_T + plotH - (avg / max) * plotH;
    return { bars, avgY, avg };
  }, [values, rows]);

  if (rows.length === 0) return <div style={{ color: "var(--dim)", fontSize: 12.5 }}>No sprints to chart yet.</div>;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block", maxHeight: H, overflow: "visible" }}>
        <line x1={PAD_L} x2={W - PAD_R} y1={avgY} y2={avgY} stroke="var(--dim)" strokeWidth={1} strokeDasharray="3 3" />
        {bars.map((b, i) => (
          <g key={rows[i].sprintId}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={4} fill={ACCENT.mint}>
              <title>{`${b.name}: ${b.value} ${label}`}</title>
            </rect>
            {b.value > 0 && (
              <text x={b.x + b.w / 2} y={b.y - 6} textAnchor="middle" fontSize={10.5} fill="var(--muted)" className="mono">{b.value}</text>
            )}
            <text x={b.x + b.w / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--dim)">
              {b.name.length > 10 ? `${b.name.slice(0, 9)}…` : b.name}
            </text>
          </g>
        ))}
      </svg>
      <div style={{ fontSize: 11, color: "var(--dim)", marginTop: 4 }}>
        Average: <span className="mono" style={{ color: "var(--muted)" }}>{avg.toFixed(1)} {label}</span> / sprint
      </div>
    </div>
  );
}
