# Feed

A replacement for YouTube that helps me watch **less**: every morning it picks a handful of videos that are actually worth my time, from topic "threads" across all of YouTube. A daily minute budget, set by how busy my calendar is, decides how much I can watch, and when it runs out the feed closes until tomorrow.

Live at https://eganbauersfeld.github.io/video-feed/ (installable as an app).

## How it works

Every day at about 5am Denver time, the **Refresh feed** GitHub Action runs `scripts/build.mjs`:

1. **Calendar.** Reads my private Google Calendar iCal feed(s) and counts the hours booked between 8am and 10pm. Under 2 hours is a **free** day (75 min), 2–5 hours is **normal** (30 min), and 5+ hours is **busy** (20 min). From Jan 3, 2027 the budget tapers down to floors of 30 / 20 / 15. Only the day type and event count are published; event titles and times never leave the Action.
2. **Weather.** Today's forecast from Open-Meteo for the location set in `config.mjs`.
3. **Gather.** For each thread in `threads.json`:
   - 3 YouTube searches from its seed searches plus queries Claude suggested. Queries rotate so the same one doesn't repeat within about 5 days.
   - **Older bangers:** videos from the thread's seed and roster channels with at least 3× that channel's median views. Not used for tech-reviews.
4. **Hard filters**, applied before Claude sees anything. These drop:
   - Shorts and livestreams
   - made-for-kids videos
   - channels under 10k subscribers or younger than 6 months
   - videos outside the thread's length range
   - videos under 0.5× their channel's median views, adjusted for how old the video is
   - anything already shown or already in my watch history
5. **Judge.** By default this is the free **rules judge** (no AI). It scores each candidate on:
   - channel trust: a seed channel, a roster channel, or a stranger
   - performance against the channel's own median views
   - whether the title matches the thread's topic words in `rules.json`. Strangers have to match by title; trusted channels can match by description.
   - clickbait signals: ALL CAPS, "!!", emoji, words like "insane"

   It drops anything that hits a block word and keeps the best that clear a threshold, with one video per channel per day. Fewer picks, or none, is fine.
6. **Mix.** The feed lists every thread's best pick before any thread's second pick, so the minutes you actually watch span several threads.
7. **Nudge.** Picks one "do this instead" suggestion from `nudges.json`, matched to the weather, my location and my biggest free block of time. The same suggestion never repeats within 30 days.
8. **Learn.** A channel with 3 accepted picks in a thread joins that thread's roster (`rosters.json`).
9. Commits `feed.json` and the state files, and GitHub Pages serves the page.

### API units per day

| Step | Units |
|---|---|
| Search: 10 threads × 3 × 100 | 3,000 |
| Video details, channel stats, channel medians (cached 7 days) | ~50–400 |
| Back catalogs: one-time full scan spread over a few days, then weekly page-1 refresh | ~60–400 |
| **Total** | **~3,100–3,800**, hard-capped at 6,000 in `config.mjs` |

### The page

- **Top:** the nudge, then the minute meter. It turns amber at 80% and red at 100%. It counts only seconds actually played (YouTube IFrame API), stored on each device per local date, and resets at midnight.
- **At 100%:** the current video can finish, then every other pick greys out and the nudge becomes the main message. There's no override.
- **Watching:** a pick opens on its own view with a youtube-nocookie embed. Related videos are off, autoplay is off, and the title links and end screen are covered. Nothing on the page links out to youtube.com.

## Files

| File | What it is |
|---|---|
| `config.mjs` | Every tunable number: budgets, taper, location, unit cap, judge model |
| `threads.json` | The threads: want/avoid, length range, picks per day, seeds |
| `rules.json` | Rules judge: topic words, block words and extra searches per thread, plus the global block list |
| `nudges.json` | "Do this instead" ideas |
| `channels.json` | Seed channel names resolved to IDs (`npm run resolve-channels`) |
| `feed.json` | Today's feed (what the page reads) |
| `seen.json` | Every video ever served, so nothing repeats |
| `history/watched-hashes.json` | Keyed hashes of my Takeout watch history (see below) |
| `rosters.json`, `queries.json`, `nudges-seen.json`, `cache/` | What the pipeline learns and caches |

