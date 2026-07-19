import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { Select } from "../components/Select";
import { ACCENT } from "../components/ui";
import { useAgent } from "../context/Agent";
import { useZoho } from "../context/Zoho";
import { useToast } from "../context/Toast";
import { useAuth } from "../context/AuthContext";
import { useSignOutGuard } from "../hooks/useSignOutGuard";
import { useTimezone, allZones, tzOffset, tzClock, deviceTz } from "../context/Timezone";
import { useBreak } from "../context/Break";
import { useTheme, THEMES, ACCENTS, FONTS, DENSITIES, type ThemeId, type AccentId, type FontId, type DensityId } from "../context/Theme";
import { useDashboardLayout } from "../hooks/useDashboardLayout";
import { DASH_TILES } from "../lib/dashboardLayout";
import { recordAudit } from "../lib/audit";
import { fetchDocker } from "../lib/agent";
import { ORBIT_AGENT_DOWNLOAD_URL } from "../lib/downloads";
import { pgServers, pgDeleteServer, type PgServer } from "../lib/pg";
import { PgServerModal } from "../components/PgServerModal";
import { ChoresCard } from "../components/ChoresCard";
import { ZohoSetupPanel } from "../components/ZohoSetupPanel";
import { GmailSetupPanel } from "../components/GmailSetupPanel";
import { AiKeySetupPanel } from "../components/AiKeySetupPanel";
import { GithubSetupPanel } from "../components/GithubSetupPanel";
import { GitlabSetupPanel } from "../components/GitlabSetupPanel";
import { AzureDevopsSetupPanel } from "../components/AzureDevopsSetupPanel";
import { MicrosoftTeamsSetupPanel } from "../components/MicrosoftTeamsSetupPanel";
import { LinkedProjectsPanel } from "../components/LinkedProjectsPanel";
import { useTable } from "../hooks/useTable";
import type { Project } from "../lib/types";
import { SentrySetupPanel } from "../components/SentrySetupPanel";
import { CloudSetupPanel } from "../components/CloudSetupPanel";
import { useIntegrationHealth } from "../hooks/useIntegrationHealth";
import { fetchSettings } from "../lib/settings";

type SectionId = "account" | "appearance" | "agent" | "zoho" | "gmail" | "github" | "gitlab" | "azuredevops" | "msteams" | "sentry" | "cloud" | "postgres" | "docker" | "chores" | "ai" | "integrations" | "data";
// Non-interactive group labels rendered above the section they precede in the
// Settings side-rail — purely visual, keeps SECTIONS' data shape unchanged.
const SECTION_GROUPS: Partial<Record<SectionId, string>> = {
  account: "General", zoho: "Integrations", postgres: "Local", chores: "Automation", data: "Data",
};
const SECTIONS: { id: SectionId; label: string; icon: string; desc: string }[] = [
  { id: "account", label: "Account", icon: "user", desc: "Identity, timezone and session" },
  { id: "appearance", label: "Appearance", icon: "palette", desc: "Theme and dashboard layout" },
  { id: "agent", label: "Local agent", icon: "plug", desc: "The companion service on this machine" },
  { id: "zoho", label: "Zoho Sprints", icon: "sprint", desc: "Projects, sprints, items and hours" },
  { id: "gmail", label: "Gmail", icon: "mail", desc: "Read-only inbox over IMAP" },
  { id: "github", label: "GitHub", icon: "github", desc: "Repos, pull requests and Actions status" },
  { id: "gitlab", label: "GitLab", icon: "gitlab", desc: "Projects, merge requests and pipelines" },
  { id: "azuredevops", label: "Azure DevOps", icon: "azuredevops", desc: "Repos, pull requests and builds" },
  { id: "msteams", label: "Microsoft Teams", icon: "msteams", desc: "Create meeting links from Calendar events" },
  { id: "sentry", label: "Sentry", icon: "alert", desc: "Unresolved issues and releases" },
  { id: "cloud", label: "Cloud", icon: "cloud", desc: "Netlify, Vercel and AWS cost/status" },
  { id: "postgres", label: "PostgreSQL", icon: "db", desc: "Servers you can browse and query" },
  { id: "docker", label: "Docker", icon: "container", desc: "Containers and images" },
  { id: "chores", label: "Break chores", icon: "zap", desc: "What the agent does while you sip" },
  { id: "ai", label: "AI-assisted seeding", icon: "sparkles", desc: "Project-aware dummy data via Claude" },
  { id: "integrations", label: "IDE & tools", icon: "layers", desc: "Local executable names for launching" },
  { id: "data", label: "Data & security", icon: "shield", desc: "Where everything is stored" },
];
const SECTIONS_IDS = new Set<string>(SECTIONS.map((s) => s.id));

