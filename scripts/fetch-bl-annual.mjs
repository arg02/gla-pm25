#!/usr/bin/env node
/**
 * Breathe London PM2.5 annual means for the continuously active 2021+ cohort.
 * Official year endpoint (same as blcp-video / sensor-info page):
 *   GET /api/getRawClarityData?queryType=year&species=ipm25&ecConversion=1
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { groupSiteType } from "./lib/site-type.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT_PATH = path.join(ROOT, "data", "bl-site-years.json");

const API_BASE = "https://api.breathelondon-communities.org/api";
const API_KEY =
  process.env.BREATHE_LONDON_API_KEY || "e2635276-e87a-11eb-9a03-0242ac130003";

const COMPLETE_YEARS = [2021, 2022, 2023, 2024, 2025];
const ALL_YEARS = [...COMPLETE_YEARS, 2026];
const YEAR_WINDOW_START = "2021-01-01T00:00:00.000Z";
const YEAR_WINDOW_END = "2026-12-31T23:59:59.999Z";
const REQUEST_DELAY_MS = 150;
const HOURLY_FALLBACK = process.env.BL_HOURLY_FALLBACK === "1";

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function unwrapSensors(data) {
  if (Array.isArray(data) && Array.isArray(data[0])) return data[0];
  if (Array.isArray(data)) return data;
  if (data?.["0"]) return data["0"];
  return [];
}

function parseStartYear(startDate) {
  if (!startDate) return null;
  const d = new Date(startDate);
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCFullYear();
}

function isCurrentlyActive(sensor) {
  const active = Number(sensor.SiteActive) === 1;
  const enabled = String(sensor.Enabled ?? "Y").toUpperCase() === "Y";
  const end = sensor.EndDate;
  const endEmpty = end == null || end === "" || end === "null";
  return active && enabled && endEmpty;
}

function isOutdoor(sensor) {
  return Number(sensor.Indoor) !== 1;
}

async function getYearlyAverages(siteCode) {
  const params = new URLSearchParams({
    key: API_KEY,
    siteCode,
    species: "ipm25",
    startTime: YEAR_WINDOW_START,
    endTime: YEAR_WINDOW_END,
    ecConversion: "1",
    queryType: "year",
  });
  const url = `${API_BASE}/getRawClarityData?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const byYear = {};
  if (!Array.isArray(data)) return byYear;
  for (const item of data) {
    if (item?.ScaledValue == null || Number.isNaN(Number(item.ScaledValue))) continue;
    const year = new Date(item.DateTime).getUTCFullYear();
    if (!ALL_YEARS.includes(year)) continue;
    byYear[year] = Math.round(Number(item.ScaledValue) * 100) / 100;
  }
  return byYear;
}

function formatBlHourlyDate(date) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const d = date.getUTCDate();
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${days[date.getUTCDay()]} ${String(d).padStart(2, "0")} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ${hh}:${mm}:${ss} GMT`;
}

async function getHourlyYearMean(siteCode, year) {
  const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
  const startEnc = encodeURIComponent(formatBlHourlyDate(start));
  const endEnc = encodeURIComponent(formatBlHourlyDate(end));
  const url = `${API_BASE}/getClarityData/${siteCode}/IPM25/${startEnc}/${endEnc}/Hourly?key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`hourly HTTP ${res.status}`);
  const data = await res.json();
  const rows = Array.isArray(data) ? data : [];
  const vals = rows
    .map((r) => Number(r.ScaledValue))
    .filter((v) => Number.isFinite(v) && v > -999 && v < 1e6);
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
}

async function hourlyFallback(siteCode) {
  const byYear = {};
  for (const year of ALL_YEARS) {
    try {
      const mean = await getHourlyYearMean(siteCode, year);
      if (mean != null) byYear[year] = mean;
    } catch (err) {
      console.warn(`  hourly fallback ${siteCode} ${year}: ${err.message}`);
    }
    await delay(REQUEST_DELAY_MS);
  }
  return byYear;
}

function hasCompleteYears(byYear) {
  return COMPLETE_YEARS.every((y) => Number.isFinite(byYear[y]));
}

async function fetchListSensors() {
  const res = await fetch(`${API_BASE}/ListSensors?key=${API_KEY}`);
  if (!res.ok) throw new Error(`ListSensors HTTP ${res.status}`);
  return unwrapSensors(await res.json());
}

async function main() {
  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });

  console.log("Fetching ListSensors…");
  const sensors = await fetchListSensors();
  console.log(`  ${sensors.length} sensors in list`);

  const skipped = {
    inactive: 0,
    indoor: 0,
    startedAfter2021: 0,
    ungrouped: 0,
    yearEndpointFailed: 0,
    incompleteYears: 0,
  };
  const ungroupedSamples = new Map();
  const candidates = [];

  for (const sensor of sensors) {
    if (!isCurrentlyActive(sensor)) {
      skipped.inactive += 1;
      continue;
    }
    if (!isOutdoor(sensor)) {
      skipped.indoor += 1;
      continue;
    }
    const startYear = parseStartYear(sensor.StartDate);
    if (startYear == null || startYear > 2021) {
      skipped.startedAfter2021 += 1;
      continue;
    }
    const group = groupSiteType(sensor.SiteClassification);
    if (!group) {
      skipped.ungrouped += 1;
      const key = sensor.SiteClassification || "(empty)";
      ungroupedSamples.set(key, (ungroupedSamples.get(key) || 0) + 1);
      continue;
    }
    candidates.push({ sensor, group, startYear });
  }

  console.log(
    `  metadata candidates: ${candidates.length} (skipped inactive ${skipped.inactive}, indoor ${skipped.indoor}, start>2021 ${skipped.startedAfter2021}, ungrouped ${skipped.ungrouped})`,
  );
  if (ungroupedSamples.size) {
    console.log("  ungrouped SiteClassification values:", Object.fromEntries(ungroupedSamples));
  }

  const sites = [];
  for (let i = 0; i < candidates.length; i++) {
    const { sensor, group, startYear } = candidates[i];
    const siteCode = sensor.SiteCode;
    process.stdout.write(`  [${i + 1}/${candidates.length}] ${siteCode} ${group}… `);
    let byYear = {};
    let source = "getRawClarityData:year";
    try {
      byYear = await getYearlyAverages(siteCode);
    } catch (err) {
      console.log(`year endpoint failed (${err.message})`);
      if (HOURLY_FALLBACK) {
        console.log(`    hourly fallback…`);
        byYear = await hourlyFallback(siteCode);
        source = "getClarityData:Hourly";
      } else {
        skipped.yearEndpointFailed += 1;
        await delay(REQUEST_DELAY_MS);
        continue;
      }
    }

    if (!hasCompleteYears(byYear)) {
      const present = COMPLETE_YEARS.filter((y) => Number.isFinite(byYear[y]));
      console.log(`incomplete (${present.join(",") || "none"})`);
      skipped.incompleteYears += 1;
      await delay(REQUEST_DELAY_MS);
      continue;
    }

    const annual = {};
    for (const year of ALL_YEARS) {
      if (Number.isFinite(byYear[year])) annual[String(year)] = byYear[year];
    }
    sites.push({
      siteCode,
      name: sensor.SiteName || siteCode,
      classification: sensor.SiteClassification || "",
      group,
      startDate: sensor.StartDate || null,
      startYear,
      source,
      annual,
    });
    console.log(
      COMPLETE_YEARS.map((y) => `${y}=${byYear[y]}`).join(" "),
      byYear[2026] != null ? `2026=${byYear[2026]}` : "2026=—",
    );
    await delay(REQUEST_DELAY_MS);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    network: "breathe-london",
    source: "getRawClarityData queryType=year species=ipm25 ecConversion=1",
    completeYears: COMPLETE_YEARS,
    years: ALL_YEARS,
    skipped,
    nSites: sites.length,
    nRoadside: sites.filter((s) => s.group === "Roadside").length,
    nBackground: sites.filter((s) => s.group === "Background").length,
    sites,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));
  console.log(
    `\nWrote ${OUT_PATH} (${payload.nRoadside} roadside, ${payload.nBackground} background)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
