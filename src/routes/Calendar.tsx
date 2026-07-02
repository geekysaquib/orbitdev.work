import { useMemo, useState } from "react";
import { Icon } from "../lib/icons";
import { ACCENT } from "../components/ui";
import { useTable } from "../hooks/useTable";
import type { CalEvent } from "../lib/types";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const KIND_COLOR: Record<string, string> = { deadline: ACCENT.red, meeting: ACCENT.blue, focus: ACCENT.mint, review: ACCENT.violet };

export default function Calendar() {
  const { rows, insert } = useTable<CalEvent>("events", { column: "starts_at", ascending: true });
  const [cursor, setCursor] = useState(new Date());
  const [modal, setModal] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", kind: "focus" });

  const { cells, monthLabel } = useMemo(() => {
    const y = cursor.getFullYear(), m = cursor.getMonth();
    const first = new Date(y, m, 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    const cells = Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start); d.setDate(start.getDate() + i); return d;
    });
    return { cells, monthLabel: cursor.toLocaleString("default", { month: "long", year: "numeric" }) };
  }, [cursor]);

  const key = (d: Date) => d.toISOString().slice(0, 10);
  const evByDay = (d: Date) => rows.filter((e) => e.starts_at.slice(0, 10) === key(d));

  async function add() {
    if (!form.title || !modal) return;
    await insert({ title: form.title, kind: form.kind, starts_at: modal + "T09:00:00.000Z", ends_at: null } as Partial<CalEvent>);
    setModal(null); setForm({ title: "", kind: "focus" });
  }

  return (
    <main className="page">
      <div className="rowhead">
        <div><div className="h1">Calendar</div><div className="sub">Deadlines, meetings, and focus blocks across projects.</div></div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button className="iconbtn" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><Icon name="chevL" size={16} /></button>
          <div className="h2" style={{ minWidth: 170, textAlign: "center" }}>{monthLabel}</div>
          <button className="iconbtn" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><Icon name="chevR" size={16} /></button>
        </div>
      </div>
      <div className="cal-grid">{DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}</div>
      <div className="cal-grid">
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = key(d) === key(new Date());
          return (
            <div key={i} className={"cal-cell" + (inMonth ? "" : " dim") + (isToday ? " today" : "")}
              onClick={() => setModal(key(d))} style={{ cursor: "pointer" }}>
              <div className="cal-num">{d.getDate()}</div>
              {evByDay(d).map((e) => {
                const c = KIND_COLOR[e.kind || "focus"] || ACCENT.mint;
                return <div key={e.id} className="cal-ev" style={{ color: c, background: c + "18", border: `1px solid ${c}30` }}>{e.title}</div>;
              })}
            </div>
          );
        })}
      </div>

      {modal && (
        <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="modal">
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <h3>New event · {modal}</h3>
              <button className="iconbtn" onClick={() => setModal(null)}><Icon name="x" size={16} /></button>
            </div>
            <div className="fld"><label>Title</label><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Obayashi RCA review" /></div>
            <div className="fld"><label>Kind</label>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="focus">Focus block</option><option value="meeting">Meeting</option>
                <option value="deadline">Deadline</option><option value="review">Review</option>
              </select></div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 22 }}>
              <button className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn-primary" onClick={add} disabled={!form.title}>Add event</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
