// Daily pipeline. Runs in GitHub Actions around 5am Denver time.
// Secrets: YT_API_KEY (required), ANTHROPIC_API_KEY (api judge), GCAL_ICS_URL (optional, comma-separated),
// HISTORY_SALT (optional, for watch history). Never logs calendar details.
import cfg from "../config.mjs";
import { readJson, writeJson } from "./lib/store.mjs";
import { createYouTube } from "./lib/youtube.mjs";
import { localDate } from "./lib/time.mjs";
import { bookedToday } from "./lib/calendar.mjs";
import { todayWeather } from "./lib/weather.mjs";
import { dayTypeFor, budgetFor } from "./lib/budget.mjs";
import { gather } from "./lib/gather.mjs";
import { loadSeenChecker } from "./lib/history.mjs";
import { pickNudge, targetSlot } from "./lib/nudges.mjs";
import { judgeWithApi, cleanPicks, SYSTEM, NUDGE_SYSTEM, threadPrompt, nudgePrompt } from "./lib/judge.mjs";
import { finish } from "./lib/finish.mjs";

const log = (...a) => console.log(...a);
const mode = process.env.JUDGE || cfg.judge.mode;
if (!process.env.YT_API_KEY) throw new Error("Missing YT_API_KEY");
if (mode === "api" && !process.env.ANTHROPIC_API_KEY) {
  throw new Error("judge.mode is \"api\" but ANTHROPIC_API_KEY is not set. Add the secret, or set judge.mode to \"offline\" in config.mjs.");
}

const now = Date.now();
const today = process.env.FEED_DATE || localDate(new Date(now), cfg.timezone);
log(`Building feed for ${today} (judge: ${mode}, location: ${cfg.location})`);

// a) Calendar -> day type and budget
const urls = (process.env.GCAL_ICS_URL || "").split(",").map((s) => s.trim()).filter(Boolean);
let cal = { ok: false, hours: 0, eventCount: null, gaps: [] };
if (urls.length) cal = await bookedToday(urls, today, cfg);
else log("No GCAL_ICS_URL set; assuming a normal day");
const dayType = cal.ok ? dayTypeFor(cal.hours, cfg) : "normal";
const budgetMinutes = budgetFor(dayType, today, cfg);
log(`Day: ${dayType}, budget ${budgetMinutes} min`);

// b) Weather
let weather = null;
try { weather = await todayWeather(cfg, today); } catch (e) { log(`Weather unavailable: ${e.message}`); }

// c-d) Gather and hard-filter
const threadsFile = await readJson("threads.json");
const threads = threadsFile.threads;
const channels = await readJson("channels.json", {});
const seedIds = Object.fromEntries(threads.map((t) => [t.id, t.seedChannels.map((n) => channels[n]?.id).filter(Boolean)]));
const state = {
  qstate: await readJson("queries.json", {}),
  channelCache: await readJson("cache/channels.json", {}),
  catalogs: await readJson("cache/catalogs.json", {}),
  judged: await readJson("cache/judged.json", {}),
  rosters: await readJson("rosters.json", {}),
  seedIds,
};
const isSeen = await loadSeenChecker(await readJson("seen.json", {}), process.env.HISTORY_SALT, log);
const yt = createYouTube(process.env.YT_API_KEY, +process.env.YT_UNIT_CAP || cfg.youtube.dailyUnitCap);
const candidates = await gather({ yt, cfg, threads, today, now, state, isSeen, log });
for (const t of threads) log(`  ${t.id}: ${candidates[t.id].length} candidates`);
log(`YouTube units used: ${yt.used}`);

await writeJson("queries.json", state.qstate);
await writeJson("cache/channels.json", state.channelCache, { compact: true });
await writeJson("cache/catalogs.json", state.catalogs, { compact: true });

// Nudge (picked here so both judge modes share it)
const nudgesSeen = await readJson("nudges-seen.json", { history: [], cycle: [] });
const { slot, freeMinutes } = targetSlot({ gaps: cal.ok ? cal.gaps : [], dayType, tz: cfg.timezone });
const nudge = pickNudge(await readJson("nudges.json"), nudgesSeen, { today, weather, location: cfg.location, freeMinutes, slot }, cfg);
await writeJson("nudges-seen.json", nudgesSeen);
log(`Nudge: ${nudge ? nudge.id : "none eligible"} (${slot})`);

const ctx = {
  today, now, dayType, eventCount: cal.ok ? cal.eventCount : null, budgetMinutes, weather, nudge,
  warnMinutesLeft: Math.max(1, Math.round(budgetMinutes * 0.2)),
  threads, candidates, seedIds,
  globalAvoid: threadsFile.globalAvoid, notes: threadsFile.notes, descriptionChars: cfg.judge.descriptionChars,
  queriesFor: (id) => [...new Set([...(threads.find((t) => t.id === id)?.seedSearches || []), ...(state.qstate[id]?.learned || [])])],
};

// e) Judge
if (mode === "offline") {
  const { queriesFor, ...saved } = ctx;
  await writeJson("cache/pending.json", saved);
  await writeJson("candidates.json", {
    date: today,
    instructions: "Judge each thread using `system` and the thread's `prompt`. Write picks.json as " +
      '{"date": "<same date>", "picks": {"<threadId>": [{"videoId", "score" (1-10, 7+ only), "why"}]}, ' +
      '"newSearches": {"<threadId>": ["3 new queries"]}, "nudgeLines": {"normal", "warn", "done"} or null}. ' +
      "Then commit picks.json and push; the Assemble feed workflow builds feed.json from it.",
    system: SYSTEM,
    threads: threads.map((t) => ({ id: t.id, perDay: t.perDay, prompt: threadPrompt(t, candidates[t.id], { ...ctx, existingQueries: queriesFor(t.id) }) })),
    nudge: nudge ? { system: NUDGE_SYSTEM, prompt: nudgePrompt(nudge, ctx) } : null,
  });
  log("Offline mode: wrote candidates.json; waiting for picks.json");
} else {
  let result;
  if (mode === "stub") {
    // Test-only: no Claude, just the top ratios. Never use for the real feed.
    result = { picks: {}, newSearches: {}, nudgeLines: null };
    for (const t of threads) {
      const raw = candidates[t.id].map((c) => ({ videoId: c.videoId, score: 7, why: `stub pick, ${c.ratio}x channel median` }));
      result.picks[t.id] = cleanPicks(raw, candidates[t.id], t.perDay);
    }
  } else {
    result = await judgeWithApi({ threads, candidates, ctx, nudge, cfg, log });
    const p = cfg.judge.model.includes("haiku") ? [0.1, 0.5] : cfg.judge.model.includes("sonnet") ? [2, 10] : [4, 20];
    const cost = (result.usage.input * p[0] + result.usage.output * p[1]) / 1e6;
    log(`Claude tokens: ${result.usage.input} in / ${result.usage.output} out (~$${cost.toFixed(3)})`);
  }
  await finish({ ctx, result, cfg, log });
}
