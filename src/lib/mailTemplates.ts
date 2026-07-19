/** CRUD over `mail_templates` (RLS-scoped) — reusable subject/body snippets for Compose. Mirrors src/lib/pg.ts's CRUD shape. */
import { supabase } from "./supabase";
import { getUser } from "./auth";
import { getOnline, OFFLINE_ERROR } from "./offline";

export interface MailTemplate { id: string; name: string; subject: string | null; body: string; createdAt: string; }
export interface MailTemplateInput { name: string; subject?: string; body: string; }

interface Row { id: string; name: string; subject: string | null; body: string; created_at: string; }
const rowToTemplate = (r: Row): MailTemplate => ({ id: r.id, name: r.name, subject: r.subject, body: r.body, createdAt: r.created_at });

export async function mailTemplates(): Promise<{ ok: boolean; templates: MailTemplate[]; error?: string }> {
  const { data, error } = await supabase.from("mail_templates").select("*").order("created_at", { ascending: true });
  if (error) return { ok: false, templates: [], error: error.message };
  return { ok: true, templates: ((data ?? []) as Row[]).map(rowToTemplate) };
}

export async function mailAddTemplate(input: MailTemplateInput): Promise<{ ok: boolean; template?: MailTemplate; error?: string }> {
  if (!getOnline()) return { ok: false, error: OFFLINE_ERROR };
  const u = getUser();
  if (!u) return { ok: false, error: "Not signed in" };
  const { data, error } = await supabase.from("mail_templates")
    .insert({ user_id: u.id, name: input.name, subject: input.subject || null, body: input.body }).select().single();
  if (error || !data) return { ok: false, error: error?.message || "Couldn't save template" };
  return { ok: true, template: rowToTemplate(data as Row) };
}

export async function mailUpdateTemplate(id: string, input: MailTemplateInput): Promise<{ ok: boolean; template?: MailTemplate; error?: string }> {
  if (!getOnline()) return { ok: false, error: OFFLINE_ERROR };
  const { data, error } = await supabase.from("mail_templates")
    .update({ name: input.name, subject: input.subject || null, body: input.body, updated_at: new Date().toISOString() })
    .eq("id", id).select().single();
  if (error || !data) return { ok: false, error: error?.message || "Couldn't update template" };
  return { ok: true, template: rowToTemplate(data as Row) };
}

export async function mailDeleteTemplate(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!getOnline()) return { ok: false, error: OFFLINE_ERROR };
  const { error } = await supabase.from("mail_templates").delete().eq("id", id);
  return { ok: !error, error: error?.message };
}
