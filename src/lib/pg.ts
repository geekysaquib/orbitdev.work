/**
 * PostgreSQL access is split across two stores:
 *  - The saved server list ("machines") lives in Supabase (`pg_servers`,
 *    RLS-scoped per user) — same plaintext-column trust model as the
 *    `integrations` table (Zoho/Gmail keys). CRUD goes straight through the
 *    Supabase client below, no agent involved.
 *  - Actually *connecting* still has to go through the local ORBIT agent —
 *    the browser can't open a raw TCP connection to Postgres. The agent is
 *    stateless about servers: every call hands it the connection details for
 *    that one request, it never stores its own copy.
 */
import { agentCall } from "./agent";
import { supabase } from "./supabase";
import { getUser } from "./auth";
import { getOnline, OFFLINE_ERROR } from "./offline";

// Thin wrapper over the shared agentCall (see lib/agent.ts) — every call site
// below is GET or POST (agentCall infers the method from whether a body is
// given, so a bodyless POST still needs an explicit `{}` to send as POST).
async function call(path: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<Response> {
  return agentCall(path, method === "GET" ? undefined : (body ?? {}));
}

export interface PgServer { id: string; name: string; host: string; port: number; user: string; password: string | null; database: string | null; ssl: boolean; }
export interface PgServerInput { name?: string; host: string; port?: number; user: string; password?: string; database?: string; ssl?: boolean; }
export interface PgResult { command?: string; fields: string[]; rows: Record<string, unknown>[]; rowCount: number; truncated?: boolean; ms: number; }
export interface PgTable { schema: string; name: string; type: string; }
export interface PgColumn { name: string; type: string; nullable: boolean; default: string | null; isPrimaryKey: boolean; }
export interface PgSchemaTable { schema: string; name: string; type: string; columns: PgColumn[]; primaryKey: string[]; }
export interface PgForeignKey { name: string; schema: string; table: string; columns: string[]; refSchema: string; refTable: string; refColumns: string[]; }
export interface PgSchema { tables: PgSchemaTable[]; foreignKeys: PgForeignKey[]; }

interface PgServerRow { id: string; name: string; host: string; port: number; db_user: string; password: string | null; database: string | null; ssl: boolean; }
const rowToServer = (r: PgServerRow): PgServer => ({ id: r.id, name: r.name, host: r.host, port: r.port, user: r.db_user, password: r.password ?? null, database: r.database ?? null, ssl: !!r.ssl });
const inputToRow = (input: PgServerInput) => ({
  name: input.name?.trim() || input.host, host: input.host, port: Number(input.port) || 5432,
  db_user: input.user, password: input.password || "", database: input.database || null, ssl: !!input.ssl,
});
/** What the agent needs to open a connection — never the friendly name/id, those stay client-side. */
const connOf = (server: PgServer) => ({ host: server.host, port: server.port, user: server.user, password: server.password, ssl: server.ssl });

// ---- Saved servers (Supabase, RLS-scoped) ----
export async function pgServers(): Promise<{ ok: boolean; servers: PgServer[]; error?: string }> {
  const { data, error } = await supabase.from("pg_servers").select("*").order("created_at", { ascending: true });
  if (error) return { ok: false, servers: [], error: error.message };
  return { ok: true, servers: ((data ?? []) as PgServerRow[]).map(rowToServer) };
}
export async function pgAddServer(input: PgServerInput): Promise<{ ok: boolean; server?: PgServer; error?: string }> {
  if (!getOnline()) return { ok: false, error: OFFLINE_ERROR };
  const u = getUser();
  if (!u) return { ok: false, error: "Not signed in" };
  const { data, error } = await supabase.from("pg_servers").insert({ user_id: u.id, ...inputToRow(input) }).select().single();
  if (error || !data) return { ok: false, error: error?.message || "Couldn't save server" };
  return { ok: true, server: rowToServer(data as PgServerRow) };
}
export async function pgUpdateServer(id: string, input: PgServerInput): Promise<{ ok: boolean; server?: PgServer; error?: string }> {
  if (!getOnline()) return { ok: false, error: OFFLINE_ERROR };
  const { data, error } = await supabase.from("pg_servers")
    .update({ ...inputToRow(input), updated_at: new Date().toISOString() })
    .eq("id", id).select().single();
  if (error || !data) return { ok: false, error: error?.message || "Couldn't update server" };
  return { ok: true, server: rowToServer(data as PgServerRow) };
}
export async function pgDeleteServer(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!getOnline()) return { ok: false, error: OFFLINE_ERROR };
  const { error } = await supabase.from("pg_servers").delete().eq("id", id);
  return { ok: !error, error: error?.message };
}

