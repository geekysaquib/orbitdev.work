import { useEffect, useMemo, useState } from "react";
import { Icon } from "../lib/icons";
import { Select } from "../components/Select";
import { ACCENT, alpha, OrbitLoader } from "../components/ui";
import { useTable } from "../hooks/useTable";
import { useToast } from "../context/Toast";
import { fetchMsTeamsStatus, createTeamsMeeting } from "../lib/msTeams";
import type { CalEvent } from "../lib/types";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const KINDS: [string, string, string][] = [
  ["focus", "Focus block", ACCENT.mint], ["meeting", "Meeting", ACCENT.blue],
  ["deadline", "Deadline", ACCENT.red], ["review", "Review", ACCENT.violet],
];
const kindColor = (k: string) => (KINDS.find((x) => x[0] === k)?.[2]) || ACCENT.mint;
// Local (not UTC) date key — fixes the off-by-one in IST etc.
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function Calendar() {
  const { rows, insert, loading } = useTable<CalEvent>("events", { column: "starts_at", ascending: true });
  const toast = useToast();
  const [cursor, setCursor] = useState(new Date());
  const [modal, setModal] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", kind: "focus", start: "", end: "", startTime: "09:00", endTime: "09:30", createMeeting: false });
  const [creatingMeeting, setCreatingMeeting] = useState(false);
  const [teamsConnected, setTeamsConnected] = useState(false);
  useEffect(() => { fetchMsTeamsStatus().then((s) => setTeamsConnected(s.connected)); }, []);

  const { cells, monthLabel } = useMemo(() => {
    const y = cursor.getFullYear(), m = cursor.getMonth();
    const first = new Date(y, m, 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
    return { cells, monthLabel: cursor.toLocaleString("default", { month: "long", year: "numeric" }) };
  }, [cursor]);

  const evByDay = (d: Date) => {
    const k = key(d);
    return rows.filter((e) => {
      const s = e.starts_at.slice(0, 10);
      const en = (e.ends_at || e.starts_at).slice(0, 10);
      return k >= s && k <= en;
    });
  };

  function openDay(k: string) { setForm({ title: "", kind: "focus", start: k, end: "", startTime: "09:00", endTime: "09:30", createMeeting: false }); setModal(k); }

  async function add() {
    if (!form.title || !form.start) return;
    const end = form.end && form.end >= form.start ? form.end : null;
    const isMeeting = form.kind === "meeting";
    const startsAt = isMeeting ? new Date(`${form.start}T${form.startTime}:00`).toISOString() : `${form.start}T09:00:00.000Z`;
    const endsAt = isMeeting ? new Date(`${end || form.start}T${form.endTime}:00`).toISOString() : (end ? `${end}T18:00:00.000Z` : null);

    let meetingUrl: string | null = null;
    if (isMeeting && form.createMeeting) {
      setCreatingMeeting(true);
      const r = await createTeamsMeeting(form.title, startsAt, endsAt as string);
      setCreatingMeeting(false);
      if (r.ok) meetingUrl = r.joinUrl ?? null;
      else toast(`Couldn't create the Teams meeting: ${r.error} — event saved without a link.`);
    }

    await insert({ title: form.title, kind: form.kind, starts_at: startsAt, ends_at: endsAt, meeting_url: meetingUrl } as Partial<CalEvent>);
    setModal(null);
  }

  const todayKey = key(new Date());

  return (
    <main className="page">
      <div className="rowhead">
        <div><div className="h1">Calendar</div><div className="sub">Deadlines, meetings, and focus blocks across your projects.</div></div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button className="btn ghost" onClick={() => setCursor(new Date())}>Today</button>
          <button className="iconbtn" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><Icon name="chevL" size={16} /></button>
          <div className="h2" style={{ minWidth: 176, textAlign: "center" }}>{monthLabel}</div>
          <button className="iconbtn" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><Icon name="chevR" size={16} /></button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, marginTop: 14, flexWrap: "wrap" }}>
        {KINDS.map(([k, label, c]) => (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--muted)" }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: c }} />{label}
          </span>
        ))}
      </div>

      {loading ? <div className="page-loader"><OrbitLoader label="Loading calendar…" /></div> : (
        <div className="cal-shell">
          <div className="cal-grid">{DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}</div>
          <div className="cal-grid">
            {cells.map((d, i) => {
              const inMonth = d.getMonth() === cursor.getMonth();
              const isToday = key(d) === todayKey;
              const isWeekend = d.getDay() === 0 || d.getDay() === 6;
              const evs = evByDay(d);
              return (
                <div key={i} className={"cal-cell" + (inMonth ? "" : " dim") + (isToday ? " today" : "") + (isWeekend ? " wknd" : "")}
                  onClick={() => openDay(key(d))}>
                  <div className="cal-num">{isToday ? <span className="cal-today-badge">{d.getDate()}</span> : d.getDate()}</div>
                  <div className="cal-evs">
                    {evs.slice(0, 4).map((e) => {
                      const c = kindColor(e.kind || "focus");
                      return (
                        <div key={e.id} className="cal-ev" style={{ color: c, background: alpha(c, 11), borderLeft: `2px solid ${c}`, display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title}</span>
                          {e.meeting_url && (
                            <a href={e.meeting_url} target="_blank" rel="noreferrer" title="Join Teams meeting" onClick={(ev) => ev.stopPropagation()} style={{ color: c, flexShrink: 0, display: "flex" }}>
                              <Icon name="msteams" size={11} />
                            </a>
                          )}
                        </div>
                      );
                    })}
                    {evs.length > 4 && <div className="cal-more">+{evs.length - 4} more</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {modal && (
        <div className="modal-bg">
          <div className="modal">
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <h3>New event</h3>
              <button className="iconbtn" onClick={() => setModal(null)}><Icon name="x" size={16} /></button>
            </div>
            <div className="fld"><label>Title</label><input value={form.title} autoFocus onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Obayashi RCA review" /></div>
            <div style={{ display: "flex", gap: 12 }}>
              <div className="fld" style={{ flex: 1 }}><label>Start date</label><input type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></div>
              <div className="fld" style={{ flex: 1 }}><label>End date <span style={{ color: "var(--dim)" }}>(optional)</span></label><input type="date" value={form.end} min={form.start} onChange={(e) => setForm({ ...form, end: e.target.value })} /></div>
            </div>
            <div className="fld"><label>Kind</label>
              <Select full value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </Select></div>
            {form.kind === "meeting" && (
              <>
                <div style={{ display: "flex", gap: 12 }}>
                  <div className="fld" style={{ flex: 1 }}><label>Start time</label><input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></div>
                  <div className="fld" style={{ flex: 1 }}><label>End time</label><input type="time" value={form.endTime} min={form.startTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></div>
                </div>
                <div className="fld" style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span className={"toggle" + (form.createMeeting ? " on" : "")} onClick={() => teamsConnected && setForm({ ...form, createMeeting: !form.createMeeting })} style={teamsConnected ? undefined : { opacity: .4, cursor: "not-allowed" }} />
                  <span style={{ fontSize: 13, color: "var(--text)" }}>Create a Microsoft Teams meeting</span>
                </div>
                {!teamsConnected && <div style={{ fontSize: 12, color: "var(--dim)", marginTop: -6 }}>Connect Microsoft Teams in Settings first.</div>}
              </>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 22 }}>
              <button className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn-primary" onClick={add} disabled={!form.title || !form.start || creatingMeeting}>{creatingMeeting ? "Creating meeting…" : "Add event"}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
