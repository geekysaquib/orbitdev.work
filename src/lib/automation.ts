/**
 * Automation — cross-module "when X then Y" rules.
 *
 * Triggers are raised at the point the change actually happens (Tasks.tsx moving
 * a card, timer.ts starting a session) rather than by DB triggers, and actions
 * run through the same RLS-scoped client calls the user would make by hand — so
 * a rule can never do something its owner couldn't do themselves.
 *
 * `fire()` is deliberately non-throwing and non-blocking: automation is a side
 * effect of the user's real action, and a broken rule must never fail the click
 * that triggered it.
 */
import { supabase } from "./supabase";
import { getUser } from "./auth";
import { getOnline } from "./offline";
import { startTimer, isTimerRunning } from "./timer";
import { fetchIntegrations } from "./integrations";
import { createTeamsMeeting } from "./msTeams";
import { gmailSend, runInProject } from "./agent";
import type { TaskStatus, Priority } from "./types";

export type TriggerType = "task_status" | "ticket_status" | "ticket_created" | "timer_started" | "timer_stopped" | "mail_rule_matched";
export type ActionType =
  | "create_task" | "set_task_status" | "set_ticket_status" | "notify" | "start_timer"
  | "send_email" | "create_teams_meeting" | "run_agent_command" | "webhook";

export const TRIGGER_LABEL: Record<TriggerType, string> = {
  task_status: "A task moves to…",
  ticket_status: "A ticket moves to…",
  ticket_created: "A new ticket is synced",
  timer_started: "A timer starts",
  timer_stopped: "A timer stops",
  mail_rule_matched: "A mail rule matches",
};
export const ACTION_LABEL: Record<ActionType, string> = {
  create_task: "Create a task",
  set_task_status: "Set that task's status",
  set_ticket_status: "Set that ticket's status",
  notify: "Send me a notification",
  start_timer: "Start a timer",
  send_email: "Send me an email",
  create_teams_meeting: "Create a Teams meeting",
  run_agent_command: "Run an agent command",
  webhook: "Call a webhook",
};

/** An extra AND'd filter on top of the trigger's own `to`/`projectId` match. */
export interface TriggerCondition { field: "priority" | "title"; op: "eq" | "contains"; value: string }
export interface TriggerConfig { to?: string; projectId?: string; conditions?: TriggerCondition[] }
export interface ActionConfig {
  title?: string; body?: string;
  status?: string; priority?: Priority;
  projectId?: string;
  /** create_task/start_timer/run_agent_command: prefer the project the triggering item belongs to. */
  useEventProject?: boolean;
  to?: string;              // send_email
  durationMinutes?: number; // create_teams_meeting
  command?: string;         // run_agent_command
  url?: string;             // webhook
}

export interface AutomationRule {
  id: string; name: string; enabled: boolean;
  triggerType: TriggerType; triggerConfig: TriggerConfig;
  actionType: ActionType; actionConfig: ActionConfig;
  runCount: number; lastRunAt: string | null; createdAt: string;
}
export interface AutomationRuleInput {
  name: string; enabled?: boolean;
  triggerType: TriggerType; triggerConfig: TriggerConfig;
  actionType: ActionType; actionConfig: ActionConfig;
}

/** What the call sites raise. `projectId`/`taskId` let actions target the thing that fired them. */
export type AutomationEvent =
  | { type: "task_status"; taskId: string; title: string; status: TaskStatus; priority: Priority; projectId: string | null }
  | { type: "ticket_status"; ticketId: string; title: string; status: string; priority: Priority; projectId: string | null }
  | { type: "ticket_created"; ticketId: string; title: string; priority: Priority; projectId: string | null }
  | { type: "timer_started"; projectId: string | null; taskId: string | null }
  | { type: "timer_stopped"; projectId: string | null; taskId: string | null; seconds: number }
  | { type: "mail_rule_matched"; ruleId: string; field: string; value: string; title: string };

interface Row {
  id: string; name: string; enabled: boolean;
  trigger_type: string; trigger_config: Record<string, unknown>;
  action_type: string; action_config: Record<string, unknown>;
  run_count: number; last_run_at: string | null; created_at: string;
}
const rowToRule = (r: Row): AutomationRule => ({
  id: r.id, name: r.name, enabled: r.enabled,
  triggerType: r.trigger_type as TriggerType, triggerConfig: (r.trigger_config || {}) as TriggerConfig,
  actionType: r.action_type as ActionType, actionConfig: (r.action_config || {}) as ActionConfig,
  runCount: r.run_count, lastRunAt: r.last_run_at, createdAt: r.created_at,
});

