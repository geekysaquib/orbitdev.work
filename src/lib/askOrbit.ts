/**
 * "Ask Orbit" — client-side prompt matching over `src/lib/intelligence.ts`'s
 * five deterministic Knowledge-Engine functions. Extracted from
 * `Intelligence.tsx` (this session's "My Work" dashboard milestone) so both
 * `/intelligence` and the new `/home` dashboard's embedded panel
 * (`src/components/AskOrbitPanel.tsx`) share the exact same matching/answer
 * logic instead of duplicating it. Honestly scoped: typed text is matched
 * against five known prompts, not new NLU — a non-match says so.
 */
import { explainProject, relatedToTask, failingIntegrations, summarizeToday, staleActiveProjects, type IntelligenceAnswer } from "./intelligence";
import type { KnowledgeEngine } from "../engines/knowledge";

export type QuestionId = "explainProject" | "relatedToTask" | "failingIntegrations" | "summarizeToday" | "staleActiveProjects";

export interface PromptDef {
  id: QuestionId; icon: string; prompt: string;
  needsProject?: boolean; needsTask?: boolean; keywords: string[];
}

export interface AskOrbitTurn { turnId: string; questionId: QuestionId; label: string; answer: IntelligenceAnswer }

export const PROMPTS: PromptDef[] = [
  { id: "explainProject", icon: "folder", prompt: "Explain a project", needsProject: true, keywords: ["explain", "project", "about", "summary"] },
  { id: "relatedToTask", icon: "layers", prompt: "What's related to a task", needsTask: true, keywords: ["related", "task", "everything", "linked"] },
  { id: "failingIntegrations", icon: "plug", prompt: "Which integrations are failing?", keywords: ["integration", "failing", "connect", "fail", "health"] },
  { id: "summarizeToday", icon: "timer", prompt: "Summarize today's work", keywords: ["today", "summar", "work", "progress", "done"] },
  { id: "staleActiveProjects", icon: "activity", prompt: "Active projects with no recent commits", keywords: ["commit", "stale", "risk", "recent", "no commits"] },
];

export async function runPrompt(knowledge: KnowledgeEngine, id: QuestionId, paramId?: string): Promise<IntelligenceAnswer> {
  switch (id) {
    case "explainProject": return explainProject(knowledge, paramId!);
    case "relatedToTask": return relatedToTask(knowledge, paramId!);
    case "failingIntegrations": return failingIntegrations(knowledge);
    case "summarizeToday": return summarizeToday(knowledge);
    case "staleActiveProjects": return staleActiveProjects(knowledge);
  }
}

export function matchPrompt(text: string): PromptDef | null {
  const q = text.trim().toLowerCase();
  if (!q) return null;
  let best: PromptDef | null = null, bestScore = 0;
  for (const p of PROMPTS) {
    const score = p.keywords.filter((k) => q.includes(k)).length;
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}

/** Client-side only — reads data the answer already returned, never a new query. */
export function deriveRecommendation(id: QuestionId, answer: IntelligenceAnswer): { label: string; href: string } | null {
  if (id === "failingIntegrations") {
    const failing = answer.entities.find((e) => !e.attributes.connected);
    return failing ? { label: `Reconnect ${failing.label}`, href: "/settings" } : null;
  }
  if (id === "staleActiveProjects") {
    const project = answer.entities[0];
    return project ? { label: `Review ${project.label}`, href: `/projects/${project.ref.id}` } : null;
  }
  if (id === "explainProject") {
    const project = answer.entities.find((e) => e.ref.type === "project");
    return project ? { label: `Open ${project.label}`, href: `/projects/${project.ref.id}` } : null;
  }
  return null;
}
