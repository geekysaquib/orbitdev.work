import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthContext";
import { listMyTeams } from "../lib/teams";
import type { Team } from "../lib/types";

export interface PresenceEntry {
  user_id: string;
  full_name: string;
  label: string;
  since: string;
}

// Mirrors the path -> label mapping in Layout.tsx's NAV_GROUPS/NAV_BOTTOM, so
// a presence label always reads like the nav rail without importing it (that
// list is keyed by icon/route metadata this doesn't need).
const PATH_LABELS: Record<string, string> = {
  "/app": "Dashboard", "/projects": "Projects", "/tasks": "Tasks", "/sprints": "Sprints",
  "/teams": "Teams", "/mail": "Mail", "/calendar": "Calendar",
  "/postgres": "Postgres", "/docker": "Docker", "/time": "Time",
  "/docs": "Docs", "/audit": "Audit log", "/health": "Health", "/settings": "Settings",
  "/notifications": "Notifications", "/tickets": "Tickets",
};
function labelForPath(pathname: string): string {
  if (PATH_LABELS[pathname]) return PATH_LABELS[pathname];
  if (pathname.startsWith("/projects/")) return "Projects";
  return "ORBIT";
}

interface PresenceShape {
  teamPresence: Record<string, PresenceEntry[]>;
  setDetail: (text: string | null) => void;
}
const Ctx = createContext<PresenceShape | undefined>(undefined);

/**
 * One Realtime Presence channel per team the user belongs to — not backed by
 * any table, so no RLS/schema is involved. Presence data (a page label) is
 * low-sensitivity, and team ids are unguessable UUIDs, so this doesn't use
 * Supabase's "private channel" authorization — a heavier setup this feature
 * doesn't warrant. Re-tracks on every route change (and whenever a page sets
 * a more specific detail) so "who's working on what" stays live.
 */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamPresence, setTeamPresence] = useState<Record<string, PresenceEntry[]>>({});

  const channelsRef = useRef<Map<string, RealtimeChannel>>(new Map());
  const detailRef = useRef<string | null>(null);
  const pathRef = useRef(location.pathname);
  const sinceRef = useRef<string>(new Date().toISOString());
  const userRef = useRef(user);
  userRef.current = user;
  pathRef.current = location.pathname;

  const trackAll = useCallback(() => {
    const u = userRef.current;
    if (!u) return;
    const base = labelForPath(pathRef.current);
    const label = detailRef.current ? `${base} — ${detailRef.current}` : base;
    const entry: PresenceEntry = { user_id: u.id, full_name: u.full_name || u.email, label, since: sinceRef.current };
    for (const ch of channelsRef.current.values()) ch.track(entry);
  }, []);

  useEffect(() => {
    if (!user) { setTeams([]); return; }
    listMyTeams().then(setTeams).catch(() => setTeams([]));
  }, [user]);

  // Join a channel for every team just discovered, leave one for any team no
  // longer in the list (left the team, or signed out).
  useEffect(() => {
    if (!user) return;
    const wanted = new Set(teams.map((t) => t.id));
    for (const [teamId, ch] of channelsRef.current) {
      if (wanted.has(teamId)) continue;
      supabase.removeChannel(ch);
      channelsRef.current.delete(teamId);
      setTeamPresence((p) => { const n = { ...p }; delete n[teamId]; return n; });
    }
    for (const teamId of wanted) {
      if (channelsRef.current.has(teamId)) continue;
      const ch = supabase.channel(`presence:team:${teamId}`, { config: { presence: { key: user.id } } });
      ch.on("presence", { event: "sync" }, () => {
        const state = ch.presenceState() as Record<string, PresenceEntry[]>;
        const list = Object.values(state).map((entries) => entries[0]).filter((e): e is PresenceEntry => !!e && e.user_id !== user.id);
        setTeamPresence((p) => ({ ...p, [teamId]: list }));
      });
      ch.subscribe((status) => { if (status === "SUBSCRIBED") trackAll(); });
      channelsRef.current.set(teamId, ch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, teams]);

  useEffect(() => {
    trackAll();
  }, [location.pathname, trackAll]);

  useEffect(() => () => {
    for (const ch of channelsRef.current.values()) supabase.removeChannel(ch);
    channelsRef.current.clear();
  }, []);

  const setDetail = useCallback((text: string | null) => {
    detailRef.current = text;
    trackAll();
  }, [trackAll]);

  const value = useMemo(() => ({ teamPresence, setDetail }), [teamPresence, setDetail]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTeamPresence(teamId: string | null | undefined): PresenceEntry[] {
  const ctx = useContext(Ctx);
  if (!ctx || !teamId) return [];
  return ctx.teamPresence[teamId] ?? [];
}

/** Lets a page override the generic route label with something specific — see ProjectDetail.tsx. */
export function usePresenceDetail(): (text: string | null) => void {
  const ctx = useContext(Ctx);
  return ctx?.setDetail ?? (() => {});
}
