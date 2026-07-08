import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchSettings, saveSettings } from "../lib/settings";

const TIMER_KEY = "orbit.timerStart";
const PAUSE_KEY = "orbit.timerPausedSec";
const BREAK_KEY = "orbit.onBreak";
const BREAK_START_KEY = "orbit.breakStart";
export const TIMER_EVENT = "orbit-timer-change";

interface BreakShape {
  onBreak: boolean;
  timerPaused: boolean;      // a running timer was paused by this break
  breakStartedAt: number | null;
  startBreak: () => void;
  endBreak: () => void;
}
const Ctx = createContext<BreakShape | undefined>(undefined);

function emit() { try { window.dispatchEvent(new Event(TIMER_EVENT)); } catch { /* noop */ } }
const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* noop */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* noop */ } },
};

export function BreakProvider({ children }: { children: ReactNode }) {
  // hydrate instantly from localStorage so a refresh never drops the break
  const [onBreak, setOnBreak] = useState(() => ls.get(BREAK_KEY) === "1");
  const [timerPaused, setTimerPaused] = useState(() => ls.get(PAUSE_KEY) !== null);
  const [breakStartedAt, setBreakStartedAt] = useState<number | null>(() => {
    const v = ls.get(BREAK_START_KEY); return v ? Number(v) : null;
  });

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
    });
  }, []);

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

  return <Ctx.Provider value={{ onBreak, timerPaused, breakStartedAt, startBreak, endBreak }}>{children}</Ctx.Provider>;
}

export function useBreak(): BreakShape {
  const c = useContext(Ctx);
  if (!c) throw new Error("useBreak must be used inside BreakProvider");
  return c;
}
