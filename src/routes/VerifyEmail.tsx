import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Icon } from "../lib/icons";
import { useAuth } from "../context/AuthContext";
import { useOtpResend } from "../hooks/useOtpResend";

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const email = params.get("email") || "";
  const next = params.get("next") || "";
  const isSignup = params.get("signup") === "1";
  const { verifyOtp } = useAuth();
  const nav = useNavigate();
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { cooldown, resend: resendCode } = useOtpResend("verify");

  useEffect(() => { if (!email) nav("/login", { replace: true }); }, [email, nav]);

  async function submit() {
    if (code.trim().length !== 6) return;
    setErr(null); setNote(null); setBusy(true);
    const res = await verifyOtp(email, code.trim());
    setBusy(false);
    if (res.error) { setErr(res.error); return; }
    if (isSignup) { nav(`/onboarding?next=${encodeURIComponent(next || "/app")}`); return; }
    nav(next || "/app");
  }

  async function resend() {
    setErr(null); setNote(null);
    const r = await resendCode(email);
    if (r.error) setErr(r.error);
    else if (r.note) setNote(r.note);
  }

  return (
    <div className="authx">
      <div className="authx-stage">
        <div className="authx-hero">
          <div className="authx-eyebrow"><span className="authx-live" />SECURE CHANNEL</div>
          <h1 className="authx-headline">Almost there.</h1>
          <p className="authx-lede">We sent a 6-digit code to {email || "your email"}. Enter it to confirm your account.</p>
        </div>
      </div>

      <div className="authx-console">
        <div className="authx-panel">
          <Link to="/login" className="authx-back"><Icon name="chevL" size={14} />Back to sign in</Link>
          <div className="authx-brand"><span className="authx-mark"><Icon name="orbit" size={22} /></span><span className="wordmark">ORBIT</span></div>
          <div className="authx-kicker">// VERIFY EMAIL</div>
          <h2 className="authx-title">Enter your code</h2>
          <p className="authx-desc">Sent to <b style={{ color: "var(--text)" }}>{email}</b>. It expires in 10 minutes.</p>

          <div className="authx-fld authx-otp">
            <label>Verification code</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="000000"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
            />
          </div>

          {err && <div className="authx-err"><Icon name="plug" size={13} />{err}</div>}
          {note && <div className="authx-note"><Icon name="check" size={13} />{note}</div>}

          <button className="authx-submit" disabled={busy || code.length !== 6} onClick={submit}>
            {busy ? <Icon name="loader" size={16} className="spin" /> : <Icon name="check" size={16} />}
            Verify &amp; continue
          </button>

          <div className="authx-resend">
            Didn't get it?{" "}
            <button onClick={resend} disabled={cooldown > 0}>
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
