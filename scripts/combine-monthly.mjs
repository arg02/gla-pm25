#!/usr/bin/env node
/**
 * Merge BL + LAQN site-month JSON into the monthly chart payload.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { roundHalfUp } from "./lib/round.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const BL_PATH = path.join(ROOT, "data", "bl-site-months.json");
const LAQN_PATH = path.join(ROOT, "data", "laqn-site-months.json");
const OUT_PATH = path.join(ROOT, "data", "monthly-pm25.json");

function scalar(v) {
  if (Array.isArray(v) && v.length === 1 && (v[0] == null || typeof v[0] !== "object")) {
    return v[0];
  }
  return v;
}

function normalizeSite(s) {
  const monthly = {};
  const raw = s.monthly || {};
  for (const [k, v] of Object.entries(raw)) {
    const n = Number(scalar(v));
    if (Number.isFinite(n)) monthly[k] = n;
  }
  return {
    siteCode: String(scalar(s.siteCode) ?? ""),
    name: String(scalar(s.name) ?? ""),
    classification: String(scalar(s.classification) ?? ""),
    group: String(scalar(s.group) ?? ""),
    monthly,
  };
}

function meanOf(nums) {
  const v = nums.filter((x) => Number.isFinite(x));
  if (!v.length) return null;
  return roundHalfUp(v.reduce((a, b) => a + b, 0) / v.length, 1);
}

function loadJson(p) {
  if (!fs.existsSync(p)) {
    throw new Error(`Missing ${p} — run npm run fetch:bl-monthly and npm run fetch:laqn-monthly first`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function unionMonths(bl, laqn) {
  const set = new Set([...(bl.months || []), ...(laqn.months || [])]);
  return [...set].sort();
}

function seriesFrom(sites, group, id, label, network, months) {
  const subset = (sites || []).map(normalizeSite).filter((s) => s.group === group);
  const values = {};
  const nByMonth = {};
  for (const key of months) {
    const means = subset
      .map((s) => s.monthly?.[key])
      .filter((x) => Number.isFinite(x));
    values[key] = meanOf(means);
    nByMonth[key] = means.length;
  }
  return {
    id,
    label,
    network,
    group,
    n: subset.length,
    nByMonth,
    values,
    sites: subset.map((s) => ({
      siteCode: s.siteCode,
      name: s.name,
      classification: s.classification,
    })),
  };
}

function main() {
  const bl = loadJson(BL_PATH);
  const laqn = loadJson(LAQN_PATH);
  const months = unionMonths(bl, laqn);

  const series = [
    seriesFrom(bl.sites, "Roadside", "bl_roadside", "Breathe London · Roadside", "breathe-london", months),
    seriesFrom(bl.sites, "Background", "bl_background", "Breathe London · Background", "breathe-london", months),
    seriesFrom(laqn.sites, "Roadside", "laqn_roadside", "LAQN · Roadside", "laqn", months),
    seriesFrom(laqn.sites, "Background", "laqn_background", "LAQN · Background", "laqn", months),
  ];

  const payload = {
    generatedAt: new Date().toISOString(),
    pollutant: "PM2.5",
    unit: "µg/m³",
    months,
    notes: [
      "Equal-weight mean of site monthly means (not pooled hours).",
      "µg/m³ values rounded half-up to 1 decimal.",
      "BL: getClarityData Hourly IPM25; a site-month is kept if ≥50% of hours are present.",
      "LAQN: openair::importImperial; a site-month is kept if ≥50% of hours are present.",
      "Same continuously active 2021–2025 cohort as the annual page.",
    ],
    sources: {
      breatheLondon: bl.source,
      laqn: laqn.source,
      blGeneratedAt: bl.generatedAt,
      laqnGeneratedAt: laqn.generatedAt,
    },
    series,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${OUT_PATH} (${months[0]} … ${months.at(-1)}, ${months.length} months)`);
  for (const s of series) {
    const latest = s.values[months.at(-1)];
    console.log(`  ${s.label}: n=${s.n}  last=${latest ?? "—"}`);
  }
}

main();
