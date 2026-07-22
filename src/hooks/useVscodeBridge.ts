/**
 * Keeps the VS Code extension in sync with ORBIT.
 *
 * Two directions, both through the local agent:
 *  - **Out:** pushes a compact tasks/tickets/timer snapshot to `/worklist`. The
 *    agent has no database access by design (it only verifies the JWT), so this
 *    tab is the source the extension's sidebar reads from.
 *  - **In:** handles `orbit:command` pushed over the agent websocket. The
 *    extension can't start the timer itself — it lives in this tab's
 *    localStorage — and task writes must go through the RLS-scoped Supabase
 *    client here, so the extension relays intent and this executes it.
 *
 * Mounted once from Layout. Cheap when nothing is listening: the push is a
 * single local request on a slow interval.
 */
import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { agentCall } from "../lib/agent";
import { readTimer, startTimer, stopTimer, isTimerRunning, TIMER_EVENT } from "../lib/timer";
import { fetchOrbitHours } from "../lib/orbitHours";
import { getUser } from "../lib/auth";
import { useAgent } from "../context/Agent";
import { useBreak } from "../context/Break";
import { ask } from "../lib/ai";
import { orbitRuntime } from "../runtime";
import { fetchIntegrations, providerKeys } from "../lib/integrations";
import { useToast } from "../context/Toast";
import type { Task, Ticket, TaskStatus } from "../lib/types";

const TASK_STATUSES: TaskStatus[] = ["todo", "doing", "review", "done"];

// The separator differs from the input's ("::") on purpose: a small model handed
// the same delimiter both ways tends to echo the whole input line back, which
// produced reasons that were just the task title repeated.
const RANK_SYSTEM = `You rank a developer's open tasks by what deserves attention first.

Reply with one line per task, most important first:
<id> | <reason>

Rules:
- <id> is copied exactly from the task's "id=" value. Never invent an id.
- <reason> is YOUR OWN short justification, at most 8 words. Never repeat the task title.
- Good reasons: "high priority, already in review", "blocks other work", "low priority, can wait".
- Output only these lines. No numbering, no preamble, no markdown.

Example input:
id=abc123 :: Fix login redirect [doing/high]
id=def456 :: Update README [todo/low]

Example output:
abc123 | high priority and already started
def456 | docs only, safe to defer`;

/** Weak models sometimes echo the title back; a reason that's mostly the title is worse than none. */
function looksEchoed(reason: string, title: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  const rw = norm(reason), tw = new Set(norm(title));
  if (!rw.length) return true;
  return rw.filter((w) => tw.has(w)).length / rw.length > 0.6;
}

/**
 * Ask the configured model to order the open tasks, then keep only ids that were
 * actually in the input — the same trust-boundary rule Ask AI's actions use, so a
 * hallucinated id can never surface in VS Code as a real task.
 */
async function rankTasks(): Promise<AiRank | null> {
  const { data } = await supabase.from("tasks").select("id,title,status,priority").neq("status", "done").limit(30);
  const rows = (data ?? []) as { id: string; title: string; status: string; priority: string }[];
  if (!rows.length) return { rankedAt: Date.now(), items: [] };

  const integrations = await fetchIntegrations();
  const prompt = rows.map((t) => `id=${t.id} :: ${t.title} [${t.status}/${t.priority}]`).join("\n");
  const r = await ask(prompt, RANK_SYSTEM, providerKeys(integrations), integrations?.ai_provider ?? undefined);
  if (!r.ok || !r.text) return null;

  const titleOf = new Map(rows.map((t) => [t.id, t.title]));
  const seen = new Set<string>();
  const items: AiRank["items"] = [];
  for (const line of r.text.split("\n")) {
    const [rawId, ...rest] = line.split("|");
    // Tolerate a stray "id=" prefix — small models copy the input's labelling.
    const id = rawId?.trim().replace(/^id\s*=\s*/i, "");
    if (!id || !titleOf.has(id) || seen.has(id)) continue;
    seen.add(id);
    const reason = rest.join("|").trim().slice(0, 80);
    items.push({ id, reason: looksEchoed(reason, titleOf.get(id)!) ? "" : reason });
  }
  // Anything the model omitted still belongs in the list, just unranked-last.
  for (const t of rows) if (!seen.has(t.id)) items.push({ id: t.id, reason: "" });
  return items.length ? { rankedAt: Date.now(), items } : null;
}


const PUSH_MS = 45_000;

/** AI focus ranking, kept in memory and re-pushed until the next `ai:rank`. */
interface AiRank { rankedAt: number; items: { id: string; reason: string }[] }

