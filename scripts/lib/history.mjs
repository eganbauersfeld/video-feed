// "Never repeat": seen.json (everything ever served) + your Takeout watch history.
// The watch history is private, so the repo only stores keyed hashes of the video IDs
// (history/watched-hashes.json). The key is the HISTORY_SALT secret; without it the hashes reveal nothing.
import { createHmac } from "node:crypto";
import { readJson } from "./store.mjs";

export const hashId = (salt, id) => createHmac("sha256", salt).update(id).digest("hex").slice(0, 16);

export async function loadSeenChecker(seen, salt, log) {
  let watched = new Set();
  const file = await readJson("history/watched-hashes.json", { hashes: [] });
  if (file.hashes.length && salt) watched = new Set(file.hashes);
  else if (file.hashes.length) log("watched-hashes.json present but HISTORY_SALT is not set; skipping watch history");
  return (id) => id in seen || (watched.size > 0 && watched.has(hashId(salt, id)));
}
