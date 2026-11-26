import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import cfg from "../../config.mjs";
import { budgetFor, dayTypeFor } from "../lib/budget.mjs";
import { zonedTime, localDate } from "../lib/time.mjs";
import { pickNudge, eligible, targetSlot } from "../lib/nudges.mjs";
import { chooseQueries } from "../lib/gather.mjs";
import { cleanPicks } from "../lib/judge.mjs";
import { bookedToday } from "../lib/calendar.mjs";

test("day types", () => {
  assert.equal(dayTypeFor(1.9, cfg), "free");
  assert.equal(dayTypeFor(2, cfg), "normal");
  assert.equal(dayTypeFor(4.9, cfg), "normal");
  assert.equal(dayTypeFor(5, cfg), "busy");
});

test("budget holds before taper, then steps down to floors", () => {
  assert.equal(budgetFor("free", "2026-12-20", cfg), 75);
  assert.equal(budgetFor("free", "2027-01-03", cfg), 75);
  assert.equal(budgetFor("free", "2027-01-09", cfg), 75);
  assert.equal(budgetFor("free", "2027-01-10", cfg), 70);
  assert.equal(budgetFor("free", "2027-02-28", cfg), 35);
  assert.equal(budgetFor("free", "2028-01-01", cfg), 30);
  assert.equal(budgetFor("normal", "2027-01-17", cfg), 25);
  assert.equal(budgetFor("normal", "2027-06-01", cfg), 20);
  assert.equal(budgetFor("busy", "2027-01-31", cfg), 15);
  assert.equal(budgetFor("busy", "2028-01-01", cfg), 15);
});

test("timezone math", () => {
  assert.equal(zonedTime("2026-11-25", 8, "America/Denver").toISOString(), "2026-11-25T15:00:00.000Z");
  assert.equal(zonedTime("2026-07-01", 8, "America/Denver").toISOString(), "2026-07-01T14:00:00.000Z");
  assert.equal(localDate(new Date("2026-11-26T05:00:00Z"), "America/Denver"), "2026-11-25");
});

const N = [
  { id: "a", text: "A", tags: ["indoor"], minutes: 20, bestTime: "evening" },
  { id: "b", text: "B", tags: ["outdoor", "good-weather"], minutes: 30, bestTime: "afternoon" },
  { id: "c", text: "C", tags: ["outdoor", "loveland"], minutes: 30, bestTime: "afternoon" },
  { id: "d", text: "D", tags: ["indoor"], minutes: 90, bestTime: "afternoon" },
];

test("nudge eligibility: weather, location, free time", () => {
  const ids = (x) => x.map((n) => n.id).sort().join("");
  assert.equal(ids(eligible(N, { weather: { goodWeather: false }, location: "boulder", freeMinutes: null })), "ad");
  assert.equal(ids(eligible(N, { weather: { goodWeather: true }, location: "loveland", freeMinutes: 60 })), "abc");
});

test("nudges never repeat within 30 days and cycle through all", () => {
  const seen = { history: [], cycle: [] };
  const used = [];
  const base = { weather: { goodWeather: true }, location: "boulder", freeMinutes: null, slot: "afternoon" };
  for (let i = 0; i < 3; i++) {
    const today = `2026-12-0${i + 1}`;
    used.push(pickNudge(N, seen, { ...base, today }, cfg)?.id ?? null);
  }
  assert.deepEqual(used.slice(0, 3).sort(), ["a", "b", "d"]);
  // Day 4: everything eligible used within 30 days -> nothing.
  assert.equal(pickNudge(N, seen, { ...base, today: "2026-12-04" }, cfg), null);
  // 31 days after the first pick it comes back.
  assert.ok(pickNudge(N, seen, { ...base, today: "2027-01-01" }, cfg));
});

test("nudge slot from biggest free gap", () => {
  const start = zonedTime("2026-11-25", 13, "America/Denver").getTime();
  assert.equal(targetSlot({ gaps: [{ start, minutes: 180 }], dayType: "normal", tz: "America/Denver" }).slot, "afternoon");
  assert.equal(targetSlot({ gaps: [], dayType: "busy", tz: "America/Denver" }).slot, "night");
});

test("queries rotate and respect cooldown", () => {
  const t = { id: "x", seedSearches: ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"] };
  const qs = {};
  const days = ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"];
  const log = days.map((d) => chooseQueries(t, qs, d, cfg).map((c) => c.key));
  const lastSeen = {};
  days.forEach((d, i) => log[i].forEach((k) => {
    if (lastSeen[k] !== undefined) assert.ok(i - lastSeen[k] >= 5, `${k} repeated after ${i - lastSeen[k]} days`);
    lastSeen[k] = i;
  }));
  assert.equal(log[0].length, 3);
});

test("cleanPicks drops unknown ids, low scores, dupes, and caps perDay", () => {
  const cands = [{ videoId: "a" }, { videoId: "b" }, { videoId: "c" }];
  const out = cleanPicks([
    { videoId: "zz", score: 9, why: "" }, { videoId: "a", score: 6, why: "" },
    { videoId: "b", score: 8, why: "" }, { videoId: "b", score: 9, why: "" }, { videoId: "c", score: 9, why: "" },
  ], cands, 1);
  assert.deepEqual(out.map((p) => p.videoId), ["c"]);
});

test("calendar: hours, overlaps, recurring, all-day and free events", async () => {
  const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTIMEZONE
TZID:America/Denver
BEGIN:STANDARD
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
TZOFFSETFROM:-0600
TZOFFSETTO:-0700
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
TZOFFSETFROM:-0700
TZOFFSETTO:-0600
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:1
DTSTART;TZID=America/Denver:20261125T090000
DTEND;TZID=America/Denver:20261125T110000
SUMMARY:Secret meeting
END:VEVENT
BEGIN:VEVENT
UID:2
DTSTART;TZID=America/Denver:20261125T100000
DTEND;TZID=America/Denver:20261125T120000
SUMMARY:Overlap
END:VEVENT
BEGIN:VEVENT
UID:3
DTSTART;TZID=America/Denver:20261102T140000
DTEND;TZID=America/Denver:20261102T150000
RRULE:FREQ=WEEKLY;BYDAY=WE
SUMMARY:Weekly class
END:VEVENT
BEGIN:VEVENT
UID:4
DTSTART;VALUE=DATE:20261125
DTEND;VALUE=DATE:20261126
SUMMARY:All day
END:VEVENT
BEGIN:VEVENT
UID:5
DTSTART;TZID=America/Denver:20261125T180000
DTEND;TZID=America/Denver:20261125T200000
TRANSP:TRANSPARENT
SUMMARY:Free time
END:VEVENT
BEGIN:VEVENT
UID:6
DTSTART;TZID=America/Denver:20261125T060000
DTEND;TZID=America/Denver:20261125T090000
SUMMARY:Early, partly outside window
END:VEVENT
END:VCALENDAR`;
  const server = createServer((_, res) => res.end(ics)).listen(0);
  const url = `http://127.0.0.1:${server.address().port}/cal.ics`;
  try {
    const r = await bookedToday([url], "2026-11-25", cfg);
    // 8-9 (1h, clipped) + 9-12 (3h merged) + 14-15 (1h recurring Wednesday) = 5h
    assert.equal(r.ok, true);
    assert.equal(r.hours, 5);
    assert.equal(r.eventCount, 4);
    assert.equal(JSON.stringify(r).includes("Secret"), false);
  } finally {
    server.close();
  }
});
