import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSettings, saveSettings } from "../lib/settings";
import { DEFAULT_LAYOUT, isDefaultLayout, normalizeLayout, reorder, cycleSize, type DashboardLayout, type TileSize } from "../lib/dashboardLayout";

const KEY = "orbit.dashboardLayout";

function readStored(): DashboardLayout {
  try {
    const raw = localStorage.getItem(KEY);
    return normalizeLayout(raw ? JSON.parse(raw) : null);
  } catch { return DEFAULT_LAYOUT; }
}

export function useDashboardLayout() {
  const [layout, setLayoutState] = useState<DashboardLayout>(readStored);
  // Mirrors `layout` so functional updates (move/toggleHidden/setSize) always
  // persist a single, complete, up-to-date layout — never a stale closure —
  // and so StrictMode's double-invoked updater doesn't fire two RPCs.
  const ref = useRef(layout);

  // Durable settings win once they arrive — this is what carries the arrangement
  // across devices.
  useEffect(() => {
    fetchSettings().then((s) => {
      if (s.dashboard_layout) {
        const next = normalizeLayout(s.dashboard_layout);
        ref.current = next;
        setLayoutState(next);
      }
    }).catch(() => { /* localStorage value stands */ });
  }, []);

  const commit = useCallback((next: DashboardLayout) => {
    ref.current = next;
    setLayoutState(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
    saveSettings({ dashboard_layout: next });
  }, []);

  const apply = useCallback((fn: (cur: DashboardLayout) => DashboardLayout) => commit(fn(ref.current)), [commit]);

  const move = useCallback((id: string, targetId: string) => {
    apply((cur) => ({ ...cur, order: reorder(cur.order, id, targetId) }));
  }, [apply]);

  const toggleHidden = useCallback((id: string) => {
    apply((cur) => ({ ...cur, hidden: cur.hidden.includes(id) ? cur.hidden.filter((h) => h !== id) : [...cur.hidden, id] }));
  }, [apply]);

  const setSize = useCallback((id: string, size: TileSize) => {
    apply((cur) => ({ ...cur, sizes: { ...cur.sizes, [id]: size } }));
  }, [apply]);

  const cycleTileSize = useCallback((id: string) => {
    apply((cur) => ({ ...cur, sizes: { ...cur.sizes, [id]: cycleSize(id, cur.sizes[id]) } }));
  }, [apply]);

  const reset = useCallback(() => commit(DEFAULT_LAYOUT), [commit]);

  return { layout, move, toggleHidden, setSize, cycleTileSize, reset, isDefault: isDefaultLayout(layout) };
}
