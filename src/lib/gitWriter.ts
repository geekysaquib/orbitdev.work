import { ask } from "./ai";

const DIFF_CAP = 12000; // keeps the prompt within reach of the free local model's context window, not just cloud

export async function generateCommitMessage(diff: string, apiKey: string | null): Promise<{ ok: boolean; text?: string; error?: string }> {
  if (!diff.trim()) return { ok: false, error: "No changes to describe — stage or edit something first." };
  const system = "You write concise, conventional git commit messages. Reply with ONLY the commit message: a short summary line (max ~72 characters), optionally a blank line then a brief body. No markdown, no quotes, no explanation, nothing else.";
  const prompt = `Write a commit message for this diff:\n\n${diff.slice(0, DIFF_CAP)}`;
  const r = await ask(prompt, system, apiKey);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, text: (r.text || "").trim() };
}

export async function generatePrDescription(commitSubjects: string[], diff: string, apiKey: string | null): Promise<{ ok: boolean; text?: string; error?: string }> {
  if (commitSubjects.length === 0 && !diff.trim()) return { ok: false, error: "No commits or changes to describe." };
  const system = "You write clear pull request descriptions in Markdown: a short summary paragraph, then a bulleted list of key changes, then a brief \"Test plan\" section if relevant. No preamble like \"Here's a description\" — start directly with the content.";
  const commitList = commitSubjects.map((s) => `- ${s}`).join("\n");
  const prompt = `Write a PR description for a branch with these commits:\n${commitList}\n\nFull diff vs. the base branch:\n\n${diff.slice(0, DIFF_CAP)}`;
  const r = await ask(prompt, system, apiKey);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, text: (r.text || "").trim() };
}
