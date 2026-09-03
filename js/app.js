const SERIES_STYLE = {
  bl_roadside: {
    color: "#e24528",
    dash: [],
    pointStyle: "circle",
  },
  bl_background: {
    color: "#0f9e90",
    dash: [],
    pointStyle: "circle",
  },
  laqn_roadside: {
    color: "#c46a2e",
    dash: [7, 5],
    pointStyle: "rect",
  },
  laqn_background: {
    color: "#3b7cc9",
    dash: [7, 5],
    pointStyle: "rect",
  },
};

const WHO_COLOR = "#c49a22";
const AXIS_MUTED = "#5b6b78";
const GRID = "rgba(21,32,43,0.08)";

function fmtWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Round half up (50.49 → 50, 50.5 → 51). Not banker's rounding. */
function roundHalfUp(value, decimals = 1) {
  if (!Number.isFinite(value)) return null;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const factor = 10 ** decimals;
  const scaled = abs * factor;
  const whole = Math.floor(scaled + 1e-12);
  const frac = scaled - whole;
  const next = frac >= 0.5 - 1e-12 ? whole + 1 : whole;
  return (sign * next) / factor;
}

function fmtUg(value, decimals = 1) {
  const n = roundHalfUp(Number(value), decimals);
  return n == null ? "—" : n.toFixed(decimals);
}

function latestComplete(data, series) {
  const years = data.completeYears || [];
  const y = years[years.length - 1];
  const v = series.values?.[String(y)];
  return y && v != null ? `${fmtUg(v)} µg/m³ in ${y}` : "—";
}

function renderToggles(series, chart) {
  const root = document.getElementById("toggles");
  root.innerHTML = "";
  series.forEach((s, i) => {
    const style = SERIES_STYLE[s.id] || SERIES_STYLE.bl_roadside;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toggle";
    btn.setAttribute("aria-pressed", "true");
    btn.innerHTML = `<span class="swatch ${style.dash.length ? "swatch--dash" : "swatch--solid"}" style="--swatch:${style.color}"></span>${s.label} · ${s.n}`;
    btn.addEventListener("click", () => {
      const ds = chart.data.datasets[i];
      ds.hidden = !ds.hidden;
      btn.setAttribute("aria-pressed", ds.hidden ? "false" : "true");
      chart.update();
    });
    root.appendChild(btn);
  });
}

function renderCounts(data) {
  const root = document.getElementById("counts");
  root.innerHTML = data.series
    .map((s) => {
      const style = SERIES_STYLE[s.id] || SERIES_STYLE.bl_roadside;
      const sites = (s.sites || [])
        .map((site) => `${site.siteCode} ${site.name}`)
        .join(" · ");
      return `<article class="count-card" style="--accent:${style.color}">
        <h2>${s.label}</h2>
        <p class="n">${s.n}</p>
        <p class="sub">${latestComplete(data, s)}</p>
        <p class="sites">${sites}</p>
      </article>`;
    })
    .join("");
}

function fmtMean(v) {
  return Number.isFinite(v) ? fmtUg(v, 1) : "—";
}

function renderMeansTable(data) {
  const table = document.getElementById("means-table");
  const years = (data.years || []).map(String);
  const incomplete = new Set((data.incompleteYears || []).map(String));
  const head = years
    .map((y) => `<th scope="col">${incomplete.has(y) ? `${y}*` : y}</th>`)
    .join("");
  const rows = data.series
    .map((s) => {
      const style = SERIES_STYLE[s.id] || SERIES_STYLE.bl_roadside;
      const cells = years
        .map((y) => `<td>${fmtMean(s.values?.[y])}</td>`)
        .join("");
      return `<tr>
        <th scope="row"><span class="means-swatch" style="--swatch:${style.color}"></span>${s.label}</th>
        ${cells}
      </tr>`;
    })
    .join("");
  table.innerHTML = `<thead><tr><th scope="col">Category</th>${head}</tr></thead><tbody>${rows}</tbody>`;
}

function weatherCell(v, unit = "") {
  return Number.isFinite(v) ? `${v}${unit}` : "—";
}

