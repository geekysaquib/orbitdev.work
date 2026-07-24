/**
 * Shared helper for optional small-image uploads (team logos, profile
 * avatars) that get stored as base64 data URIs in a text column — same
 * approach as email attachments in Mail.tsx, chosen because no Supabase
 * Storage bucket is provisioned for this project and both `teams`/`users`
 * writes already go through service-role Netlify functions.
 */
export const MAX_IMAGE_BYTES = 250 * 1024; // keeps rows/JSON payloads small — this is for logos/avatars, not general files

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(0)} KB`;
}

export function readImageAsDataUrl(file: File): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  if (!file.type.startsWith("image/")) {
    return Promise.resolve({ ok: false, error: "Please choose an image file." });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return Promise.resolve({ ok: false, error: `Image is larger than ${fmtBytes(MAX_IMAGE_BYTES)} — choose a smaller one.` });
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ ok: true, dataUrl: String(reader.result || "") });
    reader.onerror = () => resolve({ ok: false, error: "Couldn't read that file." });
    reader.readAsDataURL(file);
  });
}
