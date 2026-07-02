import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { signIn, signUp } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr(null); setBusy(true);
    const res = mode === "in" ? await signIn(email, pw) : await signUp(email, pw, name);
    setBusy(false);
    if (res.error) { setErr(res.error); return; }
    if (mode === "up") { setErr(null); setMode("in"); setErr("Account created — check your email to confirm, then sign in."); return; }
    nav("/");
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card fade">
        <div className="auth-logo"><Icon name="rocket" size={22} /></div>
        <div className="wordmark" style={{ fontSize: 22 }}>ORBIT</div>
        <div className="sub" style={{ marginTop: 4 }}>
          {mode === "in" ? "Sign in to your command center." : "Create your command center."}
        </div>

        {mode === "up" && (
          <div className="auth-field">
            <label>Name</label>
            <input className="auth-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Saquib Khan" />
          </div>
        )}
        <div className="auth-field">
          <label>Email</label>
          <input className="auth-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="you@example.com" />
        </div>
        <div className="auth-field">
          <label>Password</label>
          <input className="auth-input" type="password" value={pw} onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="••••••••" />
        </div>

        {err && <div className="auth-err">{err}</div>}

        <button className="btn-primary" style={{ width: "100%", marginTop: 20, justifyContent: "center" }}
          disabled={busy} onClick={submit}>
          {busy ? <Icon name="loader" size={16} className="spin" /> : <Icon name="check" size={16} />}
          {mode === "in" ? "Sign in" : "Create account"}
        </button>

        <div className="auth-switch">
          {mode === "in" ? "New here? " : "Already have an account? "}
          <button onClick={() => { setErr(null); setMode(mode === "in" ? "up" : "in"); }}>
            {mode === "in" ? "Create an account" : "Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
