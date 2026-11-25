# video-feed

A personal YouTube feed: about 8 videos a day from channels I choose, instead of the endless recommendations page. Live at https://eganbauersfeld.github.io/video-feed/

## How it works

- `config.json` lists the channels (each with a category), how many videos to show per day, how many slots each category gets, and filters (minimum length, max age, max per channel, blocked title keywords).
- Every day at 11:17 UTC, the **Refresh feed** GitHub Action runs `scripts/build-feed.mjs`. It pulls recent uploads from each channel via the YouTube Data API, drops Shorts, livestreams, old videos, blocked titles and anything already shown, fills the category slots, and writes `feed.json`.
- `history.json` remembers every video already shown so nothing repeats.
- The Action commits both files, and GitHub Pages serves `index.html`, which reads `feed.json`. Watched videos are remembered in your browser for that day.

You can also run it by hand from the Actions tab (Refresh feed → Run workflow) or with `gh workflow run "Refresh feed"`.

## Setup

1. Create a YouTube Data API v3 key in Google Cloud Console (APIs & Services → enable "YouTube Data API v3" → Credentials → API key).
2. Add it as a repo secret named `YT_API_KEY` (Settings → Secrets and variables → Actions), or `gh secret set YT_API_KEY`. Never commit it.
3. Turn on GitHub Pages: Settings → Pages → Deploy from a branch → `main` / root.

## Importing subscriptions

1. Export your YouTube data from [Google Takeout](https://takeout.google.com/) (select only YouTube → subscriptions).
2. Run:

   ```
   node scripts/import-subscriptions.mjs path/to/subscriptions.csv
   ```

3. New channels are added with category `Unsorted`. Edit `config.json` to give each one a real category (Engineering, Tech, Learning, Fun, or a new one added to `categories`), then commit and push.
