import { dbSelect } from "./db";

/**
 * Shared Zoho Sprints helpers — OAuth token exchange plus the columnar
 * JSON-unfurling/mapping helpers Zoho's API returns everything in. Extracted
 * out of zoho-sprints.ts (which keeps its own JWT-scoped `loadCreds(event)`
 * and HTTP handler) so the scheduled functions (daily-brief.ts,
 * anomaly-scan.ts) can also talk to Zoho without a caller JWT — they load
 * creds via `loadCredsServiceRole()` (service-role read of `integrations`)
 * instead.
 */

export interface Creds {
  clientId?: string; clientSecret?: string; refreshToken?: string;
  dc: string; teamId?: string; projectId?: string;
}
export interface Cfg extends Creds { ACCOUNTS: string; API: string; }

export function buildCfg(creds: Partial<Creds>): Cfg {
  const dc = creds.dc || "in";
  return {
    dc,
    ACCOUNTS: `https://accounts.zoho.${dc}`,
    API: `https://sprintsapi.zoho.${dc}/zsapi`,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    refreshToken: creds.refreshToken,
    teamId: creds.teamId,
    projectId: creds.projectId,
  };
}

/** Service-role creds load for cron/scheduled functions — no caller JWT to scope RLS with. */
interface IntegrationRow {
  zoho_client_id: string | null; zoho_client_secret: string | null; zoho_refresh_token: string | null;
  zoho_dc: string | null; zoho_team_id: string | null; zoho_project_id: string | null;
}
export async function loadCredsServiceRole(userId: string): Promise<Partial<Creds>> {
  const rows = await dbSelect<IntegrationRow>(
    "integrations",
    `user_id=eq.${userId}&select=zoho_client_id,zoho_client_secret,zoho_refresh_token,zoho_dc,zoho_team_id,zoho_project_id`,
  );
  const row = rows[0];
  if (!row) return {};
  return {
    clientId: row.zoho_client_id || undefined, clientSecret: row.zoho_client_secret || undefined,
    refreshToken: row.zoho_refresh_token || undefined, dc: row.zoho_dc || "in",
    teamId: row.zoho_team_id || undefined, projectId: row.zoho_project_id || undefined,
  };
}

// token cache keyed by refresh token (per user)
const tokenCache: Record<string, { token: string; expires: number }> = {};

export async function accessToken(c: Cfg): Promise<string> {
  const key = c.refreshToken || "";
  const cached = tokenCache[key];
  if (cached && Date.now() < cached.expires) return cached.token;
  const body = new URLSearchParams({
    refresh_token: c.refreshToken || "", client_id: c.clientId || "",
    client_secret: c.clientSecret || "", grant_type: "refresh_token",
  });
  const r = await fetch(`${c.ACCOUNTS}/oauth/v2/token`, { method: "POST", body });
  const j = await r.json();
  if (!j.access_token) throw new Error(`Token exchange failed (DC=${c.dc}): ${j.error || JSON.stringify(j).slice(0, 160)}. Check your Zoho keys in Settings.`);
  const ttl = (Number(j.expires_in) || 3600) * 1000;
  tokenCache[key] = { token: j.access_token, expires: Date.now() + ttl - 5 * 60 * 1000 };
  return j.access_token;
}

export async function getJson(url: string, token: string): Promise<any> {
  const r = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  if (!r.ok) { const b = await r.text().catch(() => ""); throw new Error(`${url} → ${r.status} ${b.slice(0, 160)}`); }
  return r.json();
}

export function unfurl(json: any, propKey: string, idsKey: string, jobjKey: string, idName: string): any[] {
  const props = json?.[propKey], ids = json?.[idsKey], jobj = json?.[jobjKey];
  if (!props || !Array.isArray(ids) || !jobj) return [];
  return ids.map((id: string) => {
    const vals = jobj[id] || [];
    const rec: Record<string, unknown> = { [idName]: id };
    for (const [name, idx] of Object.entries(props)) rec[name] = vals[idx as number];
    return rec;
  });
}
export const pick = (rec: any, keys: string[], fb = ""): string => { for (const k of keys) if (rec[k] != null && rec[k] !== "") return String(rec[k]); return fb; };
export const normPrio = (name: string): string => { const n = (name || "").toLowerCase(); if (/high|critical|urgent|p1|p0/.test(n)) return "high"; if (/low|none|minor|trivial|p3|p4/.test(n)) return "low"; return "med"; };
export const truthy = (v: unknown) => v === true || v === "true" || v === 1 || v === "1";

