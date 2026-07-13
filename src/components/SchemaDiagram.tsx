import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from "react";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import { Icon } from "../lib/icons";
import { OrbitLoader, Empty } from "./ui";
import { pgSchema, type PgSchema, type PgSchemaTable, type PgForeignKey, type PgServer } from "../lib/pg";

const CARD_W = 264;
const HEADER_H = 40;
const ROW_H = 25;
const PAD_V = 8;
const GAP_X = 130;
const GAP_Y = 26;
const PAD = 28;
const SECTION_GAP = 60;
const LABEL_H = 24;
const STAND_GAP_X = 36;
const STAND_GAP_Y = 24;
const STAND_COLS = 4;

const keyOf = (schema: string, table: string) => `${schema}.${table}`;
const cardHeight = (t: PgSchemaTable) => HEADER_H + PAD_V * 2 + t.columns.length * ROW_H;

interface Card { key: string; table: PgSchemaTable; x: number; y: number; w: number; h: number }
interface Edge { id: string; fromKey: string; toKey: string; self: boolean; d: string }
interface Diagram {
  cards: Card[]; edges: Edge[]; standaloneCards: Card[]; fkColSet: Set<string>;
  width: number; height: number; hasGraph: boolean; showStandaloneLabel: boolean; standaloneY: number;
}

/**
 * Longest-path layering (roots on the left, dependents on the right), a few barycenter sweeps to
 * cut down edge crossings, and standalone tables placed in a grid beneath — all in one coordinate
 * space so the whole schema is a single exportable canvas. Pure geometry, no DOM measurement, so it
 * stays in sync with the fixed-height CSS below.
 */
