/**
 * Create/edit one automation rule. The trigger and action halves each reveal
 * only the fields their selected type actually uses, so the form never asks for
 * a status on a timer trigger or a project on a "notify" action.
 */
import { useState } from "react";
import { Modal } from "./Modal";
import { Icon } from "../lib/icons";
import { Select } from "./Select";
import { useToast } from "../context/Toast";
import {
  addAutomationRule, updateAutomationRule,
  TRIGGER_LABEL, ACTION_LABEL,
  type AutomationRule, type TriggerType, type ActionType, type TriggerConfig, type ActionConfig, type TriggerCondition,
} from "../lib/automation";
import type { Project, Priority } from "../lib/types";

const TASK_STATUSES = ["todo", "doing", "review", "done"];
const TICKET_STATUSES = ["Open", "In Progress", "Resolved", "Closed"];
const PRIORITIES: Priority[] = ["low", "med", "high"];

/** Which statuses a trigger/action refers to depends on whether it's task- or ticket-shaped. */
const statusesFor = (t: TriggerType) => (t === "ticket_status" ? TICKET_STATUSES : TASK_STATUSES);
/** Triggers whose event carries a project id — only these make "Any project" a meaningful filter. */
const hasProjectFilter = (t: TriggerType) => t !== "mail_rule_matched";
/** Extra AND'd condition fields, scoped to what the trigger's event actually carries. */
const conditionFieldsFor = (t: TriggerType): { value: TriggerCondition["field"]; label: string }[] =>
  t === "mail_rule_matched" ? [{ value: "title", label: "Subject contains" }]
  : t === "timer_started" || t === "timer_stopped" ? []
  : [{ value: "priority", label: "Priority is" }, { value: "title", label: "Title contains" }];

