import { useRef, useState } from "react";
import { Icon } from "../lib/icons";
import { runInProject } from "../lib/agent";

interface HistoryEntry { command: string; stdout: string; stderr: string; code: number; }

/**
 * Project-scoped terminal — cwd is always `path` (the project's own
 * fe_path/sln_path, resolved by the caller), never a free-form value typed
 * here. One-shot per command (not a PTY): each Enter runs `command` to
 * completion via the agent's /term/run and appends the result.
 */
export function ProjectTerminal({ path }: { path: string }) {
  const [command, setCommand] = useState("");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function run() {
    const cmd = command.trim();
    if (!cmd || running) return;
    setRunning(true);
    setCommand("");
    const r = await runInProject(path, cmd);
    setHistory((h) => [...h, {
      command: cmd,
      stdout: r.stdout || "",
      stderr: r.ok ? (r.stderr || "") : (r.error || "agent offline"),
      code: r.ok ? (r.code ?? 0) : 1,
    }]);
    setRunning(false);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }));
  }

  return (
    <div className="term-shell">
      <div className="term-scroll" ref={scrollRef}>
        {history.length === 0 && <div className="term-empty">Runs in <span className="mono">{path}</span> — try <span className="mono">git status</span> or <span className="mono">npm run build</span>.</div>}
        {history.map((h, i) => (
          <div key={i} className="term-entry">
            <div className="term-cmd"><span className="term-prompt">$</span>{h.command}</div>
            {h.stdout && <pre className="term-out">{h.stdout}</pre>}
            {h.stderr && <pre className="term-out err">{h.stderr}</pre>}
            {h.code !== 0 && <div className="term-exit">exit {h.code}</div>}
          </div>
        ))}
        {running && <div className="term-running"><Icon name="loader" size={13} className="spin" />Running…</div>}
      </div>
      <div className="term-input-row">
        <span className="term-prompt">$</span>
        <input
          className="term-input mono" value={command} disabled={running} autoComplete="off" spellCheck={false}
          onChange={(e) => setCommand(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="npm install, npm test, ls…"
        />
        <button className="btn" disabled={running || !command.trim()} onClick={run}><Icon name="play" size={13} fill />Run</button>
      </div>
    </div>
  );
}
