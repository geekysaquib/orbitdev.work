import { randomInt } from "node:crypto";
import { dbSelect, dbInsert, dbUpdate } from "./db";

export type OtpPurpose = "verify" | "reset";

const TTL_MIN = 10;
const RESEND_COOLDOWN_SEC = 45;
const MAX_ATTEMPTS = 5;
const DAILY_SEND_LIMIT = 8;

interface OtpRow { id: string; code: string; attempts: number; expires_at: string; created_at: string; }

function genCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

async function latestPending(email: string, purpose: OtpPurpose): Promise<OtpRow | null> {
  const rows = await dbSelect<OtpRow>(
    "otp_codes",
    `email=eq.${encodeURIComponent(email)}&purpose=eq.${purpose}&consumed=eq.false&order=created_at.desc&limit=1`,
  );
  return rows[0] ?? null;
}

/** Issues a fresh code, superseding any still-pending one. Rate-limited per email+purpose. */
export async function issueOtp(
  email: string,
  purpose: OtpPurpose,
): Promise<{ code: string } | { error: "too_soon"; retryInSec: number } | { error: "too_many" }> {
  const existing = await latestPending(email, purpose);
  if (existing) {
    const ageSec = (Date.now() - new Date(existing.created_at).getTime()) / 1000;
    if (ageSec < RESEND_COOLDOWN_SEC) return { error: "too_soon", retryInSec: Math.ceil(RESEND_COOLDOWN_SEC - ageSec) };
    await dbUpdate("otp_codes", `id=eq.${existing.id}`, { consumed: true });
  }

  // Caps total volume (not just frequency) so a cooldown of 45s can't still add up
  // to ~80 emails/day against one inbox.
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const recent = await dbSelect<{ id: string }>(
    "otp_codes",
    `email=eq.${encodeURIComponent(email)}&purpose=eq.${purpose}&created_at=gte.${since}&select=id`,
  );
  if (recent.length >= DAILY_SEND_LIMIT) return { error: "too_many" };

  const code = genCode();
  const expires_at = new Date(Date.now() + TTL_MIN * 60_000).toISOString();
  await dbInsert("otp_codes", { email, code, purpose, expires_at });
  return { code };
}

export async function verifyOtp(email: string, purpose: OtpPurpose, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await latestPending(email, purpose);
  if (!row) return { ok: false, error: "No code requested for this email — send a new one." };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, error: "That code expired — send a new one." };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, error: "Too many incorrect attempts — send a new one." };
  if (row.code !== code.trim()) {
    await dbUpdate("otp_codes", `id=eq.${row.id}`, { attempts: row.attempts + 1 });
    const left = MAX_ATTEMPTS - row.attempts - 1;
    return { ok: false, error: left > 0 ? `Incorrect code — ${left} attempt${left === 1 ? "" : "s"} left.` : "Incorrect code — send a new one." };
  }
  await dbUpdate("otp_codes", `id=eq.${row.id}`, { consumed: true });
  return { ok: true };
}
