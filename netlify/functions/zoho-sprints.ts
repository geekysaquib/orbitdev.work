import type { Handler, HandlerEvent } from "@netlify/functions";
import { verifySession } from "./_lib/verifyToken";
import {
  type Creds, type Cfg, buildCfg, accessToken, getJson, unfurl, pick, truthy,
  mapLimit, resolveTeam, listProjects, loadMaps, itemNotes, mapItem, sprintItems, listSprints,
} from "./_lib/zohoAuth";

/**
 * Zoho SPRINTS proxy. Credentials are read strictly from the caller's own row
 * in the Supabase `integrations` table (via their JWT + RLS) — there is
 * deliberately no environment-variable fallback. Each account must link its
 * own Zoho keys in Settings; a signed-in user with nothing configured gets a
 * "not configured" error, never another account's data.
 *
 * Shared token-refresh/columnar-JSON helpers live in `_lib/zohoAuth.ts` so the
 * daily-brief/anomaly-scan scheduled functions can talk to Zoho too, without a
 * caller JWT to load creds through.
 */

async function loadCreds(event: HandlerEvent): Promise<Partial<Creds>> {
  const auth = event.headers.authorization || event.headers.Authorization;
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Server misconfigured — SUPABASE_URL/SUPABASE_ANON_KEY are not set for zoho-sprints.");

  const r = await fetch(`${url}/rest/v1/integrations?select=*`, { headers: { apikey: anon, Authorization: auth || "" } });
  if (!r.ok) throw new Error(`Could not load your integration settings (${r.status}).`);
  const rows = await r.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return {};
  return {
    clientId: row.zoho_client_id, clientSecret: row.zoho_client_secret, refreshToken: row.zoho_refresh_token,
    dc: row.zoho_dc, teamId: row.zoho_team_id, projectId: row.zoho_project_id,
  };
}

const ok = (data: unknown) => ({ statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });

export const handler: Handler = async (event) => {
  const session = await verifySession(event.headers.authorization || event.headers.Authorization);
  if (!session) return { statusCode: 401, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Sign in required." }) };

  try {
    const c: Cfg = buildCfg(await loadCreds(event));
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
      const docItems = items.filter((it) => truthy(it.isDocsAdded)).slice(0, 60);
      const fetched = await mapLimit(docItems, 8, async (it) => {
        try {
          const j = await getJson(`${c.API}/team/${teamId}/projects/${projectId}/sprints/${sprintId}/item/${it.itemId}/attachments/?action=notes`, token);
          const a = j?.itemAttachments?.[it.itemId];
          if (Array.isArray(a) && a.length) return { id: it.itemId as string, thumb: a[0].THUMBNAIL_URL || "", preview: a[0].PREVIEW_URL || "", count: a.length };
        } catch { /**/ }
        return null;
      });
      const thumbs: Record<string, { thumb: string; count: number; preview: string }> = {};
      for (const r of fetched) if (r) thumbs[r.id] = { thumb: r.thumb, preview: r.preview, count: r.count };
      return ok({ thumbs });
    }

    if (mode === "board") {
      const projectId = q.project || c.projectId;
      if (!projectId) return { statusCode: 400, body: JSON.stringify({ error: "project id required" }) };
      const maps = await loadMaps(c, teamId, projectId, token);
      const sprints = await listSprints(c, teamId, projectId, token);
      const fetched = await mapLimit(sprints, 5, async (s) => {
        try { const r = await sprintItems(c, teamId, projectId, s.sprintId, token); return { s, items: r.items, users: r.users }; }
        catch { return { s, items: [] as any[], users: {} as Record<string, string> }; }
      });
      const out = []; let total = 0;
      for (const { s, items, users } of fetched) {
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
    const targetSprints = sprints.slice(0, 12);
    const fetched = await mapLimit(targetSprints, 5, async (s) => {
      try { return { s, items: (await sprintItems(c, teamId, projectId, s.sprintId, token)).items }; }
      catch { return { s, items: [] as any[] }; }
    });
    const data: any[] = [];
    outer: for (const { s, items } of fetched) {
      for (const it of items) {
        const m = mapItem(it, maps) as any; m.sprint = pick(s, ["sprintName", "name"], "");
        data.push(m);
        if (data.length >= 200) break outer;
      }
    }
    return ok({ data, meta: { teamId, projectId, sprints: sprints.length } });
  } catch (e) {
    console.error("[zoho-sprints]", e);
    const msg = (e as Error).message || "";
    // A handful of errors above are written to guide the user to a fix (bad/missing
    // keys, unresolved team) — safe to show as-is. Everything else (raw upstream
    // URLs/status codes from getJson, network errors) stays server-side only.
    const safe = /Check your Zoho keys in Settings|set it in Settings|not configured|Server misconfigured/i.test(msg);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: safe ? msg : "Something went wrong talking to Zoho. Please try again." }),
    };
  }
};
