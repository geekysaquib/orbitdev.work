/**
 * The Orbit focus timer's shared state. Four surfaces read or write it — the Time
 * page, the Dashboard clock, break pause/resume (context/Break.tsx), and Ask AI's
 * "start timer on X" action — so the keys and the read/start/stop logic live here
 * rather than being redeclared per consumer.
 *
 * The whole timer is one localStorage key holding a start epoch; elapsed time is
 * always derived from it, never counted up. That's what lets a refresh, a second
 * tab, and a break resume all agree without any of them tracking a tick.
 *
 * Break mode pauses by writing the elapsed seconds to TIMER_PAUSE_KEY and deleting
 * TIMER_KEY (which stops every live tick), then resumes by back-dating a fresh
 * TIMER_KEY. It deliberately leaves TIMER_PROJECT_KEY alone so a paused session
 * resumes still attributed to its project.
 */
import { logOrbitSession } from "./orbitHours";

export const TIMER_KEY = "orbit.timerStart";
export const TIMER_PAUSE_KEY = "orbit.timerPausedSec";
export const TIMER_PROJECT_KEY = "orbit.timerProject";
/** Fired whenever the timer starts/stops so other mounted surfaces re-read immediately. */
export const TIMER_EVENT = "orbit-timer-change";

export const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* noop */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* noop */ } },
};

export function emitTimerChange() { try { window.dispatchEvent(new Event(TIMER_EVENT)); } catch { /* noop */ } }

export interface TimerState { startedAt: number | null; seconds: number; projectId: string | null }

export function readTimer(): TimerState {
  const raw = ls.get(TIMER_KEY);
  const startedAt = raw && Number(raw) > 0 ? Number(raw) : null;
  return {
    startedAt,
    seconds: startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0,
    projectId: ls.get(TIMER_PROJECT_KEY),
  };
}

export const isTimerRunning = (): boolean => readTimer().startedAt !== null;

/**
 * Start a session, optionally attributed to a project. No-ops if one is already
 * running — restarting would silently discard the unlogged session in progress.
 * Callers own the "can you start right now" gates (agent online, not on a break);
 * break resume has to bypass them, so they can't live here.
 */
export function startTimer(projectId?: string | null): void {
  if (isTimerRunning()) return;
  ls.set(TIMER_KEY, String(Date.now()));
  if (projectId) ls.set(TIMER_PROJECT_KEY, projectId); else ls.del(TIMER_PROJECT_KEY);
  emitTimerChange();
}

/** Stop, log the session to Orbit hours with its project, and return the seconds logged. */
export async function stopTimer(): Promise<number> {
  const { startedAt, seconds, projectId } = readTimer();
  if (startedAt === null) return 0;
  ls.del(TIMER_KEY);
  ls.del(TIMER_PROJECT_KEY);
  ls.del(TIMER_PAUSE_KEY);
  emitTimerChange();
  await logOrbitSession(seconds, projectId);
  return seconds;
}
