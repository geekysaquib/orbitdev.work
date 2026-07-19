import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { Icon } from "../lib/icons";
import { OrbitLoader } from "./ui";
import { useToast } from "../context/Toast";
import { mailTemplates, mailAddTemplate, mailUpdateTemplate, mailDeleteTemplate, type MailTemplate } from "../lib/mailTemplates";
import { fetchSettings, saveSettings } from "../lib/settings";

const BLANK = { name: "", subject: "", body: "" };

/** Template CRUD + signature editor, opened from Mail's toolbar. */
export function MailTemplatesModal({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const toast = useToast();
  const [templates, setTemplates] = useState<MailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [signature, setSignature] = useState("");
  const [savingSig, setSavingSig] = useState(false);

  async function refresh() {
    setLoading(true);
    const [t, s] = await Promise.all([mailTemplates(), fetchSettings()]);
    if (t.ok) setTemplates(t.templates);
    setSignature(s.mail_signature || "");
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  function startNew() { setDraft(BLANK); setEditingId("new"); }
  function startEdit(t: MailTemplate) { setDraft({ name: t.name, subject: t.subject || "", body: t.body }); setEditingId(t.id); }

  async function save() {
    if (!draft.name.trim() || !draft.body.trim()) return;
    setSaving(true);
    const r = editingId === "new"
      ? await mailAddTemplate(draft)
      : await mailUpdateTemplate(editingId!, draft);
    setSaving(false);
    if (!r.ok) { toast(`Couldn't save template: ${r.error}`); return; }
    setEditingId(null);
    refresh();
    onChanged?.();
  }

  async function remove(id: string) {
    const r = await mailDeleteTemplate(id);
    if (!r.ok) { toast(`Couldn't delete: ${r.error}`); return; }
    refresh();
    onChanged?.();
  }

  async function saveSignature() {
    setSavingSig(true);
    await saveSettings({ mail_signature: signature });
    setSavingSig(false);
    toast("Signature saved");
    onChanged?.();
  }

  return (
    <Modal onClose={onClose} style={{ width: 560, maxWidth: "94vw" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ display: "flex", alignItems: "center", gap: 9 }}><Icon name="edit" size={17} />Templates &amp; signature</h3>
        <button className="iconbtn" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>

      <div className="eyebrow" style={{ marginTop: 16 }}>Signature</div>
      <div className="fld" style={{ marginTop: 8 }}>
        <textarea value={signature} onChange={(e) => setSignature(e.target.value)} rows={3}
          placeholder="Appended to new drafts automatically — edit or remove per-message any time."
          style={{ width: "100%", resize: "vertical", fontFamily: "inherit", lineHeight: 1.5, padding: "8px 11px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <button className="btn" disabled={savingSig} onClick={saveSignature}>{savingSig ? "Saving…" : "Save signature"}</button>
      </div>

      <div className="eyebrow" style={{ marginTop: 22 }}>Templates</div>
      {loading ? (
        <div style={{ marginTop: 10 }}><OrbitLoader label="Loading…" size={22} /></div>
      ) : editingId ? (
        <div style={{ marginTop: 10 }}>
          <div className="fld"><label>Name</label><input value={draft.name} autoFocus onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Follow-up" /></div>
          <div className="fld"><label>Subject (optional)</label><input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} placeholder="Leave blank to keep whatever's already in Compose" /></div>
          <div className="fld">
            <label>Body</label>
            <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={6}
              style={{ width: "100%", resize: "vertical", fontFamily: "inherit", lineHeight: 1.5, padding: "8px 11px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text)" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
            <button className="btn ghost" onClick={() => setEditingId(null)}>Cancel</button>
            <button className="btn-primary" disabled={saving || !draft.name.trim() || !draft.body.trim()} onClick={save}>{saving ? "Saving…" : "Save template"}</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {templates.length === 0 && <div style={{ color: "var(--dim)", fontSize: 13 }}>No templates yet.</div>}
            {templates.map((t) => (
              <div key={t.id} className="setrow">
                <div className="l"><div className="nm">{t.name}</div>{t.subject && <div className="ds">{t.subject}</div>}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn ghost" onClick={() => startEdit(t)}><Icon name="edit" size={14} />Edit</button>
                  <button className="btn ghost" onClick={() => remove(t.id)}><Icon name="x" size={14} />Delete</button>
                </div>
              </div>
            ))}
          </div>
          <button className="btn" style={{ marginTop: 12 }} onClick={startNew}><Icon name="plus" size={14} />New template</button>
        </>
      )}
    </Modal>
  );
}
