import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { Icon } from "../lib/icons";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/Toast";
import { previewInvite, acceptInvite } from "../lib/teams";
import { recordAudit } from "../lib/audit";
import { OrbitSpinner } from "../components/ui";

type PreviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; team_name: string; invited_by_name: string; email: string };

export default function InviteAccept() {
  const { token = "" } = useParams();
  const { session } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [preview, setPreview] = useState<PreviewState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await previewInvite(token);
      if (!alive) return;
      if (res.ok) setPreview({ status: "ready", team_name: res.team_name, invited_by_name: res.invited_by_name, email: res.email });
      else setPreview({ status: "error", message: res.error });
    })();
    return () => { alive = false; };
  }, [token]);

  async function accept() {
    setErr(null); setBusy(true);
    const res = await acceptInvite(token);
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    recordAudit({ action: "team.join", entityType: "team", entityId: res.team_id, teamId: res.team_id, meta: { team_name: res.team_name } });
    toast(`You joined ${res.team_name}`);
    nav(`/teams?team=${res.team_id}`, { replace: true });
  }

  return (
    <div className="authx">
      <div className="authx-stage">
        <div className="authx-hero">
          <div className="authx-eyebrow"><span className="authx-live" />TEAM INVITE</div>
          <h1 className="authx-headline">You've been invited.</h1>
          <p className="authx-lede">Accept to start collaborating on shared tasks and projects.</p>
        </div>
      </div>

      <div className="authx-console">
        <div className="authx-panel">
          <div className="authx-brand"><span className="authx-mark"><Icon name="orbit" size={22} /></span><span className="wordmark">ORBIT</span></div>

          {preview.status === "loading" && <p className="authx-desc" style={{ display: "flex", alignItems: "center", gap: 9 }}><OrbitSpinner size={15} />Checking your invite…</p>}

          {preview.status === "error" && (
            <>
              <div className="authx-kicker">// INVITE UNAVAILABLE</div>
              <h2 className="authx-title">Can't accept this invite</h2>
              <p className="authx-desc">{preview.message}</p>
              <Link to="/login" className="authx-back"><Icon name="chevL" size={14} />Back to sign in</Link>
            </>
          )}

          {preview.status === "ready" && (
            <>
              <div className="authx-kicker">// TEAM INVITE</div>
              <h2 className="authx-title">Join {preview.team_name}</h2>
              <p className="authx-desc">{preview.invited_by_name} invited <b style={{ color: "var(--text)" }}>{preview.email}</b> to collaborate.</p>

              {err && <div className="authx-err"><Icon name="plug" size={13} />{err}</div>}

              {session ? (
                <button className="authx-submit" disabled={busy} onClick={accept}>
                  {busy ? <Icon name="loader" size={16} className="spin" /> : <Icon name="check" size={16} />}
                  Accept invite
                </button>
              ) : (
                <>
                  <p className="authx-desc">Sign in or create an account with that email to accept.</p>
                  <button className="authx-submit" onClick={() => nav(`/login?next=${encodeURIComponent(`/invite/${token}`)}`)}>
                    <Icon name="zap" size={16} />Sign in / Sign up
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
