import { schedule } from "@netlify/functions";
import { dbSelect, dbInsert } from "./_lib/db";
import { askClaude } from "./_lib/anthropic";
import { fetchOpenPulls, fetchRecentRuns, fetchSentryUnresolvedCount, type RepoProvider } from "./_lib/providerFetch";
import { buildCfg, accessToken, resolveTeam, listSprints, sprintItems, loadMaps, mapItem, loadCredsServiceRole, isOpenItemStatus, isBugType } from "./_lib/zohoAuth";

/**
 * Weekday-morning "here's your day" brief — same scheduled-function shape as
 * weekly-digest.ts (service-role reads via _lib/db.ts, direct provider/
 * Anthropic calls since a cron invocation has no caller JWT or running local
 * agent). Gathers: tasks due soon, Zoho sprint items due soon + open bug
 * count, open PRs (with age) + recent CI runs across linked repos, and Sentry
 * unresolved issue count — then has Claude turn that fact list into a short
 * prose summary. Users without an `anthropic_api_key` are skipped (no
 * local-model fallback possible from cron, same rule as weekly-digest.ts).
 */

interface IntegrationRow { user_id: string; anthropic_api_key: string | null; }
interface ProjectRow {
  id: string; name: string; status: string;
  repo_provider: RepoProvider | null; repo_full_name: string | null; sprint_project_id: string | null;
}
interface ProviderConnRow { provider: string; access_token: string | null; config: Record<string, unknown>; }
interface TaskRow { title: string; due_date: string | null; priority: string; }

function tomorrowDateStr(): string {
  const d = new Date(Date.now() + 86_400_000);
  return d.toISOString().slice(0, 10);
}

async function fetchZohoSummary(userId: string): Promise<{ dueSoon: string[]; openBugs: number } | null> {
  const creds = await loadCredsServiceRole(userId);
  if (!creds.refreshToken) return null;
  const c = buildCfg(creds);
  try {
    const token = await accessToken(c);
    const teamId = await resolveTeam(c, token);
    const projects = await dbSelect<{ sprint_project_id: string }>(
      "projects", `user_id=eq.${userId}&status=eq.active&sprint_project_id=not.is.null&select=sprint_project_id`,
    );
    const dueSoon: string[] = [];
    let openBugs = 0;
    const cutoff = Date.now() + 3 * 86_400_000;
    for (const p of projects.slice(0, 4)) {
      const projectId = p.sprint_project_id;
      const maps = await loadMaps(c, teamId, projectId, token);
      const sprints = await listSprints(c, teamId, projectId, token);
      for (const s of sprints.slice(0, 3)) {
        const { items, users } = await sprintItems(c, teamId, projectId, s.sprintId, token);
        for (const raw of items) {
          const it = mapItem(raw, { ...maps, users });
          if (!isOpenItemStatus(it.status)) continue;
          if (isBugType(it.type, it.status)) openBugs++;
          if (it.endDate && it.endDate !== "-1") {
            const t = new Date(it.endDate).getTime();
            if (!Number.isNaN(t) && t <= cutoff) dueSoon.push(`${it.subject} (due ${it.endDate.slice(0, 10)})`);
          }
        }
      }
    }
    return { dueSoon: dueSoon.slice(0, 10), openBugs };
  } catch (e) {
    console.error(`[daily-brief] zoho summary failed for ${userId}`, e);
    return null;
  }
}

