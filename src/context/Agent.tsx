import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { pingAgent, getAgentUrl, setAgentUrl } from "../lib/agent";

export type AgentStatus = "online" | "offline" | "disconnected";

interface AgentShape {
  status: AgentStatus;
  url: string;
  recheck: () => void;
  disconnect: () => void;
  reconnect: () => void;
  updateUrl: (url: string) => void;
}

const Ctx = createContext<AgentShape | undefined>(undefined);
const POLL_MS = 5000;

export function AgentProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AgentStatus>("offline");
  const [url, setUrl] = useState(getAgentUrl());
  const disconnected = useRef(false);

  const check = useCallback(async () => {
    if (disconnected.current) return;               // user chose to disconnect — don't auto-reconnect
    const ok = await pingAgent();
    setStatus(ok ? "online" : "offline");
  }, []);

  useEffect(() => {
    check();
    const t = window.setInterval(check, POLL_MS);   // auto-reconnects the moment the agent comes up
    return () => window.clearInterval(t);
  }, [check]);

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
    <Ctx.Provider value={{ status, url, recheck, disconnect, reconnect, updateUrl }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAgent() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAgent must be used inside AgentProvider");
  return c;
}
