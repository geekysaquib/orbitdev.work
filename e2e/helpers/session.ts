/**
 * Mints an ORBIT session JWT the same way netlify/functions/auth.ts's sign()
 * does, and injects it into localStorage before any page script runs — skips
 * the OTP login screen entirely for E2E. Reuses an existing verified user id
 * (read-only, via the service-role key already in .env) rather than
 * hardcoding a real token in a committed file, unlike the repo's own
 * scratch_*.cjs debug scripts.
 */
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import jwt from "jsonwebtoken";
import type { BrowserContext } from "@playwright/test";

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  const path = ".env";
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export const env = loadEnv();

export interface TestUser { id: string; email: string; full_name: string; email_verified: boolean }

export async function fetchVerifiedUser(): Promise<TestUser> {
  const r = await fetch(
    `${env.VITE_SUPABASE_URL}/rest/v1/users?select=id,email,full_name,email_verified&email_verified=eq.true&limit=1`,
    { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } },
  );
  const rows = await r.json();
  if (!r.ok || !Array.isArray(rows) || !rows.length) throw new Error(`no verified user found: ${JSON.stringify(rows)}`);
  return rows[0];
}

export function mintToken(user: TestUser): string {
  return jwt.sign({ email: user.email, role: "authenticated" }, env.SUPABASE_JWT_SECRET, {
    subject: user.id, audience: "authenticated", algorithm: "HS256", expiresIn: "1h",
  });
}

/** Call once per test (or in a beforeEach) before any `page.goto`. */
export async function signInAs(context: BrowserContext, user: TestUser): Promise<string> {
  const token = mintToken(user);
  await context.addInitScript(
    ([token, user]) => {
      localStorage.setItem("orbit.auth.token", token as string);
      localStorage.setItem("orbit.auth.user", JSON.stringify(user));
    },
    [token, user] as const,
  );
  return token;
}
