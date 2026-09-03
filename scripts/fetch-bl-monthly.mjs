#!/usr/bin/env node
/**
 * Monthly PM2.5 means for the locked Breathe London cohort.
 * Hourly endpoint (same as daqi-vs-caqi / blcp-video):
 *   GET /api/getClarityData/{siteCode}/IPM25/{start}/{end}/Hourly
 * Cohort sitecodes come from data/bl-site-years.json — not rediscovered.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { roundHalfUp } from "./lib/round.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const COHORT_PATH = path.join(ROOT, "data", "bl-site-years.json");
const OUT_PATH = path.join(ROOT, "data", "bl-site-months.json");
const CACHE_DIR = path.join(ROOT, "data", "cache", "bl-hourly");

const API_BASE = "https://api.breathelondon-communities.org/api";
const API_KEY =
  process.env.BREATHE_LONDON_API_KEY || "e2635276-e87a-11eb-9a03-0242ac130003";

const START_YEAR = 2021;
const MIN_COVERAGE = 0.5;
const REQUEST_DELAY_MS = 200;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function lastCompleteMonthUtc(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based current month
  if (m === 0) return { year: y - 1, month: 12 };
  return { year: y, month: m };
}

function monthKeysThrough(endYear, endMonth) {
  const keys = [];
  for (let y = START_YEAR; y <= endYear; y++) {
    const maxM = y === endYear ? endMonth : 12;
    for (let m = 1; m <= maxM; m++) {
      keys.push(`${y}-${String(m).padStart(2, "0")}`);
    }
  }
  return keys;
}

function expectedHours(year, month) {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return days * 24;
}

function isValidScaled(v) {
  return Number.isFinite(v) && v > -999 && v < 5000;
}

async function fetchHourlyYear(siteCode, year) {
  const cachePath = path.join(CACHE_DIR, `${siteCode}-${year}.json`);
  const currentYear = lastCompleteMonthUtc().year;
  if (year < currentYear && fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, "utf8"));
  }
  const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
  const url = `${API_BASE}/getClarityData/${siteCode}/IPM25/${encodeURIComponent(start.toUTCString())}/${encodeURIComponent(end.toUTCString())}/Hourly?key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const points = [];
  const push = (item) => {
    if (!item || !isValidScaled(Number(item.ScaledValue))) return;
    const dt = item.DateTime || item.Timestamp;
    if (!dt) return;
    points.push({ DateTime: dt, ScaledValue: Number(item.ScaledValue) });
  };
  if (Array.isArray(data)) {
    for (const item of data) push(item);
  } else if (data && typeof data === "object") {
    for (const val of Object.values(data)) {
      if (Array.isArray(val)) for (const item of val) push(item);
      else push(val);
    }
  }
  if (year < currentYear) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(points));
  }
  return points;
}

function monthlyFromPoints(points, year, endMonth) {
  const buckets = {};
  const maxMonth = year === lastCompleteMonthUtc().year ? endMonth : 12;
  for (let m = 1; m <= maxMonth; m++) {
    buckets[m] = [];
  }
  for (const p of points) {
    const d = new Date(p.DateTime);
    if (Number.isNaN(d.getTime())) continue;
    if (d.getUTCFullYear() !== year) continue;
    const m = d.getUTCMonth() + 1;
    if (!buckets[m]) continue;
    buckets[m].push(p.ScaledValue);
  }
  const monthly = {};
  const coverage = {};
  for (let m = 1; m <= maxMonth; m++) {
    const vals = buckets[m];
    const exp = expectedHours(year, m);
    const cov = vals.length / exp;
    coverage[m] = roundHalfUp(cov, 4);
    if (vals.length && cov >= MIN_COVERAGE) {
      monthly[m] = roundHalfUp(
        vals.reduce((a, b) => a + b, 0) / vals.length,
        2,
      );
    }
  }
  return { monthly, coverage };
}

async function main() {
  if (!fs.existsSync(COHORT_PATH)) {
    throw new Error(`Missing ${COHORT_PATH} — run npm run fetch:bl first`);
  }
  const cohort = JSON.parse(fs.readFileSync(COHORT_PATH, "utf8"));
  const { year: endYear, month: endMonth } = lastCompleteMonthUtc();
  const keys = monthKeysThrough(endYear, endMonth);
  const sites = [];

  for (let i = 0; i < cohort.sites.length; i++) {
    const site = cohort.sites[i];
    process.stdout.write(
      `  [${i + 1}/${cohort.sites.length}] ${site.siteCode} ${site.group}… `,
    );
    const monthly = {};
    const coverage = {};
    for (let year = START_YEAR; year <= endYear; year++) {
      try {
        const points = await fetchHourlyYear(site.siteCode, year);
        const agg = monthlyFromPoints(points, year, endMonth);
        for (const [m, v] of Object.entries(agg.monthly)) {
          monthly[`${year}-${String(m).padStart(2, "0")}`] = v;
        }
        for (const [m, v] of Object.entries(agg.coverage)) {
          coverage[`${year}-${String(m).padStart(2, "0")}`] = v;
        }
        process.stdout.write(`${year} `);
      } catch (err) {
        process.stdout.write(`${year}!(${err.message}) `);
      }
      await delay(REQUEST_DELAY_MS);
    }
    sites.push({
      siteCode: site.siteCode,
      name: site.name,
      classification: site.classification,
      group: site.group,
      source: "getClarityData:Hourly",
      monthly,
      coverage,
    });
    console.log(`→ ${Object.keys(monthly).length} months`);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    network: "breathe-london",
    source: "getClarityData Hourly IPM25; site-month mean if ≥50% of hours",
    minCoverage: MIN_COVERAGE,
    months: keys,
    nSites: sites.length,
    sites,
  };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${OUT_PATH} (${sites.length} sites, ${keys.length} months)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
