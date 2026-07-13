import { useMemo, useState } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { Icon } from "../lib/icons";
import { useAuth } from "../context/AuthContext";

const RINGS = [
  { rx: 92, ry: 40, cls: "r1", color: "#37DFA0" },
  { rx: 148, ry: 64, cls: "r2", color: "#5B8DEF" },
  { rx: 208, ry: 90, cls: "r3", color: "#A98BF5" },
  { rx: 268, ry: 116, cls: "r4", color: "#E4A951" },
];

export default function Login() {
  const { signIn, signUp } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const next = params.get("next") || "";
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>((location.state as { note?: string } | null)?.note ?? null);
  const [busy, setBusy] = useState(false);

  const stars = useMemo(() => Array.from({ length: 42 }, () => ({
    top: Math.random() * 100, left: Math.random() * 100,
    size: Math.random() * 2 + 0.6, delay: Math.random() * 4, dur: Math.random() * 3 + 2,
  })), []);

  async function submit() {
    if (!email || !pw) return;
    setErr(null); setNote(null); setBusy(true);
    const verifyUrl = `/verify?email=${encodeURIComponent(email)}${next ? `&next=${encodeURIComponent(next)}` : ""}`;
    if (mode === "up") {
      const res = await signUp(email, pw, name);
      setBusy(false);
      if (res.error) { setErr(res.error); return; }
      nav(`${verifyUrl}&signup=1`);
      return;
    }
    const res = await signIn(email, pw);
    setBusy(false);
    if (res.verifyRequired) { nav(verifyUrl); return; }
    if (res.error) { setErr(res.error); return; }
    nav(next || "/app");
  }

  return (
    <div className="authx">
      {/* ---- orbital stage ---- */}
      <div className="authx-stage">
        <div className="authx-stars">
          {stars.map((s, i) => (
            <span key={i} style={{ top: `${s.top}%`, left: `${s.left}%`, width: s.size, height: s.size, animationDelay: `${s.delay}s`, animationDuration: `${s.dur}s` }} />
          ))}
        </div>

        <div className="authx-hero">
          <div className="authx-eyebrow"><span className="authx-live" />SECURE CHANNEL</div>
          <h1 className="authx-headline">Every project,<br />in one orbit.</h1>
          <p className="authx-lede">Boards, logged hours, containers, and mail — your whole dev universe, run from a single console.</p>
        </div>

        <div className="authx-orbit-wrap" aria-hidden="true">
          <div className="authx-core-glow" />
          <svg viewBox="0 0 600 600" className="authx-orbit">
            <defs>
              <radialGradient id="authx-core" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#7CF3C4" /><stop offset="55%" stopColor="#37DFA0" /><stop offset="100%" stopColor="#0C3A2A" />
              </radialGradient>
            </defs>
            {RINGS.map((r) => (
              <g key={r.cls} className={`authx-ring ${r.cls}`}>
                <ellipse cx="300" cy="300" rx={r.rx} ry={r.ry} fill="none" stroke={r.color} strokeOpacity="0.28" strokeWidth="1.2" />
                <circle cx={300 + r.rx} cy="300" r="5" fill={r.color} />
              </g>
            ))}
            {/* planet core */}
            <circle cx="300" cy="300" r="21" fill="url(#authx-core)" />
            <ellipse cx="300" cy="300" rx="40" ry="17" fill="none" stroke="#37DFA0" strokeOpacity="0.7" strokeWidth="1.7" transform="rotate(-24 300 300)" />
          </svg>
        </div>

        <div className="authx-readout">
          <span>orbit://command-center</span>
          <span><b className="authx-ok">●</b> all systems nominal</span>
          <span>v0.1 · secure session</span>
        </div>
      </div>

      {/* ---- console ---- */}
      <div className="authx-console">
        <div className="authx-panel">
          <div className="authx-brand"><span className="authx-mark"><Icon name="orbit" size={22} /></span><span className="wordmark">ORBIT</span></div>
          <div className="authx-kicker">{mode === "in" ? "// SIGN IN" : "// NEW OPERATOR"}</div>
          <h2 className="authx-title">{mode === "in" ? "Welcome back" : "Create your console"}</h2>
          <p className="authx-desc">{mode === "in" ? "Dock into your command center." : "Set up access to your command center."}</p>

          {mode === "up" && (
            <div className="authx-fld"><label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Saquib Khan" /></div>
          )}
          <div className="authx-fld"><label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="you@example.com" /></div>
          <div className="authx-fld">
            <label style={{ display: "flex", justifyContent: "space-between" }}>
              Password
              {mode === "in" && <button type="button" className="authx-forgot" onClick={() => nav("/forgot-password")}>Forgot password?</button>}
            </label>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="••••••••" /></div>

          {err && <div className="authx-err"><Icon name="plug" size={13} />{err}</div>}
          {note && <div className="authx-note"><Icon name="check" size={13} />{note}</div>}

          <button className="authx-submit" disabled={busy || !email || !pw} onClick={submit}>
            {busy ? <Icon name="loader" size={16} className="spin" /> : <Icon name={mode === "in" ? "zap" : "check"} size={16} />}
            {mode === "in" ? "Sign in" : "Create account"}
          </button>

          <div className="authx-switch">
            {mode === "in" ? "New here? " : "Already have an account? "}
            <button onClick={() => { setErr(null); setNote(null); setMode(mode === "in" ? "up" : "in"); }}>
              {mode === "in" ? "Create an account" : "Sign in"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
