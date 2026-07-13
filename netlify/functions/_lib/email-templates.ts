/**
 * Branded, table-based HTML email templates — inline styles only, since email
 * clients strip <style> rules in the body and ignore flex/grid/box-shadow.
 * Everything here is fluid tables + inline CSS for Gmail/Outlook/Apple Mail.
 *
 * Design: a single instrument card on a near-black ground with a faint mint
 * glow, echoing the login screen's orbit motif. Mint is the "proceed" accent
 * (verify/reset — actions the account owner asked for); amber is the
 * "notice" accent (login alerts — something happened, worth a glance).
 */
const BG = "#05060a";
const CARD = "#10131a";
const INSET = "#0a0c11";
const BORDER = "#21262f";
const BORDER_SOFT = "rgba(139,146,160,.14)";
const TEXT = "#ECEEF2";
const MUTED = "#8B92A0";
const DIM = "#565C68";
const MINT = "#37DFA0";
const AMBER = "#E4A951";

const SANS = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

interface Rendered { subject: string; html: string; text: string; }
type Tone = "mint" | "amber";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const toneColor = (t: Tone) => (t === "amber" ? AMBER : MINT);

/** The app's own orbit glyph (circle + tilted ellipse) — reused, not reinvented. */
function orbitMark(tone: Tone): string {
  const c = toneColor(tone);
  return `<svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="12" cy="12" rx="10" ry="4.3" fill="none" stroke="${c}" stroke-width="1.6" transform="rotate(-26 12 12)"/>
    <circle cx="12" cy="12" r="3.1" fill="${c}"/>
  </svg>`;
}

function eyebrow(label: string, tone: Tone): string {
  const c = toneColor(tone);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;"><tr>
    <td style="width:5px;height:5px;border-radius:1px;background:${c};font-size:0;line-height:0;">&nbsp;</td>
    <td style="padding-left:9px;font-family:${MONO};font-size:11px;letter-spacing:2.5px;color:${c};font-weight:700;">${label}</td>
  </tr></table>`;
}

function shell(preheader: string, tone: Tone, bodyHtml: string): string {
  const glow = tone === "amber" ? "rgba(228,169,81,.10)" : "rgba(55,223,160,.10)";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark light" />
<meta name="supported-color-schemes" content="dark light" />
<title>ORBIT</title>
<style>
  body,table,td,a{ -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table,td{ mso-table-lspace:0pt; mso-table-rspace:0pt; }
  body{ margin:0; padding:0; width:100% !important; background:${BG}; }
  a{ color:${toneColor(tone)}; text-decoration:none; }
  @media (max-width:600px){
    .container{ width:100% !important; border-radius:0 !important; }
    .px{ padding-left:24px !important; padding-right:24px !important; }
    .code{ font-size:30px !important; letter-spacing:8px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${BG};font-family:${SANS};">
  <div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG} url('') ;background:radial-gradient(560px 260px at 50% 0%, ${glow}, transparent 70%), ${BG};">
    <tr><td align="center" style="padding:48px 16px;">

      <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:22px;"><tr>
        <td>${orbitMark(tone)}</td>
        <td style="padding-left:9px;font-family:${MONO};font-size:15px;font-weight:700;letter-spacing:5px;color:${TEXT};">ORBIT</td>
      </tr></table>

      <table role="presentation" class="container" width="560" cellpadding="0" cellspacing="0"
        style="width:560px;max-width:560px;background:${CARD};border:1px solid ${BORDER};border-radius:14px;">
        <tr><td class="px" style="padding:40px 44px 36px;">
          ${bodyHtml}
        </td></tr>
      </table>

      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:560px;margin-top:22px;"><tr>
        <td class="px" style="font-family:${MONO};font-size:10.5px;letter-spacing:1px;color:${DIM};">
          ORBIT · SENT TO KEEP YOUR ACCOUNT SECURE — IF THIS WASN'T YOU, THIS MESSAGE IS SAFE TO IGNORE
        </td>
      </tr></table>

    </td></tr>
  </table>
</body>
</html>`;
}

function heading(title: string, sub: string): string {
  return `<h1 style="margin:0 0 10px;font-size:22px;line-height:1.3;color:${TEXT};font-family:${SANS};font-weight:600;letter-spacing:-.01em;">${title}</h1>
  <p style="margin:0;font-size:14px;line-height:1.65;color:${MUTED};max-width:400px;">${sub}</p>`;
}

