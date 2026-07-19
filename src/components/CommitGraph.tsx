import { useMemo } from "react";
import type { GitCommit } from "../lib/agent";

const ROW_H = 54;
const LANE_W = 16;
const DOT_R = 4.5;
const PAD_L = 12;

interface Positioned extends GitCommit { row: number; lane: number; }

/**
 * Lane assignment for a simplified commit graph — not a full DAG layout like
 * SchemaDiagram.tsx's ER-diagram layering (that solves N-to-N foreign keys;
 * a commit graph is one parent per commit, occasionally two for a merge).
 * Each lane tracks the hash it's waiting for next; a commit claims whichever
 * lane was expecting it (or opens a new one), then its first parent
 * continues that lane and any additional parents open new lanes. Edges are
 * still drawn from real per-commit positions (not lane bookkeeping alone),
 * so a merge's two parents correctly land wherever they actually ended up
 * even if two lanes were both nominally "waiting" for the same ancestor.
 */
function layout(commits: GitCommit[]) {
  const lanes: (string | null)[] = [];
  const positioned: Positioned[] = [];
  const rowOf = new Map<string, number>();
  const laneOf = new Map<string, number>();

  commits.forEach((c, row) => {
    let lane = lanes.indexOf(c.hash);
    if (lane === -1) { lane = lanes.length; lanes.push(c.hash); }
    positioned.push({ ...c, row, lane });
    rowOf.set(c.hash, row);
    laneOf.set(c.hash, lane);

    const parents = c.parents ?? [];
    lanes[lane] = parents[0] ?? null;
    for (let i = 1; i < parents.length; i++) {
      if (!lanes.includes(parents[i])) lanes.push(parents[i]);
    }
  });

  return { positioned, rowOf, laneOf, laneCount: Math.max(1, lanes.length) };
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// A stable hue per author name (not a random color per render) so the same
// person reads as the same color throughout the graph.
function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = 60_000, hr = 60 * min, day = 24 * hr;
  if (diff < min) return "just now";
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  if (diff < 30 * day) return `${Math.floor(diff / day)}d ago`;
  if (diff < 365 * day) return `${Math.floor(diff / (30 * day))}mo ago`;
  return `${Math.floor(diff / (365 * day))}y ago`;
}

export function CommitGraph({ commits, onSelect, selectedHash }: {
  commits: GitCommit[]; onSelect: (hash: string) => void; selectedHash?: string | null;
}) {
  const { positioned, rowOf, laneOf, laneCount } = useMemo(() => layout(commits), [commits]);
  const height = positioned.length * ROW_H;
  const graphWidth = PAD_L * 2 + (laneCount - 1) * LANE_W;

  const x = (lane: number) => PAD_L + lane * LANE_W;
  const y = (row: number) => row * ROW_H + ROW_H / 2;

  return (
    <div className="commit-graph">
      <svg width={graphWidth} height={height} style={{ flexShrink: 0 }}>
        {positioned.map((c) =>
          (c.parents ?? []).map((p) => {
            const x1 = x(c.lane), y1 = y(c.row);
            const pr = rowOf.get(p), pl = laneOf.get(p);
            if (pr === undefined || pl === undefined) {
              // parent falls outside the fetched window — stub toward the bottom, implying more history below.
              return <path key={c.hash + p} className="cg-edge" d={`M${x1} ${y1} L${x1} ${height}`} />;
            }
            const x2 = x(pl), y2 = y(pr);
            const midY = (y1 + y2) / 2;
            const d = x1 === x2 ? `M${x1} ${y1} L${x2} ${y2}` : `M${x1} ${y1} C${x1} ${midY},${x2} ${midY},${x2} ${y2}`;
            return <path key={c.hash + p} className="cg-edge" d={d} />;
          })
        )}
        {positioned.map((c) => (
          <circle
            key={c.hash}
            className={"cg-dot" + (c.row === 0 ? " head" : "") + (c.hash === selectedHash ? " on" : "")}
            cx={x(c.lane)} cy={y(c.row)} r={c.row === 0 ? DOT_R + 1 : DOT_R}
          />
        ))}
      </svg>
      <div className="commit-list">
        {positioned.map((c) => (
          <button key={c.hash} className={"commit-row" + (c.hash === selectedHash ? " on" : "")} style={{ height: ROW_H }} onClick={() => onSelect(c.hash)}>
            <span className="commit-avatar" style={{ background: `hsl(${hueOf(c.author)} 42% 40%)` }}>{initialsOf(c.author)}</span>
            <div className="commit-main">
              <div className="commit-subject" title={c.subject}>{c.subject}</div>
              <div className="commit-meta">
                <span className="mono commit-hash">{c.hash.slice(0, 7)}</span>
                <span className="commit-author">{c.author}</span>
              </div>
            </div>
            <span className="commit-date mono" title={new Date(c.date).toLocaleString()}>{relativeDate(c.date)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
