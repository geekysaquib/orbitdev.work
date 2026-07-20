import { schedule } from "@netlify/functions";
import { dbSelect, dbInsert } from "./_lib/db";
import { askClaude } from "./_lib/anthropic";

/**
 * Monday-morning "how was your week" digest — mirrors mail-scheduled-send.ts's
 * shape (schedule() export, service-role reads via _lib/db.ts since a cron
 * invocation has no caller JWT to scope RLS with). Summarizes each user's last
 * 7 days from `audit_log` (task/project activity, team actions) and
 * `time_entries` (hours tracked), via a direct Anthropic REST call (see
 * _lib/anthropic.ts) — NOT the agent's /ai/ask (that only exists on the
 * user's own machine, unreachable from a Netlify cron job) — using the same
 * per-user `anthropic_api_key` already stored in `integrations`. Users
 * without a key are skipped rather than falling back to the agent's local
 * model, since there's no running agent for a cron job to call.
 */

interface IntegrationRow { user_id: string; anthropic_api_key: string | null; }
interface AuditRow { action: string; created_at: string; }
interface TimeEntryRow { seconds: number; }

async function run() {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();

  let integrations: IntegrationRow[];
  try {
    integrations = await dbSelect<IntegrationRow>("integrations", "anthropic_api_key=not.is.null&select=user_id,anthropic_api_key");
  } catch (e) {
    console.error("[weekly-digest] couldn't load integrations", e);
    return { statusCode: 200, body: "ok" };
  }

  for (const intg of integrations) {
    if (!intg.anthropic_api_key) continue;
    try {
      const [audit, timeEntries] = await Promise.all([
        dbSelect<AuditRow>("audit_log", `user_id=eq.${intg.user_id}&created_at=gte.${encodeURIComponent(since)}&select=action,created_at&order=created_at.asc&limit=500`),
        dbSelect<TimeEntryRow>("time_entries", `user_id=eq.${intg.user_id}&started_at=gte.${encodeURIComponent(since)}&select=seconds`),
      ]);
      if (audit.length === 0 && timeEntries.length === 0) continue; // nothing happened — skip a hollow digest

      const hours = (timeEntries.reduce((sum, t) => sum + (t.seconds || 0), 0) / 3600).toFixed(1);
      const actionCounts = new Map<string, number>();
      for (const a of audit) actionCounts.set(a.action, (actionCounts.get(a.action) || 0) + 1);
      const actionLines = [...actionCounts.entries()].map(([action, count]) => `${action}: ${count}`).join("\n") || "no tracked actions";

      const text = await askClaude(
        intg.anthropic_api_key,
        "You write brief, encouraging weekly work-review summaries for a developer productivity app. Be specific using the numbers given rather than generic — 3 to 5 sentences, no greeting or sign-off, just the summary itself.",
        `This person's activity over the last 7 days:\n\nTime tracked: ${hours} hours\n\nActions:\n${actionLines}`,
      );
      if (!text) continue;

      await dbInsert("notifications", { user_id: intg.user_id, kind: "weekly_digest", title: "Your weekly review", body: text.slice(0, 2000) });
    } catch (e) {
      console.error(`[weekly-digest] failed for user ${intg.user_id}`, e);
    }
  }
  return { statusCode: 200, body: "ok" };
}

export const handler = schedule("0 9 * * 1", run);
