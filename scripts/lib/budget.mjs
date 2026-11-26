import { daysBetween } from "./time.mjs";

export function dayTypeFor(hours, cfg) {
  if (hours < cfg.dayTypes.freeUnderHours) return "free";
  if (hours >= cfg.dayTypes.busyFromHours) return "busy";
  return "normal";
}

// Budget minutes for a day type on a date, with the taper applied after TAPER_START.
export function budgetFor(dayType, today, cfg) {
  const base = cfg.budget[dayType];
  const days = daysBetween(cfg.TAPER_START, today);
  if (days <= 0) return base;
  const t = cfg.taper[dayType];
  const steps = Math.floor(days / t.everyDays);
  return Math.max(t.floor, base - steps * t.stepMinutes);
}
