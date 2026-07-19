import { useEffect, useRef, useState } from "react";
import { Icon } from "../lib/icons";
import { Modal } from "./Modal";
import { useAgent } from "../context/Agent";
import { devLogSnapshot } from "../lib/agent";

/** Live-tails a running dev server's stdout/stderr — snapshot (ring buffer, agent/server.mjs) then `dev:log` events over the shared agent websocket. */
export function DevLogsModal({ pid, project, onClose }: { pid: number; project: string; onClose: () => void }) {
  const { subscribe } = useAgent();
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let cancelled = false;
    devLogSnapshot(pid).then((r) => { if (!cancelled) { setLines(r.lines); setLoading(false); } });
    const unsub = subscribe((event, payload) => {
      if (event !== "dev:log") return;
      const p = payload as { pid?: number; line?: string };
      if (p.pid !== pid) return;
      setLines((prev) => [...prev, p.line || ""]);
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
    });
    return unsub;
  }, [pid, subscribe]);

  return (
    <Modal onClose={onClose} style={{ width: 720, maxWidth: "90vw" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <Icon name="terminal" size={17} />Logs · {project}<span className="pill live" style={{ fontSize: 10.5 }}><span className="dotled" />Live</span>
        </h3>
        <button className="iconbtn" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>
      <pre ref={scrollRef} className="mono" style={{ marginTop: 14, maxHeight: "60vh", overflow: "auto", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 14, fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
        {loading ? "Loading…" : lines.length ? lines.join("\n") : "(no output yet)"}
      </pre>
    </Modal>
  );
}
