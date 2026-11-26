// Thin YouTube Data API v3 client with a hard daily unit cap.
const API = "https://www.googleapis.com/youtube/v3";
const COST = { search: 100, playlistItems: 1, videos: 1, channels: 1 };

export class QuotaExceeded extends Error {}

export function createYouTube(key, cap) {
  let used = 0;
  async function call(path, params) {
    const cost = COST[path] ?? 1;
    if (used + cost > cap) throw new QuotaExceeded(`Unit cap ${cap} reached (${used} used)`);
    used += cost;
    const url = new URL(`${API}/${path}`);
    for (const [k, v] of Object.entries({ ...params, key })) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${path} ${res.status}: ${body.replace(key, "***").slice(0, 300)}`);
    }
    return res.json();
  }

  async function batched(path, ids, params) {
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
      const data = await call(path, { ...params, id: ids.slice(i, i + 50).join(","), maxResults: 50 });
      out.push(...(data.items || []));
    }
    return out;
  }

  return {
    get used() { return used; },
    remaining: () => cap - used,
    call,
    search: (params) => call("search", { part: "snippet", type: "video", ...params }),
    videos: (ids) => batched("videos", ids, { part: "snippet,contentDetails,statistics,status,liveStreamingDetails" }),
    channels: (ids) => batched("channels", ids, { part: "snippet,statistics,contentDetails" }),
    channelByHandle: (handle) => call("channels", { part: "snippet,statistics", forHandle: handle }),
    uploads: (channelId, pageToken) =>
      call("playlistItems", { part: "contentDetails", playlistId: "UU" + channelId.slice(2), maxResults: 50, pageToken }),
  };
}

export function isoSeconds(iso = "") {
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || [];
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

export function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

// Share of lifetime views a typical video has at a given age (days). Saturates around 3 weeks.
export function ageFactor(days) {
  return 1 - Math.exp(-Math.max(days, 0.1) / 6);
}
