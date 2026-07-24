/**
 * Zoho Sprints access via the Netlify function (secrets stay server-side).
 * See netlify/functions/zoho-sprints.ts
 */
export interface ZohoItem {
  id: string;
  ticketNumber: string;
  subject: string;
  sprintId?: string;
  statusId?: string;
  status: string;
  priority: string;
  type?: string;
  typeBase?: string;
  description?: string;
  hasDocs?: boolean;
  points?: string;
  startDate?: string;
  endDate?: string;
  assignees?: string[];
  sprint?: string;
  modifiedTime?: string;
}
export interface BoardColumn { id: string; name: string; color: string; seq: number; }
export interface SprintProject { id: string; name: string; key: string; status: string; }
export interface BoardSprint { id: string; name: string; status: string; startDate: string; endDate: string; items: ZohoItem[]; }
export interface Board { project: string; columns: BoardColumn[]; sprints: BoardSprint[]; }
export interface Attachment { name: string; ext?: string; size?: number; owner?: string; uploaded?: number; contentType?: string; thumb?: string; large?: string; previewUrl?: string; downloadUrl?: string; }
export interface ItemDetail { item: ZohoItem | null; attachments: Attachment[]; }

/** Shared bug classification — used by BreakView.tsx. */
export const isOpenBug = (it: ZohoItem): boolean =>
  (it.type || "").toLowerCase().includes("bug") && !/done|closed|resolved|complete/i.test(it.status || "");

/** Any not-yet-closed sprint item, regardless of type — used by Dashboard's "Open items" widget. */
export const isOpenItem = (it: ZohoItem): boolean =>
  !/done|closed|resolved|complete/i.test(it.status || "");

import { authHeader as authHdr } from "./auth";
import { postJson } from "./apiClient";

const fn = "/.netlify/functions/zoho-sprints";

async function authHeader(): Promise<Record<string, string>> {
  return authHdr();
}

/**
 * RC1 task 10: every fetch* function below returns a `ZohoResult` instead of
 * throwing — `fetchZohoStatus`/`exchangeZohoCode` already used this pattern
 * (their own result shapes, kept as-is), while everything else threw,
 * relying on every call site remembering to catch. Every current call site
 * already did (verified before this refactor), so runtime behavior is
 * unchanged — this just makes "can fail" part of the type signature instead
 * of a convention a future call site could forget.
 */
export type ZohoResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function get<T>(qs = ""): Promise<ZohoResult<T>> {
  try {
    const r = await fetch(fn + qs, { headers: await authHeader() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: (j as { error?: string }).error || `Zoho fetch failed (${r.status})` };
    return { ok: true, data: j as T };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Flat items for the pinned/first project — used by Tickets + Dashboard.
export async function fetchZohoTickets(): Promise<ZohoResult<ZohoItem[]>> {
  const r = await get<{ data: ZohoItem[] }>();
  return r.ok ? { ok: true, data: r.data.data ?? [] } : r;
}
export async function fetchSprintProjects(): Promise<ZohoResult<SprintProject[]>> {
  const r = await get<{ projects: SprintProject[] }>("?mode=projects");
  return r.ok ? { ok: true, data: r.data.projects ?? [] } : r;
}
export async function fetchSprintBoard(projectId: string): Promise<ZohoResult<Board>> {
  return get<Board>(`?mode=board&project=${encodeURIComponent(projectId)}`);
}
export async function fetchItemDetail(projectId: string, sprintId: string, itemId: string): Promise<ZohoResult<ItemDetail>> {
  return get<ItemDetail>(`?mode=item&project=${encodeURIComponent(projectId)}&sprint=${encodeURIComponent(sprintId)}&item=${encodeURIComponent(itemId)}`);
}

export async function fetchZohoStatus(): Promise<{ connected: boolean; error?: string }> {
  try {
    const r = await fetch(fn + "?mode=status", { headers: await authHeader() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { connected: false, error: (j as { error?: string }).error };
    return { connected: !!(j as { connected?: boolean }).connected };
  } catch (e) {
    return { connected: false, error: (e as Error).message };
  }
}

export interface Thumb { thumb: string; preview: string; count: number; }
export async function fetchThumbs(projectId: string, sprintId: string): Promise<ZohoResult<Record<string, Thumb>>> {
  const r = await get<{ thumbs: Record<string, Thumb> }>(`?mode=thumbs&project=${encodeURIComponent(projectId)}&sprint=${encodeURIComponent(sprintId)}`);
  return r.ok ? { ok: true, data: r.data.thumbs ?? {} } : r;
}

export interface HoursByKey { name: string; hours: number; }
export interface Timesheet {
  totalHours: number; billableHours: number; nonBillableHours: number; count: number;
  byProject: HoursByKey[]; byUser: HoursByKey[]; byDate: Record<string, number>;
}
export async function fetchTimesheet(): Promise<ZohoResult<Timesheet>> {
  return get<Timesheet>("?mode=timesheet");
}

/**
 * Exchanges a Zoho Self Client grant code for a refresh token server-side —
 * the piece that otherwise needs a terminal + curl. See netlify/functions/zoho-exchange.ts.
 */
export async function exchangeZohoCode(args: { clientId: string; clientSecret: string; code: string; dc: string }): Promise<{ refreshToken?: string; error?: string }> {
  const res = await postJson<{ refresh_token?: string; access_token?: string; expires_in?: number }>(
    "/.netlify/functions/zoho-exchange",
    { clientId: args.clientId, clientSecret: args.clientSecret, code: args.code, dc: args.dc },
  );
  if (!res.ok) return { error: res.error };
  return { refreshToken: res.refresh_token };
}