// ---- CRUD ----

export async function automationRules(): Promise<{ ok: boolean; rules: AutomationRule[]; error?: string }> {
  const { data, error } = await supabase.from("automation_rules").select("*").order("created_at", { ascending: true });
  if (error) return { ok: false, rules: [], error: error.message };
  return { ok: true, rules: ((data ?? []) as Row[]).map(rowToRule) };
}

export async function addAutomationRule(input: AutomationRuleInput): Promise<{ ok: boolean; rule?: AutomationRule; error?: string }> {
  const u = getUser();
  if (!u) return { ok: false, error: "Not signed in" };
  const { data, error } = await supabase.from("automation_rules").insert({
    user_id: u.id, name: input.name, enabled: input.enabled ?? true,
    trigger_type: input.triggerType, trigger_config: input.triggerConfig as Record<string, unknown>,
    action_type: input.actionType, action_config: input.actionConfig as Record<string, unknown>,
  }).select().single();
  if (error || !data) return { ok: false, error: error?.message || "Couldn't save rule" };
  invalidateRuleCache();
  return { ok: true, rule: rowToRule(data as Row) };
}

export async function updateAutomationRule(id: string, input: AutomationRuleInput): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("automation_rules").update({
    name: input.name, enabled: input.enabled ?? true,
    trigger_type: input.triggerType, trigger_config: input.triggerConfig as Record<string, unknown>,
    action_type: input.actionType, action_config: input.actionConfig as Record<string, unknown>,
  }).eq("id", id);
  invalidateRuleCache();
  return { ok: !error, error: error?.message };
}

export async function setAutomationRuleEnabled(id: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("automation_rules").update({ enabled }).eq("id", id);
  invalidateRuleCache();
  return { ok: !error, error: error?.message };
}

export async function deleteAutomationRule(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("automation_rules").delete().eq("id", id);
  invalidateRuleCache();
  return { ok: !error, error: error?.message };
}

// ---- Matching ----

/** Timer events carry neither `title` nor `priority` — the modal never shows condition fields for them, but the matcher stays defensive regardless. */
function matchesCondition(cond: TriggerCondition, event: AutomationEvent): boolean {
  const raw = cond.field === "priority" ? ("priority" in event ? event.priority : "") : ("title" in event ? event.title : "");
  const have = String(raw ?? "").toLowerCase();
  const want = cond.value.toLowerCase();
  return cond.op === "eq" ? have === want : have.includes(want);
}

/** Pure matcher — exported so the rule editor can preview and tests can assert without a DB. */
export function matchesTrigger(rule: AutomationRule, event: AutomationEvent): boolean {
  if (!rule.enabled || rule.triggerType !== event.type) return false;
  const cfg = rule.triggerConfig || {};
  // An unset filter means "any" — a rule with no `to` fires on every status change.
  if (cfg.to && "status" in event && cfg.to !== event.status) return false;
  const eventProjectId = "projectId" in event ? event.projectId : null;
  if (cfg.projectId && cfg.projectId !== eventProjectId) return false;
  if (cfg.conditions?.length && !cfg.conditions.every((c) => matchesCondition(c, event))) return false;
  return true;
}

// ---- Execution ----

// A `set_task_status` action changes a task, which would raise another
// task_status event, which could match the same rule again. Rather than
// tracking rule lineage, automation-initiated work runs with the dispatcher
// closed: any event raised while an action is executing is dropped.
let running = false;

const eventProject = (e: AutomationEvent): string | null => ("projectId" in e ? e.projectId : null);

