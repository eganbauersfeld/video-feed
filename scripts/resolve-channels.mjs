// One-time helper: turns seedChannels names in threads.json into channel IDs, cached in channels.json.
// Usage: YT_API_KEY=... node scripts/resolve-channels.mjs
// Tries cheap handle lookups first (1 unit), falls back to search (100 units).
// Names already in channels.json are skipped; edit channels.json by hand to fix a wrong match.
import { readJson, writeJson } from "./lib/store.mjs";
import { createYouTube } from "./lib/youtube.mjs";

const KEY = process.env.YT_API_KEY;
if (!KEY) throw new Error("Set YT_API_KEY");
const yt = createYouTube(KEY, 3000);

const threads = await readJson("threads.json");
const channels = await readJson("channels.json", {});
const names = [...new Set(threads.threads.flatMap((t) => t.seedChannels))];

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

for (const name of names) {
  if (channels[name]) continue;
  let hit = null;
  const guesses = [...new Set([name.replace(/\s+/g, ""), name.replace(/\s+/g, "-"), name.replace(/\s+/g, "_")])];
  for (const h of guesses) {
    const data = await yt.channelByHandle("@" + h);
    const it = data.items?.[0];
    if (it && norm(it.snippet.title) === norm(name)) {
      hit = { id: it.id, title: it.snippet.title, subs: +it.statistics.subscriberCount || null, via: "handle" };
      break;
    }
  }
  if (!hit) {
    const data = await yt.call("search", { part: "snippet", type: "channel", q: name, maxResults: 1 });
    const it = data.items?.[0];
    if (it) hit = { id: it.snippet.channelId, title: it.snippet.channelTitle, via: "search" };
  }
  if (hit) {
    channels[name] = hit;
    const flag = norm(hit.title) === norm(name) ? "" : "   <-- check this match";
    console.log(`${name} -> ${hit.title} (${hit.id}) [${hit.via}]${flag}`);
  } else {
    console.log(`${name} -> NOT FOUND`);
  }
}

await writeJson("channels.json", channels);
console.log(`Done. ${yt.used} units used.`);
