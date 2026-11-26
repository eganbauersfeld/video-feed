// Every tunable number lives here. Edit and push; the next daily run picks it up.

export const LOCATIONS = {
  boulder: { label: "Boulder, CO", lat: 40.015, lon: -105.2705 },
  loveland: { label: "Loveland, CO", lat: 40.3978, lon: -105.075 },
};

export default {
  timezone: "America/Denver",
  LAUNCH_DATE: "2026-11-25",

  // Where you are. Change to "loveland" over break, "boulder" when back.
  location: "boulder",

  // Day type from Google Calendar hours booked between these local hours.
  dayWindow: { startHour: 8, endHour: 22 },
  dayTypes: { freeUnderHours: 2, busyFromHours: 5 }, // free < 2, normal 2-5, busy >= 5

  // Minutes of video per day.
  budget: { free: 75, normal: 30, busy: 20 },

  // Taper: nothing changes before TAPER_START. After it, every `everyDays` days the budget
  // drops by `stepMinutes`, never below `floor`.
  TAPER_START: "2027-01-03",
  taper: {
    free: { stepMinutes: 5, everyDays: 7, floor: 30 },
    normal: { stepMinutes: 5, everyDays: 14, floor: 20 },
    busy: { stepMinutes: 5, everyDays: 14, floor: 15 },
  },

  // Weather thresholds for nudge tags.
  weather: {
    goodMinF: 45, // daily high at or above this...
    goodMaxPrecipChance: 30, // ...and precipitation chance at or below this
    clearNightMaxCloud: 30, // avg cloud % from 8pm to midnight
  },

  youtube: {
    dailyUnitCap: 6000, // hard stop well under the 10,000 quota
    searchesPerThread: 3,
    searchMaxResults: 25,
    searchWindowDays: 60,
    queryCooldownDays: 5,
    minSubscribers: 10000,
    minChannelAgeDays: 183,
    minSeconds: 180, // anything shorter is treated as a Short
    medianOfLastUploads: 30,
    minViewRatio: 0.5, // drop videos under 0.5x their channel's median (age-adjusted)
    bangerRatio: 3, // back-catalog "older bangers" need 3x the channel median
    channelStatsTtlDays: 7,
    catalogRefreshDays: 7,
    catalogPagesPerDay: 40, // cap on back-catalog paging per run (1 unit each + stats)
    noBackCatalogThreads: ["tech-reviews"],
    bangersPerThread: 8, // max older candidates sent to the judge per thread
  },

  judge: {
    // "rules"   free, no AI: keyword lists in rules.json + channel trust + view performance
    // "api"     Anthropic API (needs ANTHROPIC_API_KEY, costs money)
    // "offline" a scheduled Claude Code session judges candidates.json
    mode: "rules",
    model: "claude-opus-5-5", // only used by "api"
    effort: "low",
    maxCandidatesPerThread: 30,
    descriptionChars: 500,
    learnedQueriesPerThread: 20, // Claude suggests new searches daily; keep this many per thread
  },

  roster: { acceptedPicksToJoin: 3 },

  nudges: { noRepeatDays: 30 },
};
