import { useEffect, useRef } from "react";
import { systemIdle } from "../lib/vscode";

const ACTIVITY_EVENTS = ["mousemove", "keydown", "mousedown", "wheel", "touchstart"] as const;
const POLL_MS = 20_000;

/**
 * Fires `onIdle` once after `idleMinutes` of inactivity, `onActive` once on the
 * first activity after that.
 *
 * Prefers **OS-wide** input idle, polled from the local agent (`/system/idle` —
 * GetLastInputInfo on Windows, IOHIDSystem on macOS, xprintidle on Linux).
 * Browser-tab events alone can only see this tab, so a user heads-down in their
 * editor read as idle and had their timer paused mid-session — which is exactly
 * the case the timer wants this signal for.
 *
 * Tab activity is still listened to as an immediate wake: it costs nothing and
 * beats waiting up to a poll interval to notice the user is back. Platforms with
 * no idle probe (or no agent running) degrade to tab-only, i.e. the previous
 * behaviour rather than no detection at all.
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
    let stopped = false;
    let osDriven = false;

    const goIdle = () => { if (!idleRef.current) { idleRef.current = true; onIdleRef.current(); } };
    const goActive = () => { if (idleRef.current) { idleRef.current = false; onActiveRef.current(); } };

    // Tab-only fallback — the original timeout behaviour.
    const armFallback = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(goIdle, ms);
    };
    const onTabActivity = () => {
      goActive();
      // Only the fallback re-arms here. Once the OS probe is driving, it owns the
      // idle decision — a stray mousemove must not extend it past real inactivity.
      if (!osDriven) armFallback();
    };
    const onVisibility = () => { if (!document.hidden) onTabActivity(); };

    const poll = async () => {
      if (stopped) return;
      const { supported, seconds } = await systemIdle();
      if (stopped) return;
      if (!supported || seconds === null) {
        if (osDriven) { osDriven = false; armFallback(); } // agent went away — degrade
        return;
      }
      if (!osDriven) { osDriven = true; if (timerRef.current) clearTimeout(timerRef.current); }
      if (seconds * 1000 >= ms) goIdle(); else goActive();
    };

    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onTabActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    armFallback();  // covers the gap before the first poll resolves
    poll();
    const interval = setInterval(poll, POLL_MS);

    return () => {
      stopped = true;
      clearInterval(interval);
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onTabActivity);
      document.removeEventListener("visibilitychange", onVisibility);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, idleMinutes]);
}
