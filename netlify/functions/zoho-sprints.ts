import type { Handler, HandlerEvent } from "@netlify/functions";

/**
 * Zoho SPRINTS proxy. Per-user credentials are read from the Supabase
 * `integrations` table (using the caller's JWT + RLS); if none are found it
 * falls back to ZOHO_* environment variables. This makes the tool multi-tenant
 * without code changes — each user stores their own keys in Settings.
 */

interface Creds {
  clientId?: string; clientSecret?: string; refreshToken?: string;
  dc: string; teamId?: string; projectId?: string;
}
interface Cfg extends Creds { ACCOUNTS: string; API: string; }

async function loadCreds(event: HandlerEvent): Promise<Partial<Creds>> {
  const auth = event.headers.authorization || event.headers.Authorization;
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (auth && url && anon) {
    try {
      const r = await fetch(`${url}/rest/v1/integrations?select=*`, { headers: { apikey: anon, Authorization: auth } });
      if (r.ok) {
        const rows = await r.json();
        const row = Array.isArray(rows) ? rows[0] : null;
        if (row) return {
          clientId: row.zoho_client_id, clientSecret: row.zoho_client_secret, refreshToken: row.zoho_refresh_token,
          dc: row.zoho_dc, teamId: row.zoho_team_id, projectId: row.zoho_project_id,
        };
      }
    } catch { /* fall through to env */ }
  }
  return {};
}

function buildCfg(creds: Partial<Creds>): Cfg {
  const dc = creds.dc || process.env.ZOHO_DC || "in";
  return {
    dc,
    ACCOUNTS: `https://accounts.zoho.${dc}`,
    API: `https://sprintsapi.zoho.${dc}/zsapi`,
    clientId: creds.clientId || process.env.ZOHO_CLIENT_ID,
    clientSecret: creds.clientSecret || process.env.ZOHO_CLIENT_SECRET,
    refreshToken: creds.refreshToken || process.env.ZOHO_REFRESH_TOKEN,
    teamId: creds.teamId || process.env.ZOHO_TEAM_ID,
    projectId: creds.projectId || process.env.ZOHO_PROJECT_ID,
  };
}

// token cache keyed by refresh token (per user)
const tokenCache: Record<string, { token: string; expires: number }> = {};