export default function Settings() {
  const toast = useToast();
  const nav = useNavigate();
  const { user } = useAuth();
  const { status, url, updateUrl, recheck } = useAgent();
  const { requestSignOut, signOutGuardModal } = useSignOutGuard();
  const { idleEnabled, idleMinutes, setIdlePrefs } = useBreak();
  const zoho = useZoho();
  const { rows: projects } = useTable<Project>("projects");
  const [searchParams] = useSearchParams();
  const [section, setSection] = useState<SectionId>(() => {
    const s = searchParams.get("section");
    return (SECTIONS_IDS.has(s || "") ? s : "account") as SectionId;
  });
  const [draft, setDraft] = useState(url);
  const [docker, setDocker] = useState<{ available: boolean; count: number } | null>(null);
  const [dockerChecking, setDockerChecking] = useState(false);
  const [onboardedAt, setOnboardedAt] = useState<string | null | undefined>(undefined);
  const { health } = useIntegrationHealth();

  useEffect(() => { fetchSettings().then((s) => setOnboardedAt(s.onboarded_at ?? null)); }, []);

  const { theme, setTheme, accent, customAccentHex, setAccent, font, setFont, density, setDensity } = useTheme();
  const { layout, toggleHidden, reset: resetLayout, isDefault: layoutIsDefault } = useDashboardLayout();

  const { tz, setTz } = useTimezone();
  const zones = useMemo(() => allZones(), []);
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNowTick(Date.now()), 1000); return () => clearInterval(t); }, []);

  const [pgList, setPgList] = useState<PgServer[]>([]);
  const [pgAddOpen, setPgAddOpen] = useState(false);
  const [pgEditing, setPgEditing] = useState<PgServer | null>(null);
  const loadPg = () => { pgServers().then((r) => setPgList(r.servers)); };
  useEffect(() => { loadPg(); }, []);

  async function checkDocker() {
    if (status !== "online") { setDocker(null); return; }
    setDockerChecking(true);
    const d = await fetchDocker();
    setDocker({ available: d.available, count: d.containers.length });
    setDockerChecking(false);
  }
  useEffect(() => { checkDocker(); }, [status]); // eslint-disable-line

  const agentPill = status === "online"
    ? <span className="pill live"><Icon name="zap" size={15} />Connected<span className="dotled" /></span>
    : status === "disconnected"
      ? <span className="pill warn"><Icon name="plug" size={15} />Disconnected<span className="dotled warn" /></span>
      : <span className="pill"><Icon name="plug" size={15} />Offline<span className="dotled" /></span>;

  // Thin adapter over useIntegrationHealth() — the single source of truth also
  // used by the Health page, so the two can't silently disagree.
  const railState = (id: SectionId): "ok" | "warn" | null => {
    if (id === "agent") return health.agent.state === "ok" ? "ok" : "warn";
    if (id === "zoho") return health.zoho.state === "ok" ? "ok" : health.zoho.state === "unknown" ? null : "warn";
    if (id === "gmail") return health.gmail.configured ? "ok" : null;
    if (id === "docker") return status !== "online" ? null : docker?.available ? "ok" : "warn";
    if (id === "postgres") return health.postgres.state === "unknown" ? null : health.postgres.state;
    if (id === "ai") return health.anthropic.state === "ok" ? "ok" : null;
    if (id === "github" || id === "gitlab" || id === "azuredevops" || id === "sentry") {
      const st = health.providers[id].state;
      return st === "unknown" ? null : st;
    }
    if (id === "cloud") {
      const states = (["netlify", "vercel", "aws"] as const).map((p) => health.providers[p].state);
      if (states.every((s) => s === "unknown")) return null;
      return states.some((s) => s === "ok") ? "ok" : "warn";
    }
    return null;
  };

  const meta = SECTIONS.find((s) => s.id === section) as (typeof SECTIONS)[number];

  return (
    <main className="page set-page">
      <div className="h1">Settings</div>
      <div className="sub">Wire up the agent, your integrations, and your data.</div>

      <div className="set-shell">
        <nav className="set-rail">
          {SECTIONS.map((s) => {
            const st = railState(s.id);
            const groupLabel = SECTION_GROUPS[s.id];
            return (
              <div key={s.id}>
                {groupLabel && <div className="set-rail-group-label">{groupLabel}</div>}
                <button className={"set-navitem" + (section === s.id ? " on" : "")} onClick={() => setSection(s.id)}>
                  <span className="sn-ic"><Icon name={s.icon} size={16} /></span>
                  <span className="sn-label">{s.label}</span>
                  {st && <span className={"sn-dot " + st} />}
                </button>
              </div>
            );
          })}
        </nav>

        <section className="set-body">
          <div className="set-head">
            <div>
              <div className="set-title">{meta.label}</div>
              <div className="set-desc">{meta.desc}</div>
            </div>
            {section === "agent" && agentPill}
          </div>

          {section === "account" && (
            <>
              <div className="card">
                <div className="setrow"><div className="l"><div className="nm">{user?.email}</div><div className="ds">{user?.email_verified ? "Verified · signed in with your ORBIT account" : "Signed in with your ORBIT account"}</div></div>
                  <button className="btn ghost" onClick={requestSignOut}><Icon name="logout" size={15} />Sign out</button></div>
              </div>
              <div className="card" style={{ marginTop: 12 }}>
                <div className="setrow">
                  <div className="l"><div className="nm">Setup guide</div><div className="ds">Walk through connecting the local agent, Zoho, Gmail, and an AI key — the same steps from first sign-up.</div></div>
                  <button className="btn" onClick={() => nav("/onboarding?next=/settings")}><Icon name="rocket" size={15} />{onboardedAt ? "Redo setup" : "Continue setup"}</button>
                </div>
                <div className="setrow">
                  <div className="l"><div className="nm">System health</div><div className="ds">See every integration's status — agent, Zoho, Gmail, Docker, Postgres, and AI — in one place.</div></div>
                  <button className="btn ghost" onClick={() => nav("/health")}><Icon name="checkc" size={15} />View health page</button>
                </div>
              </div>
              <div className="card" style={{ marginTop: 12 }}>
                <div className="setrow">
                  <div className="l"><div className="nm">Display timezone</div><div className="ds">Clocks, greetings and timestamps across ORBIT follow this zone. Defaults to your device{tz === deviceTz() ? " (in use)" : ""}.</div></div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ textAlign: "right" }}>
                      <div className="mono" style={{ fontSize: 18, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{tzClock(tz, new Date(nowTick))}</div>
                      <div className="mono" style={{ fontSize: 11, color: "var(--dim)" }}>{tzOffset(tz)}</div>
                    </div>
                    <Select className="field" value={tz} onChange={(e) => { setTz(e.target.value); toast("Timezone updated"); }} style={{ minWidth: 240 }}>
                      {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
                    </Select>
                  </div>
                </div>
                {tz !== deviceTz() && (
                  <div className="setrow"><div className="l"><div className="nm">Reset to device timezone</div><div className="ds">Follow this machine's zone ({deviceTz().replace(/_/g, " ")}) again.</div></div>
                    <button className="btn ghost" onClick={() => { setTz(deviceTz()); toast("Using device timezone"); }}><Icon name="refresh" size={15} />Use device</button></div>
                )}
              </div>
              <div className="card" style={{ marginTop: 12 }}>
                <div className="setrow">
                  <div className="l"><div className="nm">Idle detection</div><div className="ds">Auto-pause the focus timer after no activity on this tab — browser-tab-based only (won't notice you're idle here but active elsewhere, e.g. coding in your editor).</div></div>
                  <span className={"toggle" + (idleEnabled ? " on" : "")} onClick={() => setIdlePrefs(!idleEnabled, idleMinutes)} />
                </div>
                {idleEnabled && (
                  <div className="setrow">
                    <div className="l"><div className="nm">Idle threshold</div><div className="ds">Pause after this many minutes of no mouse/keyboard activity.</div></div>
                    <Select className="field" value={String(idleMinutes)} onChange={(e) => setIdlePrefs(true, Number(e.target.value))} style={{ width: 120 }}>
                      {[5, 10, 15, 20, 30].map((m) => <option key={m} value={m}>{m} min</option>)}
                    </Select>
                  </div>
                )}
              </div>
            </>
          )}

          {section === "appearance" && (
            <>
              <div className="theme-grid">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    className={"theme-card" + (theme === t.id ? " on" : "")}
                    onClick={() => { setTheme(t.id as ThemeId); toast(`Theme: ${t.label}`); }}
                  >
                    <span className={"theme-swatch sw-" + t.id}>
                      <span className="ts-rail" /><span className="ts-body"><span className="ts-card" /><span className="ts-card" /></span>
                    </span>
                    <span className="theme-meta">
                      <span className="theme-name">
                        <Icon name={t.icon} size={14} />
                        {t.label}
                        {theme === t.id && <span className="theme-tick"><Icon name="check" size={13} /></span>}
                      </span>
                      <span className="theme-desc">{t.desc}</span>
                    </span>
                  </button>
                ))}
              </div>

              <div className="card" style={{ marginTop: 12 }}>
                <div className="setrow">
                  <div className="l"><div className="nm">Accent colour</div>
                    <div className="ds">The hue used for buttons, live indicators and highlights — independent of light/dark.</div></div>
                  <div className="accent-row">
                    {ACCENTS.map((a) => a.id === "custom" ? (
                      <label key={a.id} className={"accent-swatch custom" + (accent === "custom" ? " on" : "")} title="Custom colour"
                        style={accent === "custom" ? { background: customAccentHex } : undefined}>
                        {accent !== "custom" && <Icon name="palette" size={13} />}
                        <input type="color" value={customAccentHex} onChange={(e) => setAccent("custom", e.target.value)} />
                      </label>
                    ) : (
                      <button key={a.id} className={"accent-swatch" + (accent === a.id ? " on" : "")} style={{ background: a.swatch }}
                        title={a.label} onClick={() => { setAccent(a.id); toast(`Accent: ${a.label}`); }}>
                        {accent === a.id && <Icon name="check" size={13} />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="card" style={{ marginTop: 12 }}>
                <div className="setrow">
                  <div className="l"><div className="nm">Font</div>
                    <div className="ds">{FONTS.find((f) => f.id === font)?.desc}</div></div>
                  <div className="pill-row">
                    {FONTS.map((f) => (
                      <button key={f.id} className={"pill-opt" + (font === f.id ? " on" : "")}
                        onClick={() => { setFont(f.id as FontId); toast(`Font: ${f.label}`); }}>{f.label}</button>
                    ))}
                  </div>
                </div>
                <div className="setrow">
                  <div className="l"><div className="nm">Density</div>
                    <div className="ds">{DENSITIES.find((d) => d.id === density)?.desc}</div></div>
                  <div className="pill-row">
                    {DENSITIES.map((d) => (
                      <button key={d.id} className={"pill-opt" + (density === d.id ? " on" : "")}
                        onClick={() => { setDensity(d.id as DensityId); toast(`Density: ${d.label}`); }}>{d.label}</button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="card" style={{ marginTop: 12 }}>
                <div className="setrow">
                  <div className="l"><div className="nm">Dashboard tiles</div>
                    <div className="ds">Choose which stat tiles appear. Drag them into the order you want with <b>Customise</b> on the dashboard itself.</div></div>
                  {!layoutIsDefault && <button className="btn ghost" onClick={() => { resetLayout(); toast("Layout reset"); }}><Icon name="refresh" size={15} />Reset</button>}
                </div>
                {DASH_TILES.map((t) => {
                  const off = layout.hidden.includes(t.id);
                  return (
                    <div key={t.id} className="setrow">
                      <div className="l"><div className="nm" style={{ opacity: off ? .5 : 1 }}>{t.label}</div>
                        <div className="ds">{off ? "Hidden from the dashboard" : `Position ${layout.order.indexOf(t.id) + 1} of ${layout.order.length}`}</div></div>
                      <button className={"btn ghost" + (off ? "" : " accent")} onClick={() => toggleHidden(t.id)}>
                        <Icon name={off ? "eyeOff" : "eye"} size={15} />{off ? "Hidden" : "Shown"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {section === "agent" && (
            <>
              {status !== "online" && (
                <div className="card">
                  <div className="setrow">
                    <div className="l"><div className="nm">Download the ORBIT Agent</div><div className="ds">The desktop companion that gives ORBIT hands on this machine — launches IDEs, runs git/Docker, and connects automatically. Windows, single file, no install.</div></div>
                    <a className="btn accent" href={ORBIT_AGENT_DOWNLOAD_URL}><Icon name="download" size={15} />Download for Windows</a>
                  </div>
                  <div className="setrow"><div className="l"><div className="ds">Double-click <code className="mono">orbit.exe</code> to run it — no install, no console window. It opens a status page in your browser and ORBIT connects automatically within a few seconds.</div></div></div>
                </div>
              )}
              <div className="card" style={{ marginTop: status !== "online" ? 12 : 0 }}>
                <div className="setrow"><div className="l"><div className="nm">Companion agent</div><div className="ds">Background service that launches IDEs, runs git and Docker, and powers break chores. It polls automatically and connects the moment it's running.</div></div>
                  {agentPill}</div>
                <div className="setrow"><div className="l"><div className="nm">Agent URL</div><div className="ds mono" style={{ fontSize: 11.5 }}>default http://localhost:47600</div></div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input className="field mono" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ minWidth: 240 }} />
                    <button className="btn" onClick={() => { updateUrl(draft); recordAudit({ action: "integration.update", entityType: "integration", entityId: "agent_url" }); toast("Agent URL saved"); }}>Save</button>
                    <button className="btn" onClick={() => { recheck(); toast("Checking agent…"); }}><Icon name="refresh" size={15} />Test</button>
                  </div></div>
              </div>
            </>
          )}

          {section === "zoho" && <ZohoSetupPanel />}

          {section === "gmail" && <GmailSetupPanel />}

          {section === "github" && (
            <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
              <div style={{ flex: "2 1 420px" }}><GithubSetupPanel /></div>
              <LinkedProjectsPanel provider="github" label="GitHub" projects={projects} />
            </div>
          )}

          {section === "gitlab" && (
            <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
              <div style={{ flex: "2 1 420px" }}><GitlabSetupPanel /></div>
              <LinkedProjectsPanel provider="gitlab" label="GitLab" projects={projects} />
            </div>
          )}
          {section === "azuredevops" && (
            <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
              <div style={{ flex: "2 1 420px" }}><AzureDevopsSetupPanel /></div>
              <LinkedProjectsPanel provider="azuredevops" label="Azure DevOps" projects={projects} />
            </div>
          )}

          {section === "msteams" && <MicrosoftTeamsSetupPanel />}

          {section === "sentry" && <SentrySetupPanel />}

          {section === "cloud" && <CloudSetupPanel />}

          {section === "postgres" && (
            <div className="card">
              {status !== "online" && (
                <div className="setrow"><div className="l"><div className="nm">Local agent</div><div className="ds">Your machines are saved regardless \u2014 browsing tables and running queries just needs the agent running too.</div></div>
                  <span className="pill warn"><Icon name="plug" size={15} />Agent offline<span className="dotled warn" /></span></div>
              )}
              {pgList.length === 0 ? (
                <div className="setrow"><div className="l"><div className="nm">No servers configured</div><div className="ds">Add a Postgres connection to browse databases and run queries from the Postgres tab.</div></div>
                  <button className="btn accent" onClick={() => setPgAddOpen(true)}><Icon name="plus" size={15} />Add server</button></div>
              ) : (
                <>
                  {pgList.map((s) => (
                    <div className="setrow" key={s.id}>
                      <div className="l"><div className="nm" style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ color: "var(--mint)" }}><Icon name="db" size={15} /></span>{s.name}{s.ssl && <span className="mono" style={{ fontSize: 10, color: ACCENT.mint }}>SSL</span>}</div>
                        <div className="ds mono" style={{ fontSize: 11.5 }}>{s.user}@{s.host}:{s.port}{s.database ? ` \u00b7 ${s.database}` : ""}</div></div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn ghost" onClick={() => setPgEditing(s)}><Icon name="edit" size={15} />Edit</button>
                        <button className="btn ghost" onClick={async () => { const r = await pgDeleteServer(s.id); if (!r.ok) { toast(`Couldn't remove ${s.name}: ${r.error}`); return; } recordAudit({ action: "pg_server.delete", entityType: "pg_server", entityId: s.id, meta: { name: s.name } }); loadPg(); toast(`Removed ${s.name}`); }}><Icon name="x" size={15} />Remove</button>
                      </div>
                    </div>
                  ))}
                  <div className="setrow"><div className="l"><div className="ds">Saved to your ORBIT account, visible only to you.</div></div>
                    <button className="btn ghost" onClick={() => setPgAddOpen(true)}><Icon name="plus" size={15} />Add server</button></div>
                </>
              )}
            </div>
          )}

          {section === "docker" && (
            <div className="card">
              <div className="setrow">
                <div className="l"><div className="nm">Docker Desktop</div><div className="ds">Read via the local agent (<code className="mono">docker ps</code>). Requires Docker Desktop running and <code className="mono">docker</code> on your PATH.</div></div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {status !== "online"
                    ? <span className="pill warn"><Icon name="plug" size={15} />Agent offline<span className="dotled warn" /></span>
                    : dockerChecking ? <span className="pill"><Icon name="loader" size={15} className="spin" />Checking…<span className="dotled" /></span>
                    : docker?.available ? <span className="pill live"><Icon name="container" size={15} />Connected · {docker.count} running<span className="dotled" /></span>
                    : <span className="pill warn"><Icon name="container" size={15} />Not detected<span className="dotled warn" /></span>}
                  <button className="btn" disabled={status !== "online"} onClick={checkDocker}><Icon name="refresh" size={15} />Test</button>
                </div>
              </div>
            </div>
          )}

          {section === "chores" && <ChoresCard />}

          {section === "ai" && <AiKeySetupPanel />}

          {section === "integrations" && (
            <div className="card">
              {[["VS Code", "code"], ["Visual Studio", "devenv.exe"], ["Terminal", "wt.exe"], ["Browser", "chrome"]].map((p) => (
                <div key={p[0]} className="setrow"><div className="l"><div className="nm">{p[0]}</div></div><input className="field mono" defaultValue={p[1]} /></div>
              ))}
            </div>
          )}

          {section === "data" && (
            <div className="card">
              <div className="setrow"><div className="l"><div className="nm">Data store</div><div className="ds">Supabase Postgres with row-level security. Auth is ORBIT's own — sign-in/sign-up, verification and password reset never touch Supabase Auth.</div></div>
                <span className="pill live"><Icon name="db" size={15} />Supabase</span></div>
              <div className="setrow"><div className="l"><div className="nm">Passwords</div><div className="ds">Hashed with bcrypt, verified server-side. Reset requires an emailed one-time code, never a plaintext link.</div></div>
                <span className="pill live"><Icon name="shield" size={15} />bcrypt</span></div>
              <div className="setrow"><div className="l"><div className="nm">Login alerts</div><div className="ds">Every sign-in emails you the time, approximate location and device — so you'd notice if it wasn't you.</div></div>
                <span className="pill live"><Icon name="mail" size={15} />Enabled</span></div>
              <div className="setrow"><div className="l"><div className="nm">Break history</div><div className="ds">Chore digests are written to <code className="mono">break_logs</code> when a break ends.</div></div>
                <span className="pill"><Icon name="clock" size={15} />Retained</span></div>
            </div>
          )}
        </section>
      </div>

      {pgAddOpen && <PgServerModal onClose={() => setPgAddOpen(false)} onSaved={() => { setPgAddOpen(false); loadPg(); }} />}
      {pgEditing && <PgServerModal editing={pgEditing} onClose={() => setPgEditing(null)} onSaved={() => { setPgEditing(null); loadPg(); }} />}
      {signOutGuardModal}
    </main>
  );
}
