// Builds feed.json: today's short list of videos from my chosen channels.
// Runs daily in GitHub Actions. Needs env var YT_API_KEY.
import { readFile, writeFile } from "node:fs/promises";

const KEY = process.env.YT_API_KEY;
if (!KEY) throw new Error("Missing YT_API_KEY");

const cfg = JSON.parse(await readFile("config.json", "utf8"));
const history = JSON.parse(await readFile("history.json", "utf8").catch(() => "{}"));
const shown = new Set(Object.keys(history));
const API = "https://www.googleapis.com/youtube/v3";

async function yt(path, params) {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries({ ...params, key: KEY })) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

function seconds(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || [];
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
}

const cutoff = Date.now() - cfg.maxAgeDays * 86400e3;
const blocked = cfg.blockKeywords.map((k) => k.toLowerCase());

// 1. Recent uploads per channel (uploads playlist = channel id with UC -> UU)
const candidates = [];
for (const ch of cfg.channels) {
  try {
    const data = await yt("playlistItems", { part: "snippet", playlistId: "UU" + ch.id.slice(2), maxResults: 10 });
    for (const it of data.items) {
      const s = it.snippet;
      const id = s.resourceId.videoId;
      if (shown.has(id) || Date.parse(s.publishedAt) < cutoff) continue;
      candidates.push({ id, title: s.title, channel: ch.name, category: ch.category, published: s.publishedAt,
        thumb: s.thumbnails?.high?.url || s.thumbnails?.medium?.url });
    }
  } catch (e) {
    console.warn(`Skipped ${ch.name}: ${e.message}`);
  }
}

// 2. Durations in batches of 50; drops Shorts and livestreams
for (let i = 0; i < candidates.length; i += 50) {
  const batch = candidates.slice(i, i + 50);
  const data = await yt("videos", { part: "contentDetails,snippet", id: batch.map((v) => v.id).join(",") });
  for (const v of data.items) {
    const c = batch.find((b) => b.id === v.id);
    c.seconds = seconds(v.contentDetails.duration);
    c.live = v.snippet.liveBroadcastContent !== "none";
  }
}

const pool = candidates
  .filter((v) => v.seconds >= cfg.minSeconds && !v.live)
  .filter((v) => !blocked.some((k) => v.title.toLowerCase().includes(k)))
  .sort((a, b) => Date.parse(b.published) - Date.parse(a.published));

// 3. Fill category slots, cap per channel, then top up
const picks = [];
const perChannel = {};
const take = (v) => {
  if (picks.length >= cfg.dailyCount || picks.includes(v)) return;
  if ((perChannel[v.channel] || 0) >= cfg.perChannelMax) return;
  perChannel[v.channel] = (perChannel[v.channel] || 0) + 1;
  picks.push(v);
};
for (const [cat, slots] of Object.entries(cfg.categories)) {
  pool.filter((v) => v.category === cat).forEach((v) => {
    if (picks.filter((p) => p.category === cat).length < slots) take(v);
  });
}
pool.forEach(take);

const today = new Date().toISOString().slice(0, 10);
for (const v of picks) history[v.id] = today;

await writeFile("feed.json", JSON.stringify({ date: today, videos: picks }, null, 2));
await writeFile("history.json", JSON.stringify(history, null, 2));
console.log(`Feed for ${today}: ${picks.length} videos from ${pool.length} candidates`);
