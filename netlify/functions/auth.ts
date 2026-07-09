import type { Handler, HandlerEvent } from "@netlify/functions";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { dbSelect, dbInsert, dbUpdate } from "./_lib/db";
import { issueOtp, verifyOtp } from "./_lib/otp";
import { sendMail } from "./_lib/mailer";
import { verifyEmail, resetEmail, loginAlertEmail } from "./_lib/email-templates";
import { clientIp, lookupGeo, parseUserAgent } from "./_lib/geo";

/**
 * ORBIT's own auth — no Supabase Auth involved. Signup/login/verification/
 * password reset are all handled here; sessions are JWTs we sign ourselves
 * with the project's Postgres/PostgREST JWT secret using the same claim
 * shape Supabase Auth would use (`sub` = user id, `role` = authenticated),
 * so Row Level Security (`auth.uid()`) on every other table keeps working
 * unchanged. See supabase/schema.sql for the `users` / `otp_codes` tables.
 *
 * Routes (all POST, dispatched by ?action=):
 *   signup   { email, password, full_name } -> sends a verify OTP
 *   resend   { email, purpose }             -> resends verify or reset OTP
 *   verify   { email, code }                -> confirms signup, returns a session
 *   login    { email, password }            -> returns a session
 *   forgot   { email }                      -> sends a reset OTP (always 200)
 *   reset    { email, code, password }      -> sets a new password
 */

interface DbUser { id: string; email: string; password_hash: string; full_name: string; email_verified: boolean; }

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || "";
const TOKEN_TTL_DAYS = Number(process.env.AUTH_TOKEN_TTL_DAYS) || 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (statusCode: number, data: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

function sign(user: DbUser): string {
  return jwt.sign({ email: user.email, role: "authenticated" }, JWT_SECRET, {
    subject: user.id,
    audience: "authenticated",
    algorithm: "HS256",
    expiresIn: `${TOKEN_TTL_DAYS}d`,
  });
}

const publicUser = (u: DbUser) => ({ id: u.id, email: u.email, full_name: u.full_name, email_verified: u.email_verified });

async function findUser(email: string): Promise<DbUser | null> {
  const rows = await dbSelect<DbUser>("users", `email=eq.${encodeURIComponent(email)}&limit=1`);
  return rows[0] ?? null;
}

/** Best-effort "new sign-in" email — never blocks or fails the caller's login. */
async function sendLoginAlert(user: DbUser, event: HandlerEvent): Promise<void> {
  try {
    const headers = event.headers as Record<string, string | undefined>;
    const ip = clientIp(headers);
    const geo = await lookupGeo(ip);
    const { browser, os } = parseUserAgent(headers["user-agent"] || "");
    const location = [geo.city, geo.region, geo.country].filter(Boolean).join(", ") || "Unknown location";
    const time = `${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} UTC`;
    const { subject, html, text } = loginAlertEmail(user.full_name, { time, ip: geo.ip || "unknown", location, device: `${browser} on ${os}` });
    await sendMail(user.email, subject, html, text);
  } catch (e) {
    console.error("[auth] login alert email failed:", (e as Error).message);
  }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  if (!JWT_SECRET) return json(500, { error: "Server misconfigured — SUPABASE_JWT_SECRET is not set." });

  const action = event.queryStringParameters?.action || "";
  let body: Record<string, unknown>;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid request body." }); }

  const email = String(body.email || "").trim().toLowerCase();

  try {
    switch (action) {
      case "signup": {
        const password = String(body.password || "");
        const fullName = String(body.full_name || "").trim();
        if (!EMAIL_RE.test(email)) return json(400, { error: "Enter a valid email address." });
        if (password.length < 8) return json(400, { error: "Password must be at least 8 characters." });

        const existing = await findUser(email);
        if (existing?.email_verified) return json(409, { error: "An account with this email already exists." });

        const password_hash = await bcrypt.hash(password, 10);
        if (existing) {
          await dbUpdate("users", `id=eq.${existing.id}`, { password_hash, full_name: fullName || existing.full_name });
        } else {
          await dbInsert("users", { email, password_hash, full_name: fullName, email_verified: false });
        }

        const res = await issueOtp(email, "verify");
        if ("error" in res) return json(429, { error: `Please wait ${res.retryInSec}s before requesting another code.` });
        const tpl = verifyEmail(fullName, res.code);
        await sendMail(email, tpl.subject, tpl.html, tpl.text);
        return json(200, { ok: true, email });
      }

      case "resend": {
        const purpose = body.purpose === "reset" ? "reset" : "verify";
        if (!EMAIL_RE.test(email)) return json(400, { error: "Enter a valid email address." });
        const user = await findUser(email);
        if (!user) return json(200, { ok: true }); // don't leak account existence
        if (purpose === "verify" && user.email_verified) return json(400, { error: "This account is already verified — sign in instead." });

        const res = await issueOtp(email, purpose);
        if ("error" in res) return json(429, { error: `Please wait ${res.retryInSec}s before requesting another code.` });
        const tpl = purpose === "verify" ? verifyEmail(user.full_name, res.code) : resetEmail(user.full_name, res.code);
        await sendMail(email, tpl.subject, tpl.html, tpl.text);
        return json(200, { ok: true });
      }

      case "verify": {
        const code = String(body.code || "");
        const user = await findUser(email);
        if (!user) return json(400, { error: "No pending signup for this email." });

        const v = await verifyOtp(email, "verify", code);
        if (!v.ok) return json(400, { error: v.error });

        if (!user.email_verified) {
          await dbUpdate("users", `id=eq.${user.id}`, { email_verified: true });
          user.email_verified = true;
        }
        const token = sign(user);
        await sendLoginAlert(user, event);
        return json(200, { token, user: publicUser(user) });
      }

      case "login": {
        const password = String(body.password || "");
        const user = await findUser(email);
        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
          return json(401, { error: "Invalid email or password." });
        }
        if (!user.email_verified) return json(403, { error: "verify_required", email });

        const token = sign(user);
        await sendLoginAlert(user, event);
        return json(200, { token, user: publicUser(user) });
      }

      case "forgot": {
        if (EMAIL_RE.test(email)) {
          const user = await findUser(email);
          if (user) {
            const res = await issueOtp(email, "reset");
            if (!("error" in res)) {
              const tpl = resetEmail(user.full_name, res.code);
              await sendMail(email, tpl.subject, tpl.html, tpl.text);
            }
          }
        }
        return json(200, { ok: true }); // always ok — no account-existence leak
      }

      case "reset": {
        const code = String(body.code || "");
        const password = String(body.password || "");
        if (password.length < 8) return json(400, { error: "Password must be at least 8 characters." });

        const user = await findUser(email);
        if (!user) return json(400, { error: "Invalid or expired code." });

        const v = await verifyOtp(email, "reset", code);
        if (!v.ok) return json(400, { error: v.error });

        const password_hash = await bcrypt.hash(password, 10);
        await dbUpdate("users", `id=eq.${user.id}`, { password_hash });
        return json(200, { ok: true });
      }

      default:
        return json(400, { error: "Unknown action." });
    }
  } catch (e) {
    console.error("[auth]", e);
    return json(500, { error: "Something went wrong. Please try again." });
  }
};
