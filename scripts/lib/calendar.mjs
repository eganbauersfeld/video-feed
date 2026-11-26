// Counts booked hours today from one or more private iCal URLs.
// PRIVACY: only totals and free gaps leave this module. Never log or return titles, locations or URLs.
import ical from "node-ical";
import { zonedTime } from "./time.mjs";

export async function bookedToday(urls, today, cfg) {
  const { startHour, endHour } = cfg.dayWindow;
  const winStart = zonedTime(today, startHour, cfg.timezone).getTime();
  const winEnd = zonedTime(today, endHour, cfg.timezone).getTime();
  const intervals = [];
  let failed = 0;

  for (const [i, url] of urls.entries()) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = ical.sync.parseICS(await res.text());
      for (const ev of Object.values(data)) {
        if (ev.type !== "VEVENT" || !ev.start) continue;
        if (ev.transparency === "TRANSPARENT") continue; // marked "free"
        if (ev.status === "CANCELLED") continue;
        let instances;
        try {
          instances = ical.expandRecurringEvent(ev, {
            from: new Date(winStart), to: new Date(winEnd), expandOngoing: true, maxIterations: 100000,
          });
        } catch {
          continue;
        }
        for (const inst of instances) {
          if (inst.isFullDay) continue; // all-day events aren't booked time
          const s = Math.max(new Date(inst.start).getTime(), winStart);
          const e = Math.min(new Date(inst.end ?? inst.start).getTime(), winEnd);
          if (e > s) intervals.push([s, e]);
        }
      }
    } catch (e) {
      failed++;
      console.warn(`Calendar #${i + 1} could not be read (${e.message.split("\n")[0].slice(0, 80)})`);
    }
  }

  // Merge overlaps so double-booked time counts once.
  intervals.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const iv of intervals) {
    const last = merged.at(-1);
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else merged.push([...iv]);
  }
  const bookedMs = merged.reduce((n, [s, e]) => n + (e - s), 0);

  // Free gaps inside the window (used to time the nudge).
  const gaps = [];
  let cursor = winStart;
  for (const [s, e] of merged) {
    if (s > cursor) gaps.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < winEnd) gaps.push([cursor, winEnd]);

  return {
    ok: failed < urls.length,
    hours: bookedMs / 3600e3,
    eventCount: intervals.length,
    gaps: gaps.map(([s, e]) => ({ start: s, minutes: Math.round((e - s) / 60e3) })),
  };
}
