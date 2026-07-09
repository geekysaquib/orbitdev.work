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

import { authHeader as authHdr } from "./auth";

const fn = "/.netlify/functions/zoho-sprints";

async function authHeader(): Promise<Record<string, string>> {
  return authHdr();
}

async function get<T>(qs = ""): Promise<T> {
  const r = await fetch(fn + qs, { headers: await authHeader() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Zoho fetch failed (${r.status})`);
  return j as T;
}

// Flat items for the pinned/first project — used by Tickets + Dashboard.
export async function fetchZohoTickets(): Promise<ZohoItem[]> {
  const j = await get<{ data: ZohoItem[] }>();
  return j.data ?? [];
}
export async function fetchSprintProjects(): Promise<SprintProject[]> {
  const j = await get<{ projects: SprintProject[] }>("?mode=projects");
  return j.projects ?? [];
}
export async function fetchSprintBoard(projectId: string): Promise<Board> {
  return get<Board>(`?mode=board&project=${encodeURIComponent(projectId)}`);
}
export async function fetchItemDetail(projectId: string, sprintId: string, itemId: string): Promise<ItemDetail> {
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
export async function fetchThumbs(projectId: string, sprintId: string): Promise<Record<string, Thumb>> {
  const j = await get<{ thumbs: Record<string, Thumb> }>(`?mode=thumbs&project=${encodeURIComponent(projectId)}&sprint=${encodeURIComponent(sprintId)}`);
  return j.thumbs ?? {};
}

export interface HoursByKey { name: string; hours: number; }
export interface Timesheet {
  totalHours: number; billableHours: number; nonBillableHours: number; count: number;
  byProject: HoursByKey[]; byUser: HoursByKey[]; byDate: Record<string, number>;
}
export async function fetchTimesheet(): Promise<Timesheet> {
  return get<Timesheet>("?mode=timesheet");
}
