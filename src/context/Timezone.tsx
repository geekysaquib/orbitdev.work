import { createContext, useContext, useState, type ReactNode } from "react";

const KEY = "orbit.timezone";

function deviceTz(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

/** All IANA zones the runtime knows, or a curated fallback. */
export function allZones(): string[] {
  const sv = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  if (typeof sv === "function") { try { return sv("timeZone"); } catch { /* fall through */ } }
  return [
    "UTC", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York",
    "America/Sao_Paulo", "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Moscow",
    "Asia/Dubai", "Asia/Kolkata", "Asia/Karachi", "Asia/Dhaka", "Asia/Bangkok",
    "Asia/Singapore", "Asia/Shanghai", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland",
  ];
}

const p2 = (x: number) => String(x).padStart(2, "0");

/** HH:MM:SS wall-clock in the given zone. */
export function tzClock(tz: string, d: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d);
  } catch {
    return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  }
}

/** Hour (0–23) in the given zone — for greetings/day-part logic. */
export function tzHour(tz: string, d: Date = new Date()): number {
  try {
    const s = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(d);
    return parseInt(s, 10) % 24;
  } catch { return d.getHours(); }
}

/** Long date (e.g. "Tuesday, 7 July") in the given zone. */
export function tzDate(tz: string, d: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(d);
  } catch { return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }); }
}

/** Full date-time in the given zone (for message timestamps etc.). */
export function tzDateTime(tz: string, d: Date): string {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(d);
  } catch { return d.toLocaleString(); }
}

/** Current UTC offset label for a zone, e.g. "GMT+5:30". */
export function tzOffset(tz: string, d: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(d);
    return parts.find((p) => p.type === "timeZoneName")?.value || "";
  } catch { return ""; }
}

/** Common country / region search aliases → substrings of matching IANA zones. */
const ZONE_ALIASES: Record<string, string> = {
  "asia/tokyo": "japan jp jst tokyo", "asia/kolkata": "india in ist bharat kolkata calcutta mumbai delhi bangalore",
  "asia/karachi": "pakistan pk karachi", "asia/dhaka": "bangladesh bd dhaka", "asia/colombo": "sri lanka colombo",
  "asia/kathmandu": "nepal kathmandu", "asia/dubai": "uae emirates dubai abu dhabi", "asia/riyadh": "saudi arabia riyadh",
  "asia/tehran": "iran tehran", "asia/jerusalem": "israel jerusalem", "asia/istanbul": "turkey istanbul",
  "europe/istanbul": "turkey istanbul", "asia/shanghai": "china cn shanghai beijing", "asia/hong_kong": "hong kong hk",
  "asia/singapore": "singapore sg", "asia/seoul": "south korea korea seoul", "asia/bangkok": "thailand bangkok",
  "asia/jakarta": "indonesia jakarta", "asia/kuala_lumpur": "malaysia kuala lumpur", "asia/manila": "philippines manila",
  "asia/ho_chi_minh": "vietnam ho chi minh saigon", "asia/taipei": "taiwan taipei",
  "europe/london": "uk united kingdom england britain gb london gmt bst", "europe/paris": "france fr paris",
  "europe/berlin": "germany de berlin", "europe/madrid": "spain es madrid", "europe/rome": "italy it rome",
  "europe/amsterdam": "netherlands holland amsterdam", "europe/moscow": "russia ru moscow", "europe/zurich": "switzerland zurich",
  "europe/dublin": "ireland dublin", "europe/lisbon": "portugal lisbon", "europe/stockholm": "sweden stockholm",
  "europe/warsaw": "poland warsaw", "europe/athens": "greece athens", "europe/kyiv": "ukraine kyiv kiev",
  "america/new_york": "usa us united states america new york eastern est edt nyc", "america/chicago": "usa us central time chicago cst",
  "america/denver": "usa us mountain time denver mst", "america/los_angeles": "usa us pacific time los angeles la california pst pdt",
  "america/toronto": "canada toronto", "america/vancouver": "canada vancouver", "america/mexico_city": "mexico mexico city",
  "america/sao_paulo": "brazil brasil sao paulo", "america/buenos_aires": "argentina buenos aires",
  "america/argentina/buenos_aires": "argentina buenos aires", "america/bogota": "colombia bogota", "america/lima": "peru lima",
  "america/santiago": "chile santiago", "africa/cairo": "egypt cairo", "africa/johannesburg": "south africa johannesburg",
  "africa/lagos": "nigeria lagos", "africa/nairobi": "kenya nairobi", "africa/casablanca": "morocco casablanca",
  "australia/sydney": "australia sydney nsw", "australia/melbourne": "australia melbourne", "australia/perth": "australia perth",
  "pacific/auckland": "new zealand nz auckland", "utc": "utc gmt universal coordinated",
};

/** True if the zone matches a free-text query by IANA path, city, or country alias. */
export function zoneMatches(zone: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${zone} ${zone.replace(/[_/]/g, " ")} ${ZONE_ALIASES[zone.toLowerCase()] || ""}`.toLowerCase();
  return q.split(/\s+/).every((tok) => hay.includes(tok));
}

interface TZShape { tz: string; setTz: (t: string) => void; isDefault: boolean; }
const Ctx = createContext<TZShape | undefined>(undefined);

export function TimezoneProvider({ children }: { children: ReactNode }) {
  const [tz, setTzState] = useState<string>(() => {
    try { return localStorage.getItem(KEY) || deviceTz(); } catch { return deviceTz(); }
  });
  const setTz = (t: string) => {
    try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
    setTzState(t);
  };
  const isDefault = tz === deviceTz();
  return <Ctx.Provider value={{ tz, setTz, isDefault }}>{children}</Ctx.Provider>;
}

export function useTimezone(): TZShape {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTimezone must be used inside TimezoneProvider");
  return c;
}

export { deviceTz };
