/**
 * Transactional mail for ORBIT's own account/security emails (verification,
 * password reset, login alerts) — sent directly by ORBIT, not routed through
 * Supabase's mailer. Uses Gmail SMTP with an app password.
 *
 * In production, set MAIL_USER / MAIL_APP_PASSWORD (and optionally MAIL_FROM)
 * in Netlify → Site settings → Environment variables.
 *
 * For local `netlify dev`, either set the same vars in your .env, or drop a
 * netlify/functions/mail-config.json (gitignored) shaped like:
 *   { "user": "orbit@yourdomain.com", "pass": "16-char app password", "from": "ORBIT <orbit@yourdomain.com>" }
 * See mail-config.example.json for the template.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import nodemailer, { type Transporter } from "nodemailer";

// Resolved from the project root rather than import.meta.url/__dirname: this
// file gets bundled (esbuild, sometimes to CJS) by both `netlify dev` and
// production deploys, and import.meta.url isn't reliably defined once that
// happens. process.cwd() is the repo root in both `netlify dev` and prod.
const CFG_PATH = join(process.cwd(), "netlify", "functions", "mail-config.json");

interface MailCreds { user: string; pass: string; from?: string; }

function creds(): MailCreds | null {
  if (process.env.MAIL_USER && process.env.MAIL_APP_PASSWORD) {
    return { user: process.env.MAIL_USER, pass: process.env.MAIL_APP_PASSWORD, from: process.env.MAIL_FROM };
  }
  if (existsSync(CFG_PATH)) {
    try { return JSON.parse(readFileSync(CFG_PATH, "utf8")) as MailCreds; } catch { return null; }
  }
  return null;
}

let transporter: Transporter | null = null;
let transporterUser = "";

function getTransporter(c: MailCreds): Transporter {
  if (transporter && transporterUser === c.user) return transporter;
  transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: c.user, pass: c.pass.replace(/\s+/g, "") },
  });
  transporterUser = c.user;
  return transporter;
}

export async function sendMail(to: string, subject: string, html: string, text: string): Promise<void> {
  const c = creds();
  if (!c) throw new Error("Mail not configured — set MAIL_USER/MAIL_APP_PASSWORD or add netlify/functions/mail-config.json");
  const from = c.from || `ORBIT <${c.user}>`;
  await getTransporter(c).sendMail({ from, to, subject, html, text });
}
