import { useEffect, useState } from "react";
import { dockerStats, type DockerStat } from "../lib/agent";

const MAX_SAMPLES = 30;
const POLL_MS = 4000;

/** `docker stats` is snapshot-oriented even in --no-stream mode, so this polls and accumulates a short rolling window client-side into a real (if brief) time series rather than a single static bar. */
export function DockerStatsPanel() {
  const [available, setAvailable] = useState(true);
  const [latest, setLatest] = useState<DockerStat[]>([]);
  const [history, setHistory] = useState<Record<string, number[]>>({});

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const r = await dockerStats();
      if (cancelled) return;
      setAvailable(r.available);
      setLatest(r.stats);
      setHistory((prev) => {
        const next: Record<string, number[]> = {};
        for (const s of r.stats) next[s.name] = [...(prev[s.name] || []), s.cpuPercent].slice(-MAX_SAMPLES);
        return next;
      });
    };
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  if (!available || latest.length === 0) {
    return <div style={{ color: "var(--dim)", fontSize: 12.5 }}>{available ? "No running containers." : "Docker isn't available."}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {latest.map((s) => (
        <div key={s.name}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 12, marginBottom: 5 }}>
            <span className="mono" style={{ color: "var(--text)" }}>{s.name}</span>
            <span style={{ color: "var(--dim)" }}>{s.cpuPercent.toFixed(1)}% CPU · {s.memUsage} ({s.memPercent.toFixed(1)}%)</span>
          </div>
          <Sparkline values={history[s.name] || [s.cpuPercent]} />
        </div>
      ))}
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const W = 100, H = 28;
  const max = Math.max(10, ...values);
  const points = values.map((v, i) => {
    const x = values.length > 1 ? (i / (values.length - 1)) * W : W;
    return `${x},${H - (v / max) * H}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block" }}>
      <polyline points={points} fill="none" stroke="var(--mint)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
