import { useEffect, useRef } from "react";

const ACTIVITY_EVENTS = ["mousemove", "keydown", "mousedown", "wheel", "touchstart"] as const;

/**
 * Browser-tab-based only — no OS-level idle API exists to call into (checked
 * the local agent; nothing there either), so this can only ever detect "no
 * activity on this tab," not true system idle. Fires `onIdle` once after
 * `idleMinutes` of no mouse/keyboard/scroll/touch activity (and no tab-hidden
 * time counts against it — see the visibilitychange handler), `onActive` once
 * on the first activity after that.
 */
export function useIdleDetection(enabled: boolean, idleMinutes: number, onIdle: () => void, onActive: () => void): void {
  const idleRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onIdleRef = useRef(onIdle);
  const onActiveRef = useRef(onActive);
  onIdleRef.current = onIdle;
  onActiveRef.current = onActive;

  useEffect(() => {
    if (!enabled) return;
    const ms = Math.max(1, idleMinutes) * 60_000;

    const reset = () => {
      if (idleRef.current) { idleRef.current = false; onActiveRef.current(); }
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { idleRef.current = true; onIdleRef.current(); }, ms);
    };
    const onVisibility = () => { if (!document.hidden) reset(); };

    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, reset, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    reset();

    return () => {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, reset);
      document.removeEventListener("visibilitychange", onVisibility);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, idleMinutes]);
}
