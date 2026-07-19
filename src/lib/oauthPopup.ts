/**
 * Shared "connect via OAuth popup" flow for GitHub/GitLab. Zoho's own OAuth
 * is a manual grant-code paste (no redirect URI anywhere in this codebase);
 * this is the newer redirect-based flow those two providers support. Opens a
 * popup pointed at the provider's authorize URL, waits for
 * src/routes/OAuthCallback.tsx (loaded inside that popup once the provider
 * redirects back) to postMessage the resulting code, and resolves once it
 * arrives.
 */
export function randomState(): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(36)).join("-");
}

export function openOAuthPopup(authorizeUrl: string, expectedState: string): Promise<{ code: string } | { error: string }> {
  return new Promise((resolve) => {
    // Open synchronously (before any await) so browsers don't treat it as a blocked popup.
    const popup = window.open("about:blank", "orbit-oauth", "width=520,height=680");
    if (!popup) { resolve({ error: "Popup blocked — allow popups for this site and try again." }); return; }
    popup.location.href = authorizeUrl;

    let settled = false;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      clearInterval(poll);
    };
    const finish = (result: { code: string } | { error: string }) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; code?: string; state?: string; error?: string } | null;
      if (!data || data.source !== "orbit-oauth") return;
      if (data.error) return finish({ error: data.error });
      if (data.state !== expectedState) return finish({ error: "State mismatch — please try connecting again." });
      if (!data.code) return finish({ error: "No authorization code returned." });
      finish({ code: data.code });
    }
    window.addEventListener("message", onMessage);
    const poll = setInterval(() => {
      if (popup.closed) finish({ error: "Connection window was closed before completing." });
    }, 500);
  });
}
