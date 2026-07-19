/**
 * CRUD over `scheduled_emails` (RLS-scoped). The row is just a durable queue
 * entry — actually sending happens server-side in
 * netlify/functions/mail-scheduled-send.ts (a scheduled function), not here,
 * so a scheduled send still fires even if ORBIT and the agent are both
 * closed at the scheduled time.
 */
import { supabase } from "./supabase";
import { getUser } from "./auth";
import { getOnline, OFFLINE_ERROR } from "./offline";

export type ScheduledStatus = "pending" | "sent" | "failed" | "canceled";
export interface ScheduledEmail {
  id: string; to: string; cc: string | null; bcc: string | null; subject: string | null; body: string; html: string | null;
  inReplyTo: string | null; references: string | null; sendAt: string; status: ScheduledStatus;
  error: string | null; createdAt: string;
}
// No attachments here on purpose — a scheduled send has to fire without the
// browser open (see mail-scheduled-send.ts), and there's no storage bucket
// yet to hold binary content until then. Compose disables scheduling
// whenever the draft has attachments rather than silently dropping them.
export interface ScheduledEmailInput {
  to: string; cc?: string; bcc?: string; subject?: string; body: string; html?: string;
  inReplyTo?: string; references?: string[]; sendAt: string;
}

interface Row {
  id: string; to_addr: string; cc: string | null; bcc: string | null; subject: string | null; body: string; html: string | null;
  in_reply_to: string | null; references: string | null; send_at: string; status: ScheduledStatus;
  error: string | null; created_at: string;
}
const rowToEmail = (r: Row): ScheduledEmail => ({
  id: r.id, to: r.to_addr, cc: r.cc, bcc: r.bcc, subject: r.subject, body: r.body, html: r.html,
  inReplyTo: r.in_reply_to, references: r.references, sendAt: r.send_at, status: r.status,
  error: r.error, createdAt: r.created_at,
});

export async function scheduledEmails(): Promise<{ ok: boolean; emails: ScheduledEmail[]; error?: string }> {
  const { data, error } = await supabase.from("scheduled_emails").select("*").order("send_at", { ascending: true });
  if (error) return { ok: false, emails: [], error: error.message };
  return { ok: true, emails: ((data ?? []) as Row[]).map(rowToEmail) };
}

export async function scheduleEmail(input: ScheduledEmailInput): Promise<{ ok: boolean; email?: ScheduledEmail; error?: string }> {
  if (!getOnline()) return { ok: false, error: OFFLINE_ERROR };
  const u = getUser();
  if (!u) return { ok: false, error: "Not signed in" };
  const { data, error } = await supabase.from("scheduled_emails").insert({
    user_id: u.id, to_addr: input.to, cc: input.cc || null, bcc: input.bcc || null,
    subject: input.subject || null, body: input.body, html: input.html || null, in_reply_to: input.inReplyTo || null,
    references: input.references?.length ? input.references.join(" ") : null,
    send_at: input.sendAt, status: "pending",
  }).select().single();
  if (error || !data) return { ok: false, error: error?.message || "Couldn't schedule message" };
  return { ok: true, email: rowToEmail(data as Row) };
}

export async function cancelScheduledEmail(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!getOnline()) return { ok: false, error: OFFLINE_ERROR };
  const { error } = await supabase.from("scheduled_emails").update({ status: "canceled" }).eq("id", id).eq("status", "pending");
  return { ok: !error, error: error?.message };
}
