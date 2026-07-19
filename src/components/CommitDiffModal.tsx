import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { Icon } from "../lib/icons";
import { Badge, ACCENT, Empty } from "./ui";
import { gitShow, type GitCommit } from "../lib/agent";
import { parsePatch, type DiffFile, type DiffStatus } from "../lib/gitDiff";

const STATUS_BADGE: Record<DiffStatus, { text: string; color: string }> = {
  added: { text: "Added", color: ACCENT.mint },
  deleted: { text: "Deleted", color: ACCENT.red },
  renamed: { text: "Renamed", color: ACCENT.blue },
  modified: { text: "Modified", color: ACCENT.amber },
};

/** Shows one commit's full patch — file list + colored unified diff — fetched fresh via the agent's /git/show. */
export function CommitDiffModal({ path, hash, onClose }: { path: string; hash: string; onClose: () => void }) {
  const [commit, setCommit] = useState<GitCommit | null>(null);
  const [files, setFiles] = useState<DiffFile[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setFiles(null);
    gitShow(path, hash).then((r) => {
      if (cancelled) return;
      setLoading(false);
      if (!r.ok) { setError(r.error || "Couldn't load that commit."); return; }
      setCommit(r.commit ?? null);
      setFiles(parsePatch(r.patch ?? ""));
    });
    return () => { cancelled = true; };
  }, [path, hash]);

  return (
    <Modal onClose={onClose} style={{ width: 780, maxWidth: "94vw", maxHeight: "88vh", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexShrink: 0 }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}><Icon name="git" size={16} /><span className="mono">{hash.slice(0, 10)}</span></h3>
          {commit && (
            <>
              <div style={{ marginTop: 4, fontSize: 13.5, color: "var(--text2)" }}>{commit.subject}</div>
              <div style={{ marginTop: 3, fontSize: 11.5, color: "var(--dim)" }}>{commit.author} · {new Date(commit.date).toLocaleString()}</div>
            </>
          )}
        </div>
        <button className="iconbtn" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>

      <div style={{ marginTop: 14, overflowY: "auto", flex: 1, minHeight: 0 }}>
        {loading ? (
          <div style={{ padding: "24px 0", textAlign: "center", color: "var(--dim)", fontSize: 13 }}>Loading diff…</div>
        ) : error ? (
          <div style={{ color: "var(--amber)", fontSize: 13 }}>{error}</div>
        ) : !files || files.length === 0 ? (
          <Empty icon="git" title="No changes" sub="This commit has no file changes to show (e.g. an empty or merge-only commit)." mini />
        ) : (
          files.map((f) => (
            <div key={f.path} className="diff-file">
              <div className="diff-file-head">
                <Badge text={STATUS_BADGE[f.status].text} color={STATUS_BADGE[f.status].color} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
                </span>
              </div>
              {f.binary ? (
                <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--dim)" }}>Binary file — no text diff.</div>
              ) : (
                f.hunks.map((h, i) => (
                  <div key={i}>
                    <div className="diff-hunk-header">{h.header}</div>
                    {h.lines.map((l, j) => (
                      <div key={j} className={"diff-line " + l.type}>
                        <span className="dl-mark">{l.type === "add" ? "+" : l.type === "del" ? "−" : ""}</span>
                        <span className="dl-text">{l.text || " "}</span>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