/** Runs `fn` over `items` with at most `limit` in flight at once, preserving output order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function resolveTeam(c: Cfg, token: string): Promise<string> {
  if (c.teamId) return c.teamId;
  const teams = await getJson(`${c.API}/teams/`, token);
  const id = teams?.portals?.[0]?.zsoid;
  if (!id) throw new Error("Could not resolve team id — set it in Settings.");
  return id;
}

export async function listProjects(c: Cfg, teamId: string, token: string) {
  const pj = await getJson(`${c.API}/team/${teamId}/projects/?action=allprojects`, token);
  const rows = unfurl(pj, "project_prop", "projectIds", "projectJObj", "projectId");
  return {
    projects: rows.map((p) => ({ id: p.projectId, name: pick(p, ["name", "projectName", "projName"], "(project)"), key: pick(p, ["prefix", "projectPrefix", "projectNo", "key", "projectKey"], ""), status: pick(p, ["status", "projectStatus"], "") })),
    sampleKeys: rows[0] ? Object.keys(rows[0]) : [],
  };
}

export async function loadMaps(c: Cfg, teamId: string, projectId: string, token: string) {
  const statusMap: Record<string, string> = {}, prioMap: Record<string, string> = {};
  const typeMap: Record<string, { name: string; base: string }> = {};
  const columns: { id: string; name: string; color: string; seq: number }[] = [];
  try {
    const st = await getJson(`${c.API}/team/${teamId}/projects/${projectId}/itemstatus/?action=data`, token);
    const sObj = st?.statusJObj || {};
    for (const id of Object.keys(sObj)) { const v = sObj[id] || []; statusMap[id] = String(v[0] ?? ""); columns.push({ id, name: String(v[0] ?? ""), color: String(v[5] ?? "#8B92A0"), seq: Number(v[4] ?? 0) }); }
    columns.sort((a, b) => a.seq - b.seq || a.name.localeCompare(b.name));
  } catch { /**/ }
  try {
    const pr = await getJson(`${c.API}/team/${teamId}/projects/${projectId}/priority/?action=data`, token);
    const idx = pr?.projPriority_prop?.priorityName ?? 0; const pObj = pr?.projPriorityJObj || {};
    for (const id of Object.keys(pObj)) prioMap[id] = String(pObj[id]?.[idx] ?? "");
  } catch { /**/ }
  try {
    const ty = await getJson(`${c.API}/team/${teamId}/projects/${projectId}/itemtype/?action=data`, token);
    const p = ty?.projItemType_prop || {}; const nameIdx = p.itemTypeName ?? 1, baseIdx = p.baseType ?? 4; const tObj = ty?.projItemTypeJObj || {};
    for (const id of Object.keys(tObj)) typeMap[id] = { name: String(tObj[id]?.[nameIdx] ?? ""), base: String(tObj[id]?.[baseIdx] ?? "") };
  } catch { /**/ }
  return { statusMap, prioMap, typeMap, columns };
}

export async function itemNotes(c: Cfg, teamId: string, projectId: string, sprintId: string, itemId: string, token: string): Promise<any[]> {
  try {
    const j = await getJson(`${c.API}/team/${teamId}/projects/${projectId}/sprints/${sprintId}/item/${itemId}/attachments/?action=notes`, token);
    const arr = j?.itemAttachments?.[itemId];
    if (Array.isArray(arr)) return arr.map((a: any) => {
      const ext = (a.EXTENSION || "").toString();
      const name = a.FILE_NAME || a.NAME || (a.RESOURCE_ID ? `${a.RESOURCE_ID}${ext ? "." + ext : ""}` : "attachment");
      const thumb = a.THUMBNAIL_URL || "";
      const large = thumb ? thumb.replace(/width=\d+/, "width=1400").replace(/height=\d+/, "height=1000") : (a.PREVIEW_URL || "");
      return { name, ext, size: Number(a.SIZE) || 0, owner: a.OWNER || "", uploaded: a.UPLOADED_TIME || 0, contentType: a.CONTENT_TYPE || "", thumb, large, previewUrl: a.PREVIEW_URL || "", downloadUrl: a.DOWNLOAD_URL || a.ORIG_URL || "" };
    });
    return [];
  } catch { return []; }
}

export function mapItem(it: any, maps: { statusMap: Record<string, string>; prioMap: Record<string, string>; typeMap: Record<string, { name: string; base: string }>; users?: Record<string, string> }) {
  const t = maps.typeMap[String(it.projItemTypeId)];
  const owners = Array.isArray(it.ownerId) ? it.ownerId : (it.ownerId ? [it.ownerId] : []);
  return {
    id: it.itemId, ticketNumber: pick(it, ["itemNo", "prefixItemNo"], it.itemId),
    subject: pick(it, ["itemName", "name", "projItemName", "title"], "(untitled)"),
    sprintId: String(it.sprintId ?? ""), statusId: String(it.statusId ?? ""),
    status: maps.statusMap[String(it.statusId)] || pick(it, ["status", "statusName"], "Open"),
    priority: normPrio(maps.prioMap[String(it.projPriorityId)] || ""),
    type: t?.name || "", typeBase: t?.base || "",
    description: pick(it, ["description"], ""), hasDocs: truthy(it.isDocsAdded),
    points: pick(it, ["points"], ""), startDate: pick(it, ["startDate"], ""), endDate: pick(it, ["endDate"], ""),
    assignees: maps.users ? owners.map((o: string) => maps.users![o]).filter(Boolean) : [],
    modifiedTime: pick(it, ["lastModifiedTime", "modifiedTime", "createdTime"], ""),
  };
}

export async function sprintItems(c: Cfg, teamId: string, projectId: string, sprintId: string, token: string) {
  const ij = await getJson(`${c.API}/team/${teamId}/projects/${projectId}/sprints/${sprintId}/item/?action=sprintitems&subitem=true`, token);
  return { items: unfurl(ij, "item_prop", "itemIds", "itemJObj", "itemId"), users: (ij?.userDisplayName || {}) as Record<string, string> };
}
export async function listSprints(c: Cfg, teamId: string, projectId: string, token: string) {
  const sj = await getJson(`${c.API}/team/${teamId}/projects/${projectId}/sprints/?action=data&type=%5B1,2,3,4%5D`, token);
  return unfurl(sj, "sprint_prop", "sprintIds", "sprintJObj", "sprintId");
}

/** Mirrors `src/lib/zoho.ts`'s `isOpenItem`/`isOpenBug` exactly, ported server-side for the daily-brief/anomaly-scan crons. */
export function isOpenItemStatus(status: string): boolean {
  return !/done|closed|resolved|complete/i.test(status || "");
}
export function isBugType(typeName: string, status: string): boolean {
  return (typeName || "").toLowerCase().includes("bug") && isOpenItemStatus(status);
}