export function AutomationRuleModal({
  rule, projects, onClose, onSaved,
}: { rule: AutomationRule | null; projects: Project[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(rule?.name ?? "");
  const [triggerType, setTriggerType] = useState<TriggerType>(rule?.triggerType ?? "task_status");
  const [trigger, setTrigger] = useState<TriggerConfig>(rule?.triggerConfig ?? {});
  const [actionType, setActionType] = useState<ActionType>(rule?.actionType ?? "notify");
  const [action, setAction] = useState<ActionConfig>(rule?.actionConfig ?? {});
  const [saving, setSaving] = useState(false);

  const isStatusTrigger = triggerType === "task_status" || triggerType === "ticket_status";
  const conditionFields = conditionFieldsFor(triggerType);
  // These actions operate on the item that fired the rule, so they only make
  // sense when that item is the matching kind. ticket_created also carries a
  // ticketId, so it can drive set_ticket_status too (e.g. auto-file a new ticket).
  const actionValid =
    (actionType !== "set_task_status" || triggerType === "task_status") &&
    (actionType !== "set_ticket_status" || triggerType === "ticket_status" || triggerType === "ticket_created");

  function addCondition() {
    const field = conditionFields[0]?.value;
    if (!field) return;
    const next: TriggerCondition = { field, op: field === "priority" ? "eq" : "contains", value: "" };
    setTrigger({ ...trigger, conditions: [...(trigger.conditions ?? []), next] });
  }
  function updateCondition(i: number, patch: Partial<TriggerCondition>) {
    const list = [...(trigger.conditions ?? [])];
    const merged = { ...list[i], ...patch };
    if (patch.field) merged.op = patch.field === "priority" ? "eq" : "contains";
    list[i] = merged;
    setTrigger({ ...trigger, conditions: list });
  }
  function removeCondition(i: number) {
    setTrigger({ ...trigger, conditions: (trigger.conditions ?? []).filter((_, idx) => idx !== i) });
  }

  async function save() {
    if (!name.trim()) { toast("Give the rule a name"); return; }
    if (!actionValid) { toast("That action doesn't match the trigger — pick another"); return; }
    setSaving(true);
    const input = { name: name.trim(), triggerType, triggerConfig: trigger, actionType, actionConfig: action };
    const r = rule ? await updateAutomationRule(rule.id, input) : await addAutomationRule(input);
    setSaving(false);
    if (!r.ok) { toast(`Couldn't save rule: ${r.error}`); return; }
    toast(rule ? `Updated · ${input.name}` : `Rule created · ${input.name}`);
    onSaved();
  }

  return (
    <Modal onClose={onClose} style={{ width: 540, maxWidth: "92vw" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ color: "var(--mint)" }}><Icon name="zap" size={18} /></span>{rule ? "Edit rule" : "New rule"}
        </h3>
        <button className="iconbtn" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>

      <div className="dk-field" style={{ marginTop: 14 }}>
        <label>Name</label>
        <input className="dk-in" value={name} autoFocus placeholder="e.g. Close ticket when task is done"
          onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="auto-form-sec">
        <div className="auto-form-lab"><Icon name="bolt" size={13} />When</div>
        <Select value={triggerType} onChange={(e) => { setTriggerType(e.target.value as TriggerType); setTrigger({}); }}>
          {(Object.keys(TRIGGER_LABEL) as TriggerType[]).map((t) => <option key={t} value={t}>{TRIGGER_LABEL[t]}</option>)}
        </Select>
        {isStatusTrigger && (
          <Select value={trigger.to ?? ""} onChange={(e) => setTrigger({ ...trigger, to: e.target.value || undefined })}>
            <option value="">Any status</option>
            {statusesFor(triggerType).map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        )}
        {hasProjectFilter(triggerType) && (
          <Select value={trigger.projectId ?? ""} onChange={(e) => setTrigger({ ...trigger, projectId: e.target.value || undefined })}>
            <option value="">Any project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        )}
        {conditionFields.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {(trigger.conditions ?? []).map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <Select value={c.field} onChange={(e) => updateCondition(i, { field: e.target.value as TriggerCondition["field"] })}>
                  {conditionFields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </Select>
                {c.field === "priority" ? (
                  <Select value={c.value} onChange={(e) => updateCondition(i, { value: e.target.value })}>
                    <option value="">Pick a priority…</option>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </Select>
                ) : (
                  <input className="dk-in" style={{ flex: 1 }} value={c.value} placeholder="text to match"
                    onChange={(e) => updateCondition(i, { value: e.target.value })} />
                )}
                <button className="iconbtn" onClick={() => removeCondition(i)}><Icon name="x" size={14} /></button>
              </div>
            ))}
            <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={addCondition}>
              <Icon name="plus" size={12} />Add condition
            </button>
          </div>
        )}
      </div>

      <div className="auto-form-sec">
        <div className="auto-form-lab"><Icon name="chevR" size={13} />Then</div>
        <Select value={actionType} onChange={(e) => { setActionType(e.target.value as ActionType); setAction({}); }}>
          {(Object.keys(ACTION_LABEL) as ActionType[]).map((a) => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
        </Select>

        {actionType === "send_email" && (
          <input className="dk-in" type="email" value={action.to ?? ""} placeholder="Send to (email address)"
            onChange={(e) => setAction({ ...action, to: e.target.value })} />
        )}
        {(actionType === "create_task" || actionType === "notify" || actionType === "send_email" || actionType === "create_teams_meeting") && (
          <input className="dk-in" value={action.title ?? ""}
            placeholder={actionType === "notify" ? "Notification title" : actionType === "send_email" ? "Email subject" : actionType === "create_teams_meeting" ? "Meeting title" : "Task title"}
            onChange={(e) => setAction({ ...action, title: e.target.value })} />
        )}
        {(actionType === "notify" || actionType === "send_email") && (
          <input className="dk-in" value={action.body ?? ""} placeholder={actionType === "send_email" ? "Email body" : "Notification body (optional)"}
            onChange={(e) => setAction({ ...action, body: e.target.value })} />
        )}
        {actionType === "create_teams_meeting" && (
          <input className="dk-in" type="number" min={5} value={action.durationMinutes ?? 30} placeholder="Duration (minutes)"
            onChange={(e) => setAction({ ...action, durationMinutes: Number(e.target.value) || 30 })} />
        )}
        {actionType === "run_agent_command" && (
          <input className="dk-in mono" value={action.command ?? ""} placeholder="e.g. npm test"
            onChange={(e) => setAction({ ...action, command: e.target.value })} />
        )}
        {actionType === "webhook" && (
          <input className="dk-in" value={action.url ?? ""} placeholder="https://…"
            onChange={(e) => setAction({ ...action, url: e.target.value })} />
        )}
        {actionType === "create_task" && (
          <Select value={action.priority ?? "med"} onChange={(e) => setAction({ ...action, priority: e.target.value as Priority })}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p} priority</option>)}
          </Select>
        )}
        {(actionType === "set_task_status" || actionType === "set_ticket_status") && (
          <Select value={action.status ?? ""} onChange={(e) => setAction({ ...action, status: e.target.value })}>
            <option value="">Pick a status…</option>
            {(actionType === "set_ticket_status" ? TICKET_STATUSES : TASK_STATUSES).map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        )}
        {(actionType === "create_task" || actionType === "start_timer" || actionType === "run_agent_command") && (
          <>
            <label className="auto-check">
              <input type="checkbox" checked={!!action.useEventProject}
                onChange={(e) => setAction({ ...action, useEventProject: e.target.checked, projectId: undefined })} />
              Use the project of whatever triggered it
            </label>
            {!action.useEventProject && (
              <Select value={action.projectId ?? ""} onChange={(e) => setAction({ ...action, projectId: e.target.value || undefined })}>
                <option value="">No project</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            )}
          </>
        )}
        {actionType === "webhook" && (
          <div style={{ fontSize: 11.5, color: "var(--dim)", marginTop: 4 }}>
            Posts JSON straight from your browser — the target must accept a cross-origin request (Slack/Discord-style incoming webhooks do).
          </div>
        )}
        {!actionValid && (
          <div style={{ fontSize: 12, color: "var(--red)", marginTop: 4 }}>
            “{ACTION_LABEL[actionType]}” needs a {actionType === "set_task_status" ? "task" : "ticket"} trigger.
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn accent" disabled={saving || !name.trim() || !actionValid} onClick={save}>
          {saving ? <><Icon name="loader" size={14} className="spin" />Saving…</> : <>{rule ? "Save changes" : "Create rule"}</>}
        </button>
      </div>
    </Modal>
  );
}