function codeBox(code: string, tone: Tone): string {
  const c = toneColor(tone);
  const spaced = code.split("").join(" ");
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:26px 0 8px;"><tr>
    <td style="background:${INSET};border:1px solid ${BORDER};border-top:2px solid ${c};border-radius:10px;padding:24px 0;text-align:center;">
      <span class="code" style="font-family:${MONO};font-size:36px;font-weight:700;letter-spacing:10px;color:${c};font-variant-numeric:tabular-nums;">${spaced}</span>
    </td>
  </tr></table>
  <p style="margin:12px 0 0;font-family:${MONO};font-size:10.5px;letter-spacing:1.5px;color:${DIM};text-align:center;">EXPIRES IN 10 MINUTES</p>`;
}

function footNote(text: string): string {
  return `<p style="margin:26px 0 0;padding-top:22px;border-top:1px solid ${BORDER_SOFT};font-size:12.5px;line-height:1.65;color:${MUTED};">${text}</p>`;
}

function ctaButton(label: string, url: string, tone: Tone): string {
  const c = toneColor(tone);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 6px;"><tr>
    <td style="border-radius:9px;background:${c};">
      <a href="${url}" style="display:inline-block;padding:13px 26px;font-family:${SANS};font-size:14px;font-weight:600;color:${BG};text-decoration:none;">${esc(label)}</a>
    </td>
  </tr></table>
  <p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:${DIM};word-break:break-all;">Or paste this link into your browser:<br/><a href="${url}" style="color:${c};">${esc(url)}</a></p>`;
}

export function verifyEmail(name: string, code: string): Rendered {
  const first = esc((name || "").trim().split(" ")[0]);
  const subject = `${code} is your ORBIT verification code`;
  const body = `
    ${eyebrow("ACCOUNT VERIFICATION", "mint")}
    ${heading("Confirm your email", `Hi${first ? ` ${first}` : ""} — enter this code to finish setting up your ORBIT account.`)}
    ${codeBox(code, "mint")}
    ${footNote(`Didn't sign up for ORBIT? You can ignore this email — no account will be created.`)}
  `;
  return { subject, html: shell(`Your ORBIT verification code is ${code}`, "mint", body), text: `Your ORBIT verification code is ${code}. It expires in 10 minutes.` };
}

export function resetEmail(name: string, code: string): Rendered {
  const first = esc((name || "").trim().split(" ")[0]);
  const subject = `${code} is your ORBIT password reset code`;
  const body = `
    ${eyebrow("PASSWORD RESET", "mint")}
    ${heading("Reset your password", `Hi${first ? ` ${first}` : ""} — enter this code to choose a new password.`)}
    ${codeBox(code, "mint")}
    ${footNote(`If you didn't request a password reset, your password is still safe — just ignore this email.`)}
  `;
  return { subject, html: shell(`Your ORBIT password reset code is ${code}`, "mint", body), text: `Your ORBIT password reset code is ${code}. It expires in 10 minutes.` };
}

export function teamInviteEmail(inviterName: string, teamName: string, acceptUrl: string): Rendered {
  const inviter = esc((inviterName || "").trim()) || "Someone";
  const team = esc(teamName);
  const subject = `${inviter} invited you to join ${teamName} on ORBIT`;
  const body = `
    ${eyebrow("TEAM INVITE", "mint")}
    ${heading(`Join ${team} on ORBIT`, `${inviter} invited you to collaborate on their team. Accept to see and share tasks together.`)}
    ${ctaButton("Accept invite", acceptUrl, "mint")}
    ${footNote(`This invite was sent to your email address and expires in 7 days. If you weren't expecting this, you can ignore it — no account changes happen until the link is opened and accepted.`)}
  `;
  const text = `${inviter} invited you to join ${teamName} on ORBIT.\n\nAccept: ${acceptUrl}\n\nThis invite expires in 7 days. If you weren't expecting this, you can ignore it.`;
  return { subject, html: shell(subject, "mint", body), text };
}

export function loginAlertEmail(name: string, info: { time: string; ip: string; location: string; device: string }): Rendered {
  const first = esc((name || "").trim().split(" ")[0]);
  const subject = "New sign-in to your ORBIT account";
  const row = (label: string, value: string, mono: boolean, first: boolean) => `<tr>
    <td style="padding:${first ? "0 0 13px" : "13px 0"};${first ? "" : `border-top:1px solid ${BORDER_SOFT};`}font-family:${MONO};font-size:10.5px;letter-spacing:1.5px;color:${DIM};width:112px;vertical-align:top;">${label}</td>
    <td style="padding:${first ? "0 0 13px" : "13px 0"};${first ? "" : `border-top:1px solid ${BORDER_SOFT};`}font-size:14px;color:${TEXT};font-family:${mono ? MONO : SANS};font-variant-numeric:tabular-nums;">${esc(value)}</td>
  </tr>`;
  const body = `
    ${eyebrow("SIGN-IN ALERT", "amber")}
    ${heading("New sign-in detected", `Hi${first ? ` ${first}` : ""} — your ORBIT account was just signed into.`)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 4px;">
      ${row("TIME", info.time, true, true)}
      ${row("LOCATION", info.location, false, false)}
      ${row("IP ADDRESS", info.ip, true, false)}
      ${row("DEVICE", info.device, false, false)}
    </table>
    ${footNote(`If this was you, there's nothing else to do. If you don't recognize this activity, reset your password right away from the ORBIT login screen.`)}
  `;
  const text = `New sign-in to your ORBIT account\nTime: ${info.time}\nLocation: ${info.location}\nIP: ${info.ip}\nDevice: ${info.device}\n\nIf this wasn't you, reset your password from the ORBIT login screen.`;
  return { subject, html: shell(subject, "amber", body), text };
}
