// Picks today's single "do this instead" nudge. One id per day, no repeats.
import { daysBetween, localHour } from "./time.mjs";

const WEATHER_TAGS = { "good-weather": "goodWeather", snow: "snow", "clear-night": "clearNight" };
const LOCATION_TAGS = ["boulder", "loveland"];

function slotForHour(h) {
  return h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night";
}

// The time slot of today's biggest free stretch; falls back to a guess from the day type.
export function targetSlot({ gaps, dayType, tz }) {
  const best = (gaps || []).filter((g) => g.minutes >= 15).sort((a, b) => b.minutes - a.minutes)[0];
  if (best) {
    const mid = new Date(best.start + (best.minutes * 60e3) / 2);
    return { slot: slotForHour(localHour(mid, tz)), freeMinutes: best.minutes };
  }
  return { slot: { free: "afternoon", normal: "evening", busy: "night" }[dayType], freeMinutes: null };
}

export function eligible(nudges, { weather, location, freeMinutes }) {
  return nudges.filter((n) => {
    for (const tag of n.tags) {
      if (WEATHER_TAGS[tag] && !weather?.[WEATHER_TAGS[tag]]) return false;
      if (LOCATION_TAGS.includes(tag) && tag !== location) return false;
    }
    return freeMinutes === null || n.minutes <= freeMinutes;
  });
}

// seen = { history: [{id, date}], cycle: [ids used since the last reset] }
export function pickNudge(nudges, seen, ctx, cfg, rand = Math.random) {
  const pool = eligible(nudges, ctx);
  const recent = new Set(
    seen.history.filter((h) => daysBetween(h.date, ctx.today) < cfg.nudges.noRepeatDays).map((h) => h.id),
  );
  let open = pool.filter((n) => !seen.cycle.includes(n.id) && !recent.has(n.id));
  if (!open.length && pool.every((n) => seen.cycle.includes(n.id))) {
    seen.cycle = []; // every eligible nudge has been used: start a new cycle
    open = pool.filter((n) => !recent.has(n.id));
  }
  if (!open.length) return null;
  const score = (n) =>
    (n.bestTime === ctx.slot ? 2 : 0) +
    (n.tags.some((t) => WEATHER_TAGS[t] || LOCATION_TAGS.includes(t)) ? 1.5 : 0) +
    rand();
  const pick = open.map((n) => [score(n), n]).sort((a, b) => b[0] - a[0])[0][1];
  seen.history.push({ id: pick.id, date: ctx.today });
  seen.cycle.push(pick.id);
  return pick;
}
