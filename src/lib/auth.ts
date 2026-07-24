/**
 * Client-side session storage for ORBIT's custom OTP-based auth (see
 * netlify/functions/auth.ts). There is no Supabase Auth session anywhere —
 * the token here IS the session, and it's what src/lib/supabase.ts hands to
 * PostgREST on every request via the `accessToken` client option.
 */
export interface OrbitUser {
  id: string; email: string; full_name: string; email_verified: boolean;
  avatar_data_url: string | null; phone: string | null; job_title: string | null;
}

const TOKEN_KEY = "orbit.auth.token";
const USER_KEY = "orbit.auth.user";
export const AUTH_EVENT = "orbit-auth-change";

function emit() { try { window.dispatchEvent(new Event(AUTH_EVENT)); } catch { /* noop */ } }

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function getUser(): OrbitUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as OrbitUser) : null;
  } catch { return null; }
}

export function setSession(token: string, user: OrbitUser): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch { /* noop */ }
  emit();
}

export function clearSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch { /* noop */ }
  emit();
}

/** For Netlify function calls that need the caller's identity (e.g. zoho-sprints). */
export function authHeader(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** Decoded client-side for UX only (expiry countdown) — the signature is verified server-side by Postgres, never here. */
function decodeExp(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch { return null; }
}

export function isSessionValid(): boolean {
  const t = getToken();
  if (!t || !getUser()) return false;
  const exp = decodeExp(t);
  return exp === null ? true : Date.now() < exp;
}
