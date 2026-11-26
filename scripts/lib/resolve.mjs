// Resolves seed channel names to IDs. Cheap handle lookups first (1 unit), then search (100 units).
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function resolveChannel(yt, name) {
  const guesses = [...new Set([name.replace(/\s+/g, ""), name.replace(/\s+/g, "-"), name.replace(/\s+/g, "_")])];
  for (const h of guesses) {
    const data = await yt.channelByHandle("@" + h);
    const it = data.items?.[0];
    if (it && norm(it.snippet.title) === norm(name)) return { id: it.id, title: it.snippet.title, via: "handle" };
  }
  const data = await yt.call("search", { part: "snippet", type: "channel", q: name, maxResults: 1 });
  const it = data.items?.[0];
  return it ? { id: it.snippet.channelId, title: it.snippet.channelTitle, via: "search" } : null;
}

// Fills in any seed names missing from channels.json. Returns the names it added.
export async function resolveMissing(yt, names, channels, log = () => {}) {
  const added = [];
  for (const name of names) {
    if (channels[name]) continue;
    const hit = await resolveChannel(yt, name);
    if (!hit) { log(`Seed channel not found: ${name}`); continue; }
    channels[name] = hit;
    added.push(name);
    const flag = norm(hit.title) === norm(name) ? "" : "  <-- check this match in channels.json";
    log(`Seed channel: ${name} -> ${hit.title} (${hit.id})${flag}`);
  }
  return added;
}
