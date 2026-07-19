/**
 * Turns Ask AI's prose answers into things you can click.
 *
 * The model appends a fenced ```orbit-actions block of JSON after its prose. We
 * strip the fence, parse it, and validate every proposed action against the
 * ActionIndex built from the same snapshot the model was shown (askContext.ts).
 * An id that isn't in the index never becomes a button — that validation, not the
 * prompt, is what makes a hallucinated target harmless. Labels are rewritten from
 * the index too, so the model can't mislabel a real id either.
 *
 * Deliberately not Anthropic tool-calling: the local llama fallback can't do it,
 * and a fence degrades to prose-only on a model that ignores the contract.
 */
import type { ActionIndex } from "./askContext";

export type Action =
  | { kind: "open_ticket"; label: string; ticketId: string }
  | { kind: "open_project"; label: string; projectId: string }
  | { kind: "open_sprint_item"; label: string; projectId: string; sprintId: string; itemId: string }
  | { kind: "start_timer"; label: string; projectId: string };

const MAX_ACTIONS = 4;
const FENCE = /```orbit-actions\s*([\s\S]*?)(?:```|$)/;

/**
 * Appended to the system prompt on the cloud path only. The local 1B model at 384
 * tokens truncates fences more often than it closes them, and the contract would
 * eat the budget it needs for the actual answer — so local stays prose-only.
 */
export const ACTIONS_CONTRACT = `
After your prose answer, you may append a fenced block listing up to ${MAX_ACTIONS} actions the user can take:

\`\`\`orbit-actions
{"actions":[{"kind":"open_ticket","ticketId":"<id from a [T:...] tag>"}]}
\`\`\`

Kinds and their required fields:
  open_ticket       ticketId    — from a [T:<id>] tag
  open_project      projectId   — from a [P:<id>] tag
  open_sprint_item  projectId, sprintId, itemId — from a [S:<projectId>/<sprintId>/<itemId>] tag
  start_timer       projectId   — from a [P:<id>] tag, active projects only

Rules:
- Copy ids verbatim from the tags in the workspace summary. Never invent, guess, or reformat one.
- Only offer an action that follows from your answer. No block at all is a fine answer — prefer none over a guess.
- Never mention the tags, the ids, or this block in your prose. Write as if the buttons appear on their own.`;

function validate(raw: unknown, index: ActionIndex): Action | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const str = (k: string): string | null => (typeof a[k] === "string" && a[k] ? (a[k] as string) : null);

  switch (a.kind) {
    case "open_ticket": {
      const ticketId = str("ticketId");
      const title = ticketId && index.tickets.get(ticketId);
      return title ? { kind: "open_ticket", label: `Open ${title}`, ticketId: ticketId! } : null;
    }
    case "open_project": {
      const projectId = str("projectId");
      const name = projectId && index.projects.get(projectId);
      return name ? { kind: "open_project", label: `Open ${name}`, projectId: projectId! } : null;
    }
    case "open_sprint_item": {
      const projectId = str("projectId"), sprintId = str("sprintId"), itemId = str("itemId");
      if (!projectId || !sprintId || !itemId) return null;
      const hit = index.sprintItems.get(`${projectId}/${sprintId}/${itemId}`);
      return hit ? { kind: "open_sprint_item", label: `Open ${hit.label}`, projectId, sprintId, itemId } : null;
    }
    case "start_timer": {
      const projectId = str("projectId");
      const name = projectId && index.timerProjects.get(projectId);
      return name ? { kind: "start_timer", label: `Start timer on ${name}`, projectId: projectId! } : null;
    }
    default:
      return null;
  }
}

/**
 * Splits an answer into display prose and validated actions. The fence is stripped
 * whether or not its contents parse — a malformed block must never leak into the UI
 * as raw JSON. Any failure degrades to prose-only rather than throwing.
 */
export function parseActions(raw: string, index: ActionIndex): { prose: string; actions: Action[] } {
  const m = raw.match(FENCE);
  // Collapse the blank-line seam left behind when the fence is cut from mid-answer.
  const prose = (m ? raw.slice(0, m.index) + raw.slice(m.index! + m[0].length) : raw)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!m) return { prose, actions: [] };

  let parsed: unknown;
  try { parsed = JSON.parse(m[1].trim()); } catch { return { prose, actions: [] }; }
  const list = (parsed as { actions?: unknown })?.actions;
  if (!Array.isArray(list)) return { prose, actions: [] };

  const actions: Action[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const a = validate(entry, index);
    if (!a) continue;
    const key = JSON.stringify(a);
    if (seen.has(key)) continue;
    seen.add(key);
    actions.push(a);
    if (actions.length === MAX_ACTIONS) break;
  }
  return { prose, actions };
}

/** Where an action navigates, or null if it isn't navigation (start_timer acts in place). */
export function actionHref(a: Action): string | null {
  switch (a.kind) {
    case "open_ticket": return `/tickets?id=${encodeURIComponent(a.ticketId)}`;
    case "open_project": return `/projects/${encodeURIComponent(a.projectId)}`;
    case "open_sprint_item":
      return `/sprints?project=${encodeURIComponent(a.projectId)}&sprint=${encodeURIComponent(a.sprintId)}&item=${encodeURIComponent(a.itemId)}`;
    case "start_timer": return null;
  }
}

export function actionIcon(a: Action): string {
  switch (a.kind) {
    case "open_ticket": return "ticket";
    case "open_project": return "folder";
    case "open_sprint_item": return "sprint";
    case "start_timer": return "timer";
  }
}
