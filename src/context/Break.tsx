import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchSettings, saveSettings } from "../lib/settings";
import { TIMER_KEY, TIMER_PAUSE_KEY as PAUSE_KEY, TIMER_PROJECT_KEY, TIMER_EVENT, ls, emitTimerChange } from "../lib/timer";
import { useIdleDetection } from "../hooks/useIdleDetection";
import { logFocusEvent } from "../lib/focusEvents";

const BREAK_KEY = "orbit.onBreak";
const BREAK_START_KEY = "orbit.breakStart";
// Re-exported: TimeTracking has imported TIMER_EVENT from here since before the
// timer state moved into lib/timer.ts.
export { TIMER_EVENT };

interface BreakShape {
  onBreak: boolean;
  timerPaused: boolean;      // a running timer was paused by this break
  breakStartedAt: number | null;
  startBreak: () => void;
  endBreak: () => void;
  /** Auto-paused by idle detection (distinct from a manual break — no "I'm refreshed" click needed, resumes on its own the moment activity is seen). */
  idlePaused: boolean;
  idleEnabled: boolean;
  idleMinutes: number;
  setIdlePrefs: (enabled: boolean, minutes: number) => void;
}
const Ctx = createContext<BreakShape | undefined>(undefined);

const emit = emitTimerChange;

export function BreakProvider({ children }: { children: ReactNode }) {
  // hydrate instantly from localStorage so a refresh never drops the break
  const [onBreak, setOnBreak] = useState(() => ls.get(BREAK_KEY) === "1");
  const [timerPaused, setTimerPaused] = useState(() => ls.get(PAUSE_KEY) !== null);
  const [breakStartedAt, setBreakStartedAt] = useState<number | null>(() => {
    const v = ls.get(BREAK_START_KEY); return v ? Number(v) : null;
  });
  const [idlePaused, setIdlePaused] = useState(false);
  const [idleEnabled, setIdleEnabledState] = useState(false);
  const [idleMinutes, setIdleMinutesState] = useState(10);

  // reconcile with Supabase (durable / cross-device) once, on mount
  useEffect(() => {
    fetchSettings().then((s) => {
      if (s.on_break) {
        setOnBreak(true);
        ls.set(BREAK_KEY, "1");
        if (s.break_started_at) {
          const ms = new Date(s.break_started_at).getTime();
          setBreakStartedAt(ms); ls.set(BREAK_START_KEY, String(ms));
        }
        if (s.timer_paused) setTimerPaused(true);
      } else if (s.on_break === false && ls.get(BREAK_KEY) !== "1") {
        setOnBreak(false);
      }
      if (s.idle_detection_enabled) setIdleEnabledState(true);
      if (s.idle_minutes) setIdleMinutesState(s.idle_minutes);
    });
  }, []);

  const pauseForIdle = () => {
    if (onBreak) return; // already paused via a real break — don't double-pause
    const start = Number(ls.get(TIMER_KEY) || 0);
    if (start <= 0) return; // timer isn't running — nothing to pause
    const elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));
    ls.set(PAUSE_KEY, String(elapsed));
    ls.del(TIMER_KEY);
    emit();
    setIdlePaused(true);
    logFocusEvent("idle", { projectId: ls.get(TIMER_PROJECT_KEY) });
  };
  const resumeFromIdle = () => {
    if (!idlePaused) return;
    const paused = ls.get(PAUSE_KEY);
    if (paused !== null) {
      const sec = Number(paused) || 0;
      ls.set(TIMER_KEY, String(Date.now() - sec * 1000));
      ls.del(PAUSE_KEY);
      emit();
    }
    setIdlePaused(false);
    logFocusEvent("resume", { projectId: ls.get(TIMER_PROJECT_KEY) });
  };
  useIdleDetection(idleEnabled && !onBreak, idleMinutes, pauseForIdle, resumeFromIdle);

  const setIdlePrefs = (enabled: boolean, minutes: number) => {
    setIdleEnabledState(enabled);
    setIdleMinutesState(minutes);
    if (!enabled && idlePaused) resumeFromIdle();
    saveSettings({ idle_detection_enabled: enabled, idle_minutes: minutes });
  };

  const startBreak = () => {
    const now = Date.now();
    let paused = false;
    try {
      const start = Number(ls.get(TIMER_KEY) || 0);
      if (start > 0) {
        const elapsed = Math.max(0, Math.floor((now - start) / 1000));
        ls.set(PAUSE_KEY, String(elapsed));
        ls.del(TIMER_KEY); // stops the live tick everywhere
        paused = true;
        emit();
      }
    } catch { /* noop */ }
    setTimerPaused(paused);
    setBreakStartedAt(now);
    setOnBreak(true);
    ls.set(BREAK_KEY, "1");
    ls.set(BREAK_START_KEY, String(now));
    saveSettings({ on_break: true, break_started_at: new Date(now).toISOString(), timer_paused: paused });
  };

  const endBreak = () => {
    try {
      const paused = ls.get(PAUSE_KEY);
      if (paused !== null) {
        const sec = Number(paused) || 0;
        ls.set(TIMER_KEY, String(Date.now() - sec * 1000)); // resume where it paused
        ls.del(PAUSE_KEY);
        emit();
      }
    } catch { /* noop */ }
    setTimerPaused(false);
    setBreakStartedAt(null);
    setOnBreak(false);
    ls.del(BREAK_KEY);
    ls.del(BREAK_START_KEY);
    saveSettings({ on_break: false, break_started_at: null, timer_paused: false });
  };

  return (
    <Ctx.Provider value={{ onBreak, timerPaused, breakStartedAt, startBreak, endBreak, idlePaused, idleEnabled, idleMinutes, setIdlePrefs }}>
      {children}
    </Ctx.Provider>
  );
}

export function useBreak(): BreakShape {
  const c = useContext(Ctx);
  if (!c) throw new Error("useBreak must be used inside BreakProvider");
  return c;
}
