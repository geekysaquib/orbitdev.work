import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AUTH_EVENT, getToken, getUser, setSession, clearSession, isSessionValid, type OrbitUser } from "../lib/auth";
import { postJson } from "../lib/apiClient";
import { recordAudit } from "../lib/audit";

const FN = "/.netlify/functions/auth";

function call<T = Record<string, never>>(action: string, payload: Record<string, unknown>) {
  return postJson<T>(`${FN}?action=${action}`, payload);
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
  updateProfile: (patch: { full_name?: string; job_title?: string; phone?: string; avatar_data_url?: string | null }) => Promise<{ error?: string }>;
  signOut: () => void;
}

const Ctx = createContext<AuthShape | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<OrbitUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Re-reads localStorage and syncs `user`. Only calls clearSession() (which
  // itself emits AUTH_EVENT) when there's actually something to clear —
  // otherwise, since this runs ON that same event, an already-clear session
  // would re-trigger itself forever.
  const sync = () => {
    if (isSessionValid()) { setUser(getUser()); return; }
    if (getToken() || getUser()) clearSession();
    setUser(null);
  };

  useEffect(() => {
    sync();
    setLoading(false);
  }, []);

  // Keeps every open tab in sync: `storage` fires in OTHER tabs when one tab's
  // localStorage changes (e.g. signing out there), and AUTH_EVENT covers
  // same-tab changes made outside this provider's own methods.
  useEffect(() => {
    window.addEventListener(AUTH_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(AUTH_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const signIn: AuthShape["signIn"] = async (email, password) => {
    const res = await call<{ token: string; user: OrbitUser }>("login", { email, password });
    if (!res.ok) return res.error === "verify_required" ? { verifyRequired: true } : { error: res.error };
    setSession(res.token, res.user);
    setUser(res.user);
    recordAudit({ action: "sign_in", entityType: "session" });
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

  const updateProfile: AuthShape["updateProfile"] = async (patch) => {
    const res = await call<{ user: OrbitUser }>("update-profile", patch);
    if (!res.ok) return { error: res.error };
    const token = getToken();
    if (token) setSession(token, res.user);
    setUser(res.user);
    return {};
  };

  const signOut = () => { recordAudit({ action: "sign_out", entityType: "session" }); clearSession(); setUser(null); };

  return (
    <Ctx.Provider value={{ session: !!user, user, loading, signIn, signUp, verifyOtp, resendOtp, forgotPassword, resetPassword, updateProfile, signOut }}>
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
