/**
 * Shared server-side check for small base64-image-data-URL uploads (team
 * logos, profile avatars) — never trust the client's own size/type check.
 * See src/lib/imageUpload.ts for the matching client-side helper.
 */
const DATA_URL_RE = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,([A-Za-z0-9+/=]+)$/;
export const MAX_IMAGE_BYTES = 250 * 1024;

export function validateImageDataUrl(raw: unknown, label: string): string | null | { error: string } {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") return { error: `Invalid ${label}.` };
  const m = DATA_URL_RE.exec(raw);
  if (!m) return { error: `${label} must be a PNG, JPEG, GIF, WEBP or SVG image.` };
  const decodedBytes = Math.ceil((m[2].length * 3) / 4);
  if (decodedBytes > MAX_IMAGE_BYTES) return { error: `${label} is larger than ${Math.round(MAX_IMAGE_BYTES / 1024)}KB — choose a smaller image.` };
  return raw;
}
