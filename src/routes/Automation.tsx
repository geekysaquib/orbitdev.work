/**
 * Automation — the when-X-then-Y rule list.
 *
 * Rules run client-side at the moment the triggering change happens (see
 * src/lib/automation.ts), so this page is pure CRUD plus the run counters that
 * tell you a rule is actually firing.
 */
import { useEffect, useState } from "react";
import { Icon } from "../lib/icons";
import { ACCENT, Empty, OrbitLoader } from "../components/ui";
import { AutomationRuleModal } from "../components/AutomationRuleModal";
import { useToast } from "../context/Toast";
import { useTable } from "../hooks/useTable";
import {
  automationRules, setAutomationRuleEnabled, deleteAutomationRule,
  TRIGGER_LABEL, ACTION_LABEL, type AutomationRule,
} from "../lib/automation";
import type { Project } from "../lib/types";

const fmtWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never");

/** Human sentence for a rule, so the list reads without opening each one. */
function describe(r: AutomationRule, projectName: (id?: string) => string): string {
  const t = r.triggerConfig || {}, a = r.actionConfig || {};
  let when = TRIGGER_LABEL[r.triggerType].replace("…", t.to ? `“${t.to}”` : "any status");
  if (t.projectId) when += ` in ${projectName(t.projectId)}`;
  if (t.conditions?.length) {
    when += " where " + t.conditions.map((c) => c.field === "priority" ? `priority is ${c.value}` : `title contains “${c.value}”`).join(" and ");
  }
  let then = ACTION_LABEL[r.actionType];
  if (r.actionType === "create_task" && a.title) then = `Create task “${a.title}”`;
  if (r.actionType === "notify" && a.title) then = `Notify “${a.title}”`;
  if (r.actionType === "send_email") then = a.to ? `Email ${a.to}` : "Send an email";
  if (r.actionType === "create_teams_meeting") then = a.title ? `Create Teams meeting “${a.title}”` : "Create a Teams meeting";
  if (r.actionType === "run_agent_command" && a.command) then = `Run “${a.command}”`;
  if (r.actionType === "webhook" && a.url) then = `Call ${a.url}`;
  if ((r.actionType === "set_task_status" || r.actionType === "set_ticket_status") && a.status) then += ` → ${a.status}`;
  if (r.actionType === "start_timer" || r.actionType === "run_agent_command") then += a.useEventProject ? " on that item's project" : a.projectId ? ` on ${projectName(a.projectId)}` : "";
  return `${when} → ${then}`;
}

export default function Automation() {
  const toast = useToast();
  const { rows: projects } = useTable<Project>("projects");
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [creating, setCreating] = useState(false);

  const projectName = (id?: string) => projects.find((p) => p.id === id)?.name || "a project";

  async function refresh() {
    setLoading(true);
    const r = await automationRules();
    setLoading(false);
    if (!r.ok) { setError(r.error || "Couldn't load rules"); return; }
    setError(null);
    setRules(r.rules);
  }
  useEffect(() => { refresh(); }, []);

  async function toggle(r: AutomationRule) {
    const res = await setAutomationRuleEnabled(r.id, !r.enabled);
    if (!res.ok) { toast(`Couldn't update rule: ${res.error}`); return; }
    setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)));
  }

  async function remove(r: AutomationRule) {
    const res = await deleteAutomationRule(r.id);
    if (!res.ok) { toast(`Couldn't delete rule: ${res.error}`); return; }
    setRules((prev) => prev.filter((x) => x.id !== r.id));
    toast(`Deleted · ${r.name}`);
  }

  return (
    <main className="page">
      <div className="rowhead">
        <div>
          <div className="h1">Automation</div>
          <div className="sub">Rules that run the busywork — when something changes, ORBIT does the follow-up for you.</div>
        </div>
        <button className="btn accent" onClick={() => setCreating(true)}><Icon name="plus" size={14} />New rule</button>
      </div>

      {loading ? <OrbitLoader /> : error ? (
        <div className="pg-error" style={{ marginTop: 16 }}><Icon name="plug" size={16} /><div>{error}</div></div>
      ) : rules.length === 0 ? (
        <Empty icon="zap" title="No rules yet"
          sub="Create one to chain your work together — move a task to done and have ORBIT close the ticket, or start a timer when a task goes in progress." />
      ) : (
        <div className="auto-list">
          {rules.map((r) => (
            <div key={r.id} className={"card auto-rule" + (r.enabled ? "" : " off")}>
              <div className="auto-rule-main">
                <div className="auto-rule-head">
                  <span className="auto-rule-ic" style={{ color: r.enabled ? ACCENT.mint : ACCENT.muted }}><Icon name="zap" size={15} /></span>
                  <span className="auto-rule-name">{r.name}</span>
                  {!r.enabled && <span className="badge">paused</span>}
                </div>
                <div className="auto-rule-desc">{describe(r, projectName)}</div>
                <div className="auto-rule-meta">
                  Ran {r.runCount} time{r.runCount === 1 ? "" : "s"} · last {fmtWhen(r.lastRunAt)}
                </div>
              </div>
              <div className="auto-rule-actions">
                <button className="btn ghost sm" onClick={() => toggle(r)}>
                  <Icon name={r.enabled ? "pause" : "play"} size={12} fill={!r.enabled} />{r.enabled ? "Pause" : "Enable"}
                </button>
                <button className="btn ghost sm" onClick={() => setEditing(r)}><Icon name="edit" size={12} />Edit</button>
                <button className="btn ghost sm danger" onClick={() => remove(r)}><Icon name="x" size={12} />Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <AutomationRuleModal
          rule={editing}
          projects={projects}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); refresh(); }}
        />
      )}
    </main>
  );
}
