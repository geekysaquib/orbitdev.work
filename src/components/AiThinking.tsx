import { useEffect, useRef, useState } from "react";
import { Icon } from "../lib/icons";

const PHRASES = ["Thinking", "Reading your data", "Weighing priorities", "Drafting a reply", "Almost there"];
const PHRASE_MS = 2200;

/** Claude-style "thinking" indicator — cycling status text + a live elapsed-time counter. */
export function AiThinking({ active }: { active: boolean }) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [phraseIdx, setPhraseIdx] = useState(0);
  const startRef = useRef(0);

  useEffect(() => {
    if (!active) { setElapsedMs(0); setPhraseIdx(0); return; }
    startRef.current = Date.now();
    const tick = setInterval(() => setElapsedMs(Date.now() - startRef.current), 100);
    const cycle = setInterval(() => setPhraseIdx((i) => (i + 1) % PHRASES.length), PHRASE_MS);
    return () => { clearInterval(tick); clearInterval(cycle); };
  }, [active]);

  if (!active) return null;
  return (
    <div className="ai-thinking">
      <Icon name="sparkles" size={14} className="spin" />
      <span className="ai-thinking-text">{PHRASES[phraseIdx]}…</span>
      <span className="ai-thinking-time mono">{(elapsedMs / 1000).toFixed(1)}s</span>
    </div>
  );
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
