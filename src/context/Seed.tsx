import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAgent } from "./Agent";
import { useAuth } from "./AuthContext";
import { pgStartSeed, pgSeedStatus, pgCancelSeed, type PgServer, type SeedTableRef, type SeedJobStatus } from "../lib/pg";
import { SeedBar } from "../components/SeedBar";

const LAST_JOB_KEY = "orbit.seedJobId";

interface SeedShape {
  activeJob: SeedJobStatus | null;
  startSeed: (server: PgServer, database: string, rowsPerTable: number, excludeTables?: SeedTableRef[], projectPrompt?: string, aiApiKey?: string) => Promise<{ ok: boolean; error?: string }>;
  cancelSeed: () => void;
  dismiss: () => void;
}

const Ctx = createContext<SeedShape | undefined>(undefined);

export function SeedProvider({ children }: { children: ReactNode }) {
  const { subscribe } = useAgent();
  const { session } = useAuth();
  const [job, setJob] = useState<SeedJobStatus | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const dismissTimer = useRef<number | undefined>(undefined);

  const forget = useCallback(() => {
    jobIdRef.current = null;
    try { localStorage.removeItem(LAST_JOB_KEY); } catch { /* ignore */ }
  }, []);

  const scheduleDismiss = useCallback(() => {
    window.clearTimeout(dismissTimer.current);
    dismissTimer.current = window.setTimeout(() => { setJob(null); forget(); }, 4000);
  }, [forget]);

  // Recover a job that was still running when the page last reloaded/navigated.
  useEffect(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem(LAST_JOB_KEY); } catch { /* ignore */ }
    if (!stored) return;
    jobIdRef.current = stored;
    pgSeedStatus(stored).then((r) => {
      if (!r.ok || !r.job) { forget(); return; }
      setJob(r.job);
      if (r.job.status !== "running") scheduleDismiss();
    });
  }, []); // eslint-disable-line

  useEffect(() => {
    return subscribe((event, payload) => {
      const p = (payload || {}) as Record<string, unknown>;
      if (typeof p.jobId !== "string" || p.jobId !== jobIdRef.current) return;
      if (event === "seed:progress") {
        setJob((j) => (j ? {
          ...j,
          overallDone: p.overallDone as number, overallTotal: p.overallTotal as number,
          currentTable: p.table as string, tableDone: p.tableDone as number, tableTotal: p.tableTotal as number,
        } : j));
      } else if (event === "seed:done") {
        setJob((j) => (j ? { ...j, status: p.status as SeedJobStatus["status"], result: p.result as SeedJobStatus["result"] } : j));
        scheduleDismiss();
      } else if (event === "seed:error") {
        setJob((j) => (j ? { ...j, status: "error", error: p.error as string } : j));
      }
    });
  }, [subscribe, scheduleDismiss]);

  // Safety net: the WS push is best-effort (a reconnect mid-job silently drops
  // whatever was sent while disconnected), so poll while a job is running —
  // otherwise a missed message leaves the bar stuck forever with no way to recover.
  useEffect(() => {
    if (job?.status !== "running") return;
    const id = window.setInterval(() => {
      const jid = jobIdRef.current;
      if (!jid) return;
      pgSeedStatus(jid).then((r) => {
        if (!r.ok || !r.job) return;
        setJob(r.job);
        if (r.job.status !== "running") scheduleDismiss();
      });
    }, 3000);
    return () => window.clearInterval(id);
  }, [job?.status, job?.jobId, scheduleDismiss]);

  const startSeed = useCallback(async (server: PgServer, database: string, rowsPerTable: number, excludeTables: SeedTableRef[] = [], projectPrompt?: string, aiApiKey?: string) => {
    const r = await pgStartSeed(server, database, rowsPerTable, excludeTables, projectPrompt, aiApiKey);
    if (!r.ok || !r.jobId) return { ok: false, error: r.error };
    window.clearTimeout(dismissTimer.current);
    jobIdRef.current = r.jobId;
    try { localStorage.setItem(LAST_JOB_KEY, r.jobId); } catch { /* ignore */ }
    setJob({ jobId: r.jobId, status: "running", overallDone: 0, overallTotal: 0, currentTable: null, tableDone: 0, tableTotal: 0, result: null, error: null });
    return { ok: true };
  }, []);

  const cancelSeed = useCallback(() => { if (jobIdRef.current) pgCancelSeed(jobIdRef.current); }, []);
  const dismiss = useCallback(() => { window.clearTimeout(dismissTimer.current); setJob(null); forget(); }, [forget]);

  return (
    <Ctx.Provider value={{ activeJob: job, startSeed, cancelSeed, dismiss }}>
      {children}
      {job && session && <SeedBar job={job} onCancel={cancelSeed} onDismiss={dismiss} />}
    </Ctx.Provider>
  );
}

export function useSeed() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSeed must be used inside SeedProvider");
  return c;
}
