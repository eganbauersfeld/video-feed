// Today's weather from Open-Meteo (no key).
import { LOCATIONS } from "../../config.mjs";

const SNOW = new Set([71, 73, 75, 77, 85, 86]);
const WET = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99, ...SNOW]);
const LABEL = (c) =>
  c === 0 ? "clear" : c <= 2 ? "partly cloudy" : c === 3 ? "cloudy" : c <= 48 ? "foggy" :
  SNOW.has(c) ? "snow" : c >= 95 ? "thunderstorms" : WET.has(c) ? "rain" : "mixed";

export async function todayWeather(cfg, today) {
  const loc = LOCATIONS[cfg.location];
  if (!loc) throw new Error(`Unknown location "${cfg.location}" in config.mjs`);
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  Object.entries({
    latitude: loc.lat, longitude: loc.lon, timezone: cfg.timezone,
    temperature_unit: "fahrenheit", start_date: today, end_date: today,
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,snowfall_sum",
    hourly: "cloud_cover",
  }).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const d = await res.json();
  const code = d.daily.weather_code[0];
  const high = Math.round(d.daily.temperature_2m_max[0]);
  const low = Math.round(d.daily.temperature_2m_min[0]);
  const precip = d.daily.precipitation_probability_max[0] ?? 0;
  const snowfall = d.daily.snowfall_sum[0] ?? 0;
  const nightClouds = d.hourly.cloud_cover.slice(20, 24);
  const avgNightCloud = nightClouds.reduce((a, b) => a + b, 0) / (nightClouds.length || 1);

  return {
    location: cfg.location,
    label: loc.label,
    high, low,
    condition: LABEL(code),
    precipChance: precip,
    goodWeather: high >= cfg.weather.goodMinF && precip <= cfg.weather.goodMaxPrecipChance && !WET.has(code),
    snow: snowfall > 0 || SNOW.has(code),
    clearNight: avgNightCloud <= cfg.weather.clearNightMaxCloud,
  };
}
