import { supabase } from "./supabase";
import { getUser } from "./auth";
import { getOnline } from "./offline";
import type { Json } from "./database.types";

/**
 * Durable, append-only record of targeted key actions (see supabase/schema.sql
 * `audit_log`). Deliberately NOT a generic mutation log — only meaningful
 * events get recorded, from explicit call sites, so the log stays signal-heavy.
 */
export type AuditAction =
  | "sign_in" | "sign_out"
  | "integration.connect" | "integration.disconnect" | "integration.update"
  | "task.create" | "task.update" | "task.delete"
  | "ticket.create" | "ticket.update" | "ticket.delete"
  | "project.create" | "project.update" | "project.delete"
  | "project.link_repo" | "project.unlink_repo"
  | "pg_server.create" | "pg_server.update" | "pg_server.delete"
  | "team.invite" | "team.join" | "team.remove_member" | "team.transfer_ownership"
  | "onboarding.completed" | "onboarding.skipped";

export interface AuditEntry {
  id: string; user_id: string; team_id: string | null; action: string; entity_type: string;
  entity_id: string | null; meta: Json; created_at: string;
}

/**
 * Fire-and-forget — never throws, and no-ops while offline rather than
 * queuing (offline mode is read-only-cache-only, no write queue). Losing an
 * audit row to a dropped connection is an acceptable tradeoff for keeping
 * this dead simple.
 */
export async function recordAudit(input: {
  action: AuditAction | string;
  entityType: string;
  entityId?: string | null;
  teamId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  if (!getOnline()) return;
  const u = getUser();
  if (!u) return;
  try {
    await supabase.from("audit_log").insert({
      user_id: u.id,
      team_id: input.teamId ?? null,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      meta: (input.meta ?? {}) as Json,
    });
  } catch { /* best-effort — never let audit logging break the caller's flow */ }
}

export async function fetchAuditLog(opts: {
  page?: number; pageSize?: number; action?: string; entityType?: string; from?: string; to?: string;
} = {}): Promise<{ rows: AuditEntry[]; total: number; error?: string }> {
  const page = opts.page ?? 0;
  const pageSize = opts.pageSize ?? 50;
  let q = supabase.from("audit_log").select("*", { count: "exact" }).order("created_at", { ascending: false });
  if (opts.action) q = q.eq("action", opts.action);
  if (opts.entityType) q = q.eq("entity_type", opts.entityType);
  if (opts.from) q = q.gte("created_at", opts.from);
  if (opts.to) q = q.lte("created_at", opts.to);
  const { data, error, count } = await q.range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) return { rows: [], total: 0, error: error.message };
  return { rows: (data ?? []) as AuditEntry[], total: count ?? 0 };
}
