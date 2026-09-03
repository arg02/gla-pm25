# Annual PM2.5 — roadside vs background

Local analysis page: **mean annual PM2.5** since 2021 at continuously active **roadside** and **background** sites, Breathe London beside LAQN (Imperial / `openair::importImperial`).

**Live:** https://arg02.github.io/gla-pm25/

## Preview

```bash
npm run build:data   # BL API + R/openair + combine JSON
python3 serve.py     # http://127.0.0.1:8765/
```

Or step by step:

```bash
npm run fetch:bl     # ListSensors + getRawClarityData?queryType=year
npm run fetch:laqn   # R openair::importImperial (slow; many sites)
npm run combine
python3 serve.py
```

## Method

| | Breathe London | LAQN |
|---|---|---|
| Annual means | Official `getRawClarityData?queryType=year&species=ipm25&ecConversion=1` | Hourly `importImperial` → calendar-year mean |
| Cohort | Currently active, outdoor, `StartDate` in 2021 or earlier, a PM2.5 annual value in **every** year 2021–2025 | Currently open, `OpeningDate` year ≤ 2021, London bounding box, ≥**75%** hourly capture each year 2021–2025 |
| Groups | Roadside = roadside / kerbside / urban traffic. Background = urban / suburban background. Drop industrial, rural, indoor. | Same grouping on `site_type` |
| Statistic | Equal-weight mean of site annual means | Same |

The current calendar year is plotted as year-to-date (dashed / starred). WHO annual PM2.5 guideline (5 µg/m³) is drawn on the chart. Series are selectable.

Hourly BL fallback is off by default (`BL_HOURLY_FALLBACK=1` to enable if the year endpoint fails).

## Outputs

- `data/bl-site-years.json`
- `data/laqn-site-years.json`
- `data/annual-pm25.json` — chart payload