function renderWeatherNarrative(wx) {
  const y = wx.years || {};
  const s23 = y["2023"]?.spring;
  const s24 = y["2024"]?.spring;
  const s22 = y["2022"]?.spring;
  const s25 = y["2025"]?.spring;
  const u23 = y["2023"]?.summer;
  const u22 = y["2022"]?.summer;
  const u25 = y["2025"]?.summer;
  if (!s23 || !s24 || !s22 || !s25) return "";
  return `2023–24 look like washout years: springs were wetter (${s23.precipMm} mm and ${s24.precipMm} mm vs ${s22.precipMm} mm in 2022), windier, and less easterly. Summer 2023 was also cool and wet (${u23.meanTempC}°C, ${u23.precipMm} mm) compared with 2022 (${u22.meanTempC}°C, ${u22.precipMm} mm). Spring 2025 flipped the other way — only ${s25.precipMm} mm of rain, the calmest wind (${s25.meanWindMs} m/s; ${s25.calmDayPct}% of days below 3 m/s), and the most easterly flow (${s25.easterlyPct}% of days). Summer 2025 was the warmest of the set (${u25.meanTempC}°C). That mix is consistent with a weather-driven rebound in annual PM₂.₅, though it does not rule out emission changes.`;
}

function renderWeatherTable(wx) {
  const years = Object.keys(wx.years || {}).sort();
  const metrics = [
    { key: "meanTempC", label: "Mean temperature", unit: " °C" },
    { key: "precipMm", label: "Total rainfall", unit: " mm" },
    { key: "meanWindMs", label: "Mean wind", unit: " m/s" },
    { key: "easterlyPct", label: "Easterly days", unit: "%" },
    { key: "calmDayPct", label: "Calm days (<3 m/s)", unit: "%" },
    { key: "sunshineHours", label: "Sunshine", unit: " h" },
    { key: "dryDayPct", label: "Dry days", unit: "%" },
  ];
  const head = years
    .flatMap((year) => [
      `<th scope="col">${year} spr</th>`,
      `<th scope="col">${year} sum</th>`,
    ])
    .join("");
  const rows = metrics
    .map((m) => {
      const cells = years
        .flatMap((year) => {
          const spr = wx.years[year]?.spring?.[m.key];
          const sum = wx.years[year]?.summer?.[m.key];
          return [
            `<td>${weatherCell(spr, m.unit)}</td>`,
            `<td>${weatherCell(sum, m.unit)}</td>`,
          ];
        })
        .join("");
      return `<tr><th scope="row">${m.label}</th>${cells}</tr>`;
    })
    .join("");
  return `<thead><tr><th scope="col">London</th>${head}</tr></thead><tbody>${rows}</tbody>`;
}

const WX_METERS = [
  { key: "precipMm", label: "Rain", unit: " mm", color: "#3b7cc9" },
  { key: "easterlyPct", label: "Easterly", unit: "%", color: "#c46a2e" },
  { key: "calmDayPct", label: "Calm", unit: "%", color: "#6b5a7a" },
  { key: "meanWindMs", label: "Wind", unit: " m/s", color: "#0f9e90" },
];

function weatherMaxes(wx) {
  const maxes = {};
  for (const m of WX_METERS) maxes[m.key] = 0;
  for (const year of Object.values(wx.years || {})) {
    for (const season of ["spring", "summer"]) {
      for (const m of WX_METERS) {
        const v = year[season]?.[m.key];
        if (Number.isFinite(v) && v > maxes[m.key]) maxes[m.key] = v;
      }
    }
  }
  return maxes;
}

function weatherTone(yearBlock) {
  const rain = (yearBlock.spring?.precipMm || 0) + (yearBlock.summer?.precipMm || 0);
  const calm = (yearBlock.spring?.calmDayPct || 0) + (yearBlock.summer?.calmDayPct || 0);
  if (rain >= 340) return { className: "wx-card--wet", tag: "Wet / mixed" };
  if (calm >= 100 && rain < 250) return { className: "wx-card--stagnant", tag: "Dry / stagnant" };
  return { className: "wx-card--mid", tag: "Warmer / drier summer" };
}

function renderWeatherVisual(wx) {
  const root = document.getElementById("weather-visual");
  if (!root) return;
  const years = Object.keys(wx.years || {}).sort();
  const maxes = weatherMaxes(wx);
  root.innerHTML = years
    .map((year) => {
      const block = wx.years[year];
      const tone = weatherTone(block);
      const seasons = [
        { key: "spring", label: "Spring" },
        { key: "summer", label: "Summer" },
      ]
        .map((season) => {
          const stats = block[season.key] || {};
          const meters = WX_METERS.map((m) => {
            const v = stats[m.key];
            const pct = Number.isFinite(v) && maxes[m.key] > 0 ? (100 * v) / maxes[m.key] : 0;
            return `<div class="wx-meter">
              <span class="wx-meter__lab">${m.label}</span>
              <span class="wx-meter__track"><span class="wx-meter__fill" style="width:${pct}%;background:${m.color}"></span></span>
              <span class="wx-meter__val">${weatherCell(v, m.unit)}</span>
            </div>`;
          }).join("");
          return `<div class="wx-season">
            <h4>${season.label} <span>${stats.meanTempC ?? "—"}°C</span></h4>
            ${meters}
          </div>`;
        })
        .join("");
      return `<article class="wx-card ${tone.className}">
        <header>
          <h3>${year}</h3>
          <p>${tone.tag}</p>
        </header>
        ${seasons}
      </article>`;
    })
    .join("");
}

