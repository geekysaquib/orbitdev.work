/**
 * Focus analytics — reads the focus_events table (idle/resume pairs + route
 * changes) that Break.tsx and Layout.tsx have been logging since the Insights
 * health-score work, and turns it into interrupted-hours / context-switching /
 * deep-work-streak numbers. Deliberately client-side aggregation over a plain
 * date-range select rather than a DB view: the event volume here is small
 * (a handful of idle/resume/route_change rows a day) and this was explicitly
 * deferred until there was real data to look at — see the memory note this
 * finally closes out.
 */
import { supabase } from "./supabase";

interface FocusEventRow { type: "idle" | "resume" | "route_change"; at: string }

export interface DayBucket { dateKey: string; label: string; interruptions: number; interruptedMinutes: number; routeChanges: number; longestFocusMinutes: number }
export interface HourBucket { hour: number; interruptions: number }

export interface FocusAnalytics {
  hasData: boolean;
  days: DayBucket[];
  hourHistogram: HourBucket[];
  peakInterruptedHour: number | null;
  totalInterruptions: number;
  totalInterruptedMinutes: number;
  totalRouteChanges: number;
  avgLongestFocusMinutes: number;
}

const DAY_MS = 86_400_000;
const localDayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayLabel = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });

function emptyAnalytics(): FocusAnalytics {
  return { hasData: false, days: [], hourHistogram: [], peakInterruptedHour: null, totalInterruptions: 0, totalInterruptedMinutes: 0, totalRouteChanges: 0, avgLongestFocusMinutes: 0 };
}

export async function computeFocusAnalytics(rangeDays = 14): Promise<FocusAnalytics> {
  const since = new Date(Date.now() - rangeDays * DAY_MS);
  const { data, error } = await supabase
    .from("focus_events")
    .select("type, at")
    .gte("at", since.toISOString())
    .order("at", { ascending: true });
  if (error) throw new Error(error.message);
  const events = (data ?? []) as FocusEventRow[];
  if (events.length === 0) return emptyAnalytics();

  const buckets = new Map<string, DayBucket>();
  for (let t = since.getTime(); t <= Date.now(); t += DAY_MS) {
    const d = new Date(t);
    const key = localDayKey(d);
    buckets.set(key, { dateKey: key, label: dayLabel(d), interruptions: 0, interruptedMinutes: 0, routeChanges: 0, longestFocusMinutes: 0 });
  }
  const hourHistogram: HourBucket[] = Array.from({ length: 24 }, (_, hour) => ({ hour, interruptions: 0 }));

  // idle/resume are logged as sequential pairs from the same tab session, so
  // walking the ordered stream and matching each idle to the next resume
  // gives interruption duration without needing a stored session id.
  let pendingIdleAt: Date | null = null;
  const eventsByDay = new Map<string, Date[]>();

  for (const ev of events) {
    const at = new Date(ev.at);
    const key = localDayKey(at);
    if (!eventsByDay.has(key)) eventsByDay.set(key, []);
    eventsByDay.get(key)!.push(at);

    if (ev.type === "idle") {
      pendingIdleAt = pendingIdleAt ?? at;
      const bucket = buckets.get(key);
      if (bucket) bucket.interruptions += 1;
      hourHistogram[at.getHours()].interruptions += 1;
    } else if (ev.type === "resume" && pendingIdleAt) {
      const idleKey = localDayKey(pendingIdleAt);
      const bucket = buckets.get(idleKey);
      if (bucket) bucket.interruptedMinutes += Math.round((at.getTime() - pendingIdleAt.getTime()) / 60000);
      pendingIdleAt = null;
    } else if (ev.type === "route_change") {
      const bucket = buckets.get(key);
      if (bucket) bucket.routeChanges += 1;
    }
  }

  for (const [key, times] of eventsByDay) {
    const bucket = buckets.get(key);
    if (!bucket || times.length < 2) continue;
    let longest = 0;
    for (let i = 1; i < times.length; i++) longest = Math.max(longest, times[i].getTime() - times[i - 1].getTime());
    bucket.longestFocusMinutes = Math.round(longest / 60000);
  }

  const days = Array.from(buckets.values());
  const totalInterruptions = days.reduce((sum, d) => sum + d.interruptions, 0);
  const totalInterruptedMinutes = days.reduce((sum, d) => sum + d.interruptedMinutes, 0);
  const totalRouteChanges = days.reduce((sum, d) => sum + d.routeChanges, 0);
  const streakDays = days.filter((d) => d.longestFocusMinutes > 0);
  const avgLongestFocusMinutes = streakDays.length ? Math.round(streakDays.reduce((sum, d) => sum + d.longestFocusMinutes, 0) / streakDays.length) : 0;
  const peak = hourHistogram.reduce((best, h) => (h.interruptions > (best?.interruptions ?? 0) ? h : best), null as HourBucket | null);

  return {
    hasData: true, days, hourHistogram,
    peakInterruptedHour: peak && peak.interruptions > 0 ? peak.hour : null,
    totalInterruptions, totalInterruptedMinutes, totalRouteChanges, avgLongestFocusMinutes,
  };
}
