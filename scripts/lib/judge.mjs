// judge(): picks the videos worth watching. Two backends behind one interface.
//   api     -> Anthropic API (ANTHROPIC_API_KEY), runs inside the daily Action.
//   offline -> writes candidates.json; a scheduled Claude Code session writes picks.json.
// Both return/produce: { picks: {threadId: [{videoId, score, why}]}, newSearches: {threadId: [q]}, nudgeLines }
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const SYSTEM = `You are the curator for a personal video feed whose purpose is to help the viewer watch LESS YouTube, and only videos that genuinely give them something: a skill, an idea, a story, or craft worth seeing.

You judge one thread at a time. For each candidate you get the title, the start of the description, channel, duration, age, and views relative to that channel's median (ratio; 1.0 = typical for the channel, 3+ = a standout). "older" candidates come from the channel's back catalog and are allowed at any age.

Rules:
- Accept only videos that clearly match the thread's "want" and hit none of its "avoid" or the global avoid list.
- Reject filler, clickbait, compilations, reaction content, AI-voiceover channels, clips of TV or film, and anything that just kills time. When unsure, reject.
- It is good to return fewer picks than allowed, or none. Never pad to fill the quota.
- Never return more than the thread's perDay.
- Score accepted picks 1-10 for how much the viewer would get out of it; only 7+ belong in the feed.
- "why" is one short, specific line the viewer sees under the video (max ~90 characters). Say what they get, not that it matches a thread. No hype words.
- Only use videoIds from the candidate list.
- Also suggest 3 new YouTube search queries for this thread, phrased like a person would type them, aimed at the kind of video you would accept. Do not repeat the existing queries.`;

const ThreadResult = z.object({
  picks: z.array(z.object({ videoId: z.string(), score: z.number(), why: z.string() })),
  newSearches: z.array(z.string()),
});

const NudgeResult = z.object({ normal: z.string(), warn: z.string(), done: z.string() });

export const NUDGE_SYSTEM = `You write the one-line "do this instead" message at the top of a personal video feed that exists to help the viewer watch less. Friendly, specific, one line each, under ~80 characters. No guilt trips, no stats shaming, no emoji. Keep the same suggestion in all three lines; only the wording and directness change.
- normal: subtle, shown while they browse.
- warn: shown at 80% of today's budget; mention the minutes left and suggest doing the thing after this video.
- done: the budget is used up; the suggestion is now the main message.`;

function fmtAge(published, now) {
  const d = Math.floor((now - Date.parse(published)) / 86400e3);
  return d < 1 ? "today" : d < 60 ? `${d}d` : d < 730 ? `${Math.round(d / 30)}mo` : `${Math.round(d / 365)}y`;
}

export function candidateLines(cands, now, chars) {
  return cands.map((c) =>
    JSON.stringify({
      videoId: c.videoId, title: c.title, channel: c.channel, minutes: Math.round(c.seconds / 60),
      age: fmtAge(c.published, now), ratio: c.ratio, source: c.source,
      description: (c.description || "").replace(/\s+/g, " ").slice(0, chars),
    }),
  ).join("\n");
}

export function threadPrompt(t, cands, ctx) {
  const extra = t.id === "tech-reviews"
    ? `\nExtra rule for this thread: reject reviews of products that are older than about 12 months as of ${ctx.today}, unless the topic is timeless (design, how a company or technology works). Use the title, description and upload age to judge the product's age.`
    : "";
  return `Today: ${ctx.today}

Thread: ${t.name} (perDay: ${t.perDay}, ${t.minMinutes}-${t.maxMinutes} min)
Want: ${t.want}
Avoid: ${t.avoid}${extra}

Global avoid: ${ctx.globalAvoid}
Viewer notes: ${ctx.notes}

Existing queries: ${JSON.stringify(ctx.existingQueries)}

Candidates (one JSON object per line):
${candidateLines(cands, ctx.now, ctx.descriptionChars)}`;
}

export function nudgePrompt(n, ctx) {
  return `Suggestion: "${n.text}" (about ${n.minutes} min)
Today: ${ctx.dayType} day; weather in ${ctx.weather?.label ?? "town"}: ${ctx.weather ? `high ${ctx.weather.high}°F, ${ctx.weather.condition}` : "unknown"}.
Minutes left at the warn point: ${ctx.warnMinutesLeft}.`;
}

export function fallbackNudgeLines(n, warnMinutesLeft) {
  const t = n.text.replace(/[.!?]$/, "");
  return { normal: `${t}?`, warn: `${warnMinutesLeft} min left. ${t} after this one?`, done: `${t}.` };
}

// Keeps only valid, de-duplicated picks within perDay, best first.
export function cleanPicks(raw, cands, perDay) {
  const ids = new Set(cands.map((c) => c.videoId));
  const seen = new Set();
  return (raw || [])
    .filter((p) => ids.has(p.videoId) && !seen.has(p.videoId) && seen.add(p.videoId) && p.score >= 7)
    .sort((a, b) => b.score - a.score)
    .slice(0, perDay)
    .map((p) => ({ videoId: p.videoId, score: p.score, why: String(p.why).slice(0, 140) }));
}

async function parseWithFallback(client, params) {
  try {
    return await client.beta.messages.parse({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  } catch (e) {
    if (e instanceof Anthropic.BadRequestError && /fallback/i.test(e.message)) return client.beta.messages.parse(params);
    throw e;
  }
}

export async function judgeWithApi({ threads, candidates, ctx, nudge, cfg, log }) {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  const out = { picks: {}, newSearches: {}, nudgeLines: null, usage: { input: 0, output: 0 } };
  const track = (r) => { out.usage.input += r.usage?.input_tokens || 0; out.usage.output += r.usage?.output_tokens || 0; };

  for (const t of threads) {
    const cands = candidates[t.id] || [];
    if (!cands.length) { out.picks[t.id] = []; continue; }
    try {
      const res = await parseWithFallback(client, {
        model: cfg.judge.model,
        max_tokens: 16000,
        system: SYSTEM,
        output_config: { effort: cfg.judge.effort, format: betaZodOutputFormat(ThreadResult) },
        messages: [{ role: "user", content: threadPrompt(t, cands, { ...ctx, existingQueries: ctx.queriesFor(t.id) }) }],
      });
      track(res);
      if (res.stop_reason === "refusal" || !res.parsed_output) {
        log(`Judge: no usable answer for ${t.id} (${res.stop_reason})`);
        out.picks[t.id] = [];
        continue;
      }
      out.picks[t.id] = cleanPicks(res.parsed_output.picks, cands, t.perDay);
      out.newSearches[t.id] = res.parsed_output.newSearches.slice(0, 3);
    } catch (e) {
      log(`Judge error on ${t.id}: ${e.status ?? ""} ${e.message.slice(0, 200)}`);
      out.picks[t.id] = [];
    }
  }

  if (nudge) {
    try {
      const res = await parseWithFallback(client, {
        model: cfg.judge.model,
        max_tokens: 4000,
        system: NUDGE_SYSTEM,
        output_config: { effort: "low", format: betaZodOutputFormat(NudgeResult) },
        messages: [{ role: "user", content: nudgePrompt(nudge, ctx) }],
      });
      track(res);
      if (res.parsed_output) out.nudgeLines = res.parsed_output;
    } catch (e) {
      log(`Nudge wording error: ${e.message.slice(0, 200)}`);
    }
  }
  return out;
}
