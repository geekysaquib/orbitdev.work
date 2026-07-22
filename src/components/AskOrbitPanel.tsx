import { useState } from "react";
import type { Entity, KnowledgeEngine } from "../engines/knowledge";
import { PROMPTS, matchPrompt, runPrompt, type AskOrbitTurn, type PromptDef } from "../lib/askOrbit";
import { Icon } from "../lib/icons";
import { AnswerDetail } from "./AnswerDetail";

export interface AskOrbitPanelProps {
  knowledge: KnowledgeEngine;
  projects: Entity[];
  tasks: Entity[];
  turns: AskOrbitTurn[];
  onTurnsChange: (turns: AskOrbitTurn[]) => void;
}

/**
 * The embeddable "Ask Orbit" bar + prompt chips + conversation thread —
 * extracted from `Intelligence.tsx` so the `/home` dashboard can host the
 * exact same experience in full, not a link out to a separate page. `turns`
 * is a controlled prop (not internal state) so a host page can read
 * `turns.length` itself if it needs to (e.g. `Intelligence.tsx`'s empty-state
 * check).
 */
export function AskOrbitPanel({ knowledge, projects, tasks, turns, onTurnsChange }: AskOrbitPanelProps) {
  const [askText, setAskText] = useState("");
  const [noMatch, setNoMatch] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<PromptDef | null>(null);
  const [paramValue, setParamValue] = useState("");
  const [asking, setAsking] = useState(false);

  async function submitPrompt(p: PromptDef, paramId?: string) {
    setAsking(true);
    setPendingPrompt(null);
    try {
      const answer = await runPrompt(knowledge, p.id, paramId);
      const paramLabel = paramId ? (p.needsProject ? projects : tasks).find((e) => e.ref.id === paramId)?.label : undefined;
      const label = paramLabel
        ? p.id === "explainProject" ? `Explain ${paramLabel}` : `Related to ${paramLabel}`
        : p.prompt;
      onTurnsChange([...turns, { turnId: `${Date.now()}`, questionId: p.id, label, answer }]);
    } finally {
      setAsking(false);
    }
  }

  function choosePrompt(p: PromptDef) {
    setAskText(""); setNoMatch(false);
    if (p.needsProject || p.needsTask) { setPendingPrompt(p); setParamValue(""); return; }
    void submitPrompt(p);
  }

  function submitAsk() {
    const matched = matchPrompt(askText);
    if (!matched) { setNoMatch(true); return; }
    choosePrompt(matched);
  }

  return (
    <>
      <div className="card" style={{ marginTop: 16, padding: 16 }}>
        <div className="ds" style={{ marginBottom: 8 }}>Ask Orbit</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="dk-in" style={{ flex: 1 }}
            value={askText}
            placeholder="Ask about a project, a task, or what's going on…"
            onChange={(e) => { setAskText(e.target.value); setNoMatch(false); }}
            onKeyDown={(e) => e.key === "Enter" && submitAsk()}
          />
          <button className="btn accent" disabled={!askText.trim() || asking} onClick={submitAsk}>
            {asking ? <Icon name="loader" size={14} className="spin" /> : <Icon name="play" size={13} fill />}
          </button>
        </div>
        {noMatch && (
          <p style={{ fontSize: 11.5, color: "var(--amber)", marginTop: 8 }}>
            Orbit doesn't have an answer for that yet — try one of these:
          </p>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {PROMPTS.map((p) => (
            <button key={p.id} className="ai-chip" onClick={() => choosePrompt(p)}>
              <Icon name={p.icon} size={12} />{p.prompt}
            </button>
          ))}
        </div>

        {pendingPrompt && (
          <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select className="dk-in" style={{ maxWidth: 280 }} value={paramValue} onChange={(e) => setParamValue(e.target.value)} autoFocus>
              <option value="">{pendingPrompt.needsProject ? "Choose a project…" : "Choose a task…"}</option>
              {(pendingPrompt.needsProject ? projects : tasks).map((e) => <option key={e.ref.id} value={e.ref.id}>{e.label}</option>)}
            </select>
            <button className="btn accent sm" disabled={!paramValue || asking} onClick={() => submitPrompt(pendingPrompt, paramValue)}>
              {asking ? <Icon name="loader" size={13} className="spin" /> : "Ask"}
            </button>
            <button className="btn ghost sm" onClick={() => setPendingPrompt(null)}>Cancel</button>
          </div>
        )}
      </div>

      {turns.length > 0 && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {turns.map((t) => (
            <div key={t.turnId} className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 11.5, color: "var(--dim)" }}>{t.label}</div>
              <AnswerDetail questionId={t.questionId} answer={t.answer} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
