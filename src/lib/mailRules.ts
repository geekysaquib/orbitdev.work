/**
 * CRUD over `mail_rules` (RLS-scoped) — simple "from/subject contains X"
 * rules, evaluated client-side in Layout.tsx's poller against messages read
 * through the local agent's IMAP session (see agent/server.mjs's /gmail/list).
 */
import { supabase } from "./supabase";
import { getUser } from "./auth";
import { getOnline, OFFLINE_ERROR } from "./offline";

export type MailRuleField = "from" | "subject";
export interface MailRule { id: string; field: MailRuleField; value: string; enabled: boolean; createdAt: string; }
export interface MailRuleInput { field: MailRuleField; value: string; enabled?: boolean; }

interface Row { id: string; field: MailRuleField; value: string; enabled: boolean; created_at: string; }
const rowToRule = (r: Row): MailRule => ({ id: r.id, field: r.field, value: r.value, enabled: r.enabled, createdAt: r.created_at });

export async function mailRules(): Promise<{ ok: boolean; rules: MailRule[]; error?: string }> {
  const { data, error } = await supabase.from("mail_rules").select("*").order("created_at", { ascending: true });
  if (error) return { ok: false, rules: [], error: error.message };
  return { ok: true, rules: ((data ?? []) as Row[]).map(rowToRule) };
}

export async function mailAddRule(input: MailRuleInput): Promise<{ ok: boolean; rule?: MailRule; error?: string }> {
  if (!getOnline()) return { ok: false, error: OFFLINE_ERROR };
  const u = getUser();
  if (!u) return { ok: false, error: "Not signed in" };
  const { data, error } = await supabase.from("mail_rules")
    .insert({ user_id: u.id, field: input.field, value: input.value, enabled: input.enabled ?? true }).select().single();
  if (error || !data) return { ok: false, error: error?.message || "Couldn't save rule" };
  return { ok: true, rule: rowToRule(data as Row) };
}

export async function mailSetRuleEnabled(id: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!getOnline()) return { ok: false, error: OFFLINE_ERROR };
  const { error } = await supabase.from("mail_rules").update({ enabled }).eq("id", id);
  return { ok: !error, error: error?.message };
}

export async function mailDeleteRule(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!getOnline()) return { ok: false, error: OFFLINE_ERROR };
  const { error } = await supabase.from("mail_rules").delete().eq("id", id);
  return { ok: !error, error: error?.message };
}

/** Pure matcher — exported so both the Layout poller and any future test can share it. */
export function matchesRule(rule: MailRule, msg: { from: string; fromAddr: string; subject: string }): boolean {
  if (!rule.enabled || !rule.value.trim()) return false;
  const needle = rule.value.trim().toLowerCase();
  const haystack = rule.field === "from" ? `${msg.from} ${msg.fromAddr}`.toLowerCase() : msg.subject.toLowerCase();
  return haystack.includes(needle);
}
