import { useEffect, useMemo, useState } from "react";
import { Icon } from "../lib/icons";
import { Select } from "../components/Select";
import { ACCENT, Empty, OrbitLoader } from "../components/ui";
import { useTable } from "../hooks/useTable";
import { useToast } from "../context/Toast";
import { useTimezone, tzDate } from "../context/Timezone";
import { supabase } from "../lib/supabase";
import { getUser } from "../lib/auth";
import { listMyTeams } from "../lib/teams";
import { recordAudit } from "../lib/audit";
import { useMyTeamRoles } from "../hooks/useMyTeamRoles";
import type { Task, TaskStatus, Priority, Project, Team } from "../lib/types";

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
  const { rows, insert, update, remove, error, loading } = useTable<Task>("tasks");
  const { rows: projects } = useTable<Project>("projects");
  const toast = useToast();
  const { tz } = useTimezone();
  const myId = getUser()?.id;
  const [title, setTitle] = useState("");
  const [prio, setPrio] = useState<Priority>("med");
  const [projFilter, setProjFilter] = useState("all");
  const [hideDone, setHideDone] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  useEffect(() => { listMyTeams().then(setTeams); }, []);
  const myRoleByTeam = useMyTeamRoles();

  const projName = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p.name])), [projects]);
  const teamName = useMemo(() => Object.fromEntries(teams.map((t) => [t.id, t.name])), [teams]);

  async function share(t: Task, teamId: string) {
    const { error } = await update(t.id, { team_id: teamId || null } as Partial<Task>);
    if (error) { toast(`Couldn't update sharing: ${error}`); return; }
    recordAudit({ action: "task.update", entityType: "task", entityId: t.id, teamId: teamId || t.team_id, meta: { title: t.title, team_change: true } });
    toast(teamId ? `Shared with ${teamName[teamId]}` : "Made personal");
  }

  const visible = rows.filter((t) => (projFilter === "all" || t.project_id === projFilter) && !(hideDone && t.status === "done"));
  const total = rows.length;
  const done = rows.filter((t) => t.status === "done").length;

  async function add() {
    if (!title.trim()) return;
    const t = title.trim();
    await insert({ title: t, status: "todo", priority: prio, project_id: projFilter === "all" ? null : projFilter } as Partial<Task>);
    setTitle("");
    recordAudit({ action: "task.create", entityType: "task", meta: { title: t } });
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
          <div className="ts-item"><b className="mono">{total - done}</b> <span style={{ color: ACCENT.muted }}>open</span></div>
          <div className="ts-item"><b className="mono" style={{ color: ACCENT.mint }}>{done}</b> <span style={{ color: ACCENT.muted }}>done</span></div>
        </div>
      </div>

      {error && (
        <div className="authx-err" style={{ marginTop: 12 }}><Icon name="plug" size={13} />Couldn't load tasks: {error}</div>
      )}

      <div className="ttoolbar">
        <input className="tinput" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Add a task and press Enter" />
        <div className="tprios">
          {PRIOS.map(([p, l, c]) => (
            <span key={p} className={"tprio-chip" + (prio === p ? " on" : "")} style={{ color: prio === p ? c : undefined }} onClick={() => setPrio(p)}>{l}</span>
          ))}
        </div>
        <button className="btn-primary" onClick={add}><Icon name="plus" size={15} />Add</button>
        <div className="tprojsel">
          <Select value={projFilter} onChange={(e) => setProjFilter(e.target.value)} chevron={false}>
            <option value="all">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <span className="chev"><Icon name="chevD" size={11} /></span>
        </div>
        <label className="thidedone"><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />Hide done</label>
      </div>

      {loading ? (
        <div className="page-loader"><OrbitLoader label="Loading tasks…" /></div>
      ) : (
      <>
      {rows.length === 0 && <Empty icon="layers" title="No tasks yet" sub="Add one above, or create tasks from a Zoho work item on the Tickets screen." />}

      <div className="tboard">
        {COLS.map(([status, label, color]) => {
          const items = visible.filter((t) => t.status === status);
          return (
            <div key={status} className={"tcol" + (overCol === status ? " over" : "")}
              onDragOver={(e) => { e.preventDefault(); setOverCol(status); }}
              onDragLeave={() => setOverCol((c) => (c === status ? null : c))}
              onDrop={() => drop(status)}>
              <div className="tcol-head">
                <span className="tcol-dot" style={{ background: color }} />
                <span className="tcol-label">{label}</span>
                <span className="tcol-count">{items.length}</span>
              </div>
              {items.length === 0 && <div className="tempty">No tasks</div>}
              {items.map((t) => {
                const due = t.due_date ? dueLabel(t.due_date) : null;
                const mine = t.user_id === myId;
                const canEdit = mine || (!!t.team_id && ["owner", "admin"].includes(myRoleByTeam[t.team_id]));
                return (
                  <div key={t.id} className={"ttask" + (t.status === "done" ? " done" : "") + (canEdit ? "" : " readonly")} draggable={canEdit}
                    onDragStart={() => canEdit && setDragId(t.id)} onDragEnd={() => { setDragId(null); setOverCol(null); }}>
                    <div className="ttask-top">
                      <span className="ttask-title">{t.title}</span>
                      {canEdit && <button className="ttask-del" title="Delete" onClick={() => { remove(t.id); recordAudit({ action: "task.delete", entityType: "task", entityId: t.id, teamId: t.team_id, meta: { title: t.title } }); toast("Task deleted"); }}><Icon name="x" size={12} /></button>}
                    </div>
                    <div className="ttask-meta">
                      {canEdit ? (
                        <button className="ttask-prio" title="Cycle priority" style={{ color: prColorOf(t.priority) }} onClick={() => update(t.id, { priority: nextPrio(t.priority) } as Partial<Task>)}>{t.priority}</button>
                      ) : (
                        <span className="ttask-prio" title="Only the creator can edit this task" style={{ color: prColorOf(t.priority) }}>{t.priority}</span>
                      )}
                      {t.project_id && projName[t.project_id] && <span>· {projName[t.project_id]}</span>}
                      {due && <span className={"ttask-due" + (due.over ? " over" : "")}>· {due.text}</span>}
                      {mine ? (
                        teams.length > 0 && (
                          <>
                            <span>·</span>
                            <Select value={t.team_id ?? ""} onChange={(e) => share(t, e.target.value)} onClick={(e) => e.stopPropagation()}>
                              <option value="">Personal</option>
                              {teams.map((tm) => <option key={tm.id} value={tm.id}>Share with {tm.name}</option>)}
                            </Select>
                          </>
                        )
                      ) : (
                        t.team_id && teamName[t.team_id] && <span title="Shared by a teammate">· Shared with {teamName[t.team_id]}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      </>
      )}
    </main>
  );
}
