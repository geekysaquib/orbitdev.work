/**
 * PostgreSQL access through the local ORBIT agent.
 * The browser can't open TCP to Postgres, so the agent (see /agent) proxies it
 * with the `pg` driver. Connection details live in the agent's pg-config.json.
 */
import { getAgentUrl } from "./agent";

async function call(path: string, method: "GET" | "POST" | "DELETE" = "GET", body?: unknown): Promise<Response> {
  return fetch(getAgentUrl() + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export interface PgServer { id: string; name: string; host: string; port: number; user: string; database: string | null; ssl: boolean; }
export interface PgServerInput { name?: string; host: string; port?: number; user: string; password?: string; database?: string; ssl?: boolean; }
export interface PgResult { command?: string; fields: string[]; rows: Record<string, unknown>[]; rowCount: number; truncated?: boolean; ms: number; }
export interface PgTable { schema: string; name: string; type: string; }

export async function pgServers(): Promise<{ ok: boolean; servers: PgServer[]; error?: string }> {
  try { const r = await call("/pg/servers"); const j = await r.json().catch(() => ({})); return r.ok ? { ok: true, servers: j.servers ?? [] } : { ok: false, servers: [], error: j.error }; }
  catch { return { ok: false, servers: [], error: "agent offline" }; }
}
export async function pgAddServer(input: PgServerInput): Promise<{ ok: boolean; server?: PgServer; error?: string }> {
  try { const r = await call("/pg/servers", "POST", input); const j = await r.json().catch(() => ({})); return r.ok ? { ok: true, server: j.server } : { ok: false, error: j.error || `agent ${r.status}` }; }
  catch { return { ok: false, error: "agent offline" }; }
}
export async function pgTestServer(input: PgServerInput): Promise<{ ok: boolean; version?: string; error?: string }> {
  try { const r = await call("/pg/test", "POST", input); const j = await r.json().catch(() => ({})); return r.ok ? { ok: true, version: j.version } : { ok: false, error: j.error || `agent ${r.status}` }; }
  catch { return { ok: false, error: "agent offline" }; }
}
export async function pgDeleteServer(id: string): Promise<{ ok: boolean }> {
  try { const r = await call(`/pg/servers/${id}`, "DELETE"); return { ok: r.ok }; } catch { return { ok: false }; }
}
export async function pgDatabases(server: string): Promise<{ ok: boolean; databases: string[]; error?: string }> {
  try { const r = await call(`/pg/databases?server=${encodeURIComponent(server)}`); const j = await r.json().catch(() => ({})); return r.ok ? { ok: true, databases: j.databases ?? [] } : { ok: false, databases: [], error: j.error }; }
  catch { return { ok: false, databases: [], error: "agent offline" }; }
}
export async function pgTables(server: string, database: string): Promise<{ ok: boolean; tables: PgTable[]; error?: string }> {
  try { const r = await call(`/pg/tables?server=${encodeURIComponent(server)}&database=${encodeURIComponent(database)}`); const j = await r.json().catch(() => ({})); return r.ok ? { ok: true, tables: j.tables ?? [] } : { ok: false, tables: [], error: j.error }; }
  catch { return { ok: false, tables: [], error: "agent offline" }; }
}
export async function pgQuery(server: string, database: string, sql: string): Promise<{ ok: boolean; result?: PgResult; error?: string; ms?: number }> {
  try {
    const r = await call("/pg/query", "POST", { server, database, sql });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: j.error || `agent ${r.status}`, ms: j.ms };
    return { ok: true, result: j as PgResult };
  } catch { return { ok: false, error: "agent offline" }; }
}

export interface PgHealth { ok: boolean; name: string; connections: number; longestSec: number; size: string; error?: string; }
export async function pgHealth(server: string): Promise<PgHealth> {
  try {
    const r = await fetch(`${getAgentUrl()}/pg/health?server=${encodeURIComponent(server)}`);
    const j = await r.json().catch(() => ({}));
    return { ok: !!j.ok, name: j.name ?? server, connections: j.connections ?? 0, longestSec: j.longestSec ?? 0, size: j.size ?? "—", error: j.error };
  } catch { return { ok: false, name: server, connections: 0, longestSec: 0, size: "—", error: "agent offline" }; }
}
