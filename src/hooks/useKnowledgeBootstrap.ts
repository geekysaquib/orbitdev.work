import { useEffect, useState } from "react";
import type { Entity, KnowledgeEngine } from "../engines/knowledge";
import { syncTimeEntries, syncIntegrationStatus } from "../lib/knowledgeSync";

/**
 * Shared mount sequence for pages that read the Knowledge Graph beyond what
 * Orbit Runtime's global sync already covers (projects/tasks/tickets only —
 * see src/lib/knowledgeSync.ts). Runs the two additive, lazy syncs once, then
 * loads project/task entities. First built for Intelligence.tsx, reused by
 * Home.tsx so neither duplicates this effect.
 */
export function useKnowledgeBootstrap(knowledge: KnowledgeEngine): { ready: boolean; projects: Entity[]; tasks: Entity[] } {
  const [ready, setReady] = useState(false);
  const [projects, setProjects] = useState<Entity[]>([]);
  const [tasks, setTasks] = useState<Entity[]>([]);

  useEffect(() => {
    Promise.all([syncTimeEntries(knowledge), syncIntegrationStatus(knowledge)])
      .catch(() => { /* best-effort — callers still degrade gracefully if this fails */ })
      .then(async () => {
        const [p, t] = await Promise.all([knowledge.query({ type: "project" }), knowledge.query({ type: "task" })]);
        setProjects(p); setTasks(t);
        setReady(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ready, projects, tasks };
}
