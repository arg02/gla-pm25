const SERIES_STYLE = {
  bl_roadside: {
    color: "#ff5c3a",
    dash: [],
    pointStyle: "circle",
  },
  bl_background: {
    color: "#2ec8b8",
    dash: [],
    pointStyle: "circle",
  },
  laqn_roadside: {
    color: "#f0a36b",
    dash: [7, 5],
    pointStyle: "rect",
  },
  laqn_background: {
    color: "#7ab3ff",
    dash: [7, 5],
    pointStyle: "rect",
  },
};

const WHO_COLOR = "#d4b45a";
const AXIS_MUTED = "#8b9bab";
const GRID = "rgba(232,238,243,0.08)";

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

function latestComplete(data, series) {
  const years = data.completeYears || [];
  const y = years[years.length - 1];
  const v = series.values?.[String(y)];
  return y && v != null ? `${v.toFixed(1)} µg/m³ in ${y}` : "—";
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
  return Number.isFinite(v) ? v.toFixed(2) : "—";
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
          backgroundColor: "#0b141b",
          titleColor: "#e8eef3",
          bodyColor: "#e8eef3",
          titleFont: { family: "Fraunces", size: 14 },
          bodyFont: { family: "Commissioner", size: 13 },
          padding: 12,
          callbacks: {
            label(item) {
              const y = item.label;
              const extra = incomplete.has(y) ? " · YTD" : "";
              const v = item.parsed.y;
              if (v == null) return `${item.dataset.label}: no data`;
              return `${item.dataset.label}: ${v.toFixed(1)} µg/m³${extra}`;
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
  } catch (err) {
    generated.textContent = "";
    document.querySelector(".board").insertAdjacentHTML(
      "afterbegin",
      `<p class="error">${err.message}. Run <code>npm run build:data</code> then refresh.</p>`,
    );
  }
}

main();
