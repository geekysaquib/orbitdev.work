import { schedule } from "@netlify/functions";
import { dbSelect, dbInsert } from "./_lib/db";
import { askAI, type CloudProvider } from "./_lib/aiProviders";

/**
 * Monday-morning "how was your week" digest — mirrors mail-scheduled-send.ts's
 * shape (schedule() export, service-role reads via _lib/db.ts since a cron
 * invocation has no caller JWT to scope RLS with). Summarizes each user's last
 * 7 days from `audit_log` (task/project activity, team actions) and
 * `time_entries` (hours tracked), via _lib/aiProviders.ts's askAI() — tries
 * every cloud provider the user has configured, in their preferred order,
 * before giving up — NOT the agent's /ai/ask (that only exists on the user's
 * own machine, unreachable from a Netlify cron job). Users with no provider
 * key at all are skipped; there's no local-model fallback here since there's
 * no running agent for a cron job to call.
 */

interface IntegrationRow {
  user_id: string;
  anthropic_api_key: string | null; gemini_api_key: string | null; openai_api_key: string | null; grok_api_key: string | null;
  ai_provider: CloudProvider | null;
}
interface AuditRow { action: string; created_at: string; }
interface TimeEntryRow { seconds: number; }

async function run() {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();

  let integrations: IntegrationRow[];
  try {
    integrations = await dbSelect<IntegrationRow>(
      "integrations",
      "or=(anthropic_api_key.not.is.null,gemini_api_key.not.is.null,openai_api_key.not.is.null,grok_api_key.not.is.null)&select=user_id,anthropic_api_key,gemini_api_key,openai_api_key,grok_api_key,ai_provider",
    );
  } catch (e) {
    console.error("[weekly-digest] couldn't load integrations", e);
    return { statusCode: 200, body: "ok" };
  }

  for (const intg of integrations) {
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

      const { text, error } = await askAI(
        { anthropic: intg.anthropic_api_key, gemini: intg.gemini_api_key, openai: intg.openai_api_key, grok: intg.grok_api_key },
        intg.ai_provider,
        "You write brief, encouraging weekly work-review summaries for a developer productivity app. Be specific using the numbers given rather than generic — 3 to 5 sentences, no greeting or sign-off, just the summary itself.",
        `This person's activity over the last 7 days:\n\nTime tracked: ${hours} hours\n\nActions:\n${actionLines}`,
      );
      if (!text) {
        if (error) console.warn(`[weekly-digest] no AI answer for user ${intg.user_id}: ${error}`);
        continue;
      }

      await dbInsert("notifications", { user_id: intg.user_id, kind: "weekly_digest", title: "Your weekly review", body: text.slice(0, 2000) });
    } catch (e) {
      console.error(`[weekly-digest] failed for user ${intg.user_id}`, e);
    }
  }
  return { statusCode: 200, body: "ok" };
}

export const handler = schedule("0 9 * * 1", run);