## Setup (Windows)

### 1. YouTube API key → `YT_API_KEY` (already done)

1. Go to https://console.cloud.google.com and create a project, e.g. "video-feed".
2. Open **APIs & Services → Library**, search for **YouTube Data API v3**, and click **Enable**.
3. Open **APIs & Services → Credentials → Create credentials → API key**.
4. Click the new key and, under **API restrictions**, choose **Restrict key → YouTube Data API v3**. Save.

### 2. Google Calendar → `GCAL_ICS_URL`

1. Open https://calendar.google.com on a computer and click the **gear → Settings**.
2. In the left sidebar under **Settings for my calendars**, click a calendar you want counted.
3. Scroll to **Integrate calendar** and copy **Secret address in iCal format** (it ends in `basic.ics`).
4. Repeat for each calendar and join the addresses with commas, no spaces.

Treat these like passwords: anyone with the address can read that calendar. If one leaks, use **Reset** on the same settings page.

### 3. Anthropic API key → `ANTHROPIC_API_KEY` (only if you switch to the paid API judge)

1. Go to https://console.anthropic.com and sign in.
2. Add a payment method or credits under **Billing**. Set a monthly spend limit there too (e.g. $20).
3. Go to **API keys → Create key** and copy it.

### 4. Add the secrets

In PowerShell, run each command and paste the value when asked. Input is hidden.

```powershell
gh secret set GCAL_ICS_URL --repo eganbauersfeld/video-feed
```

Or use the website: repo **Settings → Secrets and variables → Actions → New repository secret**.

**Pages** is already on (**Settings → Pages → Deploy from a branch → main / root**).

### 5. Install the app

- **iPhone:** open the site in Safari, tap **Share → Add to Home Screen → Add**.
- **Brave on Windows:** open the site, then click the install icon at the right end of the address bar, or **Menu → Install Feed** (sometimes under **Save, share and cast**).

### 6. Optional: watch history

So nothing I've already seen gets picked:

1. Go to https://takeout.google.com and click **Deselect all**. Tick **YouTube and YouTube Music**.
2. Under **All YouTube data included**, keep only **history**. Under **Multiple formats**, set History to **JSON**.
3. Export, unzip, and copy `watch-history.json` into `history/`. It's gitignored and never committed.
4. Run `npm run import-history`. The first time, it creates a private key in `.local/history-salt` and prints a command to save it as the `HISTORY_SALT` secret.
5. Commit `history/watched-hashes.json`. Re-export every few months and repeat steps 3–5.

The repo is public, so the raw history never goes in it. Only keyed hashes do, and they can't be checked against video IDs without the secret.

## Judges

Set `judge.mode` in `config.mjs`.

- **`rules` (default, free):** no AI. Tune it in `rules.json`:
  - Add a word to a thread's `block` list when junk gets through.
  - Add to `boost` when good videos are missed.
  - Raise `threshold` to get fewer, safer picks.
  - Add a channel name to `blockChannels` to never see it again.

  New seed channels in `threads.json` are looked up automatically on the next daily run. Threads with `"priority": 2` come first in each round of the feed.

  To see what it would pick from the cached back catalogs without using any API quota, run `node scripts/test/rules-preview.mjs`.
- **`api`:** Claude judges each video against the want/avoid text and writes the "why" lines. It's much better at taste (spotting filler, AI-voiceover channels, old-product reviews) and costs about $0.35–0.75 a day on `claude-opus-5-5`, or about $0.01–0.02 on `claude-haiku-5-5`. It needs `ANTHROPIC_API_KEY`.
- **`offline`:** like `api`, but a scheduled Claude Code routine does the judging on a Claude plan, with no API bill. See [OFFLINE_JUDGE.md](OFFLINE_JUDGE.md).

## Later (not built yet)

- 👍 / 👎 and "less like this" on each pick, and muting a thread (this would help the rules judge most)
- Auto-pausing a thread for two weeks after several thumbs-downs in a row
- Course threads: an ordered path, one step a day
- Syncing watch time across devices (it's per-device for now)
