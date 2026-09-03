#!/usr/bin/env node
/**
 * Merge BL + LAQN site-year JSON into the chart payload.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const BL_PATH = path.join(ROOT, "data", "bl-site-years.json");
const LAQN_PATH = path.join(ROOT, "data", "laqn-site-years.json");
const OUT_PATH = path.join(ROOT, "data", "annual-pm25.json");

const COMPLETE_YEARS = [2021, 2022, 2023, 2024, 2025];
const CURRENT_YEAR = new Date().getUTCFullYear();
const ALL_YEARS = [];
for (let y = 2021; y <= CURRENT_YEAR; y++) ALL_YEARS.push(y);
const INCOMPLETE_YEARS = ALL_YEARS.filter((y) => y > 2025 || y === CURRENT_YEAR);

function scalar(v) {
  if (Array.isArray(v) && v.length === 1 && (v[0] == null || typeof v[0] !== "object")) {
    return v[0];
  }
  return v;
}

function normalizeSite(s) {
  const annual = {};
  const rawAnnual = s.annual || {};
  for (const [k, v] of Object.entries(rawAnnual)) {
    const n = Number(scalar(v));
    if (Number.isFinite(n)) annual[k] = n;
  }
  return {
    siteCode: String(scalar(s.siteCode) ?? ""),
    name: String(scalar(s.name) ?? ""),
    classification: String(scalar(s.classification) ?? ""),
    group: String(scalar(s.group) ?? ""),
    startYear: scalar(s.startYear),
    source: scalar(s.source),
    annual,
  };
}

function meanOf(nums) {
  const v = nums.filter((x) => Number.isFinite(x));
  if (!v.length) return null;
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100;
}

function loadJson(p) {
  if (!fs.existsSync(p)) {
    throw new Error(`Missing ${p} — run npm run fetch:bl and npm run fetch:laqn first`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function seriesFrom(sites, group, id, label, network) {
  const subset = (sites || []).map(normalizeSite).filter((s) => s.group === group);
  const values = {};
  const nByYear = {};
  for (const year of ALL_YEARS) {
    const key = String(year);
    const means = subset
      .map((s) => s.annual?.[key])
      .filter((x) => Number.isFinite(x));
    values[key] = meanOf(means);
    nByYear[key] = means.length;
  }
  return {
    id,
    label,
    network,
    group,
    n: subset.length,
    nByYear,
    values,
    sites: subset.map((s) => ({
      siteCode: s.siteCode,
      name: s.name,
      classification: s.classification,
      annual: s.annual,
    })),
  };
}

function main() {
  const bl = loadJson(BL_PATH);
  const laqn = loadJson(LAQN_PATH);

  const series = [
    seriesFrom(bl.sites, "Roadside", "bl_roadside", "Breathe London · Roadside", "breathe-london"),
    seriesFrom(bl.sites, "Background", "bl_background", "Breathe London · Background", "breathe-london"),
    seriesFrom(laqn.sites, "Roadside", "laqn_roadside", "LAQN · Roadside", "laqn"),
    seriesFrom(laqn.sites, "Background", "laqn_background", "LAQN · Background", "laqn"),
  ];

  const payload = {
    generatedAt: new Date().toISOString(),
    pollutant: "PM2.5",
    unit: "µg/m³",
    whoPm25: 5,
    completeYears: COMPLETE_YEARS,
    years: ALL_YEARS,
    incompleteYears: INCOMPLETE_YEARS.filter((y) => ALL_YEARS.includes(y)),
    notes: [
      "Equal-weight mean of site annual means (not pooled hours).",
      "BL: official getRawClarityData queryType=year, sites active since 2021 with a value in every year 2021–2025.",
      "LAQN: openair::importImperial, currently open since 2021, ≥75% hourly capture each year 2021–2025.",
      `${CURRENT_YEAR} is year-to-date and may be incomplete.`,
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
  console.log(`Wrote ${OUT_PATH}`);
  for (const s of series) {
    const latest = s.values[String(COMPLETE_YEARS.at(-1))];
    console.log(`  ${s.label}: n=${s.n}  2025 mean=${latest ?? "—"}`);
  }
}

main();