function buildDiagram(schema: PgSchema): Diagram {
  const byKey = new Map(schema.tables.map((t) => [keyOf(t.schema, t.name), t]));
  const touched = new Set<string>();
  const outEdges = new Map<string, Set<string>>();
  const adjacency = new Map<string, Set<string>>();
  for (const t of schema.tables) { outEdges.set(keyOf(t.schema, t.name), new Set()); adjacency.set(keyOf(t.schema, t.name), new Set()); }
  const fkColSet = new Set<string>();
  const links: { fk: PgForeignKey; fromKey: string; toKey: string; self: boolean }[] = [];

  for (const fk of schema.foreignKeys) {
    const fromKey = keyOf(fk.schema, fk.table);
    const toKey = keyOf(fk.refSchema, fk.refTable);
    if (!byKey.has(fromKey) || !byKey.has(toKey)) continue;
    touched.add(fromKey); touched.add(toKey);
    for (const c of fk.columns) fkColSet.add(`${fromKey}.${c}`);
    const self = fromKey === toKey;
    links.push({ fk, fromKey, toKey, self });
    if (!self) { outEdges.get(fromKey)!.add(toKey); adjacency.get(fromKey)!.add(toKey); adjacency.get(toKey)!.add(fromKey); }
  }

  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  function calcLayer(key: string): number {
    if (layer.has(key)) return layer.get(key)!;
    if (visiting.has(key)) return 0; // cycle guard
    visiting.add(key);
    let max = -1;
    for (const ref of outEdges.get(key) ?? []) max = Math.max(max, calcLayer(ref));
    visiting.delete(key);
    const L = max + 1;
    layer.set(key, L);
    return L;
  }
  for (const key of touched) calcLayer(key);

  const byLayer = new Map<number, string[]>();
  for (const key of touched) {
    const L = layer.get(key) ?? 0;
    if (!byLayer.has(L)) byLayer.set(L, []);
    byLayer.get(L)!.push(key);
  }
  const layerNums = [...byLayer.keys()].sort((a, b) => a - b);
  for (const L of layerNums) byLayer.get(L)!.sort();

  // Barycenter sweeps: reorder each layer by the average position of its neighbors in the
  // previously-ordered adjacent layer, alternating left->right and right->left passes.
  const posInLayer = new Map<string, number>();
  function reindex() { for (const L of layerNums) byLayer.get(L)!.forEach((k, i) => posInLayer.set(k, i)); }
  reindex();
  const passes = layerNums.length > 1 ? 4 : 0;
  for (let pass = 0; pass < passes; pass++) {
    const forward = pass % 2 === 0;
    const seq = forward ? layerNums : [...layerNums].reverse();
    for (const L of seq) {
      const neighborLayer = forward ? L - 1 : L + 1;
      if (!byLayer.has(neighborLayer)) continue;
      const arr = byLayer.get(L)!;
      const scored = arr.map((k) => {
        const neigh = [...(adjacency.get(k) ?? [])].filter((n) => layer.get(n) === neighborLayer);
        const score = neigh.length ? neigh.reduce((s, n) => s + posInLayer.get(n)!, 0) / neigh.length : posInLayer.get(k)!;
        return { k, score };
      });
      scored.sort((a, b) => a.score - b.score);
      byLayer.set(L, scored.map((s) => s.k));
      reindex();
    }
  }

  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
  layerNums.forEach((L, li) => {
    const x = PAD + li * (CARD_W + GAP_X);
    let y = PAD;
    for (const key of byLayer.get(L)!) {
      const h = cardHeight(byKey.get(key)!);
      pos.set(key, { x, y, w: CARD_W, h });
      y += h + GAP_Y;
    }
  });

  const graphContentHeight = Math.max(0, ...layerNums.map((L) =>
    byLayer.get(L)!.reduce((sum, k) => sum + pos.get(k)!.h + GAP_Y, -GAP_Y)));
  const graphWidth = layerNums.length ? layerNums.length * CARD_W + (layerNums.length - 1) * GAP_X : 0;
  const hasGraph = layerNums.length > 0;

  function rowAnchorY(key: string, columnName: string) {
    const t = byKey.get(key)!;
    const idx = Math.max(0, t.columns.findIndex((c) => c.name === columnName));
    const p = pos.get(key)!;
    return p.y + HEADER_H + PAD_V + idx * ROW_H + ROW_H / 2;
  }

  const edges: Edge[] = links.map(({ fk, fromKey, toKey, self }, i) => {
    if (self) {
      const p = pos.get(fromKey)!;
      const y = rowAnchorY(fromKey, fk.columns[0]);
      const x = p.x + p.w;
      return { id: `${fromKey}#${fk.name}#${i}`, fromKey, toKey, self: true, d: `M ${x} ${y} C ${x + 46} ${y - 20}, ${x + 46} ${y + 20}, ${x} ${y}` };
    }
    const a = pos.get(fromKey)!, b = pos.get(toKey)!;
    const fromLeft = a.x < b.x;
    const x1 = fromLeft ? a.x + a.w : a.x;
    const y1 = rowAnchorY(fromKey, fk.columns[0]);
    const x2 = fromLeft ? b.x : b.x + b.w;
    const y2 = rowAnchorY(toKey, fk.refColumns[0]);
    const dx = Math.max(50, Math.abs(x2 - x1) / 2);
    const c1x = fromLeft ? x1 + dx : x1 - dx;
    const c2x = fromLeft ? x2 - dx : x2 + dx;
    return { id: `${fromKey}#${fk.name}#${i}`, fromKey, toKey, self: false, d: `M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}` };
  });

  const cards: Card[] = [...touched].map((key) => ({ key, table: byKey.get(key)!, ...pos.get(key)! }));
  const standaloneTables = schema.tables.filter((t) => !touched.has(keyOf(t.schema, t.name)));
  const hasStandalone = standaloneTables.length > 0;

  const showLabel = hasGraph && hasStandalone;
  const standaloneY = hasGraph ? PAD + graphContentHeight + SECTION_GAP + LABEL_H : PAD;
  const standCols = Math.max(1, Math.min(STAND_COLS, standaloneTables.length));
  const colBottoms = new Array(standCols).fill(standaloneY);
  const colX = (ci: number) => PAD + ci * (CARD_W + STAND_GAP_X);
  const standaloneCards: Card[] = standaloneTables.map((t, i) => {
    const ci = i % standCols;
    const y = colBottoms[ci];
    const h = cardHeight(t);
    colBottoms[ci] = y + h + STAND_GAP_Y;
    return { key: keyOf(t.schema, t.name), table: t, x: colX(ci), y, w: CARD_W, h };
  });

  const standaloneGridWidth = hasStandalone ? standCols * CARD_W + (standCols - 1) * STAND_GAP_X : 0;
  const contentBottom = hasStandalone ? Math.max(...colBottoms) - STAND_GAP_Y : (hasGraph ? PAD + graphContentHeight : PAD);
  const contentWidth = Math.max(graphWidth, standaloneGridWidth);
  const width = contentWidth + PAD * 2;
  const height = contentBottom + PAD;

  return { cards, edges, standaloneCards, fkColSet, width, height, hasGraph, showStandaloneLabel: showLabel, standaloneY };
}

