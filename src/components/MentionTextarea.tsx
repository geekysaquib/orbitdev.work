import { useRef, useState, type TextareaHTMLAttributes } from "react";

export interface MentionCandidate { id: string; label: string; }

type Props = {
  value: string;
  onChange: (v: string) => void;
  candidates: MentionCandidate[];
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">;

/**
 * A plain textarea that pops a filtered teammate list when "@" is typed and
 * inserts "@Full Name " on select. Purely a client-side text-editing affordance
 * — the actual @mention -> notification fan-out happens server-side (see the
 * notify_project_mentions trigger in supabase/schema.sql), which matches on
 * the same "@" + full_name substring this inserts.
 */
export function MentionTextarea({ value, onChange, candidates, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [triggerPos, setTriggerPos] = useState<number | null>(null);

  const matches = query === null ? [] : candidates.filter((c) => c.label.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  function detectTrigger(text: string, caret: number) {
    const upto = text.slice(0, caret);
    const at = upto.lastIndexOf("@");
    if (at === -1 || /[\s\n]/.test(upto.slice(at + 1))) { setQuery(null); return; }
    setQuery(upto.slice(at + 1));
    setTriggerPos(at);
    setActiveIdx(0);
  }

  function select(c: MentionCandidate) {
    if (triggerPos === null || !ref.current) return;
    const caret = ref.current.selectionStart ?? value.length;
    const before = value.slice(0, triggerPos);
    const after = value.slice(caret);
    onChange(`${before}@${c.label} ${after}`);
    setQuery(null);
    const pos = before.length + c.label.length + 2;
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(pos, pos); });
  }

  return (
    <div style={{ position: "relative" }}>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => { onChange(e.target.value); detectTrigger(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
        onClick={(e) => detectTrigger(value, e.currentTarget.selectionStart ?? 0)}
        onBlur={() => setTimeout(() => setQuery(null), 120)}
        onKeyDown={(e) => {
          if (query === null || matches.length === 0) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => (i + 1) % matches.length); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => (i - 1 + matches.length) % matches.length); }
          else if (e.key === "Enter") { e.preventDefault(); select(matches[activeIdx]); }
          else if (e.key === "Escape") { setQuery(null); }
        }}
        {...rest}
      />
      {query !== null && matches.length > 0 && (
        <div className="mention-pop">
          {matches.map((c, i) => (
            <div key={c.id} className={"mention-opt" + (i === activeIdx ? " on" : "")} onMouseDown={(e) => { e.preventDefault(); select(c); }}>
              {c.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
