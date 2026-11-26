// Offline judge, stage 2: builds feed.json from picks.json + cache/pending.json.
import cfg from "../config.mjs";
import { readJson } from "./lib/store.mjs";
import { cleanPicks } from "./lib/judge.mjs";
import { finish } from "./lib/finish.mjs";

const ctx = await readJson("cache/pending.json");
const raw = await readJson("picks.json");
if (raw.date !== ctx.date && raw.date !== ctx.today) throw new Error(`picks.json is for ${raw.date}, pending is for ${ctx.today}`);

const picks = {};
for (const t of ctx.threads) picks[t.id] = cleanPicks(raw.picks?.[t.id], ctx.candidates[t.id] || [], t.perDay);
await finish({ ctx, result: { picks, newSearches: raw.newSearches || {}, nudgeLines: raw.nudgeLines || null }, cfg, log: console.log });
