/** Best-effort request → location/device info for login-alert emails. Never throws. */
export interface GeoInfo { ip: string; city?: string; region?: string; country?: string; }

const PRIVATE_RANGES = [/^127\./, /^10\./, /^192\.168\./, /^::1$/, /^fc00:/, /^fe80:/];

export function clientIp(headers: Record<string, string | undefined>): string {
  const raw =
    headers["x-nf-client-connection-ip"] ||
    headers["client-ip"] ||
    (headers["x-forwarded-for"] || "").split(",")[0] ||
    "";
  return raw.trim();
}

export async function lookupGeo(ip: string): Promise<GeoInfo> {
  // A loopback/LAN address (always the case under `netlify dev`, since there's
  // no real client IP to read) can't be geolocated directly. Falling back to
  // an IP-less lookup asks ipwho.is "who's asking?", which resolves to this
  // machine's real public IP/location — so local testing still shows a real
  // location instead of a permanent "Unknown". In production this branch is
  // effectively dead: Netlify always supplies the real client IP.
  const isPrivate = !ip || PRIVATE_RANGES.some((re) => re.test(ip));
  const url = isPrivate ? "https://ipwho.is/" : `https://ipwho.is/${encodeURIComponent(ip)}`;
  try {
    // Kept short: login/verify await this (see sendLoginAlert in auth.ts), so a slow
    // or unresponsive geo provider shouldn't add much latency to every sign-in.
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1200);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return { ip: isPrivate ? "unknown" : ip };
    const j = (await r.json()) as { success?: boolean; ip?: string; city?: string; region?: string; country?: string };
    if (!j.success) return { ip: isPrivate ? "unknown" : ip };
    return { ip: isPrivate ? j.ip || "unknown" : ip, city: j.city, region: j.region, country: j.country };
  } catch {
    return { ip: isPrivate ? "unknown" : ip };
  }
}

export function parseUserAgent(ua: string): { browser: string; os: string } {
  const os = /windows/i.test(ua) ? "Windows"
    : /mac os/i.test(ua) ? "macOS"
    : /android/i.test(ua) ? "Android"
    : /iphone|ipad|ipod/i.test(ua) ? "iOS"
    : /linux/i.test(ua) ? "Linux"
    : "an unknown device";
  const browser = /edg\//i.test(ua) ? "Edge"
    : /chrome\//i.test(ua) ? "Chrome"
    : /firefox\//i.test(ua) ? "Firefox"
    : /safari\//i.test(ua) && !/chrome/i.test(ua) ? "Safari"
    : "a browser";
  return { browser, os };
}
