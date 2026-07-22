import { createContext, useContext, useEffect, type ReactNode } from "react";
import { OrbitRuntime } from "./OrbitRuntime";

/**
 * The single, module-level runtime singleton — constructed once, for the
 * whole app. Components never construct an engine themselves; they read
 * from this instance via `useOrbitRuntime()`.
 */
export const orbitRuntime = new OrbitRuntime();

const RuntimeContext = createContext<OrbitRuntime>(orbitRuntime);

/**
 * Starts the runtime on mount, stops it on unmount — mount inside the
 * authenticated part of the app (see src/App.tsx) so the knowledge-graph
 * sync and realtime subscription only ever run for a signed-in session.
 */
export function RuntimeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    void orbitRuntime.start();
    return () => orbitRuntime.dispose();
  }, []);

  return <RuntimeContext.Provider value={orbitRuntime}>{children}</RuntimeContext.Provider>;
}

export function useOrbitRuntime(): OrbitRuntime {
  return useContext(RuntimeContext);
}
