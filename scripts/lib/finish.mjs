// Stage 2: turn the judge's picks into feed.json and update learning state.
import { readJson, writeJson } from "./store.mjs";
import { fallbackNudgeLines } from "./judge.mjs";

export async function finish({ ctx, result, cfg, log, markJudged = true }) {
  const threads = ctx.threads;
  const seen = await readJson("seen.json", {});
  const judged = await readJson("cache/judged.json", {});
  const rosters = await readJson("rosters.json", {});
  const queries = await readJson("queries.json", {});

  // Join picks with metadata; rank = position within its own thread.
  const rows = [];
  for (const t of threads) {
    const cands = Object.fromEntries((ctx.candidates[t.id] || []).map((c) => [c.videoId, c]));
    (result.picks[t.id] || []).forEach((p, rank) => {
      const c = cands[p.videoId];
      if (!c) return;
      rows.push({
        videoId: c.videoId, threadId: t.id, thread: t.name, title: c.title, channel: c.channel,
        channelId: c.channelId, seconds: c.seconds, published: c.published, older: c.source === "older",
        why: p.why, score: p.score, rank,
      });
    });
  }
  // Round-robin across threads: every thread's best pick comes before any thread's second pick,
  // so the part of the list the budget covers spans several threads. Within a round, best score first.
  rows.sort((a, b) => a.rank - b.rank || b.score - a.score);

  const nudge = ctx.nudge
    ? { id: ctx.nudge.id, minutes: ctx.nudge.minutes, lines: result.nudgeLines || fallbackNudgeLines(ctx.nudge, ctx.warnMinutesLeft, ctx.weather, ctx.today) }
    : null;

  const feed = {
    date: ctx.today,
    generatedAt: new Date().toISOString(),
    dayType: ctx.dayType,
    eventCount: ctx.eventCount,
    budgetMinutes: ctx.budgetMinutes,
    weather: ctx.weather,
    nudge,
    picks: rows.map(({ rank, channelId, ...r }) => r),
  };

  for (const r of rows) seen[r.videoId] = ctx.today;
  // AI judges are not re-asked about a rejected video for 30 days. The rules judge is free, so it re-checks daily.
  if (markJudged) for (const list of Object.values(ctx.candidates)) for (const c of list) judged[c.videoId] = ctx.today;
  for (const [id, d] of Object.entries(judged)) if (Date.parse(ctx.today) - Date.parse(d) > 45 * 86400e3) delete judged[id];

  for (const r of rows) {
    const t = (rosters[r.threadId] ??= {});
    const entry = (t[r.channelId] ??= { name: r.channel, accepted: 0, rostered: false });
    entry.accepted++;
    const isSeed = (ctx.seedIds[r.threadId] || []).includes(r.channelId);
    if (!isSeed && entry.accepted >= cfg.roster.acceptedPicksToJoin && !entry.rostered) {
      entry.rostered = true;
      log(`Roster: ${r.channel} joined ${r.threadId}`);
    }
  }

  for (const [tid, qs] of Object.entries(result.newSearches || {})) {
    const st = (queries[tid] ??= { learned: [], lastUsed: {} });
    const seeds = threads.find((t) => t.id === tid)?.seedSearches || [];
    const norm = (s) => s.toLowerCase().trim();
    const have = new Set([...seeds, ...st.learned].map(norm));
    for (const q of qs) if (q && !have.has(norm(q))) { st.learned.push(q.trim()); have.add(norm(q)); }
    st.learned = st.learned.slice(-cfg.judge.learnedQueriesPerThread);
  }

  await writeJson("feed.json", feed);
  await writeJson("seen.json", seen, { compact: true });
  await writeJson("cache/judged.json", judged, { compact: true });
  await writeJson("rosters.json", rosters);
  await writeJson("queries.json", queries);
  const mins = Math.round(rows.reduce((n, r) => n + r.seconds, 0) / 60);
  log(`Feed for ${ctx.today}: ${rows.length} picks (${mins} min) for a ${ctx.budgetMinutes}-min ${ctx.dayType} day`);
  return feed;
}