async function accessToken(c: Cfg): Promise<string> {
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

async function getJson(url: string, token: string): Promise<any> {
  const r = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  if (!r.ok) { const b = await r.text().catch(() => ""); throw new Error(`${url} → ${r.status} ${b.slice(0, 160)}`); }
  return r.json();
}

function unfurl(json: any, propKey: string, idsKey: string, jobjKey: string, idName: string): any[] {
  const props = json?.[propKey], ids = json?.[idsKey], jobj = json?.[jobjKey];
  if (!props || !Array.isArray(ids) || !jobj) return [];
  return ids.map((id: string) => {
    const vals = jobj[id] || [];
    const rec: Record<string, unknown> = { [idName]: id };
    for (const [name, idx] of Object.entries(props)) rec[name] = vals[idx as number];
    return rec;
  });
}
const pick = (rec: any, keys: string[], fb = ""): string => { for (const k of keys) if (rec[k] != null && rec[k] !== "") return String(rec[k]); return fb; };
const normPrio = (name: string): string => { const n = (name || "").toLowerCase(); if (/high|critical|urgent|p1|p0/.test(n)) return "high"; if (/low|none|minor|trivial|p3|p4/.test(n)) return "low"; return "med"; };
const truthy = (v: unknown) => v === true || v === "true" || v === 1 || v === "1";

async function resolveTeam(c: Cfg, token: string): Promise<string> {
  if (c.teamId) return c.teamId;
  const teams = await getJson(`${c.API}/teams/`, token);
  const id = teams?.portals?.[0]?.zsoid;
  if (!id) throw new Error("Could not resolve team id — set it in Settings.");
  return id;
}

async function listProjects(c: Cfg, teamId: string, token: string) {
  const pj = await getJson(`${c.API}/team/${teamId}/projects/?action=allprojects`, token);
  const rows = unfurl(pj, "project_prop", "projectIds", "projectJObj", "projectId");
  return {
    projects: rows.map((p) => ({ id: p.projectId, name: pick(p, ["name", "projectName", "projName"], "(project)"), key: pick(p, ["prefix", "projectPrefix", "projectNo", "key", "projectKey"], ""), status: pick(p, ["status", "projectStatus"], "") })),
    sampleKeys: rows[0] ? Object.keys(rows[0]) : [],
  };
}

async function loadMaps(c: Cfg, teamId: string, projectId: string, token: string) {
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

async function itemNotes(c: Cfg, teamId: string, projectId: string, sprintId: string, itemId: string, token: string): Promise<any[]> {
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

function mapItem(it: any, maps: { statusMap: Record<string, string>; prioMap: Record<string, string>; typeMap: Record<string, { name: string; base: string }>; users?: Record<string, string> }) {
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

async function sprintItems(c: Cfg, teamId: string, projectId: string, sprintId: string, token: string) {
  const ij = await getJson(`${c.API}/team/${teamId}/projects/${projectId}/sprints/${sprintId}/item/?action=sprintitems&subitem=true`, token);
  return { items: unfurl(ij, "item_prop", "itemIds", "itemJObj", "itemId"), users: (ij?.userDisplayName || {}) as Record<string, string> };
}
async function listSprints(c: Cfg, teamId: string, projectId: string, token: string) {
  const sj = await getJson(`${c.API}/team/${teamId}/projects/${projectId}/sprints/?action=data&type=%5B1,2,3,4%5D`, token);
  return unfurl(sj, "sprint_prop", "sprintIds", "sprintJObj", "sprintId");
}

const ok = (data: unknown) => ({ statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });

export const handler: Handler = async (event) => {
  try {
    const c = buildCfg(await loadCreds(event));
    if (!c.refreshToken) return { statusCode: 400, body: JSON.stringify({ error: "Zoho not configured — add your keys in Settings." }) };

    const q = event.queryStringParameters || {};
    const mode = q.mode || "items";
    const token = await accessToken(c);
    const teamId = await resolveTeam(c, token);

    if (mode === "status") return ok({ connected: true, teamId });

    if (mode === "projects") { const { projects, sampleKeys } = await listProjects(c, teamId, token); return ok({ projects, meta: { teamId, count: projects.length, sampleKeys } }); }

    if (mode === "timesheet") {
      const projs = q.project ? [{ id: q.project, name: q.name || "Project" }] : (await listProjects(c, teamId, token)).projects;
      const byProject: Record<string, number> = {}, byUser: Record<string, number> = {}, byDate: Record<string, number> = {};
      let totalMs = 0, billableMs = 0, count = 0;
      for (const proj of projs) {
        let index = 1, pages = 0;
        while (pages < 6) {
          const url = `${c.API}/team/${teamId}/projects/${proj.id}/timesheet/?action=data${index > 1 ? `&index=${index}` : ""}`;
          let j: any; try { j = await getJson(url, token); } catch { break; }
          const logs = unfurl(j, "log_prop", "logIds", "logJObj", "logId");
          const users = (j.userDisplayName || {}) as Record<string, string>;
          for (const l of logs) {
            const ms = Number(l.logTime) || 0; totalMs += ms; count++;
            if (Number(l.billableType) === 1) billableMs += ms;
            const uname = users[String(l.Owner)] || "Unknown";
            byUser[uname] = (byUser[uname] || 0) + ms;
            byProject[proj.name] = (byProject[proj.name] || 0) + ms;
            byDate[String(l.logDate || "").slice(0, 10)] = (byDate[String(l.logDate || "").slice(0, 10)] || 0) + ms;
          }
          if (!j.hasNext || !j.nextIndex || logs.length === 0) break;
          index = j.nextIndex; pages++;
        }
      }
      const H = (ms: number) => +(ms / 3600000).toFixed(2);
      const arr = (o: Record<string, number>) => Object.entries(o).map(([name, ms]) => ({ name, hours: H(ms) })).sort((a, b) => b.hours - a.hours);
      const byDateHours: Record<string, number> = {}; for (const d of Object.keys(byDate)) byDateHours[d] = H(byDate[d]);
      return ok({ totalHours: H(totalMs), billableHours: H(billableMs), nonBillableHours: H(totalMs - billableMs), count, byProject: arr(byProject), byUser: arr(byUser), byDate: byDateHours });
    }

    if (mode === "thumbs") {
      const projectId = q.project || c.projectId; const sprintId = q.sprint;
      if (!projectId || !sprintId) return { statusCode: 400, body: JSON.stringify({ error: "project and sprint required" }) };
      const { items } = await sprintItems(c, teamId, projectId, sprintId, token);
      const thumbs: Record<string, { thumb: string; count: number; preview: string }> = {}; let calls = 0;
      for (const it of items) {
        if (!truthy(it.isDocsAdded)) continue; if (calls >= 60) break; calls++;
        try { const j = await getJson(`${c.API}/team/${teamId}/projects/${projectId}/sprints/${sprintId}/item/${it.itemId}/attachments/?action=notes`, token); const a = j?.itemAttachments?.[it.itemId]; if (Array.isArray(a) && a.length) thumbs[it.itemId] = { thumb: a[0].THUMBNAIL_URL || "", preview: a[0].PREVIEW_URL || "", count: a.length }; } catch { /**/ }
      }
      return ok({ thumbs });
    }

    if (mode === "board") {
      const projectId = q.project || c.projectId;
      if (!projectId) return { statusCode: 400, body: JSON.stringify({ error: "project id required" }) };
      const maps = await loadMaps(c, teamId, projectId, token);
      const sprints = await listSprints(c, teamId, projectId, token);
      const out = []; let total = 0;
      for (const s of sprints) {
        let items: any[] = [], users: Record<string, string> = {};
        try { const r = await sprintItems(c, teamId, projectId, s.sprintId, token); items = r.items; users = r.users; } catch { items = []; }
        out.push({ id: s.sprintId, name: pick(s, ["sprintName", "name"], "Sprint"), status: pick(s, ["sprintStatus", "status", "statusName"], ""), startDate: pick(s, ["startDate"], ""), endDate: pick(s, ["endDate"], ""), items: items.map((it) => mapItem(it, { ...maps, users })) });
        total += items.length; if (total >= 600) break;
      }
      return ok({ project: projectId, columns: maps.columns, sprints: out, meta: { statusMapped: Object.keys(maps.statusMap).length, types: Object.keys(maps.typeMap).length } });
    }

    if (mode === "item") {
      const projectId = q.project || c.projectId; const sprintId = q.sprint, itemId = q.item;
      if (!projectId || !sprintId || !itemId) return { statusCode: 400, body: JSON.stringify({ error: "project, sprint and item required" }) };
      const maps = await loadMaps(c, teamId, projectId, token);
      const d = await getJson(`${c.API}/team/${teamId}/projects/${projectId}/sprints/${sprintId}/item/${itemId}/?action=details`, token);
      const users = (d?.userDisplayName || {}) as Record<string, string>;
      const it = unfurl(d, "item_prop", "itemIds", "itemJObj", "itemId")[0];
      const item = it ? mapItem(it, { ...maps, users }) : null;
      const attachments = await itemNotes(c, teamId, projectId, sprintId, itemId, token);
      return ok({ item, attachments });
    }

    // default: flat items for one project
    const projectId = q.project || c.projectId || (await listProjects(c, teamId, token)).projects[0]?.id;
    if (!projectId) return ok({ data: [] });
    const maps = await loadMaps(c, teamId, projectId, token);
    const sprints = await listSprints(c, teamId, projectId, token);
    const data: any[] = [];
    for (const s of sprints.slice(0, 12)) {
      let items: any[] = [];
      try { items = (await sprintItems(c, teamId, projectId, s.sprintId, token)).items; } catch { continue; }
      for (const it of items) { const m = mapItem(it, maps) as any; m.sprint = pick(s, ["sprintName", "name"], ""); data.push(m); if (data.length >= 200) break; }
      if (data.length >= 200) break;
    }
    return ok({ data, meta: { teamId, projectId, sprints: sprints.length } });
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: (e as Error).message }) };
  }
};
