import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchZohoStatus } from "../lib/zoho";
import { AUTH_EVENT, getToken } from "../lib/auth";

export type ZohoStatus = "connected" | "disconnected" | "checking";
const KEY = "orbit.zohoEnabled";

interface Shape {
  status: ZohoStatus;
  enabled: boolean;
  error: string | null;
  connect: () => void;
  disconnect: () => void;
  recheck: () => void;
}
const Ctx = createContext<Shape | undefined>(undefined);

export function ZohoProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem(KEY) !== "false"; } catch { return true; }
  });
  const [status, setStatus] = useState<ZohoStatus>("checking");
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    if (!enabled) { setStatus("disconnected"); return; }
    // No session yet (e.g. app just booted, pre-login) — nothing to check against.
    // Leave this to the AUTH_EVENT listener below so login always re-checks with a real token.
    if (!getToken()) { setStatus("checking"); return; }
    setStatus("checking");
    const r = await fetchZohoStatus();
    setStatus(r.connected ? "connected" : "disconnected");
    setError(r.error ?? null);
  }, [enabled]);

  useEffect(() => { check(); }, [check]);
  // Re-check whenever auth state changes (sign in, sign out, session restore) so a
  // stale pre-login "disconnected" result never survives into a fresh session, and
  // Zoho reconnects automatically using the already-saved keys — no manual step needed.
  useEffect(() => {
    window.addEventListener(AUTH_EVENT, check);
    return () => window.removeEventListener(AUTH_EVENT, check);
  }, [check]);

  const connect = useCallback(() => { try { localStorage.setItem(KEY, "true"); } catch { /**/ } setEnabled(true); }, []);
  const disconnect = useCallback(() => { try { localStorage.setItem(KEY, "false"); } catch { /**/ } setEnabled(false); setStatus("disconnected"); }, []);

  return (
    <Ctx.Provider value={{ status, enabled, error, connect, disconnect, recheck: check }}>
      {children}
    </Ctx.Provider>
  );
}
export function useZoho() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useZoho must be used inside ZohoProvider");
  return c;
}
