import { useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { OrbitLoader } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/Toast";
import { readImageAsDataUrl, MAX_IMAGE_BYTES, fmtBytes } from "../lib/imageUpload";

// Mirrors the limits enforced server-side in netlify/functions/auth.ts's
// "update-profile" action — kept in sync by hand since nothing here shares a
// build step with the Netlify functions.
const FULL_NAME_MAX = 80;
const JOB_TITLE_MAX = 80;
const PHONE_MAX = 30;
const PHONE_RE = /^[0-9+()\-.\s]*$/;

interface Touched { name?: boolean; phone?: boolean }

export default function Profile() {
  const { user, loading, updateProfile } = useAuth();
  const nav = useNavigate();
  const toast = useToast();

  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [jobTitle, setJobTitle] = useState(user?.job_title ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [avatar, setAvatar] = useState<string | null>(user?.avatar_data_url ?? null);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState<Touched>({});
  const fileRef = useRef<HTMLInputElement>(null);

  if (loading || !user) {
    return <main className="page"><div className="page-loader"><OrbitLoader label="Loading profile…" /></div></main>;
  }

  const displayName = fullName.trim() || user.full_name || user.email.split("@")[0];
  const initials = displayName.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  const dirty = fullName.trim() !== (user.full_name ?? "")
    || jobTitle.trim() !== (user.job_title ?? "")
    || phone.trim() !== (user.phone ?? "")
    || avatar !== (user.avatar_data_url ?? null);

  const nameError = fullName.trim().length === 0
    ? "Enter your name."
    : fullName.trim().length > FULL_NAME_MAX ? `Keep it under ${FULL_NAME_MAX} characters.` : null;
  const jobTitleError = jobTitle.trim().length > JOB_TITLE_MAX ? `Keep it under ${JOB_TITLE_MAX} characters.` : null;
  const phoneError = phone.trim().length > PHONE_MAX
    ? `Keep it under ${PHONE_MAX} characters.`
    : phone.trim().length > 0 && !PHONE_RE.test(phone.trim()) ? "Digits, spaces, and + - ( ) only." : null;

  const canSave = dirty && !saving && !avatarLoading && !nameError && !jobTitleError && !phoneError;

  function discardChanges() {
    setFullName(user!.full_name ?? "");
    setJobTitle(user!.job_title ?? "");
    setPhone(user!.phone ?? "");
    setAvatar(user!.avatar_data_url ?? null);
    setTouched({});
  }

  async function onPickAvatar(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAvatarLoading(true);
    const res = await readImageAsDataUrl(file);
    setAvatarLoading(false);
    if (!res.ok) { toast(res.error); return; }
    setAvatar(res.dataUrl);
  }

  async function save() {
    setTouched({ name: true, phone: true });
    if (nameError || jobTitleError || phoneError) { toast(nameError || jobTitleError || phoneError || "Fix the highlighted fields"); return; }
    setSaving(true);
    const res = await updateProfile({ full_name: fullName.trim(), job_title: jobTitle.trim(), phone: phone.trim(), avatar_data_url: avatar });
    setSaving(false);
    if (res.error) { toast(`Couldn't save: ${res.error}`); return; }
    toast("Profile updated");
    setTouched({});
  }

  return (
    <main className="page">
      <div className="rowhead">
        <div>
          <div className="h1">Profile</div>
          <div className="sub">Your personal details — shown next to your work across ORBIT.</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 20, padding: "28px 32px", display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flexShrink: 0 }}>
          {avatar
            ? <img src={avatar} alt="" style={{ width: 84, height: 84, borderRadius: "50%", objectFit: "cover", border: "1px solid var(--border-soft)", display: "block" }} />
            : <span className="avatar" style={{ width: 84, height: 84, borderRadius: "50%", fontSize: 30 }}>{initials}</span>}
          {avatarLoading && (
            <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "rgba(6,9,14,.6)", display: "grid", placeItems: "center" }}>
              <Icon name="loader" size={20} className="spin" />
            </span>
          )}
          <button
            className="iconbtn" title="Change photo" onClick={() => fileRef.current?.click()} disabled={avatarLoading}
            style={{ position: "absolute", bottom: -2, right: -2, width: 28, height: 28, borderRadius: "50%", background: "var(--raised2)", border: "1px solid var(--border)" }}
          >
            <Icon name="edit" size={12} />
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickAvatar} />
        </div>

        <div style={{ flex: "1 1 220px", minWidth: 200 }}>
          <div style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 700, letterSpacing: "-.2px" }}>{displayName}</div>
          <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 3 }}>{jobTitle.trim() || "No job title set"}</div>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginTop: 12, fontSize: 13, color: "var(--text2)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Icon name="mail" size={13} />{user.email}</span>
            {user.email_verified && (
              <span className="pill live" style={{ fontSize: 11 }}><Icon name="checkc" size={11} />Verified</span>
            )}
          </div>
        </div>

        {avatar && <button className="btn ghost" onClick={() => setAvatar(null)} disabled={avatarLoading}>Remove photo</button>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 20, marginTop: 20, alignItems: "start" }}>
        <div className="card" style={{ padding: 24, minWidth: 0 }}>
          <div className="eyebrow">Personal information</div>

          <div className="fld">
            <label style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Full name</span>
              <span style={{ color: "var(--dim)" }}>{fullName.length}/{FULL_NAME_MAX}</span>
            </label>
            <input
              value={fullName} maxLength={FULL_NAME_MAX} placeholder="Your name"
              onChange={(e) => setFullName(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, name: true }))}
              onKeyDown={(e) => e.key === "Enter" && canSave && save()}
              style={touched.name && nameError ? { borderColor: "var(--red)" } : undefined}
              autoComplete="name"
            />
            {touched.name && nameError && <div style={{ fontSize: 11, color: "var(--red)", marginTop: 6 }}>{nameError}</div>}
          </div>

          <div className="fld">
            <label style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Job title <span style={{ color: "var(--dim)" }}>optional</span></span>
              <span style={{ color: "var(--dim)" }}>{jobTitle.length}/{JOB_TITLE_MAX}</span>
            </label>
            <input value={jobTitle} maxLength={JOB_TITLE_MAX} placeholder="e.g. Frontend Engineer" onChange={(e) => setJobTitle(e.target.value)} autoComplete="organization-title" />
            {jobTitleError && <div style={{ fontSize: 11, color: "var(--red)", marginTop: 6 }}>{jobTitleError}</div>}
          </div>

          <div className="fld">
            <label>Phone number <span style={{ color: "var(--dim)" }}>optional</span></label>
            <input
              value={phone} maxLength={PHONE_MAX} placeholder="e.g. +1 555 0100"
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
              onKeyDown={(e) => e.key === "Enter" && canSave && save()}
              style={touched.phone && phoneError ? { borderColor: "var(--red)" } : undefined}
              autoComplete="tel"
            />
            {touched.phone && phoneError && <div style={{ fontSize: 11, color: "var(--red)", marginTop: 6 }}>{phoneError}</div>}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 22 }}>
            {dirty && !saving && <button className="btn ghost" onClick={discardChanges}>Discard changes</button>}
            <button className="btn-primary" onClick={save} disabled={!canSave} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              {saving && <Icon name="loader" size={14} className="spin" />}{saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
          <div className="card" style={{ padding: 24 }}>
            <div className="eyebrow">Account</div>
            <div className="setrow" style={{ padding: "14px 0", borderTop: "none" }}>
              <div className="l"><div className="nm">{user.email}</div><div className="ds">{user.email_verified ? "Verified · sign-in email" : "Sign-in email"}</div></div>
            </div>
            <div className="setrow">
              <div className="l"><div className="nm">Password &amp; sign-out</div><div className="ds">Managed from Settings.</div></div>
              <button className="btn ghost" onClick={() => nav("/settings")}>Open Settings</button>
            </div>
          </div>

          <div className="card" style={{ padding: 24 }}>
            <div className="eyebrow">Photo guidelines</div>
            <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10, lineHeight: 1.6 }}>
              Square images work best. PNG, JPG, GIF or WEBP, up to {fmtBytes(MAX_IMAGE_BYTES)}.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
