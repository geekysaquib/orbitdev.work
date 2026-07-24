import { ACCENT } from "../components/ui";
import type { Notification } from "./types";

/** Shared between Layout.tsx (topbar dropdown) and routes/Notifications.tsx (full list). */
export const NOTIF_ICON: Record<string, [string, string]> = {
  ticket: ["ticket", ACCENT.amber], deploy: ["upload", ACCENT.mint],
  git: ["git", ACCENT.blue], deadline: ["cal", ACCENT.red], system: ["bolt", ACCENT.violet],
  task_team: ["users", ACCENT.mint], task: ["layers", ACCENT.blue], mail: ["mail", ACCENT.violet],
  mention: ["at", ACCENT.blue], weekly_digest: ["sparkles", ACCENT.violet],
  daily_brief: ["sun", ACCENT.amber], anomaly: ["alert", ACCENT.red],
  automation: ["zap", ACCENT.mint], team_deleted: ["users", ACCENT.red],
};
export const NOTIF_KIND_LABEL: Record<string, string> = {
  ticket: "Tickets", deploy: "Deploys", git: "Git events", deadline: "Deadlines",
  system: "System", task_team: "Team tasks", task: "Tasks", mail: "Mail rules",
  mention: "Mentions", weekly_digest: "Weekly review",
  daily_brief: "Daily brief", anomaly: "Anomalies", automation: "Automation",
  team_deleted: "Team deleted",
};
export const NOTIF_KINDS = Object.keys(NOTIF_KIND_LABEL);

export function notifAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

// ---- Preferences (persisted via user_settings, see lib/settings.ts) ----
export interface NotificationPrefs { desktop: boolean; muted: string[]; }
export const DEFAULT_NOTIF_PREFS: NotificationPrefs = { desktop: false, muted: [] };

export function isDesktopSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}
export async function requestDesktopPermission(): Promise<boolean> {
  if (!isDesktopSupported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const r = await Notification.requestPermission();
  return r === "granted";
}
/** Fires a native OS notification for one row, if the browser supports it, permission was granted, and this kind isn't muted. */
export function fireDesktopNotification(n: Notification, prefs: NotificationPrefs) {
  if (!prefs.desktop || prefs.muted.includes(n.kind)) return;
  if (!isDesktopSupported() || Notification.permission !== "granted") return;
  try { new Notification(n.title, { body: n.body || undefined, tag: n.id }); } catch { /* ignore */ }
}

// ---- Digest: today's unread notifications grouped by kind ----
export interface DigestGroup { kind: string; label: string; icon: string; color: string; count: number; latest: Notification; }
export function buildDigest(rows: Notification[]): DigestGroup[] {
  const todayKey = new Date().toDateString();
  const today = rows.filter((n) => new Date(n.created_at).toDateString() === todayKey);
  const map = new Map<string, Notification[]>();
  for (const n of today) (map.get(n.kind) || map.set(n.kind, []).get(n.kind)!).push(n);
  return [...map.entries()]
    .map(([kind, list]) => {
      const [icon, color] = NOTIF_ICON[kind] || ["bell", ACCENT.muted];
      return { kind, label: NOTIF_KIND_LABEL[kind] || kind, icon, color, count: list.length, latest: list[0] };
    })
    .sort((a, b) => b.count - a.count);
}
