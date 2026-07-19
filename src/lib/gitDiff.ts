/**
 * Minimal unified-diff parser for `git show`'s patch output (see
 * agent/server.mjs's /git/show, which returns the raw patch text as-is —
 * parsing happens here so there's one source of truth for "what changed"
 * instead of duplicating file/hunk logic server-side too).
 */
export type DiffLineType = "add" | "del" | "context";
export interface DiffLine { type: DiffLineType; text: string; }
export interface DiffHunk { header: string; lines: DiffLine[]; }
export type DiffStatus = "added" | "deleted" | "renamed" | "modified";
export interface DiffFile { path: string; oldPath?: string; status: DiffStatus; hunks: DiffHunk[]; binary: boolean; }

const FILE_HEADER_RE = /^diff --git a\/(.*) b\/(.*)$/;
const HUNK_HEADER_RE = /^@@ .* @@/;

export function parsePatch(patch: string): DiffFile[] {
  if (!patch.trim()) return [];
  const lines = patch.split("\n");
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let hunk: DiffHunk | null = null;

  const pushHunk = () => { if (current && hunk) current.hunks.push(hunk); hunk = null; };
  const pushFile = () => { pushHunk(); if (current) files.push(current); };

  for (const line of lines) {
    const fileMatch = line.match(FILE_HEADER_RE);
    if (fileMatch) {
      pushFile();
      current = { path: fileMatch[2], oldPath: fileMatch[1] !== fileMatch[2] ? fileMatch[1] : undefined, status: "modified", hunks: [], binary: false };
      continue;
    }
    if (!current) continue; // stray preamble before the first file header

    if (line.startsWith("new file mode")) { current.status = "added"; continue; }
    if (line.startsWith("deleted file mode")) { current.status = "deleted"; continue; }
    if (line.startsWith("rename from")) { current.status = "renamed"; continue; }
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) { current.binary = true; continue; }
    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("index ") || line.startsWith("similarity index") || line.startsWith("rename to")) continue;

    if (HUNK_HEADER_RE.test(line)) {
      pushHunk();
      hunk = { header: line, lines: [] };
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    if (line.startsWith("+")) hunk.lines.push({ type: "add", text: line.slice(1) });
    else if (line.startsWith("-")) hunk.lines.push({ type: "del", text: line.slice(1) });
    else hunk.lines.push({ type: "context", text: line.startsWith(" ") ? line.slice(1) : line });
  }
  pushFile();
  return files;
}