async function run() {
  let integrations: IntegrationRow[];
  try {
    integrations = await dbSelect<IntegrationRow>("integrations", "anthropic_api_key=not.is.null&select=user_id,anthropic_api_key");
  } catch (e) {
    console.error("[daily-brief] couldn't load integrations", e);
    return { statusCode: 200, body: "ok" };
  }

  for (const intg of integrations) {
    if (!intg.anthropic_api_key) continue;
    try {
      const userId = intg.user_id;
      const [projects, connections, tasksDue] = await Promise.all([
        dbSelect<ProjectRow>("projects", `user_id=eq.${userId}&status=eq.active&select=id,name,status,repo_provider,repo_full_name,sprint_project_id`),
        dbSelect<ProviderConnRow>("provider_connections", `user_id=eq.${userId}&provider=in.(github,gitlab,azuredevops,sentry)&select=provider,access_token,config`),
        dbSelect<TaskRow>("tasks", `user_id=eq.${userId}&status=neq.done&due_date=lte.${tomorrowDateStr()}&select=title,due_date,priority`),
      ]);

      const connByProvider = new Map(connections.filter((c) => c.access_token).map((c) => [c.provider, c]));
      const linkedRepos = projects.filter((p) => p.repo_provider && p.repo_full_name && connByProvider.has(p.repo_provider));

      let prCount = 0, oldestPrDays = 0, ciFailures = 0;
      for (const p of linkedRepos.slice(0, 6)) {
        const conn = connByProvider.get(p.repo_provider!)!;
        const [pulls, runs] = await Promise.all([
          fetchOpenPulls(p.repo_provider!, conn.access_token!, p.repo_full_name!, conn.config),
          fetchRecentRuns(p.repo_provider!, conn.access_token!, p.repo_full_name!, conn.config),
        ]);
        prCount += pulls.length;
        for (const pr of pulls) {
          const days = Math.floor((Date.now() - new Date(pr.createdAt).getTime()) / 86_400_000);
          if (days > oldestPrDays) oldestPrDays = days;
        }
        const dayAgo = Date.now() - 86_400_000;
        ciFailures += runs.filter((r) => new Date(r.createdAt).getTime() >= dayAgo && /fail|error/i.test(r.conclusion || "")).length;
      }

      let sentryCount: number | null = null;
      const sentryConn = connByProvider.get("sentry");
      if (sentryConn) {
        const orgSlug = String(sentryConn.config?.org_slug || "");
        if (orgSlug) sentryCount = await fetchSentryUnresolvedCount(sentryConn.access_token!, orgSlug);
      }

      const zoho = await fetchZohoSummary(userId);

      if (tasksDue.length === 0 && prCount === 0 && ciFailures === 0 && !sentryCount && (!zoho || (zoho.dueSoon.length === 0 && zoho.openBugs === 0))) {
        continue; // nothing to brief — skip a hollow notification
      }

      const facts = [
        `Tasks due today/tomorrow: ${tasksDue.length ? tasksDue.map((t) => `${t.title} (${t.priority})`).join("; ") : "none"}`,
        zoho ? `Sprint items due soon: ${zoho.dueSoon.length ? zoho.dueSoon.join("; ") : "none"}` : null,
        zoho ? `Open sprint bugs: ${zoho.openBugs}` : null,
        `Open pull requests: ${prCount}${prCount > 0 ? ` (oldest ${oldestPrDays} day${oldestPrDays === 1 ? "" : "s"})` : ""}`,
        `Failed CI runs in the last 24h: ${ciFailures}`,
        sentryCount !== null ? `Unresolved Sentry issues: ${sentryCount}` : null,
      ].filter(Boolean).join("\n");

      const text = await askClaude(
        intg.anthropic_api_key,
        "You write short, proactive \"here's your day\" briefs for a solo developer, based on raw facts about their tasks, sprint board, pull requests, CI, and error tracker. 3-5 sentences, specific numbers, no greeting or sign-off — just the brief itself. If everything looks calm, say so briefly rather than padding.",
        facts,
      );
      if (!text) continue;

      await dbInsert("notifications", { user_id: userId, kind: "daily_brief", title: "Your day", body: text.slice(0, 2000) });
    } catch (e) {
      console.error(`[daily-brief] failed for user ${intg.user_id}`, e);
    }
  }
  return { statusCode: 200, body: "ok" };
}

export const handler = schedule("0 6 * * 1-5", run);
