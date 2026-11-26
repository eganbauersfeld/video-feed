// Gathers candidates per thread: searches + older bangers, then applies hard filters.
import { QuotaExceeded, isoSeconds, median, ageFactor } from "./youtube.mjs";
import { daysBetween } from "./time.mjs";

const DAY = 86400e3;
const ORDERS = ["relevance", "viewCount"];

function durationParam(t) {
  if (t.minMinutes >= 4 && t.maxMinutes <= 20) return "medium";
  if (t.minMinutes >= 20) return "long";
  return undefined; // spans both; filter in code
}

// Pick the queries for today, rotating so none repeats within the cooldown when the pool allows.
export function chooseQueries(thread, qstate, today, cfg) {
  const st = (qstate[thread.id] ??= { learned: [], lastUsed: {} });
  const pool = [...new Set([...thread.seedSearches, ...(thread.extraSearches || []), ...st.learned])];
  const combos = pool.flatMap((q) => ORDERS.map((order) => ({ q, order, key: `${q}|${order}` })));
  const age = (c) => (st.lastUsed[c.key] ? daysBetween(st.lastUsed[c.key], today) : Infinity);
  const fresh = combos.filter((c) => age(c) >= cfg.youtube.queryCooldownDays);
  // Never-used first (seed order), then least recently used.
  const ranked = [...fresh].sort((a, b) => age(b) - age(a));
  const picked = [];
  const usedQ = new Set();
  for (const c of ranked) {
    if (picked.length >= cfg.youtube.searchesPerThread) break;
    if (usedQ.has(c.q)) continue; // spread across different phrasings
    picked.push(c);
    usedQ.add(c.q);
  }
  if (picked.length < cfg.youtube.searchesPerThread) {
    const rest = combos.filter((c) => !picked.includes(c)).sort((a, b) => age(b) - age(a));
    picked.push(...rest.slice(0, cfg.youtube.searchesPerThread - picked.length));
  }
  for (const c of picked) st.lastUsed[c.key] = today;
  return picked;
}

function videoInfo(v) {
  const s = v.snippet;
  return {
    videoId: v.id,
    title: s.title,
    description: (s.description || "").slice(0, 1200),
    channelId: s.channelId,
    channel: s.channelTitle,
    published: s.publishedAt,
    seconds: isoSeconds(v.contentDetails?.duration),
    views: +v.statistics?.viewCount || 0,
    live: !!v.liveStreamingDetails || (s.liveBroadcastContent && s.liveBroadcastContent !== "none"),
    kids: !!v.status?.madeForKids,
    shortsTag: /#shorts?\b/i.test(s.title + " " + (s.description || "")),
  };
}

function passesVideoFilters(v, t, cfg) {
  const min = Math.max(cfg.youtube.minSeconds, t.minMinutes * 60);
  return !v.live && !v.kids && !v.shortsTag && v.seconds >= min && v.seconds <= t.maxMinutes * 60;
}

