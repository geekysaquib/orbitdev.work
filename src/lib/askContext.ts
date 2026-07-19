/**
 * Gathers a snapshot of the signed-in user's ORBIT workspace — active projects,
 * local tasks/tickets, and (if connected) live Zoho sprint boards — for `askThread()`.
 * Returns both the prompt text and an `ActionIndex`: the set of ids the model is
 * allowed to cite. Every action it proposes is validated against that index before
 * becoming a button (see askActions.ts), so a hallucinated id can never navigate
 * anywhere — the index is the trust boundary, not the prompt.
 *
 * Cached in two layers because the halves have opposite needs: Supabase is cheap
 * and should stay fresh, while the Zoho leg is a serial chain through Netlify that
 * costs 9-30s and is the reason this file has a cache at all. Prefetched at Layout
 * mount (see primeAskContext), so opening Ask AI is normally instant.
 *
 * Every section stays capped: the snapshot rides in the first user turn of a
 * conversation that grows with each follow-up, and the local model only has 4k of
 * context to spend.
 */
import { supabase } from "./supabase";
import { fetchZohoStatus, fetchSprintBoard, fetchTimesheet, isOpenBug } from "./zoho";
import { fetchOrbitHours } from "./orbitHours";
import { ttlCache } from "./cache";
import type { Project, Ticket, Task } from "./types";

export interface SprintItemTarget { projectId: string; sprintId: string; itemId: string; label: string }
/** The ids the model may cite — anything absent is treated as a hallucination. */
export interface ActionIndex {
  tickets: Map<string, string>;              // Ticket.id -> title
  projects: Map<string, string>;             // Project.id -> name
  sprintItems: Map<string, SprintItemTarget>; // `${projectId}/${sprintId}/${itemId}`
  timerProjects: Map<string, string>;        // active projects only — you can't time an archived one
}
export interface AppContext { text: string; index: ActionIndex; at: number }

const SUPA_TTL = 30_000;      // cheap — keep it fresh
const ZOHO_TTL = 5 * 60_000;  // the slow leg — cache hard

interface SupaSlice { projects: Project[]; tickets: Ticket[]; tasks: Task[]; orbit: { todayH: number; totalH: number } | null }
interface ZohoSlice { connected: boolean; todayHours: number | null; boards: { project: Project; board: Awaited<ReturnType<typeof fetchSprintBoard>> }[] }

async function loadSupa(): Promise<SupaSlice> {
  const [{ data: projects }, { data: tickets }, { data: tasks }, orbit] = await Promise.all([
    supabase.from("projects").select("*"),
    supabase.from("tickets").select("*"),
    supabase.from("tasks").select("*"),
    fetchOrbitHours().catch(() => null),
  ]);
  return { projects: (projects ?? []) as Project[], tickets: (tickets ?? []) as Ticket[], tasks: (tasks ?? []) as Task[], orbit };
}

// Sprint data isn't persisted locally — it's always fetched fresh from Zoho.
// The chain stays serial: fetchZohoStatus is the not-connected early exit, so
// firing the timesheet alongside it would waste a call on every disconnected user.
async function loadZoho(active: Project[]): Promise<ZohoSlice> {
  const status = await fetchZohoStatus().catch(() => ({ connected: false }));
  if (!status.connected) return { connected: false, todayHours: null, boards: [] };

  const timesheet = await fetchTimesheet().catch(() => null);
  const today = new Date().toISOString().slice(0, 10);
  const todayHours = timesheet ? (timesheet.byDate[today] ?? 0) : null;

  const linked = active.filter((p) => p.sprint_project_id);
  const boards = await Promise.all(
    linked.slice(0, 4).map(async (p) => {
      try { return { project: p, board: await fetchSprintBoard(p.sprint_project_id!) }; }
      catch { return null; }
    }),
  );
  return { connected: true, todayHours, boards: boards.filter((b): b is NonNullable<typeof b> => b !== null) };
}

const supaCache = ttlCache(SUPA_TTL, loadSupa);
// Derives its own active-project list rather than taking one, so the two layers
// expire independently — a Supabase refresh must not drag the 9-30s leg with it.
const zohoCache = ttlCache(ZOHO_TTL, async () => {
  const supa = await supaCache.get();
  return loadZoho(supa.projects.filter((p) => p.status === "active"));
});

