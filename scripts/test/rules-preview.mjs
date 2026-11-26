// Dry run of the rules judge on cached back-catalog videos (no API calls, writes nothing).
// Usage: node scripts/test/rules-preview.mjs
import { readJson } from "../lib/store.mjs";
import { judgeWithRules } from "../lib/rules-judge.mjs";

const threads = (await readJson("threads.json")).threads;
const rules = await readJson("rules.json");
const channels = await readJson("channels.json");
const catalogs = await readJson("cache/catalogs.json", {});
const cache = await readJson("cache/channels.json", {});
const seedIds = Object.fromEntries(threads.map((t) => [t.id, t.seedChannels.map((n) => channels[n]?.id).filter(Boolean)]));

const candidates = {};
for (const t of threads) {
  candidates[t.id] = (seedIds[t.id] || []).flatMap((cid) =>
    Object.entries(catalogs[cid]?.bangers || {}).map(([videoId, b]) => ({
      videoId, ...b, channelId: cid, source: "older", ratio: b.views / Math.max(cache[cid]?.median || 1, 1),
    })),
  ).filter((c) => c.seconds >= Math.max(180, t.minMinutes * 60) && c.seconds <= t.maxMinutes * 60);
}
const today = new Date().toISOString().slice(0, 10);
const { picks } = judgeWithRules({ threads, candidates, rules, seedIds, rosters: {}, today });
for (const t of threads) {
  console.log(`\n${t.id} (${candidates[t.id].length} candidates)`);
  for (const p of picks[t.id]) {
    const c = candidates[t.id].find((x) => x.videoId === p.videoId);
    console.log(`  ${p.score}  ${c.channel} | ${c.title.slice(0, 60)}\n        ${p.why}`);
  }
}
