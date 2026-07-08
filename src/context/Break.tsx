import { createContext, useContext, useState, type ReactNode } from "react";

const TIMER_KEY = "orbit.timerStart";
const PAUSE_KEY = "orbit.timerPausedSec";
export const TIMER_EVENT = "orbit-timer-change";

interface BreakShape {
  onBreak: boolean;
  /** true while a running timer is paused because of the break */
  timerPaused: boolean;
  startBreak: () => void;
  endBreak: () => void;
}
const Ctx = createContext<BreakShape | undefined>(undefined);

function emit() { try { window.dispatchEvent(new Event(TIMER_EVENT)); } catch { /* noop */ } }

export function BreakProvider({ children }: { children: ReactNode }) {
  const [onBreak, setOnBreak] = useState(false);
  const [timerPaused, setTimerPaused] = useState(false);

  const startBreak = () => {
    try {
      const start = Number(localStorage.getItem(TIMER_KEY) || 0);
      if (start > 0) {
        const elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));
        localStorage.setItem(PAUSE_KEY, String(elapsed));
        localStorage.removeItem(TIMER_KEY); // stops the live tick everywhere
        setTimerPaused(true);
        emit();
      } else {
        setTimerPaused(false);
      }
    } catch { /* noop */ }
    setOnBreak(true);
  };

  const endBreak = () => {
    try {
      const paused = localStorage.getItem(PAUSE_KEY);
      if (paused !== null) {
        const sec = Number(paused) || 0;
        localStorage.setItem(TIMER_KEY, String(Date.now() - sec * 1000)); // resume from where it paused
        localStorage.removeItem(PAUSE_KEY);
        emit();
      }
    } catch { /* noop */ }
    setTimerPaused(false);
    setOnBreak(false);
  };

  return <Ctx.Provider value={{ onBreak, timerPaused, startBreak, endBreak }}>{children}</Ctx.Provider>;
}

export function useBreak(): BreakShape {
  const c = useContext(Ctx);
  if (!c) throw new Error("useBreak must be used inside BreakProvider");
  return c;
}
