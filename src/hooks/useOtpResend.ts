import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";

const RESEND_COOLDOWN = 45;

/** Shared resend-cooldown countdown + resend call, used by ForgotPassword and VerifyEmail. */
export function useOtpResend(purpose: "verify" | "reset") {
  const { resendOtp } = useAuth();
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function resend(email: string): Promise<{ error?: string; note?: string }> {
    if (cooldown > 0) return {};
    const res = await resendOtp(email, purpose);
    if (res.error) return { error: res.error };
    setCooldown(RESEND_COOLDOWN);
    return { note: "New code sent — check your inbox." };
  }

  return { cooldown, resend, resetCooldown: () => setCooldown(RESEND_COOLDOWN) };
}
