import { schedule } from "@netlify/functions";
import nodemailer, { type Transporter } from "nodemailer";
import { dbSelect, dbUpdate } from "./_lib/db";

/**
 * Sends due rows from `scheduled_emails` (see supabase/schema.sql) — a real
 * server-side scheduled function rather than a client-side poller, since the
 * whole point of "send later" is that it still fires when ORBIT and the
 * local agent are both closed at the scheduled time. Uses the Gmail app
 * password already stored per-user in `integrations` (service-role read via
 * _lib/db.ts, since a cron invocation has no caller JWT to scope RLS with),
 * and sends via nodemailer/SMTP the same way _lib/mailer.ts does for ORBIT's
 * own transactional mail.
 */

interface DueRow {
  id: string; user_id: string; to_addr: string; cc: string | null; bcc: string | null;
  subject: string | null; body: string; html: string | null; in_reply_to: string | null; references: string | null;
}
interface Creds { gmail_user: string | null; gmail_app_password: string | null; }

const transporters = new Map<string, Transporter>();
function transporterFor(user: string, pass: string): Transporter {
  const cached = transporters.get(user);
  if (cached) return cached;
  const t = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass: pass.replace(/\s+/g, "") } });
  transporters.set(user, t);
  return t;
}

async function run() {
  const nowIso = new Date().toISOString();
  let due: DueRow[];
  try {
    due = await dbSelect<DueRow>("scheduled_emails", `status=eq.pending&send_at=lte.${encodeURIComponent(nowIso)}&order=send_at.asc&limit=50`);
  } catch (e) {
    console.error("[mail-scheduled-send] couldn't load due rows", e);
    return { statusCode: 200, body: "ok" };
  }
  if (due.length === 0) return { statusCode: 200, body: "ok" };

  for (const row of due) {
    try {
      const creds = await dbSelect<Creds>("integrations", `user_id=eq.${row.user_id}&select=gmail_user,gmail_app_password&limit=1`);
      const c = creds[0];
      if (!c?.gmail_user || !c?.gmail_app_password) {
        await dbUpdate("scheduled_emails", `id=eq.${row.id}`, { status: "failed", error: "Gmail isn't connected for this account anymore." });
        continue;
      }
      await transporterFor(c.gmail_user, c.gmail_app_password).sendMail({
        from: c.gmail_user, to: row.to_addr, cc: row.cc || undefined, bcc: row.bcc || undefined,
        subject: row.subject || "(no subject)", text: row.body, html: row.html || undefined,
        inReplyTo: row.in_reply_to || undefined,
        references: row.references || undefined,
      });
      await dbUpdate("scheduled_emails", `id=eq.${row.id}`, { status: "sent", sent_at: new Date().toISOString() });
    } catch (e) {
      console.error(`[mail-scheduled-send] failed to send ${row.id}`, e);
      try { await dbUpdate("scheduled_emails", `id=eq.${row.id}`, { status: "failed", error: (e as Error).message.slice(0, 300) }); } catch { /* best-effort */ }
    }
  }
  return { statusCode: 200, body: "ok" };
}

export const handler = schedule("*/5 * * * *", run);
