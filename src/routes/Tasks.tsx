import { useMemo, useState } from "react";
import { Icon } from "../lib/icons";
import { ACCENT, Empty } from "../components/ui";
import { useTable } from "../hooks/useTable";
import { useToast } from "../context/Toast";
import { useTimezone, tzDate } from "../context/Timezone";
import { supabase } from "../lib/supabase";
import { getUser } from "../lib/auth";
import type { Task, TaskStatus, Priority, Project } from "../lib/types";

const COLS: [TaskStatus, string, string][] = [
  ["todo", "To do", ACCENT.muted],
  ["doing", "In progress", ACCENT.blue],
  ["review", "Review", ACCENT.violet],
  ["done", "Done", ACCENT.mint],
];
const PRIOS: [Priority, string, string][] = [["high", "High", ACCENT.red], ["med", "Med", ACCENT.amber], ["low", "Low", ACCENT.dim]];
const prColorOf = (p: Priority) => (p === "high" ? ACCENT.red : p === "med" ? ACCENT.amber : ACCENT.dim);
const nextPrio = (p: Priority): Priority => (p === "low" ? "med" : p === "med" ? "high" : "low");

export default function Tasks() {
  const { rows, insert, update, remove } = useTable<Task>("tasks");
  const { rows: projects } = useTable<Project>("projects");
  const toast = useToast();
  const { tz } = useTimezone();
  const [title, setTitle] = useState("");
  const [prio, setPrio] = useState<Priority>("med");
  const [projFilter, setProjFilter] = useState("all");
  const [hideDone, setHideDone] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);

  const projName = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p.name])), [projects]);

  const visible = rows.filter((t) => (projFilter === "all" || t.project_id === projFilter) && !(hideDone && t.status === "done"));
  const total = rows.length;
  const done = rows.filter((t) => t.status === "done").length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  async function add() {
    if (!title.trim()) return;
    const t = title.trim();
    await insert({ title: t, status: "todo", priority: prio, project_id: projFilter === "all" ? null : projFilter } as Partial<Task>);
    setTitle("");
    toast(`Task added · ${t}`);
    const u = getUser();
    if (u) await supabase.from("notifications").insert({ user_id: u.id, kind: "task", title: "New task added", body: t });
  }
  function drop(status: TaskStatus) {
    if (dragId) {
      const t = rows.find((x) => x.id === dragId);
      if (t && t.status !== status) update(t.id, { status } as Partial<Task>);
    }
    setDragId(null); setOverCol(null);
  }
  const dueLabel = (iso: string) => {
    const d = new Date(iso);
    const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
    if (days < 0) return { text: `${Math.abs(days)}d overdue`, over: true };
    if (days === 0) return { text: "Due today", over: false };
    if (days === 1) return { text: "Due tomorrow", over: false };
    return { text: tzDate(tz, d).replace(/,.*/, "") + `, ${d.getDate()}`, over: false };
  };

  return (
    <main className="page">
      <div className="rowhead">
        <div><div className="h1">Tasks</div><div className="sub">Everything across your projects, on one board.</div></div>
        <div className="task-stats">
          <div className="ts-item"><span className="mono">{total - done}</span> open</div>
          <div className="ts-item"><span className="mono" style={{ color: ACCENT.mint }}>{done}</span> done</div>
          <div className="ts-bar" title={`${pct}% complete`}><span style={{ width: `${pct}%` }} /></div>
        </div>
      </div>

      <div className="task-controls">
        <div className="task-add">
          <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Add a task and press Enter" />
          <div className="task-prio">
            {PRIOS.map(([p, l, c]) => (
              <button key={p} className={"tp" + (prio === p ? " on" : "")} style={prio === p ? { color: c, borderColor: c + "66", background: c + "18" } : {}} onClick={() => setPrio(p)}>
                <span className="prdot" style={{ background: c }} />{l}
              </button>
            ))}
          </div>
          <button className="btn accent" onClick={add}><Icon name="plus" size={15} />Add</button>
        </div>
        <div className="task-filters">
          <select className="field" value={projFilter} onChange={(e) => setProjFilter(e.target.value)}>
            <option value="all">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label className="task-toggle"><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />Hide done</label>
        </div>
      </div>

      {rows.length === 0 && <Empty icon="layers" title="No tasks yet" sub="Add one above, or create tasks from a Zoho work item on the Tickets screen." />}

      <div className="kanban" style={{ marginTop: 22 }}>
        {COLS.map(([status, label, color]) => {
          const items = visible.filter((t) => t.status === status);
          return (
            <div key={status} className={"kcol" + (overCol === status ? " over" : "")}
              onDragOver={(e) => { e.preventDefault(); setOverCol(status); }}
              onDragLeave={() => setOverCol((c) => (c === status ? null : c))}
              onDrop={() => drop(status)}>
              <h4><span style={{ display: "flex", alignItems: "center", gap: 7 }}><span className="kdot" style={{ background: color }} />{label}</span><span className="kcount">{items.length}</span></h4>
              {items.map((t) => {
                const due = t.due_date ? dueLabel(t.due_date) : null;
                return (
                  <div key={t.id} className={"kcard" + (t.status === "done" ? " kdone" : "")} draggable
                    onDragStart={() => setDragId(t.id)} onDragEnd={() => { setDragId(null); setOverCol(null); }}>
                    <div className="kcard-top">
                      <span className="ktitle">{t.title}</span>
                      <button className="kdel" title="Delete" onClick={() => { remove(t.id); toast("Task deleted"); }}><Icon name="x" size={12} /></button>
                    </div>
                    <div className="kt">
                      <button className="kprio" title="Cycle priority" onClick={() => update(t.id, { priority: nextPrio(t.priority) } as Partial<Task>)}>
                        <span className="prdot" style={{ background: prColorOf(t.priority) }} />{t.priority}
                      </button>
                      {t.project_id && projName[t.project_id] && <span className="kchip"><Icon name="boxes" size={10} />{projName[t.project_id]}</span>}
                      {due && <span className={"kdue" + (due.over ? " over" : "")}><Icon name="clock" size={10} />{due.text}</span>}
                    </div>
                  </div>
                );
              })}
              {items.length === 0 && <div className="kempty">Drop here</div>}
            </div>
          );
        })}
      </div>
    </main>
  );
}