async function renderWeather() {
  const lede = document.getElementById("weather-lede");
  const table = document.getElementById("weather-table");
  const note = document.getElementById("weather-note");
  try {
    const res = await fetch("data/london-season-weather.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`weather ${res.status}`);
    const wx = await res.json();
    lede.textContent = renderWeatherNarrative(wx);
    renderWeatherVisual(wx);
    table.innerHTML = renderWeatherTable(wx);
    note.textContent = `St James’s Park daily weather from Open-Meteo archive. Easterly = dominant wind 45–135° (NE–SE), the continental sector linked with higher London PM₂.₅. ${wx.seasons.spring} / ${wx.seasons.summer}.`;
  } catch (err) {
    lede.textContent =
      "Weather summary could not be loaded. Run npm run fetch:weather.";
    console.warn(err);
  }
}

function buildChart(data) {
  const labels = data.years.map(String);
  const incomplete = new Set((data.incompleteYears || []).map(String));
  const datasets = data.series.map((s) => {
    const style = SERIES_STYLE[s.id] || SERIES_STYLE.bl_roadside;
    return {
      label: s.label,
      data: labels.map((y) => s.values?.[y] ?? null),
      borderColor: style.color,
      backgroundColor: style.color,
      borderDash: style.dash,
      pointStyle: style.pointStyle,
      pointRadius: labels.map((y) => (incomplete.has(y) ? 5 : 4)),
      pointHoverRadius: 6,
      borderWidth: 2.25,
      tension: 0.18,
      spanGaps: false,
      hidden: false,
    };
  });

  datasets.push({
    label: "WHO annual 5 µg/m³",
    data: labels.map(() => data.whoPm25 ?? 5),
    borderColor: WHO_COLOR,
    backgroundColor: WHO_COLOR,
    borderDash: [2, 4],
    pointRadius: 0,
    borderWidth: 1.5,
    tension: 0,
    hidden: false,
  });

  const ctx = document.getElementById("chart");
  return new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#15202b",
          titleColor: "#f6f9fb",
          bodyColor: "#f6f9fb",
          titleFont: { family: "Fraunces", size: 14 },
          bodyFont: { family: "Commissioner", size: 13 },
          padding: 12,
          callbacks: {
            label(item) {
              const y = item.label;
              const extra = incomplete.has(y) ? " · YTD" : "";
              const v = item.parsed.y;
              if (v == null) return `${item.dataset.label}: no data`;
              return `${item.dataset.label}: ${fmtUg(v)} µg/m³${extra}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: GRID },
          ticks: {
            font: { family: "Commissioner", size: 12 },
            color: AXIS_MUTED,
            callback(value, index) {
              const y = labels[index];
              return incomplete.has(y) ? `${y}*` : y;
            },
          },
        },
        y: {
          beginAtZero: true,
          suggestedMax: 16,
          title: {
            display: true,
            text: "µg/m³",
            color: AXIS_MUTED,
            font: { family: "Commissioner", size: 12 },
          },
          grid: { color: GRID },
          ticks: {
            font: { family: "Commissioner", size: 12 },
            color: AXIS_MUTED,
          },
        },
      },
    },
  });
}

async function main() {
  const generated = document.getElementById("generated");
  try {
    const res = await fetch("data/annual-pm25.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`Could not load data (${res.status})`);
    const data = await res.json();
    generated.textContent = `Updated ${fmtWhen(data.generatedAt)}`;
    const incompleteEl = document.getElementById("incomplete");
    if (data.incompleteYears?.length) {
      incompleteEl.hidden = false;
      incompleteEl.textContent = `${data.incompleteYears.join(", ")} marked with * is year-to-date, not a full calendar year.`;
    }
    renderCounts(data);
    renderMeansTable(data);
    const chart = buildChart(data);
    renderToggles(data.series, chart);
    await renderWeather();
  } catch (err) {
    generated.textContent = "";
    document.querySelector(".board").insertAdjacentHTML(
      "afterbegin",
      `<p class="error">${err.message}. Run <code>npm run build:data</code> then refresh.</p>`,
    );
  }
}

main();
