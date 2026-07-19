import { useCallback, useEffect, useState } from "react";
import { gitStatus, type GitStatusResult } from "../lib/agent";
import type { Project } from "../lib/types";

/**
 * Fans gitStatus() out across a project list in parallel — shared by the
 * Projects list and Dashboard's project bays so both surfaces show the same
 * live branch/dirty/ahead-behind data ProjectDetail's Git tab already reads,
 * instead of each re-implementing the fetch. No-ops while the agent is
 * offline; the static `project.branch` field is the caller's fallback then.
 */
export function useProjectsGitStatus(projects: Project[], agentOnline: boolean) {
  const [gitByProject, setGitByProject] = useState<Record<string, GitStatusResult>>({});
  const [gitLoading, setGitLoading] = useState(false);

  // A stable key over just (id, path) pairs — so an edit to an unrelated
  // field (name, client, status…) that gives `projects` a new array
  // reference doesn't re-trigger a full re-check of every repo.
  const targets = projects
    .map((p) => ({ id: p.id, path: p.fe_path || p.sln_path }))
    .filter((t): t is { id: string; path: string } => !!t.path);
  const targetsKey = targets.map((t) => `${t.id}:${t.path}`).join("|");

  const refreshGit = useCallback(() => {
    if (!agentOnline || targets.length === 0) { setGitByProject({}); return; }
    setGitLoading(true);
    Promise.all(targets.map((t) => gitStatus(t.path).then((r) => [t.id, r] as const)))
      .then((entries) => setGitByProject(Object.fromEntries(entries)))
      .finally(() => setGitLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentOnline, targetsKey]);

  useEffect(() => { refreshGit(); }, [refreshGit]);

  return { gitByProject, gitLoading, refreshGit };
}
