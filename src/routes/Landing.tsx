import { useEffect } from "react";

// In production the static marketing page (public/landing.html) is served at "/"
// via _redirects. This route only renders if the SPA is hit at "/" directly
// (e.g. local dev), and simply forwards to that page.
export default function Landing() {
  useEffect(() => { window.location.replace("/landing.html"); }, []);
  return <div className="center-load">Loading ORBIT…</div>;
}
