/**
 * Dashboard tile arrangement. Stored per-user in `user_settings` (and mirrored to
 * localStorage so the dashboard paints in the right order before the fetch lands).
 */
export type TileSize = 1 | 2 | 4;

export interface DashboardLayout {
  /** Tile ids, in render order. */
  order: string[];
  /** Tile ids the user has hidden. */
  hidden: string[];
  /** Column span (out of 4) per tile. Missing ids fall back to the tile's default. */
  sizes: Record<string, TileSize>;
}

/** The tiles the dashboard can arrange, in their out-of-the-box order. */
export const DASH_TILES: { id: string; label: string; defaultSize: TileSize; sizes: TileSize[] }[] = [
  { id: "projects", label: "Active projects", defaultSize: 1, sizes: [1, 2] },
  { id: "orbit", label: "Orbit hours", defaultSize: 1, sizes: [1, 2] },
  { id: "zoho", label: "Zoho hours today", defaultSize: 1, sizes: [1, 2] },
  { id: "containers", label: "Containers up", defaultSize: 1, sizes: [1, 2] },
  { id: "bays", label: "Project bays", defaultSize: 4, sizes: [2, 4] },
  { id: "openItems", label: "Sprint board", defaultSize: 2, sizes: [2, 4] },
  { id: "health", label: "System health", defaultSize: 2, sizes: [2, 4] },
];

const TILE_IDS = DASH_TILES.map((t) => t.id);
const TILE_BY_ID = new Map(DASH_TILES.map((t) => [t.id, t]));

export function defaultSizeOf(id: string): TileSize {
  return TILE_BY_ID.get(id)?.defaultSize ?? 1;
}

export function allowedSizesOf(id: string): TileSize[] {
  return TILE_BY_ID.get(id)?.sizes ?? [1];
}

const DEFAULT_SIZES: Record<string, TileSize> = Object.fromEntries(DASH_TILES.map((t) => [t.id, t.defaultSize]));

export const DEFAULT_LAYOUT: DashboardLayout = { order: TILE_IDS, hidden: [], sizes: DEFAULT_SIZES };

/**
 * Reconciles a stored layout against the tiles this build actually ships:
 * unknown ids are dropped, tiles added since the layout was saved are appended
 * rather than silently disappearing, and any missing/invalid size falls back
 * to that tile's registry default. An older `{order,hidden}` payload with no
 * `sizes` at all simply gets every tile at its default — no migration needed.
 */
export function normalizeLayout(raw: Partial<DashboardLayout> | null | undefined): DashboardLayout {
  const known = new Set(TILE_IDS);
  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of raw?.order ?? []) {
    if (known.has(id) && !seen.has(id)) { order.push(id); seen.add(id); }
  }
  for (const id of TILE_IDS) if (!seen.has(id)) order.push(id);
  const hidden = (raw?.hidden ?? []).filter((id) => known.has(id));
  const sizes: Record<string, TileSize> = {};
  for (const id of order) {
    const want = raw?.sizes?.[id];
    sizes[id] = want && allowedSizesOf(id).includes(want) ? want : defaultSizeOf(id);
  }
  return { order, hidden, sizes };
}

export function isDefaultLayout(l: DashboardLayout): boolean {
  if (l.hidden.length !== 0 || l.order.join(",") !== TILE_IDS.join(",")) return false;
  return TILE_IDS.every((id) => (l.sizes[id] ?? defaultSizeOf(id)) === defaultSizeOf(id));
}

/** Moves `id` to the slot currently held by `targetId`, shifting the rest along. */
export function reorder(order: string[], id: string, targetId: string): string[] {
  if (id === targetId) return order;
  const from = order.indexOf(id);
  const to = order.indexOf(targetId);
  if (from < 0 || to < 0) return order;
  const next = order.slice();
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Next allowed size for a tile, wrapping back to the smallest after the largest. */
export function cycleSize(id: string, cur: TileSize): TileSize {
  const sizes = allowedSizesOf(id);
  const i = sizes.indexOf(cur);
  return sizes[(i + 1) % sizes.length];
}
