// Rules judge: no AI, no cost. Scores each candidate from channel trust, how it performs vs its
// channel, keyword fit (rules.json), clickbait signals and length, then keeps the best above a threshold.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const termRe = (t) => new RegExp(`(^|[^a-z0-9])${esc(t.toLowerCase())}($|[^a-z0-9])`);
const compile = (list = []) => list.map((t) => ({ t, re: termRe(t) }));
// Description text minus link/affiliate lines, which mention gear rather than the topic.
// Drops each link together with the label in front of it ("My Camera Bag: https://..."), plus sponsor lines.
const proseOf = (d = "") =>
  d.replace(/[^\n]*https?:\/\/\S+/g, " ")
    .split("\n").filter((l) => !/amzn|affiliate|sponsor|use code|discount/i.test(l)).join(" ")
    .toLowerCase().slice(0, 300);
const hits = (text, terms) => terms.filter(({ re }) => re.test(text)).map(({ t }) => t);

function clickbaitPenalty(title, bait) {
  let p = 0;
  const words = title.split(/\s+/).filter((w) => /[A-Za-z]{3,}/.test(w));
  const caps = words.filter((w) => w === w.toUpperCase()).length;
  if (words.length >= 3 && caps / words.length > 0.5) p += 2; // MOSTLY SHOUTING
  else if (caps >= 2) p += 0.5;
  if (/[!?]{2,}/.test(title)) p += 1;
  if ((title.match(/\p{Extended_Pictographic}/gu) || []).length >= 2) p += 1;
  if (hits(title.toLowerCase(), bait).length) p += 1.5;
  return p;
}

function whyLine(c, { trust, ratio, kw, thread }) {
  const x = `${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1).replace(/\.0$/, "")}x`;
  if (c.source === "older") return `One of ${c.channel}'s standouts: ${x} its usual views`;
  if (trust === "seed") return ratio >= 1.5 ? `New from ${c.channel}, already ${x} its usual views` : `New from ${c.channel}`;
  if (trust === "roster") return `${c.channel} keeps landing in ${thread}`;
  return ratio >= 1.5 ? `${kw ? `About ${kw}; ` : ""}doing ${x} this channel's usual` : `${kw ? `About ${kw}, ` : ""}from ${c.channel}`;
}

export function judgeWithRules({ threads, candidates, rules, seedIds, rosters, today }) {
  const year = +today.slice(0, 4);
  const globalBlock = compile(rules.globalBlock);
  const bait = compile(rules.clickbait);
  const threshold = rules.threshold ?? 3.5;
  const picks = {};
  const usedChannels = new Set();
  const scored = [];

  for (const t of threads) {
    const r = rules.threads?.[t.id] || {};
    const boost = compile(r.boost);
    const block = compile(r.block);
    const seeds = new Set(seedIds[t.id] || []);
    const roster = new Set(Object.entries(rosters[t.id] || {}).filter(([, v]) => v.rostered).map(([id]) => id));

    for (const c of candidates[t.id] || []) {
      const title = c.title.toLowerCase();
      const head = `${title} ${proseOf(c.description)}`;
      if (hits(head, globalBlock).length || hits(head, block).length) continue;
      if (r.blockOldYears) {
        const old = [...c.title.matchAll(/\b(20\d\d)\b/g)].some(([, y]) => +y <= year - 2);
        if (old) continue;
      }
      const trust = seeds.has(c.channelId) ? "seed" : roster.has(c.channelId) ? "roster" : "unknown";
      if (r.seedOnly && trust !== "seed") continue;
      if (r.minRatio && c.ratio < r.minRatio) continue;

      const titleHits = hits(title, boost);
      const descHits = hits(proseOf(c.description), boost).filter((k) => !titleHits.includes(k));
      // On-topic check: strangers must match by title; trusted channels at least by description.
      if (boost.length && trust === "unknown" && !titleHits.length) continue;
      if (boost.length && !titleHits.length && !descHits.length) continue;

      let score = 0;
      score += trust === "seed" ? 3 : trust === "roster" ? 2 : 0;
      score += Math.max(-1, Math.min(3, Math.log2(Math.max(c.ratio, 0.01))));
      score += Math.min(3, titleHits.length * 1.5) + Math.min(1, descHits.length * 0.25);
      score -= clickbaitPenalty(c.title, bait);
      if (c.seconds <= 25 * 60) score += 0.5;
      if (score < threshold) continue;

      scored.push({
        threadId: t.id, channelId: c.channelId, videoId: c.videoId,
        score: Math.round(Math.min(10, score + 3) * 10) / 10,
        why: whyLine(c, { trust, ratio: c.ratio, kw: titleHits[0], thread: t.name }),
      });
    }
  }

  // Best first across all threads; one video per channel per day; respect perDay.
  scored.sort((a, b) => b.score - a.score);
  for (const t of threads) picks[t.id] = [];
  for (const s of scored) {
    const t = threads.find((x) => x.id === s.threadId);
    if (picks[t.id].length >= t.perDay || usedChannels.has(s.channelId)) continue;
    usedChannels.add(s.channelId);
    picks[t.id].push({ videoId: s.videoId, score: s.score, why: s.why });
  }
  return { picks, newSearches: {}, nudgeLines: null };
}
