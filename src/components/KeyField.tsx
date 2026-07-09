import { useEffect, useState } from "react";
import { Icon } from "../lib/icons";

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  optional?: boolean;
  span?: boolean;
}

/**
 * A credential field that stays readable. These are your own keys on your own
 * machine — masking them just means you can't check them against the console.
 * The copy button is the point: grab the value without selecting it by hand.
 */
export function KeyField({ label, value, onChange, placeholder, hint, optional, span }: Props) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    if (!value) return;
    try { await navigator.clipboard.writeText(value); setCopied(true); }
    catch { /* clipboard blocked */ }
  };

  return (
    <div className="kf" style={span ? { gridColumn: "1 / -1" } : undefined}>
      <label>
        {label}
        {optional && <span className="kf-opt">optional</span>}
      </label>
      <div className="kf-wrap">
        <input
          className="kf-input mono"
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="button"
          className={"kf-copy" + (copied ? " done" : "")}
          onClick={copy}
          disabled={!value}
          title={value ? "Copy to clipboard" : "Nothing to copy"}
        >
          <Icon name={copied ? "check" : "copy"} size={14} />
        </button>
      </div>
      {hint && <div className="kf-hint">{hint}</div>}
    </div>
  );
}
