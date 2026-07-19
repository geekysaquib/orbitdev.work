import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getOnline, setOnline as setOnlineStore, subscribeOnline, pingBackend } from "../lib/offline";

interface OfflineShape {
  online: boolean;
}

const Ctx = createContext<OfflineShape | undefined>(undefined);
const HEARTBEAT_MS = 20000;
const FAILS_BEFORE_OFFLINE = 2;

export function OfflineProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(getOnline());
  const fails = useRef(0);

  const verify = useCallback(async () => {
    const ok = await pingBackend();
    if (ok) {
      fails.current = 0;
      setOnlineStore(true);
    } else {
      fails.current += 1;
      if (fails.current >= FAILS_BEFORE_OFFLINE) setOnlineStore(false);
    }
  }, []);

  useEffect(() => subscribeOnline(setOnline), []);

  // The browser's online/offline events only reflect whether a network
  // interface is up, not whether the backend is actually reachable — treat
  // them as a trigger to re-verify rather than a source of truth.
  useEffect(() => {
    const onOnline = () => verify();
    const onOffline = () => { fails.current = FAILS_BEFORE_OFFLINE; setOnlineStore(false); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [verify]);

  useEffect(() => {
    verify();
    let t: number | null = null;
    const start = () => { if (t == null) t = window.setInterval(verify, HEARTBEAT_MS); };
    const stop = () => { if (t != null) { window.clearInterval(t); t = null; } };
    const onVisibility = () => {
      if (document.hidden) stop();
      else { verify(); start(); }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [verify]);

  return <Ctx.Provider value={{ online }}>{children}</Ctx.Provider>;
}

export function useOffline() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useOffline must be used inside OfflineProvider");
  return c;
}