async function runAction(rule: AutomationRule, event: AutomationEvent): Promise<void> {
  const u = getUser();
  if (!u) return;
  const cfg = rule.actionConfig || {};

  switch (rule.actionType) {
    case "create_task": {
      const projectId = cfg.useEventProject ? eventProject(event) : (cfg.projectId ?? null);
      await supabase.from("tasks").insert({
        user_id: u.id, project_id: projectId,
        title: cfg.title?.trim() || `Follow-up from “${rule.name}”`,
        status: (cfg.status as TaskStatus) || "todo",
        priority: cfg.priority || "med",
      });
      break;
    }
    case "set_task_status": {
      // Only meaningful when a task raised the event.
      if (event.type !== "task_status" || !cfg.status) return;
      await supabase.from("tasks").update({ status: cfg.status as TaskStatus }).eq("id", event.taskId);
      break;
    }
    case "set_ticket_status": {
      // ticket_created also carries a ticketId, so a rule can triage a brand-new ticket straight to a status.
      if ((event.type !== "ticket_status" && event.type !== "ticket_created") || !cfg.status) return;
      await supabase.from("tickets").update({ status: cfg.status }).eq("id", event.ticketId);
      break;
    }
    case "notify": {
      await supabase.from("notifications").insert({
        user_id: u.id, kind: "automation",
        title: cfg.title?.trim() || rule.name,
        body: cfg.body?.trim() || null,
      });
      break;
    }
    case "start_timer": {
      // Never stomp a session already in progress — the user's own timer wins.
      if (isTimerRunning()) return;
      startTimer(cfg.useEventProject ? eventProject(event) : (cfg.projectId ?? null), null);
      break;
    }
    case "send_email": {
      if (!cfg.to?.trim() || !cfg.body?.trim()) return;
      const intg = await fetchIntegrations();
      if (!intg?.gmail_user || !intg?.gmail_app_password) return; // Gmail not connected — skip quietly, same no-throw contract as the rest of fire()
      await gmailSend({ to: cfg.to.trim(), subject: cfg.title?.trim() || rule.name, text: cfg.body.trim() });
      break;
    }
    case "create_teams_meeting": {
      const start = new Date();
      const end = new Date(start.getTime() + (cfg.durationMinutes || 30) * 60_000);
      await createTeamsMeeting(cfg.title?.trim() || rule.name, start.toISOString(), end.toISOString());
      break;
    }
    case "run_agent_command": {
      if (!cfg.command?.trim()) return;
      const projectId = cfg.useEventProject ? eventProject(event) : (cfg.projectId ?? null);
      if (!projectId) return;
      const { data } = await supabase.from("projects").select("fe_path,sln_path").eq("id", projectId).maybeSingle();
      const path = data?.fe_path || data?.sln_path;
      if (!path) return; // no local folder on this project — nothing to run against
      await runInProject(path, cfg.command.trim());
      break;
    }
    case "webhook": {
      if (!cfg.url?.trim()) return;
      // Best-effort — the target is outside our control (must accept a cross-origin POST from the browser).
      await fetch(cfg.url.trim(), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule: rule.name, event }),
      }).catch(() => {});
      break;
    }
  }
}

// Rules change rarely but events can fire in bursts (dragging several cards);
// a short TTL keeps that from becoming a query per card.
const RULES_TTL = 20_000;
let cache: { at: number; rules: AutomationRule[] } | null = null;
export function invalidateRuleCache(): void { cache = null; }

async function enabledRules(): Promise<AutomationRule[]> {
  if (cache && Date.now() - cache.at < RULES_TTL) return cache.rules;
  const { ok, rules } = await automationRules();
  if (!ok) return [];
  const enabled = rules.filter((r) => r.enabled);
  cache = { at: Date.now(), rules: enabled };
  return enabled;
}

/**
 * Raise an event and run whatever matches. Never throws and never blocks the
 * caller's own work — await it only if you need the count (the rules page does,
 * for its "test rule" button; the call sites don't).
 */
export async function fire(event: AutomationEvent): Promise<number> {
  if (running || !getOnline()) return 0;
  const u = getUser();
  if (!u) return 0;
  try {
    const matched = (await enabledRules()).filter((r) => matchesTrigger(r, event));
    if (!matched.length) return 0;
    running = true;
    for (const rule of matched) {
      try {
        await runAction(rule, event);
        await supabase.from("automation_rules")
          .update({ run_count: rule.runCount + 1, last_run_at: new Date().toISOString() })
          .eq("id", rule.id);
        rule.runCount += 1; // keep the cached copy honest for a burst of events
      } catch { /* one bad rule shouldn't stop the rest */ }
    }
    return matched.length;
  } catch {
    return 0;
  } finally {
    running = false;
  }
}

/** Fire-and-forget wrapper for call sites that must not await automation. */
export function fireAsync(event: AutomationEvent): void {
  void fire(event).catch(() => { /* automation is best-effort */ });
}