function relatedOf(key: string, edges: Edge[]): Set<string> {
  const set = new Set<string>([key]);
  for (const e of edges) {
    if (e.fromKey === key) set.add(e.toKey);
    if (e.toKey === key) set.add(e.fromKey);
  }
  return set;
}

export function SchemaDiagram({ server, database }: { server: PgServer; database: string }) {
  const [schema, setSchema] = useState<PgSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [view, setView] = useState({ scale: 1, tx: 40, ty: 40 });
  const [panning, setPanning] = useState(false);
  const [exportBusy, setExportBusy] = useState<"png" | "pdf" | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const reqRef = useRef(0);
  const savedFilterRef = useRef<{ query: string; hoverKey: string | null } | null>(null);

  function load() {
    if (!server || !database) return;
    const id = ++reqRef.current;
    setLoading(true); setError(null);
    pgSchema(server, database).then((r) => {
      if (reqRef.current !== id) return;
      if (r.ok && r.schema) setSchema(r.schema); else setError(r.error || "Couldn't load schema");
      setLoading(false);
    });
  }
  useEffect(() => { setSchema(null); setQuery(""); setHoverKey(null); load(); }, [server?.id, database]); // eslint-disable-line

  const diagram = useMemo(() => schema ? buildDiagram(schema) : null, [schema]);
  const tableCount = diagram ? diagram.cards.length + diagram.standaloneCards.length : 0;

  function fit() {
    const wrap = wrapRef.current;
    if (!wrap || !diagram || tableCount === 0) { setView({ scale: 1, tx: 40, ty: 40 }); return; }
    const rect = wrap.getBoundingClientRect();
    const s = Math.min(1, (rect.width - 80) / Math.max(1, diagram.width), (rect.height - 80) / Math.max(1, diagram.height));
    setView({ scale: Math.max(0.25, s), tx: 40, ty: 40 });
  }
  useEffect(() => { fit(); }, [diagram]); // eslint-disable-line

  function zoomBy(factor: number, center?: { x: number; y: number }) {
    const wrap = wrapRef.current;
    const rect = wrap?.getBoundingClientRect();
    const cx = center?.x ?? (rect ? rect.width / 2 : 0);
    const cy = center?.y ?? (rect ? rect.height / 2 : 0);
    setView((v) => {
      const next = Math.min(2.2, Math.max(0.2, v.scale * factor));
      const k = next / v.scale;
      return { scale: next, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k };
    });
  }
  function onWheel(e: ReactWheelEvent) {
    e.preventDefault();
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomBy(1 - e.deltaY * 0.0012, { x: e.clientX - rect.left, y: e.clientY - rect.top });
  }
  function onMouseDown(e: ReactMouseEvent) {
    if ((e.target as HTMLElement).closest(".sdiag-card")) return;
    dragRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    setPanning(true);
  }
  useEffect(() => {
    function onMove(e: globalThis.MouseEvent) {
      const d = dragRef.current;
      if (!d) return;
      setView((v) => ({ ...v, tx: d.tx + (e.clientX - d.x), ty: d.ty + (e.clientY - d.y) }));
    }
    function onUp() { dragRef.current = null; setPanning(false); }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const activeKeys = useMemo(() => {
    if (!diagram) return null;
    const q = query.trim().toLowerCase();
    if (q) {
      const set = new Set<string>();
      for (const t of [...diagram.cards.map((c) => c.table), ...diagram.standaloneCards.map((c) => c.table)]) {
        const key = keyOf(t.schema, t.name);
        if (key.toLowerCase().includes(q) || t.columns.some((c) => c.name.toLowerCase().includes(q))) set.add(key);
      }
      return set;
    }
    if (hoverKey) return relatedOf(hoverKey, diagram.edges);
    return null;
  }, [diagram, query, hoverKey]);

  function requestExport(kind: "png" | "pdf") {
    if (!diagram || tableCount === 0 || exportBusy) return;
    savedFilterRef.current = { query, hoverKey };
    setQuery(""); setHoverKey(null);
    setExportBusy(kind);
  }

  useEffect(() => {
    if (!exportBusy) return;
    let cancelled = false;
    const kind = exportBusy;
    requestAnimationFrame(() => requestAnimationFrame(async () => {
      if (cancelled) return;
      try { await runExport(kind); } catch (e) { console.error("Schema export failed", e); }
      const saved = savedFilterRef.current;
      savedFilterRef.current = null;
      if (saved) { setQuery(saved.query); setHoverKey(saved.hoverKey); }
      setExportBusy(null);
    }));
    return () => { cancelled = true; };
  }, [exportBusy]); // eslint-disable-line

  async function runExport(kind: "png" | "pdf") {
    const node = canvasRef.current;
    if (!node || !diagram) return;
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#0A0B0D";
    const dataUrl = await toPng(node, {
      width: diagram.width,
      height: diagram.height,
      pixelRatio: 2,
      backgroundColor: bg,
      style: { transform: "none" },
    });
    const filename = `${database}-schema`;
    if (kind === "png") {
      const a = document.createElement("a");
      a.href = dataUrl; a.download = `${filename}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      return;
    }
    const orientation = diagram.width >= diagram.height ? "landscape" : "portrait";
    const pdf = new jsPDF({ orientation, unit: "px", format: [diagram.width, diagram.height] });
    pdf.addImage(dataUrl, "PNG", 0, 0, diagram.width, diagram.height);
    pdf.save(`${filename}.pdf`);
  }

  if (loading) return <div className="sdiag"><div className="page-loader"><OrbitLoader label="Mapping schema…" /></div></div>;
  if (error) return <div className="sdiag"><div className="pg-error" style={{ margin: 26 }}><Icon name="plug" size={16} /><div><div style={{ fontWeight: 600, marginBottom: 4 }}>Couldn't map the schema</div><div className="mono" style={{ fontSize: 12.5 }}>{error}</div></div></div></div>;
  if (!diagram) return null;

  return (
    <div className="sdiag">
      <div className="sdiag-toolbar">
        <div className="sdiag-search"><Icon name="search" size={13} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter tables or columns…" /></div>
        <div className="sdiag-summary"><b>{schema!.tables.length}</b> table{schema!.tables.length === 1 ? "" : "s"} · <b>{schema!.foreignKeys.length}</b> relationship{schema!.foreignKeys.length === 1 ? "" : "s"}</div>
        <div className="sdiag-spacer" />
        <button className="btn ghost" onClick={load}><Icon name="refresh" size={14} />Refresh</button>
        <button className="btn ghost" onClick={fit}>Fit</button>
        <div className="sdiag-zoom">
          <button onClick={() => zoomBy(0.82)} title="Zoom out">−</button>
          <span className="pct">{Math.round(view.scale * 100)}%</span>
          <button onClick={() => zoomBy(1.22)} title="Zoom in">+</button>
        </div>
        <button className="btn ghost" disabled={tableCount === 0 || !!exportBusy} onClick={() => requestExport("png")}>
          <Icon name="download" size={14} />{exportBusy === "png" ? "Exporting…" : "PNG"}
        </button>
        <button className="btn ghost" disabled={tableCount === 0 || !!exportBusy} onClick={() => requestExport("pdf")}>
          <Icon name="download" size={14} />{exportBusy === "pdf" ? "Exporting…" : "PDF"}
        </button>
      </div>

      {tableCount === 0 ? (
        <Empty icon="db" title="No tables in this database" mini />
      ) : (
        <div
          className={"sdiag-canvas-wrap" + (panning ? " panning" : "")}
          ref={wrapRef}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
        >
          <div className="sdiag-canvas" ref={canvasRef} style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, width: diagram.width, height: diagram.height }}>
            {diagram.hasGraph && (
              <svg className="sdiag-svg" width={diagram.width} height={diagram.height}>
                <defs>
                  <marker id="sdiag-arrow" markerWidth="7" markerHeight="7" refX="5.4" refY="3" orient="auto">
                    <path d="M0,0 L6,3 L0,6 Z" fill="context-stroke" />
                  </marker>
                </defs>
                {diagram.edges.map((e) => {
                  const hi = hoverKey ? e.fromKey === hoverKey || e.toKey === hoverKey : false;
                  const dim = activeKeys ? !(activeKeys.has(e.fromKey) && activeKeys.has(e.toKey)) : false;
                  return <path key={e.id} className={"sdiag-edge" + (hi ? " hi" : "") + (dim ? " dim" : "")} d={e.d} markerEnd={e.self ? undefined : "url(#sdiag-arrow)"} />;
                })}
              </svg>
            )}
            {diagram.showStandaloneLabel && (
              <div className="sdiag-section-label" style={{ left: PAD, top: diagram.standaloneY - LABEL_H }}>
                Standalone tables ({diagram.standaloneCards.length}) — no foreign keys in or out
              </div>
            )}
            {diagram.cards.map((c) => (
              <TableCard
                key={c.key}
                table={c.table}
                fkColSet={diagram.fkColSet}
                style={{ left: c.x, top: c.y }}
                dim={!!activeKeys && !activeKeys.has(c.key)}
                hi={hoverKey === c.key}
                onEnter={() => setHoverKey(c.key)}
                onLeave={() => setHoverKey((k) => (k === c.key ? null : k))}
              />
            ))}
            {diagram.standaloneCards.map((c) => (
              <TableCard
                key={c.key}
                table={c.table}
                fkColSet={diagram.fkColSet}
                style={{ left: c.x, top: c.y }}
                dim={!!activeKeys && !activeKeys.has(c.key)}
                hi={hoverKey === c.key}
                onEnter={() => setHoverKey(c.key)}
                onLeave={() => setHoverKey((k) => (k === c.key ? null : k))}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TableCard({ table, fkColSet, style, dim, hi, onEnter, onLeave }: {
  table: PgSchemaTable; fkColSet: Set<string>; style?: CSSProperties; dim: boolean; hi: boolean;
  onEnter: () => void; onLeave: () => void;
}) {
  const key = keyOf(table.schema, table.name);
  return (
    <div className={"sdiag-card" + (hi ? " hi" : "") + (dim ? " dim" : "")} style={style} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div className="sdiag-card-head">
        <Icon name="boxes" size={13} />
        <span className="sc">{table.schema}.</span><span className="nm">{table.name}</span>
        <span className="cnt">{table.columns.length}</span>
      </div>
      <div className="sdiag-card-body">
        {table.columns.map((c) => {
          const isFk = fkColSet.has(`${key}.${c.name}`);
          return (
            <div key={c.name} className={"sdiag-row" + (c.isPrimaryKey ? " pk" : "") + (isFk ? " fk" : "")}>
              <span className="ic">{c.isPrimaryKey ? <Icon name="key" size={10} /> : isFk ? <Icon name="link" size={10} /> : null}</span>
              <span className="cn">{c.name}</span>
              <span className="ct">{c.type}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
