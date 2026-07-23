import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { Icon } from "../lib/icons";

interface Props { children: ReactNode }
interface State { error: Error | null }

/**
 * Last-resort catch for any render-time throw anywhere in the tree. Without
 * this, React unmounts the whole app on an uncaught render error and the
 * user sees a blank white screen with no way back except guessing to hit
 * refresh — the Beta Readiness Review's top Reliability/Error-recovery
 * finding, and RC1 task 1 in the release plan.
 *
 * Deliberately minimal: the fallback below has zero dependency on any React
 * context (Auth/Toast/Runtime/etc.) since any of those could be what threw.
 * Recovery is a hard reload, not an in-place retry — safer than risking a
 * re-render into the same broken state.
 *
 * Error reporting is NOT wired to Sentry here — `componentDidCatch` only
 * console.errors for now, matching this codebase's existing best-effort
 * logging convention elsewhere. Wiring Sentry (and reporting from here) is
 * the next RC1 task, not this one.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ORBIT] Unhandled render error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <ErrorFallback error={this.state.error} />;
  }
}

function ErrorFallback({ error }: { error: Error }) {
  const [copied, setCopied] = useState(false);

  function copyDetails() {
    const details = `${error.message}\n\n${error.stack ?? ""}`;
    navigator.clipboard?.writeText(details)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
      .catch(() => {});
  }

  return (
    <div className="center-load">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, maxWidth: 420, textAlign: "center", padding: 24 }}>
        <span style={{ color: "var(--red)" }}><Icon name="alert" size={32} /></span>
        <div style={{ fontFamily: "var(--display)", fontSize: 16, fontWeight: 600, color: "var(--text)" }}>Something went wrong</div>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          Orbit hit an unexpected error and can't continue safely. Reloading usually fixes it — your data is untouched.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn accent" onClick={() => window.location.reload()}>Reload Orbit</button>
          <button className="btn ghost" onClick={copyDetails}>{copied ? "Copied" : "Copy error details"}</button>
        </div>
      </div>
    </div>
  );
}
