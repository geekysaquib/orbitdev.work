import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";

interface Cmd { label: string; icon: string; hint?: string; run: () => void; group: string; }

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const go = (to: string) => { nav(to); onClose(); };
  const commands: Cmd[] = useMemo(() => [
    { group: "Go to", label: "Dashboard", icon: "grid", run: () => go("/") },
    { group: "Go to", label: "Projects", icon: "boxes", run: () => go("/projects") },
    { group: "Go to", label: "Sprints", icon: "sprint", run: () => go("/sprints") },
    { group: "Go to", label: "Tasks", icon: "layers", run: () => go("/tasks") },
    { group: "Go to", label: "Calendar", icon: "cal", run: () => go("/calendar") },
    { group: "Go to", label: "Automation", icon: "zap", run: () => go("/automation") },
    { group: "Go to", label: "Time", icon: "timer", run: () => go("/time") },
    { group: "Go to", label: "Notifications", icon: "bell", run: () => go("/notifications") },
    { group: "Go to", label: "Docs", icon: "book", run: () => go("/docs") },
    { group: "Go to", label: "Settings", icon: "settings", run: () => go("/settings") },
    { group: "Actions", label: "New project", icon: "plus", run: () => go("/projects") },
    { group: "Actions", label: "Start Work", icon: "zap", run: () => go("/automation") },
  ], []); // eslint-disable-line

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? commands.filter((c) => c.label.toLowerCase().includes(s)) : commands;
  }, [q, commands]);

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
      else if (e.key === "Enter") { e.preventDefault(); filtered[active]?.run(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [filtered, active, onClose]);

  let lastGroup = "";
  return (
    <div className="cmdk-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cmdk">
        <div className="cmdk-input">
          <Icon name="search" size={17} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Jump to a page or action…" />
          <kbd style={{ color: "var(--dim)", fontSize: 11 }}>ESC</kbd>
        </div>
        <div className="cmdk-list">
          {filtered.length === 0 && <div className="cmdk-empty">No matches for “{q}”.</div>}
          {filtered.map((c, i) => {
            const showGroup = c.group !== lastGroup; lastGroup = c.group;
            return (
              <div key={c.label}>
                {showGroup && <div className="cmdk-sec">{c.group}</div>}
                <div className={"cmdk-item" + (i === active ? " on" : "")} onMouseEnter={() => setActive(i)} onClick={c.run}>
                  <span className="ci-ic"><Icon name={c.icon} size={16} /></span>{c.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
