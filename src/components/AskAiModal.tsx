/**
 * Ask AI — a grounded conversation about the user's workspace.
 *
 * Stays mounted (hidden via the `open` prop) rather than being conditionally
 * rendered, so a thread survives closing and reopening the modal, and the context
 * prefetch on mount has somewhere to live. Both would be lost on unmount.
 *
 * The workspace snapshot rides in the first user turn rather than the system prompt:
 * the agent truncates `system` at 6000 chars, and a snapshot with ids in it is big
 * enough to be silently clipped there. It's re-applied from the cache on every
 * submit, so a follow-up after a Refresh sees current data while `turns` stays a
 * clean transcript.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { Modal } from "./Modal";
import { AiThinking, formatDuration } from "./AiThinking";
import { askThread, type AiSource, type AiMessage } from "../lib/ai";
import { buildAppContext, primeAskContext, invalidateAskContext, type ActionIndex } from "../lib/askContext";
import { parseActions, actionHref, actionIcon, ACTIONS_CONTRACT, type Action } from "../lib/askActions";
import { fetchIntegrations } from "../lib/integrations";
import { startTimer, isTimerRunning } from "../lib/timer";
import { useToast } from "../context/Toast";
import { useAgent } from "../context/Agent";
import { useBreak } from "../context/Break";

const EXAMPLES = ["What should I focus on today?", "Summarize my open work", "Any risks in my sprints?"];
const PERSONA = "You are ORBIT's assistant, helping a developer with their day across projects, tasks, tickets, and Zoho sprints. Answer concisely and concretely, grounded in the workspace summary you're given — don't invent details it doesn't support.";

interface Turn { role: "user" | "assistant"; text: string; actions?: Action[]; source?: AiSource; ms?: number }

/** Wrap the snapshot around the opening user turn; strip any leftover fences from history. */
function wireMessages(turns: Turn[], ctxText: string): AiMessage[] {
  const msgs: AiMessage[] = turns.map((t) => ({ role: t.role, content: t.text }));
  if (msgs[0]?.role === "user") msgs[0] = { role: "user", content: `<workspace>\n${ctxText}\n</workspace>\n\n${msgs[0].content}` };
  return msgs;
}

function ago(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}

