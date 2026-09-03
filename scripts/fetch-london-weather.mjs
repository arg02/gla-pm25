#!/usr/bin/env node
/**
 * Seasonal London weather (St James's Park) via Open-Meteo archive —
 * same point as aq-model-testing R/collect_openmeteo_weather.R.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT_PATH = path.join(ROOT, "data", "london-season-weather.json");

const LAT = 51.5054;
const LON = -0.131;
const YEARS = [2022, 2023, 2024, 2025];

const SEASONS = {
  spring: { label: "Spring (MAM)", months: [3, 4, 5] },
  summer: { label: "Summer (JJA)", months: [6, 7, 8] },
};

function mean(nums) {
  const v = nums.filter((x) => Number.isFinite(x));
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function sum(nums) {
  return nums.filter((x) => Number.isFinite(x)).reduce((a, b) => a + b, 0);
}

function isEasterly(deg) {
  if (!Number.isFinite(deg)) return false;
  return deg >= 45 && deg < 135;
}

function round(n, d = 1) {
  if (!Number.isFinite(n)) return null;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchRange(startDate, endDate, attempt = 1) {
  const params = new URLSearchParams({
    latitude: String(LAT),
    longitude: String(LON),
    start_date: startDate,
    end_date: endDate,
    daily: [
      "temperature_2m_mean",
      "precipitation_sum",
      "wind_speed_10m_mean",
      "wind_direction_10m_dominant",
      "sunshine_duration",
      "relative_humidity_2m_mean",
    ].join(","),
    wind_speed_unit: "ms",
    timezone: "Europe/London",
  });
  const url = `https://archive-api.open-meteo.com/v1/archive?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (attempt < 4) {
      console.warn(`  retry ${attempt} after HTTP ${res.status} (${startDate}–${endDate})`);
      await sleep(1500 * attempt);
      return fetchRange(startDate, endDate, attempt + 1);
    }
    throw new Error(`Open-Meteo HTTP ${res.status} for ${startDate}–${endDate}`);
  }
  const json = await res.json();
  const d = json.daily || {};
  const n = d.time?.length || 0;
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      date: d.time[i],
      temp: d.temperature_2m_mean?.[i],
      precip: d.precipitation_sum?.[i],
      wind: d.wind_speed_10m_mean?.[i],
      windDir: d.wind_direction_10m_dominant?.[i],
      sunshineSec: d.sunshine_duration?.[i],
      humidity: d.relative_humidity_2m_mean?.[i],
    });
  }
  return rows;
}

async function fetchYear(year) {
  const spring = await fetchRange(`${year}-03-01`, `${year}-05-31`);
  await sleep(400);
  const summer = await fetchRange(`${year}-06-01`, `${year}-08-31`);
  return [...spring, ...summer];
}

function summarise(rows) {
  const temps = rows.map((r) => r.temp);
  const precips = rows.map((r) => r.precip);
  const winds = rows.map((r) => r.wind);
  const hums = rows.map((r) => r.humidity);
  const sunHours = rows.map((r) =>
    Number.isFinite(r.sunshineSec) ? r.sunshineSec / 3600 : NaN,
  );
  const easterlyDays = rows.filter((r) => isEasterly(r.windDir)).length;
  const dryDays = rows.filter((r) => Number.isFinite(r.precip) && r.precip < 0.2).length;
  const calmDays = rows.filter((r) => Number.isFinite(r.wind) && r.wind < 3).length;
  return {
    nDays: rows.length,
    meanTempC: round(mean(temps), 1),
    precipMm: round(sum(precips), 0),
    meanWindMs: round(mean(winds), 1),
    sunshineHours: round(sum(sunHours), 0),
    meanHumidityPct: round(mean(hums), 0),
    easterlyPct: round((100 * easterlyDays) / rows.length, 0),
    dryDayPct: round((100 * dryDays) / rows.length, 0),
    calmDayPct: round((100 * calmDays) / rows.length, 0),
  };
}

async function main() {
  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  const years = {};
  for (const year of YEARS) {
    console.log(`Fetching Open-Meteo daily ${year}…`);
    const rows = await fetchYear(year);
    years[year] = {};
    for (const [key, season] of Object.entries(SEASONS)) {
      const subset = rows.filter((r) => {
        const m = Number(r.date.slice(5, 7));
        return season.months.includes(m);
      });
      years[year][key] = summarise(subset);
      const s = years[year][key];
      console.log(
        `  ${season.label}: ${s.meanTempC}°C, ${s.precipMm} mm, wind ${s.meanWindMs} m/s, easterly ${s.easterlyPct}%, sun ${s.sunshineHours} h`,
      );
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "Open-Meteo archive ERA5-land / Europe/London daily",
    location: { name: "St James's Park", latitude: LAT, longitude: LON },
    seasons: {
      spring: "March–May",
      summer: "June–August",
    },
    notes: [
      "Easterly days: daily dominant wind direction 45–135° (NE–SE), the continental sector associated with higher London PM2.5.",
      "Dry days: precipitation < 0.2 mm. Calm days: mean 10 m wind < 3 m/s.",
    ],
    years,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
