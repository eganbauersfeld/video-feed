# Offline judge routine

Only used when `judge.mode` is `"offline"` in `config.mjs`. Schedule a Claude Code routine (for example, `/schedule` in Claude Code) to run daily at about 5:30am Denver time on this repo, with this prompt:

```
In the video-feed repo: pull main. If candidates.json's "date" is not today's date (America/Denver), stop.
Otherwise read candidates.json. For each entry in "threads", act as the judge described in "system"
and judge that thread's "prompt". Accept only score 7+, at most perDay per thread, and fewer or none is fine.
If "nudge" is not null, write the three nudge lines described in nudge.system for nudge.prompt.
Write picks.json exactly in the shape described in candidates.json "instructions".
Commit only picks.json with the message "Picks for <date>" and push to main.
```

Pushing `picks.json` triggers the **Assemble feed** workflow, which writes `feed.json`.
