import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { pingAgent, getAgentUrl, setAgentUrl, agentEvents } from "../lib/agent";

export type AgentStatus = "online" | "offline" | "disconnected";

interface AgentShape {
  status: AgentStatus;
  url: string;
  recheck: () => void;
  disconnect: () => void;
  reconnect: () => void;
  updateUrl: (url: string) => void;
  subscribe: (onEvent: (event: string, payload?: unknown) => void) => () => void;
}

const Ctx = createContext<AgentShape | undefined>(undefined);
const POLL_MS = 5000;

export function AgentProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AgentStatus>("offline");
  const [url, setUrl] = useState(getAgentUrl());
  const disconnected = useRef(false);
  const listeners = useRef(new Set<(event: string, payload?: unknown) => void>());

  const check = useCallback(async () => {
    if (disconnected.current) return;               // user chose to disconnect — don't auto-reconnect
    const ok = await pingAgent();
    setStatus(ok ? "online" : "offline");
  }, []);

  // Polling is paused while the tab is hidden — no point hammering /ping when the
  // user can't see the result, and the /events websocket (below) already carries
  // its own liveness signal. Re-checks immediately on becoming visible again
  // rather than waiting up to POLL_MS for a stale status to refresh.
  useEffect(() => {
    check();
    let t: number | null = null;
    const start = () => { if (t == null) t = window.setInterval(check, POLL_MS); };
    const stop = () => { if (t != null) { window.clearInterval(t); t = null; } };
    const onVisibility = () => {
      if (document.hidden) stop();
      else { check(); start(); }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [check]);

  // Held open for as long as the app itself is mounted (i.e. the tab is open)
  // — the packaged agent watches this connection to know when to auto-quit,
  // so it must not be tied to any one route's lifetime.
  useEffect(() => {
    return agentEvents((event, payload) => { for (const fn of listeners.current) fn(event, payload); });
  }, []);

  const subscribe = useCallback((onEvent: (event: string, payload?: unknown) => void) => {
    listeners.current.add(onEvent);
    return () => { listeners.current.delete(onEvent); };
  }, []);

  const recheck = useCallback(() => { disconnected.current = false; check(); }, [check]);
  const disconnect = useCallback(() => { disconnected.current = true; setStatus("disconnected"); }, []);
  const reconnect = useCallback(() => { disconnected.current = false; setStatus("offline"); check(); }, [check]);
  const updateUrl = useCallback((u: string) => {
    setAgentUrl(u);
    setUrl(getAgentUrl());
    disconnected.current = false;
    check();
  }, [check]);

  return (
    <Ctx.Provider value={{ status, url, recheck, disconnect, reconnect, updateUrl, subscribe }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAgent() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAgent must be used inside AgentProvider");
  return c;
}