/** Warm the cache without blocking or throwing — call on Layout mount so the modal opens instantly. */
export function primeAskContext(): void {
  buildAppContext().catch(() => { /* prefetch is best-effort; the modal retries and surfaces errors */ });
}

/** Drop both layers so the next build refetches — behind the modal's Refresh button. */
export function invalidateAskContext(): void {
  supaCache.invalidate();
  zohoCache.invalidate();
}

/** ms since the snapshot was assembled, or null if nothing is cached yet. */
export function askContextAge(): number | null {
  return zohoCache.age() ?? supaCache.age();
}

export async function buildAppContext(): Promise<AppContext> {
  const supa = await supaCache.get();
  const active = supa.projects.filter((p) => p.status === "active");
  // A Zoho failure degrades to the local-only snapshot rather than failing the ask.
  const zoho = await zohoCache.get().catch(() => ({ connected: false, todayHours: null, boards: [] } as ZohoSlice));

  const index: ActionIndex = { tickets: new Map(), projects: new Map(), sprintItems: new Map(), timerProjects: new Map() };
  for (const p of active) { index.projects.set(p.id, p.name); index.timerProjects.set(p.id, p.name); }

  const lines: string[] = [];
  lines.push(active.length
    ? `Active projects: ${active.map((p) => `[P:${p.id}] ${p.name}`).join("; ")}`
    : "Active projects: none");
  if (supa.orbit) lines.push(`Orbit hours today: ${supa.orbit.todayH}h (${supa.orbit.totalH}h all-time)`);

  const done = supa.tasks.filter((t) => t.status === "done").map((t) => t.title);
  const inProgress = supa.tasks.filter((t) => t.status !== "done").map((t) => `${t.title} (${t.status})`);
  lines.push(`Done tasks: ${done.length ? done.slice(0, 20).join("; ") : "none"}`);
  lines.push(`Tasks in progress / to do: ${inProgress.length ? inProgress.slice(0, 20).join("; ") : "none"}`);

  const openTickets = supa.tickets.filter((t) => !/resolved|closed/i.test(t.status)).slice(0, 20);
  if (openTickets.length) {
    lines.push("Open tickets (local):");
    for (const t of openTickets) {
      index.tickets.set(t.id, t.title);
      // The zoho_id is display-only context so a user asking about "#4102" resolves
      // for the model; it answers with the [T:] id, which is what actions target.
      const num = t.zoho_id ? `#${t.zoho_id} ` : "";
      lines.push(`  [T:${t.id}] ${num}${t.title} — ${t.status}/${t.priority}`);
    }
  } else {
    lines.push("Open tickets (local): none");
  }

  if (!zoho.connected) {
    lines.push("Zoho Sprints: not connected");
    return { text: lines.join("\n"), index, at: Date.now() };
  }
  if (zoho.todayHours !== null) lines.push(`Zoho hours today: ${zoho.todayHours}h`);

  let openBugCount = 0;
  const sprintLines: string[] = [];
  for (const entry of zoho.boards) {
    for (const sprint of entry.board.sprints) {
      openBugCount += sprint.items.filter(isOpenBug).length;
      const openItems = sprint.items.filter((it) => !/done|closed|resolved|complete/i.test(it.status));
      if (openItems.length === 0) continue;
      const block = [`  ${entry.project.name} · ${sprint.name} (${sprint.status}):`];
      for (const it of openItems.slice(0, 10)) {
        const projectId = entry.project.sprint_project_id!;
        const key = `${projectId}/${sprint.id}/${it.id}`;
        const label = it.subject;
        index.sprintItems.set(key, { projectId, sprintId: sprint.id, itemId: it.id, label });
        const num = it.ticketNumber ? `#${it.ticketNumber} ` : "";
        const who = it.assignees?.length ? ` (${it.assignees.join(", ")})` : "";
        block.push(`    [S:${key}] ${num}${it.subject} [${it.status}${it.priority ? `/${it.priority}` : ""}]${who}`);
      }
      sprintLines.push(block.join("\n"));
    }
  }
  lines.push(`Open bugs across linked sprints: ${openBugCount}`);
  lines.push(sprintLines.length
    ? `Zoho sprint items in progress:\n${sprintLines.slice(0, 8).join("\n")}`
    : "Zoho sprint items in progress: none");

  return { text: lines.join("\n"), index, at: Date.now() };
}
