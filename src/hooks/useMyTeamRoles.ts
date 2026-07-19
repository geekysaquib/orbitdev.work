import { useEffect, useState } from "react";
import { listMyTeams, listMembers } from "../lib/teams";
import { getUser } from "../lib/auth";
import type { TeamRole } from "../lib/types";

/**
 * "What's my role in each team I'm in" — a single reusable primitive instead
 * of duplicating the listMyTeams+listMembers+find-my-row lookup wherever a
 * page needs to gate a shared item's edit controls by the current user's
 * team role (see Tasks.tsx/ProjectDetail.tsx's `canEdit`).
 */
export function useMyTeamRoles(): Record<string, TeamRole> {
  const [roles, setRoles] = useState<Record<string, TeamRole>>({});

  useEffect(() => {
    let alive = true;
    const myId = getUser()?.id;
    if (!myId) return;
    listMyTeams().then(async (teams) => {
      const entries = await Promise.all(teams.map(async (t) => {
        const members = await listMembers(t.id);
        const mine = members.find((m) => m.user_id === myId);
        return mine ? [t.id, mine.role] as const : null;
      }));
      if (!alive) return;
      setRoles(Object.fromEntries(entries.filter((e): e is readonly [string, TeamRole] => e !== null)));
    }).catch(() => { if (alive) setRoles({}); });
    return () => { alive = false; };
  }, []);

  return roles;
}
