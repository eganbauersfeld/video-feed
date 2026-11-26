// Timezone helpers without a date library.

function parts(date, tz) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const o = {};
  for (const p of f.formatToParts(date)) if (p.type !== "literal") o[p.type] = +p.value;
  return o;
}

// Offset of tz from UTC at the given instant, in ms.
function offsetMs(date, tz) {
  const p = parts(date, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

// "YYYY-MM-DD" for the instant in tz.
export function localDate(date, tz) {
  const p = parts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function localHour(date, tz) {
  return parts(date, tz).hour;
}

// Instant for a wall-clock time on a local date in tz.
export function zonedTime(dateStr, hour, tz) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour);
  let t = guess - offsetMs(new Date(guess), tz);
  t = guess - offsetMs(new Date(t), tz); // second pass settles DST edges
  return new Date(t);
}

export function daysBetween(fromStr, toStr) {
  const a = Date.UTC(...fromStr.split("-").map((n, i) => (i === 1 ? n - 1 : +n)));
  const b = Date.UTC(...toStr.split("-").map((n, i) => (i === 1 ? n - 1 : +n)));
  return Math.round((b - a) / 86400e3);
}
