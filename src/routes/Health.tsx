import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { useOffline } from "../context/Offline";
import { useIntegrationHealth } from "../hooks/useIntegrationHealth";
import { HealthTile } from "../components/HealthTile";
import { askLocalAI } from "../lib/ai";

export default function Health() {
  const nav = useNavigate();
  const { online } = useOffline();
  const { health, refresh, loading } = useIntegrationHealth();
  const [pgOpen, setPgOpen] = useState(false);
  const [localAi, setLocalAi] = useState<{ busy: boolean; ok: boolean | null; message: string | null }>({ busy: false, ok: null, message: null });

  async function testLocalAi() {
    setLocalAi({ busy: true, ok: null, message: null });
    const r = await askLocalAI("Reply with only the word: ready.");
    setLocalAi({ busy: false, ok: r.ok, message: r.ok ? (r.text || "").trim() : r.error || "Couldn't reach the local model" });
  }

  return (
    <main className="page">
      <div className="rowhead">
        <div><div className="h1">Health</div><div className="sub">Every integration ORBIT relies on, at a glance.</div></div>
        <button className="btn ghost" disabled={loading} onClick={refresh}><Icon name="refresh" size={15} />{loading ? "Checking…" : "Recheck all"}</button>
      </div>

      {!online && (
        <div className="offline-alert" style={{ borderRadius: 10, marginTop: 16 }}>
          <Icon name="wifiOff" size={15} />
          <span>You're offline — these statuses are from before the connection dropped.</span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12, marginTop: 20 }}>
        <HealthTile
          icon="plug" label="Local agent" state={health.agent.state}
          sub={`${health.agent.label} — launches IDEs, runs git/Docker, powers break chores.`}
          cta={{ label: "Fix in Settings", onClick: () => nav("/settings?section=agent") }}
        />
        <HealthTile
          icon="sprint" label="Zoho Sprints" state={health.zoho.state}
          sub={`${health.zoho.label} — projects, sprints, items and hours.`}
          cta={{ label: health.zoho.state === "unknown" ? "Set up in onboarding" : "Fix in Settings", onClick: () => nav(health.zoho.state === "unknown" ? "/onboarding" : "/settings?section=zoho") }}
        />
        <HealthTile
          icon="mail" label="Gmail" state={health.gmail.state}
          sub={health.gmail.configured ? "Keys saved — read-only inbox over IMAP." : "Not configured — open Mail won't connect until this is set up."}
          cta={{ label: "Set up", onClick: () => nav("/settings?section=gmail") }}
        />
        <HealthTile
          icon="github" label="GitHub" state={health.providers.github.state}
          sub={`${health.providers.github.label} — repos, pull requests and Actions status.`}
          cta={{ label: "Set up", onClick: () => nav("/settings?section=github") }}
        />
        <HealthTile
          icon="gitlab" label="GitLab" state={health.providers.gitlab.state}
          sub={`${health.providers.gitlab.label} — projects, merge requests and pipelines.`}
          cta={{ label: "Set up", onClick: () => nav("/settings?section=gitlab") }}
        />
        <HealthTile
          icon="azuredevops" label="Azure DevOps" state={health.providers.azuredevops.state}
          sub={`${health.providers.azuredevops.label} — repos, pull requests and builds.`}
          cta={{ label: "Set up", onClick: () => nav("/settings?section=azuredevops") }}
        />
        <HealthTile
          icon="msteams" label="Microsoft Teams" state={health.providers.msteams.state}
          sub={`${health.providers.msteams.label} — create meeting links from Calendar events.`}
          cta={{ label: "Set up", onClick: () => nav("/settings?section=msteams") }}
        />
        <HealthTile
          icon="alert" label="Sentry" state={health.providers.sentry.state}
          sub={`${health.providers.sentry.label} — unresolved issues and releases.`}
          cta={{ label: "Set up", onClick: () => nav("/settings?section=sentry") }}
        />
        <HealthTile
          icon="cloud" label="Cloud" state={
            [health.providers.netlify.state, health.providers.vercel.state, health.providers.aws.state].some((s) => s === "ok") ? "ok"
            : [health.providers.netlify.state, health.providers.vercel.state, health.providers.aws.state].every((s) => s === "unknown") ? "unknown"
            : "warn"
          }
          sub={`Netlify: ${health.providers.netlify.label} · Vercel: ${health.providers.vercel.label} · AWS: ${health.providers.aws.label}`}
          cta={{ label: "Set up", onClick: () => nav("/settings?section=cloud") }}
        />
        <HealthTile
          icon="container" label="Docker" state={health.docker.state}
          sub={health.agent.state !== "ok" ? "Needs the local agent running." : health.docker.available ? `Connected — ${health.docker.count} container${health.docker.count === 1 ? "" : "s"} running.` : "Docker Desktop not detected."}
          cta={{ label: "Fix in Settings", onClick: () => nav("/settings?section=docker") }}
        />
        <HealthTile
          icon="db" label="Postgres" state={health.postgres.state}
          sub={health.postgres.servers.length === 0 ? "No servers saved yet." : `${health.postgres.servers.filter((s) => s.ok).length} of ${health.postgres.servers.length} server${health.postgres.servers.length === 1 ? "" : "s"} reachable.`}
          cta={{ label: "Manage in Settings", onClick: () => nav("/settings?section=postgres") }}
        >
          {health.postgres.servers.length > 0 && (
            <>
              <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setPgOpen((o) => !o)}>
                <Icon name={pgOpen ? "chevL" : "chevR"} size={13} />{pgOpen ? "Hide servers" : "Show servers"}
              </button>
              {pgOpen && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                  {health.postgres.servers.map((s) => (
                    <div key={s.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--dim)" }}>
                      <span>{s.name}</span>
                      <span style={{ color: s.ok ? "var(--mint)" : "var(--red)" }}>{s.ok ? "OK" : s.error || "Unreachable"}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </HealthTile>
        <HealthTile
          icon="sparkles" label="Local AI" state={localAi.ok === true ? "ok" : localAi.ok === false ? "warn" : "unknown"}
          sub="Free, no key — runs on this machine via the local agent. First run downloads a small model."
        >
          <button className="btn ghost" style={{ marginTop: 10 }} disabled={localAi.busy} onClick={testLocalAi}>
            {localAi.busy ? <><Icon name="loader" size={14} className="spin" />Testing…</> : <><Icon name="play" size={13} fill />Test</>}
          </button>
          {localAi.ok === true && <div style={{ marginTop: 8, fontSize: 12, color: "var(--mint)" }}>Working — replied: "{localAi.message}"</div>}
          {localAi.ok === false && <div style={{ marginTop: 8, fontSize: 12, color: "var(--red)" }}>{localAi.message}</div>}
        </HealthTile>
        <HealthTile
          icon="key" label="Anthropic key" state={health.anthropic.state}
          sub={health.anthropic.state === "ok" ? "Set — powers schema Q&A, ticket triage, and standup summaries." : "Not set — optional, the local model covers the same features for free."}
          cta={{ label: "Set up", onClick: () => nav("/settings?section=ai") }}
        />
      </div>

      <div style={{ marginTop: 20 }}>
        <button className="btn ghost" onClick={() => nav("/audit")}><Icon name="activity" size={15} />View audit log</button>
      </div>
    </main>
  );
}