export async function gather({ yt, cfg, threads, today, now, state, isSeen, log }) {
  const { qstate, channelCache, catalogs, judged, rosters, seedIds } = state;
  const notJudgedRecently = (id) => !judged[id] || daysBetween(judged[id], today) >= 30;
  const publishedAfter = new Date(now - cfg.youtube.searchWindowDays * DAY).toISOString();
  const byThread = Object.fromEntries(threads.map((t) => [t.id, []]));
  const stop = (e) => {
    if (e instanceof QuotaExceeded) { log(`Quota: ${e.message}`); return true; }
    log(`  skipped: ${e.message.replace(/\s+/g, " ").slice(0, 160)}`);
    return false;
  };

  // 1. Searches (100 units each).
  const searchHits = Object.fromEntries(threads.map((t) => [t.id, new Set()])); // threadId -> Set(videoId)
  const RESERVE = 600; // keep units for details, medians and back catalogs
  outer: for (const t of threads) {
    for (const q of chooseQueries(t, qstate, today, cfg)) {
      if (yt.remaining() - 100 < RESERVE) { log("Searches stopped early to stay under the unit cap"); break outer; }
      try {
        const data = await yt.search({
          q: q.q, order: q.order, maxResults: cfg.youtube.searchMaxResults, publishedAfter,
          videoDuration: durationParam(t), relevanceLanguage: "en", regionCode: "US", safeSearch: "none",
        });
        for (const it of data.items || []) if (it.id?.videoId) searchHits[t.id].add(it.id.videoId);
      } catch (e) {
        if (stop(e)) break outer;
      }
    }
  }

  // 2. Details for unseen search hits.
  const allIds = [...new Set(Object.values(searchHits).flatMap((s) => [...s]))]
    .filter((id) => !isSeen(id) && notJudgedRecently(id));
  const details = {};
  try {
    for (const v of await yt.videos(allIds)) details[v.id] = videoInfo(v);
  } catch (e) { stop(e); }

  // 3. Video-level filters, per thread.
  const prelim = {};
  for (const t of threads) {
    prelim[t.id] = [...searchHits[t.id]].map((id) => details[id]).filter((v) => v && passesVideoFilters(v, t, cfg));
  }

  // 4. Channel stats (subs, age), cached.
  const needStats = [...new Set(Object.values(prelim).flat().map((v) => v.channelId))].filter((id) => {
    const c = channelCache[id];
    return !c?.statsAt || daysBetween(c.statsAt, today) >= cfg.youtube.channelStatsTtlDays;
  });
  try {
    for (const ch of await yt.channels(needStats)) {
      channelCache[ch.id] = {
        ...channelCache[ch.id],
        title: ch.snippet.title,
        created: ch.snippet.publishedAt,
        subs: ch.statistics.hiddenSubscriberCount ? null : +ch.statistics.subscriberCount,
        statsAt: today,
      };
    }
  } catch (e) { stop(e); }

  const channelOk = (id) => {
    const c = channelCache[id];
    if (!c?.statsAt) return false;
    if (c.subs !== null && c.subs < cfg.youtube.minSubscribers) return false;
    return now - Date.parse(c.created) >= cfg.youtube.minChannelAgeDays * DAY;
  };
  for (const t of threads) prelim[t.id] = prelim[t.id].filter((v) => channelOk(v.channelId));

  // 5. Channel medians (uploads page 1 + stats), cached.
  async function ensureMedian(channelId) {
    const c = (channelCache[channelId] ??= {});
    if (c.medianAt && daysBetween(c.medianAt, today) < cfg.youtube.channelStatsTtlDays) return;
    const page = await yt.uploads(channelId);
    const ids = (page.items || []).map((i) => i.contentDetails.videoId);
    const vids = (await yt.videos(ids)).map(videoInfo)
      .filter((v) => !v.live && v.seconds >= cfg.youtube.minSeconds)
      .sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
    const settled = vids.filter((v) => now - Date.parse(v.published) >= 7 * DAY);
    const sample = (settled.length >= 5 ? settled : vids).slice(0, cfg.youtube.medianOfLastUploads);
    c.median = median(sample.map((v) => v.views));
    c.medianAt = today;
    c.firstPage = { items: vids.slice(0, 50), nextPageToken: page.nextPageToken || null };
  }

  const viewRatio = (v) => {
    const m = channelCache[v.channelId]?.median;
    if (!m) return null;
    const days = (now - Date.parse(v.published)) / DAY;
    const expected = days < 21 ? m * ageFactor(days) : m;
    return v.views / Math.max(expected, 1);
  };

  const medianChannels = [...new Set(Object.values(prelim).flat().map((v) => v.channelId))];
  for (const id of medianChannels) {
    try { await ensureMedian(id); } catch (e) { if (stop(e)) break; }
  }
  for (const t of threads) {
    for (const v of prelim[t.id]) {
      const r = viewRatio(v);
      if (r === null || r < cfg.youtube.minViewRatio) continue;
      byThread[t.id].push({ ...v, ratio: +r.toFixed(2), source: "search" });
    }
  }

  // 6. Older bangers from seed + roster channels (not for excluded threads).
  let pagesLeft = cfg.youtube.catalogPagesPerDay;
  async function scanCatalog(channelId) {
    const cat = (catalogs[channelId] ??= { bangers: {}, complete: false, nextPageToken: null, scannedAt: null });
    await ensureMedian(channelId);
    const m = channelCache[channelId].median;
    const addBangers = (vids) => {
      for (const v of vids) {
        if (m && v.views >= cfg.youtube.bangerRatio * m && !v.live && !v.kids && !v.shortsTag) {
          cat.bangers[v.videoId] = { title: v.title, description: v.description.slice(0, 600), published: v.published,
            seconds: v.seconds, views: v.views, channel: v.channel };
        }
      }
    };
    const stale = !cat.scannedAt || daysBetween(cat.scannedAt, today) >= cfg.youtube.catalogRefreshDays;
    if (stale) {
      // Page 1 catches new uploads (reuses the median fetch when it happened this run).
      let first = channelCache[channelId].firstPage;
      if (!first) {
        const page = await yt.uploads(channelId);
        const ids = (page.items || []).map((i) => i.contentDetails.videoId);
        first = { items: (await yt.videos(ids)).map(videoInfo), nextPageToken: page.nextPageToken || null };
      }
      addBangers(first.items);
      if (!cat.scannedAt) {
        cat.nextPageToken = first.nextPageToken;
        cat.complete = !first.nextPageToken;
      }
      cat.scannedAt = today;
    }
    // Keep walking older pages until the whole back catalog is scanned (spread over days).
    while (!cat.complete && cat.nextPageToken && pagesLeft > 0) {
      pagesLeft--;
      const page = await yt.uploads(channelId, cat.nextPageToken);
      const ids = (page.items || []).map((i) => i.contentDetails.videoId);
      addBangers((await yt.videos(ids)).map(videoInfo));
      cat.nextPageToken = page.nextPageToken || null;
      if (!cat.nextPageToken) cat.complete = true;
    }
  }

  const catalogThreads = threads.filter((t) => !cfg.youtube.noBackCatalogThreads.includes(t.id));
  catalogLoop: for (const t of catalogThreads) {
    const roster = Object.entries(rosters[t.id] || {}).filter(([, r]) => r.rostered).map(([id]) => id);
    const chans = [...new Set([...(seedIds[t.id] || []), ...roster])];
    for (const id of chans) {
      try { await scanCatalog(id); } catch (e) { if (stop(e)) break catalogLoop; }
    }
    const min = Math.max(cfg.youtube.minSeconds, t.minMinutes * 60);
    const pool = chans.flatMap((cid) =>
      Object.entries(catalogs[cid]?.bangers || {}).map(([videoId, b]) => ({
        videoId, ...b, channelId: cid, ratio: +(b.views / Math.max(channelCache[cid]?.median || 1, 1)).toFixed(2), source: "older",
      })),
    ).filter((b) => b.seconds >= min && b.seconds <= t.maxMinutes * 60 && !isSeen(b.videoId) && notJudgedRecently(b.videoId));
    // Mix: some of the very best, some random, so the whole catalog gets a look over time.
    pool.sort((a, b) => b.ratio - a.ratio);
    const n = cfg.youtube.bangersPerThread;
    const top = pool.slice(0, Math.ceil(n / 2));
    const rest = pool.slice(top.length).sort(() => Math.random() - 0.5).slice(0, n - top.length);
    byThread[t.id].push(...top, ...rest);
  }

  // Drop cached first pages so the cache file stays small.
  for (const c of Object.values(channelCache)) delete c.firstPage;

  // 7. Dedupe across threads (keep the thread where it scored highest), cap per thread.
  const owner = {};
  for (const [tid, list] of Object.entries(byThread)) {
    for (const v of list) if (!owner[v.videoId] || owner[v.videoId].ratio < v.ratio) owner[v.videoId] = { tid, ratio: v.ratio };
  }
  const blocked = new Set((state.blockChannels || []).map((n) => n.toLowerCase()));
  for (const t of threads) {
    const seen = new Set();
    byThread[t.id] = byThread[t.id]
      .filter((v) => !blocked.has(String(v.channel).toLowerCase()) && !blocked.has(v.channelId))
      .filter((v) => owner[v.videoId].tid === t.id && !seen.has(v.videoId) && seen.add(v.videoId))
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, cfg.judge.maxCandidatesPerThread);
  }
  return byThread;
}
