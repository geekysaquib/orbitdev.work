import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getToken, getUser, setSession, clearSession, isSessionValid, type OrbitUser } from "../lib/auth";

const FN = "/.netlify/functions/auth";

type ApiResult<T> = ({ ok: true } & T) | { ok: false; error: string; code?: string };

async function call<T = Record<string, never>>(action: string, payload: Record<string, unknown>): Promise<ApiResult<T>> {
  try {
    const r = await fetch(`${FN}?action=${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: (j as { error?: string }).error || `Request failed (${r.status})`, code: (j as { error?: string }).error };
    return { ok: true, ...(j as T) };
  } catch {
    return { ok: false, error: "Couldn't reach ORBIT — check your connection and try again." };
  }
}

interface AuthShape {
  session: boolean;
  user: OrbitUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string; verifyRequired?: boolean }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error?: string }>;
  verifyOtp: (email: string, code: string) => Promise<{ error?: string }>;
  resendOtp: (email: string, purpose: "verify" | "reset") => Promise<{ error?: string }>;
  forgotPassword: (email: string) => Promise<{ error?: string }>;
  resetPassword: (email: string, code: string, password: string) => Promise<{ error?: string }>;
  signOut: () => void;
}

const Ctx = createContext<AuthShape | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<OrbitUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUser(isSessionValid() ? getUser() : (clearSession(), null));
    setLoading(false);
  }, []);

  const signIn: AuthShape["signIn"] = async (email, password) => {
    const res = await call<{ token: string; user: OrbitUser }>("login", { email, password });
    if (!res.ok) return res.error === "verify_required" ? { verifyRequired: true } : { error: res.error };
    setSession(res.token, res.user);
    setUser(res.user);
    return {};
  };

  const signUp: AuthShape["signUp"] = async (email, password, fullName) => {
    const res = await call("signup", { email, password, full_name: fullName });
    return res.ok ? {} : { error: res.error };
  };

  const verifyOtp: AuthShape["verifyOtp"] = async (email, code) => {
    const res = await call<{ token: string; user: OrbitUser }>("verify", { email, code });
    if (!res.ok) return { error: res.error };
    setSession(res.token, res.user);
    setUser(res.user);
    return {};
  };

  const resendOtp: AuthShape["resendOtp"] = async (email, purpose) => {
    const res = await call("resend", { email, purpose });
    return res.ok ? {} : { error: res.error };
  };

  const forgotPassword: AuthShape["forgotPassword"] = async (email) => {
    const res = await call("forgot", { email });
    return res.ok ? {} : { error: res.error };
  };

  const resetPassword: AuthShape["resetPassword"] = async (email, code, password) => {
    const res = await call("reset", { email, code, password });
    return res.ok ? {} : { error: res.error };
  };

  const signOut = () => { clearSession(); setUser(null); };

  return (
    <Ctx.Provider value={{ session: !!user, user, loading, signIn, signUp, verifyOtp, resendOtp, forgotPassword, resetPassword, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used inside AuthProvider");
  return c;
}

// Re-exported so call sites that only need the raw token (e.g. authHeader for
// the zoho-sprints function) don't need to import from two places.
export { getToken };