export function useVscodeBridge(): void {
  const { status, subscribe } = useAgent();
  const { onBreak, breakStartedAt, idlePaused } = useBreak();
  const toast = useToast();
  const online = status === "online";
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const aiRankRef = useRef<AiRank | null>(null);
  // Read inside the interval callback, which closes over the first render's values.
  const breakRef = useRef({ onBreak, breakStartedAt, idlePaused });
  breakRef.current = { onBreak, breakStartedAt, idlePaused };
  const pushRef = useRef<() => void>(() => {});

  // ---- Out: publish the work list ----
  useEffect(() => {
    if (!online) return;
    let stopped = false;

    const push = async () => {
      if (stopped) return;
      const [{ data: tasks }, { data: tickets }, { data: projects }] = await Promise.all([
        supabase.from("tasks").select("id,title,status,priority,project_id").neq("status", "done").limit(50),
        supabase.from("tickets").select("id,title,status,priority,project_id").limit(50),
        supabase.from("projects").select("id,name"),
      ]);
      if (stopped) return;
      const nameOf = new Map(((projects ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
      // Structural, not `Task | Ticket` — their `status` types differ (a union vs
      // plain string) and only these four fields are wanted from either.
      const shape = (r: { id: string; title: string; status: string; priority: string; project_id: string | null }) => ({
        id: r.id, title: r.title, status: r.status, priority: r.priority,
        project: r.project_id ? nameOf.get(r.project_id) ?? null : null,
      });
      const t = readTimer();
      const hours = await fetchOrbitHours().catch(() => null);
      await agentCall("/worklist", {
        tasks: ((tasks ?? []) as Task[]).map(shape),
        // Open tickets only — a closed backlog isn't "my work".
        tickets: ((tickets ?? []) as Ticket[]).filter((x) => !/resolved|closed/i.test(x.status)).map(shape),
        timer: {
          running: t.startedAt !== null, projectId: t.projectId, taskId: t.taskId, seconds: t.seconds,
          // Absolute start, so the extension can tick a live clock instead of
          // showing a number that only advances when we next push.
          startedAt: t.startedAt,
          project: t.projectId ? nameOf.get(t.projectId) ?? null : null,
        },
        hours: hours ? { today: hours.todayH, total: hours.totalH } : null,
        projects: ((projects ?? []) as { id: string; name: string }[]).slice(0, 40),
        // Surfaced in VS Code so a break is visible where the user actually is —
        // the whole point of a break is that they're not looking at ORBIT.
        break: {
          onBreak: breakRef.current.onBreak,
          startedAt: breakRef.current.breakStartedAt ? new Date(breakRef.current.breakStartedAt).getTime() : null,
          idlePaused: breakRef.current.idlePaused,
        },
        ai: aiRankRef.current,
      }).catch(() => { /* agent went away mid-cycle */ });
    };
    pushRef.current = () => void push();

    void push();
    const interval = setInterval(push, PUSH_MS);
    // The timer is the one field worth pushing immediately — the extension's
    // status bar showing a stale running/stopped state is the obvious tell.
    const onTimer = () => void push();
    window.addEventListener(TIMER_EVENT, onTimer);
    return () => { stopped = true; clearInterval(interval); window.removeEventListener(TIMER_EVENT, onTimer); };
  }, [online]);

  // Break state changes are the one thing worth pushing the moment they happen —
  // waiting up to 45s to show "on break" in VS Code defeats the purpose.
  useEffect(() => { if (online) pushRef.current(); }, [online, onBreak, idlePaused]);

  // ---- In: execute relayed commands ----
  useEffect(() => {
    return subscribe((event, payload) => {
      if (event !== "orbit:command") return;
      const { command, payload: args } = (payload ?? {}) as { command?: string; payload?: Record<string, unknown> };
      if (command === "timer:start") {
        if (isTimerRunning()) return;
        startTimer((args?.projectId as string) ?? null, (args?.taskId as string) ?? null);
        toastRef.current("Timer started from VS Code");
      } else if (command === "timer:stop") {
        if (!isTimerRunning()) return;
        void stopTimer().then((s) => toastRef.current(`Timer stopped from VS Code · ${Math.floor(s / 60)}m logged`));
      } else if (command === "task:status") {
        const id = args?.id as string;
        const status = args?.status as TaskStatus;
        // Relayed input — only the four real statuses are accepted.
        if (!id || !TASK_STATUSES.includes(status)) return;
        // Goes through this tab's client so RLS applies, and so the automation
        // engine's task_status trigger fires exactly as it would on a drag.
        // This path had no event trail before — closed here. Fire-and-forget,
        // same principle as every other event-publish call in this codebase.
        // See docs/architecture/event-engine-adoption.md.
        void supabase.from("tasks").update({ status }).eq("id", id).select().single().then(({ data, error }) => {
          toastRef.current(error ? `Couldn't update task: ${error.message}` : `Task moved to ${status} from VS Code`);
          if (data) {
            void orbitRuntime.events.publish({
              source: "task-workflow", type: "status_changed", occurredAt: new Date().toISOString(), teamId: data.team_id ?? null,
              payload: {
                taskId: data.id, projectId: data.project_id, teamId: data.team_id ?? null, title: data.title,
                status: data.status, previousStatus: null, priority: data.priority, dueDate: data.due_date, completedAt: data.completed_at,
              },
            }).catch(() => {});
          }
        });
      } else if (command === "ai:rank") {
        void rankTasks().then((r) => {
          aiRankRef.current = r;
          pushRef.current();   // get the result to VS Code without waiting for the next cycle
          toastRef.current(r ? "AI ranked your tasks for VS Code" : "Couldn't rank tasks — check your AI settings");
        });
      } else if (command === "task:create") {
        const title = String(args?.title ?? "").trim();
        if (!title) return;
        const u = getUser();
        if (!u) return;
        void supabase.from("tasks").insert({
          user_id: u.id, title, status: "todo",
          priority: (args?.priority as "low" | "med" | "high") ?? "med",
          project_id: (args?.projectId as string) ?? null,
        }).select().single().then(({ data, error }) => {
          toastRef.current(error ? `Couldn't create task: ${error.message}` : `Task created from VS Code · ${title}`);
          // This path had no event trail before — closed here, same principle
          // as every other event-publish call. See
          // docs/architecture/event-engine-adoption.md.
          if (data) {
            void orbitRuntime.events.publish({
              source: "task-workflow", type: "created", occurredAt: new Date().toISOString(), teamId: data.team_id ?? null,
              payload: { taskId: data.id, projectId: data.project_id, teamId: data.team_id ?? null, title: data.title, status: data.status, priority: data.priority },
            }).catch(() => {});
          }
        });
      }
    });
  }, [subscribe]);
}