// ---- Connecting (via the local agent — stateless, one-shot per call) ----
export async function pgTestServer(input: PgServerInput): Promise<{ ok: boolean; version?: string; error?: string }> {
  try { const r = await call("/pg/test", "POST", input); const j = await r.json().catch(() => ({})); return r.ok ? { ok: true, version: j.version } : { ok: false, error: j.error || `agent ${r.status}` }; }
  catch { return { ok: false, error: "agent offline" }; }
}
export async function pgDatabases(server: PgServer): Promise<{ ok: boolean; databases: string[]; error?: string }> {
  try { const r = await call("/pg/databases", "POST", { server: connOf(server) }); const j = await r.json().catch(() => ({})); return r.ok ? { ok: true, databases: j.databases ?? [] } : { ok: false, databases: [], error: j.error }; }
  catch { return { ok: false, databases: [], error: "agent offline" }; }
}
export async function pgCreateDatabase(server: PgServer, name: string): Promise<{ ok: boolean; database?: string; error?: string }> {
  try {
    const r = await call("/pg/databases/create", "POST", { server: connOf(server), name });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, database: j.database } : { ok: false, error: j.error || `agent ${r.status}` };
  } catch { return { ok: false, error: "agent offline" }; }
}
export async function pgTables(server: PgServer, database: string): Promise<{ ok: boolean; tables: PgTable[]; error?: string }> {
  try { const r = await call("/pg/tables", "POST", { server: connOf(server), database }); const j = await r.json().catch(() => ({})); return r.ok ? { ok: true, tables: j.tables ?? [] } : { ok: false, tables: [], error: j.error }; }
  catch { return { ok: false, tables: [], error: "agent offline" }; }
}
export async function pgBackupAvailable(): Promise<boolean> {
  try { const r = await call("/pg/backup/available", "GET"); const j = await r.json().catch(() => ({})); return !!(j as { available?: boolean }).available; }
  catch { return false; }
}
/** Returns the dump as a Blob for the caller to trigger a browser download with — no native picker involved, unlike dockerSave. */
export async function pgBackup(server: PgServer, database: string): Promise<{ ok: boolean; blob?: Blob; filename?: string; error?: string }> {
  try {
    const r = await call("/pg/backup", "POST", { server: connOf(server), database });
    if (!r.ok) { const j = await r.json().catch(() => ({})); return { ok: false, error: (j as { error?: string }).error || `agent ${r.status}` }; }
    const blob = await r.blob();
    const match = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "");
    return { ok: true, blob, filename: match?.[1] || `${database}.sql` };
  } catch { return { ok: false, error: "agent offline" }; }
}
export async function pgSchema(server: PgServer, database: string): Promise<{ ok: boolean; schema?: PgSchema; error?: string }> {
  try {
    const r = await call("/pg/schema", "POST", { server: connOf(server), database });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, schema: { tables: j.tables ?? [], foreignKeys: j.foreignKeys ?? [] } } : { ok: false, error: j.error };
  } catch { return { ok: false, error: "agent offline" }; }
}
export async function pgQuery(server: PgServer, database: string, sql: string): Promise<{ ok: boolean; result?: PgResult; error?: string; ms?: number }> {
  try {
    const r = await call("/pg/query", "POST", { server: connOf(server), database, sql });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: j.error || `agent ${r.status}`, ms: j.ms };
    if (!Array.isArray(j.rows) || !Array.isArray(j.fields)) return { ok: false, error: "Malformed response from agent", ms: j.ms };
    return { ok: true, result: j as PgResult };
  } catch { return { ok: false, error: "agent offline" }; }
}

// ---- Dummy-data seeding ----
export const MAX_ROWS_PER_TABLE = 1000;
export interface SeedTableRef { schema: string; name: string; }
export interface SeedSkip { table: string; reason: string; }
export interface SeedJobStatus {
  jobId: string;
  status: "running" | "done" | "cancelled" | "error";
  overallDone: number;
  overallTotal: number;
  currentTable: string | null;
  tableDone: number;
  tableTotal: number;
  result: { inserted: Record<string, number>; skipped: SeedSkip[] } | null;
  error: string | null;
}
export async function pgStartSeed(server: PgServer, database: string, rowsPerTable: number, excludeTables: SeedTableRef[] = [], projectPrompt?: string, aiApiKey?: string): Promise<{ ok: boolean; jobId?: string; error?: string }> {
  try {
    const r = await call("/pg/seed/start", "POST", { server: connOf(server), database, rowsPerTable, excludeTables, projectPrompt, aiApiKey });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, jobId: j.jobId } : { ok: false, error: j.error || `agent ${r.status}` };
  } catch { return { ok: false, error: "agent offline" }; }
}
export async function pgSeedStatus(jobId: string): Promise<{ ok: boolean; job?: SeedJobStatus; error?: string }> {
  try {
    const r = await call(`/pg/seed/status/${jobId}`, "GET");
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, job: j.job } : { ok: false, error: j.error };
  } catch { return { ok: false, error: "agent offline" }; }
}
export async function pgCancelSeed(jobId: string): Promise<{ ok: boolean; error?: string }> {
  try { const r = await call(`/pg/seed/cancel/${jobId}`, "POST"); const j = await r.json().catch(() => ({})); return { ok: r.ok, error: j.error }; }
  catch { return { ok: false, error: "agent offline" }; }
}

export interface PgHealth { ok: boolean; name: string; connections: number; longestSec: number; size: string; error?: string; }
export async function pgHealth(server: PgServer, database?: string): Promise<PgHealth> {
  try {
    const r = await call("/pg/health", "POST", { server: connOf(server), database });
    const j = await r.json().catch(() => ({}));
    return { ok: !!j.ok, name: server.name, connections: j.connections ?? 0, longestSec: j.longestSec ?? 0, size: j.size ?? "—", error: j.error };
  } catch { return { ok: false, name: server.name, connections: 0, longestSec: 0, size: "—", error: "agent offline" }; }
}