export function AskAiModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const { status: agentStatus } = useAgent();
  const { onBreak } = useBreak();
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorSource, setErrorSource] = useState<AiSource | null>(null);
  const [contextReady, setContextReady] = useState(false);
  const [snapshotAt, setSnapshotAt] = useState<number | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef<ActionIndex | null>(null);
  const contextRef = useRef<string>("");

  // Warm the workspace snapshot at mount (Layout mounts this once, signed in), so
  // opening Ask AI doesn't pay the 9-30s Zoho gather. Safe to call repeatedly —
  // the cache dedupes in-flight gathers.
  useEffect(() => { primeAskContext(); }, []);

  const loadContext = () => {
    setContextReady(false);
    Promise.all([fetchIntegrations(), buildAppContext()])
      .then(([i, ctx]) => {
        setApiKey(i?.anthropic_api_key || null);
        contextRef.current = ctx.text;
        indexRef.current = ctx.index;
        setSnapshotAt(ctx.at);
        setContextReady(true);
      })
      .catch(() => setError("Couldn't read your workspace — check your connection and try again."));
  };
  useEffect(loadContext, []);

  // autoFocus only fires on a real mount, and this component no longer remounts.
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [turns, busy]);

  async function submit(q: string) {
    const text = q.trim();
    if (!text || busy || !contextReady) return;
    setQuestion("");
    setError(null);
    setBusy(true);
    const started = Date.now();
    const next: Turn[] = [...turns, { role: "user", text }];
    setTurns(next);

    // The actions contract goes to the cloud model only: the local 1B model at 384
    // tokens truncates the fence more often than it closes one, and the contract
    // would crowd out the prose it actually needs to produce.
    const system = apiKey ? `${PERSONA}\n${ACTIONS_CONTRACT}` : PERSONA;
    const r = await askThread(wireMessages(next, contextRef.current), system, apiKey);
    setBusy(false);
    if (!r.ok) {
      setError(r.error || "Couldn't get an answer");
      setErrorSource(r.source);
      setTurns(turns); // drop the unanswered question rather than stranding it mid-thread
      setQuestion(text);
      return;
    }
    const { prose, actions } = parseActions(r.text || "", indexRef.current ?? { tickets: new Map(), projects: new Map(), sprintItems: new Map(), timerProjects: new Map() });
    setTurns([...next, { role: "assistant", text: prose || "(no answer)", actions, source: r.source, ms: Date.now() - started }]);
  }

  function runAction(a: Action) {
    if (a.kind === "start_timer") {
      if (agentStatus !== "online") { toast("Agent required — start the ORBIT agent to run the timer"); return; }
      if (onBreak) { toast("You're on a break — resume is disabled until you're refreshed."); return; }
      if (isTimerRunning()) { toast("A timer is already running — stop it on the Time page first"); return; }
      startTimer(a.projectId);
      toast(a.label.replace(/^Start timer on/, "Timer started on"));
      onClose();
      nav("/time");
      return;
    }
    const href = actionHref(a);
    if (!href) return;
    onClose();
    nav(href);
  }

  function refresh() {
    invalidateAskContext();
    loadContext();
  }

  if (!open) return null;

  const empty = turns.length === 0;
  return (
    <Modal onClose={onClose} style={{ width: 560, maxWidth: "90vw" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ display: "flex", alignItems: "center", gap: 9 }}><span style={{ color: "var(--mint)" }}><Icon name="sparkles" size={18} /></span>Ask AI</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {!empty && <button className="btn ghost sm" onClick={() => { setTurns([]); setError(null); }}>New chat</button>}
          <button className="iconbtn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
      </div>
      <p style={{ color: "var(--dim)", fontSize: 11.5, marginTop: 6 }}>
        {!contextReady
          ? "Gathering your projects, tasks, tickets, and Zoho sprints…"
          : apiKey
            ? "Answered by Claude, grounded in your projects, tasks, tickets, and Zoho sprints. Ask follow-ups."
            : "No Anthropic key set — this tries the free local model instead (needs Python + llama-cpp-python, see Settings)."}
      </p>

      {!empty && (
        <div className="ai-thread" ref={scrollRef}>
          {turns.map((t, i) => (
            t.role === "user" ? (
              <div key={i} className="ai-turn-user">{t.text}</div>
            ) : (
              <div key={i} className="ai-turn-assistant">
                <div className="ai-answer">{t.text}</div>
                {t.actions && t.actions.length > 0 && (
                  <div className="ai-actions">
                    {t.actions.map((a, j) => (
                      <button key={j} className="btn ghost sm" onClick={() => runAction(a)}>
                        <Icon name={actionIcon(a)} size={12} />{a.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="ai-source">
                  <span>via {t.source === "local" ? "local model (free)" : "Claude"}{t.ms ? ` · ${formatDuration(t.ms)}` : ""}</span>
                  <button className="btn ghost sm" onClick={() => { navigator.clipboard.writeText(t.text); }}><Icon name="copy" size={12} />Copy</button>
                </div>
              </div>
            )
          ))}
        </div>
      )}

      <div className="dk-field" style={{ marginTop: 14 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            ref={inputRef} className="dk-in" value={question}
            placeholder={empty ? "Ask about your work…" : "Ask a follow-up…"}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(question); }}
          />
          <button className="btn accent" disabled={!question.trim() || busy || !contextReady} onClick={() => submit(question)}>
            {busy || !contextReady ? <Icon name="loader" size={14} className="spin" /> : <Icon name="play" size={13} fill />}
          </button>
        </div>
      </div>

      {empty && !busy && !error && (
        <div className="ai-chips">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="ai-chip" disabled={!contextReady} onClick={() => submit(ex)}>{ex}</button>
          ))}
        </div>
      )}
      {/* Also active during the context gather — that wait used to show nothing at all. */}
      <AiThinking active={busy || !contextReady} />
      {busy && !apiKey && <p style={{ color: "var(--dim)", fontSize: 11.5, marginTop: 10 }}>First run of the local model can take a while if it still needs to download.</p>}
      {error && (
        <div className="pg-error" style={{ marginTop: 14 }}>
          <Icon name="plug" size={16} />
          <div>
            {error}
            {errorSource === "local" && <div style={{ marginTop: 6 }}><button className="btn ghost sm" onClick={() => { onClose(); nav("/settings?section=ai"); }}>Open AI settings</button></div>}
          </div>
        </div>
      )}
      {contextReady && snapshotAt !== null && (
        <div className="ai-source" style={{ marginTop: 10 }}>
          <span>Snapshot {ago(Date.now() - snapshotAt)}</span>
          <button className="btn ghost sm" onClick={refresh}><Icon name="refresh" size={12} />Refresh</button>
        </div>
      )}
    </Modal>
  );
}
