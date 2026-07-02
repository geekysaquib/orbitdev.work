import type { Handler } from "@netlify/functions";

/**
 * Zoho SPRINTS → ORBIT work-items proxy (server-side only; secrets never reach the browser).
 *
 * Sprints returns data in an indexed "prop / Ids / JObj" shape, e.g.
 *   { item_prop: { name: 0, priority: 5, ... }, itemIds: ["2000..."],
 *     itemJObj: { "2000...": ["Fix login", ..., "High", ...] } }
 * We unfurl that into flat records. Hierarchy is team → project → sprint → item.
 */
const DC = process.env.ZOHO_DC || "in";
const ACCOUNTS = `https://accounts.zoho.${DC}`;
const API = `https://sprintsapi.zoho.${DC}/zsapi`;

async function accessToken(): Promise<string> {
  const body = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN || "",
    client_id: process.env.ZOHO_CLIENT_ID || "",
    client_secret: process.env.ZOHO_CLIENT_SECRET || "",
    grant_type: "refresh_token",
  });
  const r = await fetch(`${ACCOUNTS}/oauth/v2/token`, { method: "POST", body });
  const j = await r.json();
  if (!j.access_token) throw new Error("Zoho token exchange failed — check client id/secret/refresh token and DC");
  return j.access_token as string;
}

async function getJson(url: string, token: string): Promise<any> {
  const r = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

/** Turn a Sprints prop/Ids/JObj block into flat records. */
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

const pick = (rec: any, keys: string[], fallback = ""): string => {
  for (const k of keys) if (rec[k] != null && rec[k] !== "") return String(rec[k]);
  return fallback;
};

export const handler: Handler = async () => {
  try {
    if (!process.env.ZOHO_REFRESH_TOKEN) {
      return { statusCode: 400, body: JSON.stringify({ error: "Zoho not configured" }) };
    }
    const token = await accessToken();

    // 1) team / portal id
    let teamId = process.env.ZOHO_TEAM_ID;
    if (!teamId) {
      const teams = await getJson(`${API}/teams/`, token);
      teamId = teams?.portals?.[0]?.zsoid;
      if (!teamId) throw new Error("Could not resolve team id from /teams/ — set ZOHO_TEAM_ID");
    }

    // 2) project (override with ZOHO_PROJECT_ID, or match ZOHO_PROJECT_NAME, else first)
    let projectId = process.env.ZOHO_PROJECT_ID;
    const wantName = (process.env.ZOHO_PROJECT_NAME || "").toLowerCase();
    if (!projectId) {
      const pj = await getJson(`${API}/team/${teamId}/projects/?action=allprojects`, token);
      const projects = unfurl(pj, "project_prop", "projectIds", "projectJObj", "projectId");
      const match = wantName ? projects.find((p) => pick(p, ["name", "projectName"]).toLowerCase().includes(wantName)) : null;
      projectId = (match || projects[0])?.projectId;
      if (!projectId) throw new Error("No projects found for this team");
    }

    // 3) sprints (types 1-4 = active/upcoming/completed/backlog scope)
    const sj = await getJson(`${API}/team/${teamId}/projects/${projectId}/sprints/?action=data&type=[1,2,3,4]`, token);
    const sprints = unfurl(sj, "sprint_prop", "sprintIds", "sprintJObj", "sprintId");

    // 4) items across the first few sprints (bounded for a fast serverless response)
    const out: any[] = [];
    let sampleKeys: string[] = [];
    for (const s of sprints.slice(0, 6)) {
      const ij = await getJson(
        `${API}/team/${teamId}/projects/${projectId}/sprints/${s.sprintId}/item/?action=sprintitems&subitem=true`, token);
      const items = unfurl(ij, "item_prop", "itemIds", "itemJObj", "itemId");
      if (items.length && !sampleKeys.length) sampleKeys = Object.keys(items[0]);
      for (const it of items) {
        out.push({
          id: it.itemId,
          ticketNumber: pick(it, ["itemNo", "prefixItemNo", "itemPrefix"], it.itemId),
          subject: pick(it, ["name", "itemName", "projItemName", "title"], "(untitled)"),
          status: pick(it, ["status", "statusName", "projStatus", "itemStatus"], "Open"),
          priority: pick(it, ["priority", "priorityName", "projPriority"], "med"),
          sprint: pick(s, ["sprintName", "name"], ""),
          modifiedTime: pick(it, ["lastModifiedTime", "modifiedTime"], ""),
        });
        if (out.length >= 60) break;
      }
      if (out.length >= 60) break;
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      // sampleKeys lets you confirm the real item field names on first run and
      // tweak the pick() lists above if your workspace uses different labels.
      body: JSON.stringify({ data: out, meta: { teamId, projectId, sprints: sprints.length, sampleKeys } }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: (e as Error).message }) };
  }
};
