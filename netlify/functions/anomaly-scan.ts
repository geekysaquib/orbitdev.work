import { schedule } from "@netlify/functions";
import { dbSelect, dbInsert, dbUpsert } from "./_lib/db";
import { fetchOpenPulls, fetchRecentRuns, fetchCommitCountSince, fetchSentryUnresolvedCount, type RepoProvider } from "./_lib/providerFetch";
import { buildCfg, accessToken, resolveTeam, listSprints, sprintItems, loadMaps, mapItem, loadCredsServiceRole, isOpenItemStatus, isBugType } from "./_lib/zohoAuth";

/**
 * Hourly threshold checks — deterministic, no AI call (cheaper, and avoids the
 * model misjudging a numeric comparison). Runs more often than daily-brief.ts
 * so a stale PR or a bug-count spike surfaces same-day instead of waiting for
 * tomorrow morning's brief. Because this runs hourly, every notification goes
 * through a de-dupe check first so a still-stale condition doesn't re-alert
 * every run.
 */

const STALE_PR_DAYS = 3;
const METRIC_JUMP_PCT = 0.3;
const METRIC_MIN_FLOOR = 3; // skip "jumped 100%" noise from tiny counts (1 -> 2)
const NO_COMMIT_HOURS_FLOOR = 1;
const DEDUPE_WINDOW_MS = 20 * 3600_000; // < 24h so an hourly run never misses a day, but never fires twice inside one day

interface UserRow { id: string; }
interface ProjectRow {
  id: string; name: string; repo_provider: RepoProvider | null; repo_full_name: string | null; sprint_project_id: string | null;
}
interface ProviderConnRow { provider: string; access_token: string | null; config: Record<string, unknown>; }
interface TimeEntryRow { project_id: string | null; seconds: number; }
interface NotifRow { id: string; }

