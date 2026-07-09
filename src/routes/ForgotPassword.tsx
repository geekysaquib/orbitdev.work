import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Icon } from "../lib/icons";
import { useAuth } from "../context/AuthContext";

const RESEND_COOLDOWN = 45;

export default function ForgotPassword() {
  const { forgotPassword, resendOtp, resetPassword } = useAuth();
  const nav = useNavigate();
  const [step, setStep] = useState<"request" | "reset">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);

  useEffect(() => {
    if (step !== "reset" || cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [step, cooldown]);

  async function requestCode() {
    if (!email.trim()) return;
    setErr(null); setNote(null); setBusy(true);
    await forgotPassword(email.trim());
    setBusy(false);
    setStep("reset");
    setCooldown(RESEND_COOLDOWN);
    setNote("If that email has an ORBIT account, a code is on its way.");
  }

  async function resend() {
    if (cooldown > 0) return;
    setErr(null); setNote(null);
    const res = await resendOtp(email.trim(), "reset");
    if (res.error) { setErr(res.error); return; }
    setNote("New code sent — check your inbox.");
    setCooldown(RESEND_COOLDOWN);
  }

  async function submitReset() {
    if (code.trim().length !== 6 || pw.length < 8) return;
    if (pw !== pw2) { setErr("Passwords don't match."); return; }
    setErr(null); setNote(null); setBusy(true);
    const res = await resetPassword(email.trim(), code.trim(), pw);
    setBusy(false);
    if (res.error) { setErr(res.error); return; }
    nav("/login", { state: { note: "Password updated — sign in with your new password." } });
  }

  return (
    <div className="authx">
      <div className="authx-stage">
        <div className="authx-hero">
          <div className="authx-eyebrow"><span className="authx-live" />SECURE CHANNEL</div>
          <h1 className="authx-headline">Locked out?<br />Let's fix that.</h1>
          <p className="authx-lede">We'll email you a one-time code — no old password required.</p>
        </div>
      </div>

      <div className="authx-console">
        <div className="authx-panel">
          <Link to="/login" className="authx-back"><Icon name="chevL" size={14} />Back to sign in</Link>
          <div className="authx-brand"><span className="authx-mark"><Icon name="orbit" size={22} /></span><span className="wordmark">ORBIT</span></div>

          {step === "request" ? (
            <>
              <div className="authx-kicker">// FORGOT PASSWORD</div>
              <h2 className="authx-title">Reset your password</h2>
              <p className="authx-desc">Enter your account email and we'll send a reset code.</p>

              <div className="authx-fld"><label>Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && requestCode()} placeholder="you@example.com" autoFocus /></div>

              {err && <div className="authx-err"><Icon name="plug" size={13} />{err}</div>}

              <button className="authx-submit" disabled={busy || !email.trim()} onClick={requestCode}>
                {busy ? <Icon name="loader" size={16} className="spin" /> : <Icon name="mail" size={16} />}
                Send reset code
              </button>
            </>
          ) : (
            <>
              <div className="authx-kicker">// RESET PASSWORD</div>
              <h2 className="authx-title">Check your inbox</h2>
              <p className="authx-desc">Enter the code sent to <b style={{ color: "var(--text)" }}>{email}</b> and choose a new password.</p>

              <div className="authx-fld authx-otp">
                <label>Reset code</label>
                <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" inputMode="numeric" autoComplete="one-time-code" maxLength={6} /></div>

              <div className="authx-fld"><label>New password</label>
                <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 8 characters" /></div>
              <div className="authx-fld"><label>Confirm new password</label>
                <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitReset()} placeholder="••••••••" /></div>

              {err && <div className="authx-err"><Icon name="plug" size={13} />{err}</div>}
              {note && <div className="authx-note"><Icon name="check" size={13} />{note}</div>}

              <button className="authx-submit" disabled={busy || code.length !== 6 || pw.length < 8 || !pw2} onClick={submitReset}>
                {busy ? <Icon name="loader" size={16} className="spin" /> : <Icon name="check" size={16} />}
                Set new password
              </button>

              <div className="authx-resend">
                Didn't get it?{" "}
                <button onClick={resend} disabled={cooldown > 0}>
                  {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
