import { useEffect } from "react";

/**
 * Landing page for GitHub/GitLab's OAuth redirect — only ever opened inside
 * the popup window created by src/lib/oauthPopup.ts. Relays `code`/`state`/
 * `error` back to the opener via postMessage, then closes itself. Registered
 * outside <Guard> in App.tsx since it only reads its own query string — no
 * Supabase/agent access needed here.
 */
export default function OAuthCallback() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payload = {
      source: "orbit-oauth",
      code: params.get("code") || undefined,
      state: params.get("state") || undefined,
      error: params.get("error_description") || params.get("error") || undefined,
    };
    try {
      window.opener?.postMessage(payload, window.location.origin);
    } finally {
      window.close();
    }
  }, []);
  return <div className="center-load">Connecting…</div>;
}
