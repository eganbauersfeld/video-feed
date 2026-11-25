// Turns Google Takeout's subscriptions.csv into config.json channel entries.
// Usage: node scripts/import-subscriptions.mjs path/to/subscriptions.csv
import { readFile, writeFile } from "node:fs/promises";

const file = process.argv[2];
if (!file) throw new Error("Pass the path to subscriptions.csv");

const rows = (await readFile(file, "utf8")).trim().split(/\r?\n/).slice(1);
const cfg = JSON.parse(await readFile("config.json", "utf8"));
const have = new Set(cfg.channels.map((c) => c.id));

let added = 0;
for (const row of rows) {
  const [id, , name] = row.split(",");
  if (!id || have.has(id)) continue;
  cfg.channels.push({ id, name: name?.trim(), category: "Unsorted" });
  added++;
}

await writeFile("config.json", JSON.stringify(cfg, null, 2));
console.log(`Added ${added} channels. Set their categories in config.json.`);
