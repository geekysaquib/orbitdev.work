import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { Icon } from "../lib/icons";
import { OrbitLoader } from "./ui";
import { Select } from "./Select";
import { useToast } from "../context/Toast";
import { mailRules, mailAddRule, mailSetRuleEnabled, mailDeleteRule, type MailRule, type MailRuleField } from "../lib/mailRules";

/** Simple "from/subject contains X" rule CRUD — matched by Layout.tsx's poller, which fires a notification on a hit. */
export function MailRulesModal({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const toast = useToast();
  const [rules, setRules] = useState<MailRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [field, setField] = useState<MailRuleField>("from");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    const r = await mailRules();
    if (r.ok) setRules(r.rules);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  async function add() {
    if (!value.trim()) return;
    setSaving(true);
    const r = await mailAddRule({ field, value: value.trim() });
    setSaving(false);
    if (!r.ok) { toast(`Couldn't save rule: ${r.error}`); return; }
    setValue("");
    refresh();
    onChanged?.();
  }

  async function toggle(r: MailRule) {
    const res = await mailSetRuleEnabled(r.id, !r.enabled);
    if (!res.ok) { toast(`Couldn't update rule: ${res.error}`); return; }
    refresh();
    onChanged?.();
  }

  async function remove(id: string) {
    const r = await mailDeleteRule(id);
    if (!r.ok) { toast(`Couldn't delete: ${r.error}`); return; }
    refresh();
    onChanged?.();
  }

  return (
    <Modal onClose={onClose} style={{ width: 520, maxWidth: "94vw" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ display: "flex", alignItems: "center", gap: 9 }}><Icon name="bell" size={17} />Mail rules</h3>
        <button className="iconbtn" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>
      <div className="ds" style={{ marginTop: 8 }}>Get an ORBIT notification when a new message matches — checked while ORBIT and the local agent are running.</div>

      <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "flex-end" }}>
        <div className="fld" style={{ marginBottom: 0, width: 130 }}>
          <label>When</label>
          <Select full value={field} onChange={(e) => setField(e.target.value as MailRuleField)}>
            <option value="from">Sender contains</option>
            <option value="subject">Subject contains</option>
          </Select>
        </div>
        <div className="fld" style={{ marginBottom: 0, flex: 1 }}>
          <label>Value</label>
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={field === "from" ? "client@example.com" : "invoice"} onKeyDown={(e) => e.key === "Enter" && add()} />
        </div>
        <button className="btn" disabled={saving || !value.trim()} onClick={add}><Icon name="plus" size={14} />Add</button>
      </div>

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 6 }}>
        {loading ? (
          <OrbitLoader label="Loading…" size={22} />
        ) : rules.length === 0 ? (
          <div style={{ color: "var(--dim)", fontSize: 13 }}>No rules yet.</div>
        ) : rules.map((r) => (
          <div key={r.id} className="setrow">
            <div className="l"><div className="nm">{r.field === "from" ? "Sender" : "Subject"} contains "{r.value}"</div></div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button className="btn ghost" style={r.enabled ? undefined : { opacity: 0.5 }} onClick={() => toggle(r)}>{r.enabled ? "On" : "Off"}</button>
              <button className="btn ghost" onClick={() => remove(r.id)}><Icon name="x" size={14} /></button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
