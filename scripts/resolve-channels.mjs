// Resolves seedChannels names in threads.json to channel IDs, cached in channels.json.
// The daily run does this automatically for new names; use this to do it ahead of time.
// Usage: YT_API_KEY=... node scripts/resolve-channels.mjs
// Edit channels.json by hand to fix a wrong match.
import { readJson, writeJson } from "./lib/store.mjs";
import { createYouTube } from "./lib/youtube.mjs";
import { resolveMissing } from "./lib/resolve.mjs";

if (!process.env.YT_API_KEY) throw new Error("Set YT_API_KEY");
const yt = createYouTube(process.env.YT_API_KEY, 3000);
const threads = await readJson("threads.json");
const channels = await readJson("channels.json", {});
await resolveMissing(yt, [...new Set(threads.threads.flatMap((t) => t.seedChannels))], channels, console.log);
await writeJson("channels.json", channels);
console.log(`Done. ${yt.used} units used.`);
