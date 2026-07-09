import { fetchSettings, saveSettings } from "./settings";

export type ChoreId =
  | "git.pull" | "npm.outdated" | "npm.audit"
  | "zoho.bugs" | "zoho.sprint" | "zoho.review" | "zoho.blocked" | "timesheet.drift"
  | "tasks.backlog" | "docker.ps" | "docker.images" | "docker.df"
  | "pg.health" | "mail.unread" | "ports.map" | "dev.servers";

export interface ChoreMeta {
  id: ChoreId;
  label: string;
  desc: string;
  group: "Git" | "Dependencies" | "Zoho" | "Orbit" | "Infra";
  /** Chores that touch your machine or data. Off by default, always explicit. */
  writes?: boolean;
  /** Roughly how long this takes — the slow ones are off by default. */
  slow?: boolean;
}

export const CHORES: ChoreMeta[] = [
  { id: "git.pull", label: "Pull active repos", desc: "git fetch + fast-forward each active project", group: "Git" },
  { id: "npm.outdated", label: "Dependency drift", desc: "npm outdated — how far behind your packages are", group: "Dependencies", slow: true },
  { id: "npm.audit", label: "Security advisories", desc: "npm audit — known vulnerabilities", group: "Dependencies", slow: true },
  { id: "zoho.bugs", label: "Open bugs", desc: "Bugs still to fix across linked projects", group: "Zoho" },
  { id: "zoho.sprint", label: "Sprint burndown", desc: "Days remaining and items still open", group: "Zoho" },
  { id: "zoho.review", label: "Waiting on you", desc: "Items sitting in review", group: "Zoho" },
  { id: "zoho.blocked", label: "Blocked items", desc: "Anything flagged blocked or on hold", group: "Zoho" },
  { id: "timesheet.drift", label: "Timesheet drift", desc: "Orbit hours vs hours logged in Zoho", group: "Zoho" },
  { id: "tasks.backlog", label: "Task backlog", desc: "Todo count and overdue tasks", group: "Orbit" },
  { id: "mail.unread", label: "Unread mail", desc: "Inbox unread count via IMAP", group: "Orbit" },
  { id: "docker.ps", label: "Containers", desc: "What's running right now", group: "Infra" },
  { id: "docker.images", label: "Latest image", desc: "Newest built image", group: "Infra" },
  { id: "docker.df", label: "Docker disk", desc: "Dangling images and reclaimable space", group: "Infra" },
  { id: "pg.health", label: "Postgres health", desc: "Connections, long queries, database size", group: "Infra" },
  { id: "ports.map", label: "Port map", desc: "What's listening on your dev ports", group: "Infra" },
  { id: "dev.servers", label: "Dev servers", desc: "Which dev servers are still up", group: "Infra" },
];

export interface ChoreSettings {
  enabled: Record<ChoreId, boolean>;
  intervalSec: number;
  /** Destructive, opt-in: prune dangling docker images when disk is reclaimable. */
  allowDockerPrune: boolean;
  /** Escalate warnings (conflicts, criticals, overdue) into Orbit notifications. */
  notifyWarnings: boolean;
}

const OFF_BY_DEFAULT: ChoreId[] = ["npm.outdated", "npm.audit"];

export const DEFAULT_CHORES: ChoreSettings = {
  enabled: Object.fromEntries(CHORES.map((c) => [c.id, !OFF_BY_DEFAULT.includes(c.id)])) as Record<ChoreId, boolean>,
  intervalSec: 60,
  allowDockerPrune: false,
  notifyWarnings: true,
};

const KEY = "orbit.chores";

export function cachedChores(): ChoreSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_CHORES;
    const p = JSON.parse(raw) as Partial<ChoreSettings>;
    return { ...DEFAULT_CHORES, ...p, enabled: { ...DEFAULT_CHORES.enabled, ...(p.enabled || {}) } };
  } catch { return DEFAULT_CHORES; }
}

export async function loadChores(): Promise<ChoreSettings> {
  const s = await fetchSettings();
  const merged: ChoreSettings = s.chores
    ? { ...DEFAULT_CHORES, ...s.chores, enabled: { ...DEFAULT_CHORES.enabled, ...(s.chores.enabled || {}) } }
    : cachedChores();
  try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch { /* noop */ }
  return merged;
}

export async function saveChores(c: ChoreSettings): Promise<void> {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* noop */ }
  await saveSettings({ chores: c });
}
