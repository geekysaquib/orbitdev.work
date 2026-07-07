import { useState } from "react";
import { Icon } from "../lib/icons";
import { ACCENT, Empty } from "../components/ui";
import { useTable } from "../hooks/useTable";
import { useToast } from "../context/Toast";
import { supabase } from "../lib/supabase";
import type { Task, TaskStatus } from "../lib/types";

const COLS: [TaskStatus, string][] = [["todo", "To do"], ["doing", "In progress"], ["review", "Review"], ["done", "Done"]];

export default function Tasks() {
  const { rows, insert, update } = useTable<Task>("tasks");
  const toast = useToast();
  const [title, setTitle] = useState("");

  async function add() {
    if (!title.trim()) return;
    const t = title.trim();
    await insert({ title: t, status: "todo", priority: "med" } as Partial<Task>);
    setTitle("");
    toast(`Task added · ${t}`);
    const { data: u } = await supabase.auth.getUser();
    if (u.user) await supabase.from("notifications").insert({ user_id: u.user.id, kind: "task", title: "New task added", body: t });
  }
  function move(t: Task, dir: 1 | -1) {
    const order: TaskStatus[] = ["todo", "doing", "review", "done"];
    const i = order.indexOf(t.status);
    const next = order[Math.min(order.length - 1, Math.max(0, i + dir))];
    if (next !== t.status) update(t.id, { status: next } as Partial<Task>);
  }

  return (
    <main className="page">
      <div className="rowhead">
        <div><div className="h1">Tasks</div><div className="sub">Everything across your projects, on one board.</div></div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 20, maxWidth: 520 }}>
        <input className="field" style={{ flex: 1, fontFamily: "var(--body)", fontSize: 13.5 }} value={title}
          onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Add a task and press Enter" />
        <button className="btn accent" onClick={add}><Icon name="plus" size={15} />Add</button>
      </div>
      {rows.length === 0 && <Empty icon="layers" title="No tasks yet" sub="Add one above, or create tasks from a Zoho work item on the Tickets screen." />}
      <div className="kanban" style={{ marginTop: 22 }}>
        {COLS.map(([status, label]) => (
          <div key={status} className="kcol">
            <h4>{label}<span>{rows.filter((t) => t.status === status).length}</span></h4>
            {rows.filter((t) => t.status === status).map((t) => (
              <div key={t.id} className="kcard">
                {t.title}
                <div className="kt">
                  <span className="prdot" style={{ background: t.priority === "high" ? ACCENT.red : t.priority === "med" ? ACCENT.amber : ACCENT.dim }} />
                  <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                    <button className="iconbtn" style={{ width: 24, height: 24 }} onClick={() => move(t, -1)}><Icon name="chevL" size={12} /></button>
                    <button className="iconbtn" style={{ width: 24, height: 24 }} onClick={() => move(t, 1)}><Icon name="chevR" size={12} /></button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </main>
  );
}