function yesterdayDateStr(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

async function alreadyNotified(userId: string, title: string): Promise<boolean> {
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
  const rows = await dbSelect<NotifRow>(
    "notifications",
    `user_id=eq.${userId}&kind=eq.anomaly&title=eq.${encodeURIComponent(title)}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`,
  );
  return rows.length > 0;
}

async function notifyAnomaly(userId: string, title: string, body: string) {
  if (await alreadyNotified(userId, title)) return;
  await dbInsert("notifications", { user_id: userId, kind: "anomaly", title, body });
}

/** Upserts today's value for `metric` and returns { current, jumpPct } vs. yesterday's snapshot (null if no prior day to compare). */
async function snapshotAndCompare(userId: string, metric: string, value: number): Promise<{ jumpPct: number | null; prev: number | null }> {
  await dbUpsert("metric_snapshots", { user_id: userId, metric, value }, "user_id,metric,snapshot_date");
  const prevRows = await dbSelect<{ value: number }>(
    "metric_snapshots", `user_id=eq.${userId}&metric=eq.${metric}&snapshot_date=eq.${yesterdayDateStr()}&select=value`,
  );
  const prev = prevRows[0]?.value ?? null;
  if (prev === null || prev < METRIC_MIN_FLOOR) return { jumpPct: null, prev };
  return { jumpPct: (value - prev) / prev, prev };
}

async function fetchZohoOpenBugCount(userId: string): Promise<number | null> {
  const creds = await loadCredsServiceRole(userId);
  if (!creds.refreshToken) return null;
  const c = buildCfg(creds);
  try {
    const token = await accessToken(c);
    const teamId = await resolveTeam(c, token);
    const projects = await dbSelect<{ sprint_project_id: string }>(
      "projects", `user_id=eq.${userId}&status=eq.active&sprint_project_id=not.is.null&select=sprint_project_id`,
    );
    let openBugs = 0;
    for (const p of projects.slice(0, 4)) {
      const projectId = p.sprint_project_id;
      const maps = await loadMaps(c, teamId, projectId, token);
      const sprints = await listSprints(c, teamId, projectId, token);
      for (const s of sprints.slice(0, 3)) {
        const { items, users } = await sprintItems(c, teamId, projectId, s.sprintId, token);
        for (const raw of items) {
          const it = mapItem(raw, { ...maps, users });
          if (isOpenItemStatus(it.status) && isBugType(it.type, it.status)) openBugs++;
        }
      }
    }
    return openBugs;
  } catch (e) {
    console.error(`[anomaly-scan] zoho bug count failed for ${userId}`, e);
    return null;
  }
}

async function run() {
  let users: UserRow[];
  try {
    users = await dbSelect<UserRow>("users", "select=id");
  } catch (e) {
    console.error("[anomaly-scan] couldn't load users", e);
    return { statusCode: 200, body: "ok" };
  }

  for (const u of users) {
    try {
      const userId = u.id;
      const [projects, connections, timeEntries] = await Promise.all([
        dbSelect<ProjectRow>("projects", `user_id=eq.${userId}&status=eq.active&select=id,name,repo_provider,repo_full_name,sprint_project_id`),
        dbSelect<ProviderConnRow>("provider_connections", `user_id=eq.${userId}&provider=in.(github,gitlab,azuredevops,sentry)&select=provider,access_token,config`),
        dbSelect<TimeEntryRow>("time_entries", `user_id=eq.${userId}&started_at=gte.${encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())}&select=project_id,seconds`),
      ]);
      const connByProvider = new Map(connections.filter((c) => c.access_token).map((c) => [c.provider, c]));
      const linkedRepos = projects.filter((p) => p.repo_provider && p.repo_full_name && connByProvider.has(p.repo_provider));
      const sinceIso = new Date(Date.now() - 86_400_000).toISOString();

      // --- Stale PRs ---
      const stale: { title: string; days: number }[] = [];
      let failedRuns = 0;
      for (const p of linkedRepos.slice(0, 6)) {
        const conn = connByProvider.get(p.repo_provider!)!;
        const [pulls, runs] = await Promise.all([
          fetchOpenPulls(p.repo_provider!, conn.access_token!, p.repo_full_name!, conn.config),
          fetchRecentRuns(p.repo_provider!, conn.access_token!, p.repo_full_name!, conn.config),
        ]);
        for (const pr of pulls) {
          const days = Math.floor((Date.now() - new Date(pr.createdAt).getTime()) / 86_400_000);
          if (days >= STALE_PR_DAYS) stale.push({ title: pr.title, days });
        }
        failedRuns += runs.filter((r) => new Date(r.createdAt).getTime() >= Date.now() - 86_400_000 && /fail|error/i.test(r.conclusion || "")).length;

        // --- Hours logged, no commits (per project) ---
        const seconds = timeEntries.filter((t) => t.project_id === p.id).reduce((s, t) => s + (t.seconds || 0), 0);
        if (seconds >= NO_COMMIT_HOURS_FLOOR * 3600) {
          const commits = await fetchCommitCountSince(p.repo_provider!, conn.access_token!, p.repo_full_name!, sinceIso, conn.config);
          if (commits === 0) {
            const hours = (seconds / 3600).toFixed(1);
            await notifyAnomaly(userId, `${hours}h logged on ${p.name} with no commits`, `You logged ${hours}h on "${p.name}" in the last 24h, but its linked repo has no new commits in that window.`);
          }
        }
      }
      if (stale.length > 0) {
        const title = `${stale.length} pull request${stale.length === 1 ? "" : "s"} open ${STALE_PR_DAYS}+ days`;
        const body = stale.map((s) => `${s.title} — ${s.days}d`).join("\n");
        await notifyAnomaly(userId, title, body);
      }

      // --- CI failure spike ---
      if (linkedRepos.length > 0) {
        const { jumpPct } = await snapshotAndCompare(userId, "ci_failed_runs", failedRuns);
        if (failedRuns > 0 && jumpPct !== null && jumpPct >= METRIC_JUMP_PCT) {
          await notifyAnomaly(userId, "CI failures are up", `${failedRuns} failed CI run${failedRuns === 1 ? "" : "s"} in the last 24h, up ${Math.round(jumpPct * 100)}% from yesterday.`);
        }
      }

      // --- Bug-count spikes ---
      const sentryConn = connByProvider.get("sentry");
      if (sentryConn) {
        const orgSlug = String(sentryConn.config?.org_slug || "");
        if (orgSlug) {
          const count = await fetchSentryUnresolvedCount(sentryConn.access_token!, orgSlug);
          if (count !== null) {
            const { jumpPct } = await snapshotAndCompare(userId, "sentry_open_issues", count);
            if (jumpPct !== null && jumpPct >= METRIC_JUMP_PCT) {
              await notifyAnomaly(userId, "Unresolved Sentry issues jumped", `${count} unresolved issues, up ${Math.round(jumpPct * 100)}% since yesterday.`);
            }
          }
        }
      }
      const zohoBugs = await fetchZohoOpenBugCount(userId);
      if (zohoBugs !== null) {
        const { jumpPct } = await snapshotAndCompare(userId, "zoho_open_bugs", zohoBugs);
        if (jumpPct !== null && jumpPct >= METRIC_JUMP_PCT) {
          await notifyAnomaly(userId, "Open bug count jumped", `${zohoBugs} open bugs across your sprint boards, up ${Math.round(jumpPct * 100)}% since yesterday.`);
        }
      }
    } catch (e) {
      console.error(`[anomaly-scan] failed for user ${u.id}`, e);
    }
  }
  return { statusCode: 200, body: "ok" };
}

export const handler = schedule("0 * * * *", run);
