// Turns a Google Takeout watch history into history/watched-hashes.json.
// Usage: node scripts/import-watch-history.mjs [history/watch-history.json | watch-history.html]
//
// The raw export stays on your computer (it's gitignored). Only keyed hashes are committed, so the
// public repo can't be used to look up what you've watched. The key lives in .local/history-salt
// (also gitignored) and must be added once as the HISTORY_SALT repo secret.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { hashId } from "./lib/history.mjs";
import { readJson, writeJson } from "./lib/store.mjs";

const file = process.argv[2] || "history/watch-history.json";
const text = await readFile(file, "utf8");

const ids = new Set();
if (file.endsWith(".json")) {
  for (const item of JSON.parse(text)) {
    const m = item.titleUrl?.match(/[?&]v=([\w-]{11})/);
    if (m) ids.add(m[1]);
  }
} else {
  for (const m of text.matchAll(/watch\?v=([\w-]{11})/g)) ids.add(m[1]);
}

let salt = process.env.HISTORY_SALT;
let created = false;
if (!salt) {
  try {
    salt = (await readFile(".local/history-salt", "utf8")).trim();
  } catch {
    salt = randomBytes(24).toString("hex");
    await mkdir(".local", { recursive: true });
    await writeFile(".local/history-salt", salt + "\n");
    created = true;
  }
}

const existing = await readJson("history/watched-hashes.json", { hashes: [] });
const all = new Set(existing.hashes);
for (const id of ids) all.add(hashId(salt, id));
await writeJson("history/watched-hashes.json", { updated: new Date().toISOString().slice(0, 10), hashes: [...all].sort() }, { compact: true });

console.log(`Read ${ids.size} watched videos; ${all.size} hashes total in history/watched-hashes.json.`);
if (created) {
  console.log("Created a new key in .local/history-salt. Add it as a repo secret once:");
  console.log("  gh secret set HISTORY_SALT < .local/history-salt");
}
