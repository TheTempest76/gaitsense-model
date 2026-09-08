/* GaitSense dashboard.
 *
 * Charts are hand-built SVG: the whole page is served from the FastAPI process
 * on a LAN that may have no internet route, so pulling a charting library from
 * a CDN would leave the dashboard blank exactly when it is needed.
 *
 * Every chart here plots a single measure against one axis. There is no
 * dual-axis chart anywhere, and the risk indicator's bands are drawn in
 * neutral gray rather than traffic-light colours -- see risk.py for why the
 * model does not support a stronger visual claim.
 */

const REFRESH_MS = 5000;
const SVG_NS = "http://www.w3.org/2000/svg";

const state = { summary: null, history: null, readings: null, exercises: null };

/* ------------------------------------------------------------------ utils */

const $ = (id) => document.getElementById(id);

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function fmtInt(n) {
  return n === null || n === undefined || Number.isNaN(n)
    ? "—" : Math.round(n).toLocaleString();
}

function fmt(n, digits = 1) {
  return n === null || n === undefined || Number.isNaN(n)
    ? "—" : Number(n).toFixed(digits);
}

function fmtDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined,
    { month: "short", day: "numeric" });
}

function fmtClock(ms) {
  return new Date(ms).toLocaleTimeString(undefined,
    { hour: "2-digit", minute: "2-digit" });
}

function fmtAgo(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

/* Nice round axis maximum, so ticks land on readable numbers. */
function niceMax(v) {
  if (!(v > 0)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/* A bar with rounded top corners, anchored square to the baseline. */
function barPath(x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, w / 2, h));
  if (h <= 0) return "";
  return `M${x},${y + h}V${y + rad}A${rad},${rad} 0 0 1 ${x + rad},${y}` +
         `H${x + w - rad}A${rad},${rad} 0 0 1 ${x + w},${y + rad}` +
         `V${y + h}Z`;
}

/* ----------------------------------------------------------- chart chrome */

const PAD = { top: 16, right: 18, bottom: 30, left: 46 };

function setupSvg(svg, height) {
  const width = Math.max(320, svg.parentElement.clientWidth);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  return { width, height, plotW: width - PAD.left - PAD.right,
           plotH: height - PAD.top - PAD.bottom };
}

function drawYAxis(svg, g, yMax, plotW, fmtTick, ticks = 4) {
  for (let i = 0; i <= ticks; i++) {
    const v = (yMax * i) / ticks;
    const y = PAD.top + g.plotH - (v / yMax) * g.plotH;
    svg.appendChild(el("line", {
      class: i === 0 ? "axis-line" : "grid-line",
      x1: PAD.left, x2: PAD.left + plotW, y1: y, y2: y,
    }));
    svg.appendChild(el("text", {
      class: "tick-text", x: PAD.left - 8, y: y + 3.5, "text-anchor": "end",
    }, fmtTick(v)));
  }
}

function emptyState(svg, wrap, message) {
  const width = Math.max(320, wrap.clientWidth);
  svg.setAttribute("viewBox", `0 0 ${width} 120`);
  svg.setAttribute("height", 120);
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.appendChild(el("text", {
    class: "tick-text", x: width / 2, y: 62, "text-anchor": "middle",
  }, message));
}

/* Tooltip that follows the pointer but stays inside the chart box. */
function showTip(tip, wrap, x, y, html) {
  tip.innerHTML = html;
  tip.classList.add("show");
  const box = wrap.getBoundingClientRect();
  const tw = tip.offsetWidth;
  let left = x + 12;
  if (left + tw > box.width - 4) left = x - tw - 12;
  tip.style.left = `${Math.max(4, left)}px`;
  tip.style.top = `${Math.max(4, y - 14)}px`;
}

const hideTip = (tip) => tip.classList.remove("show");

/* ------------------------------------------------------------- bar chart */

function renderStepsChart() {
  const svg = $("steps-chart");
  const wrap = $("steps-wrap");
  const tip = $("steps-tip");
  const days = (state.history?.days || []).slice(-30);

  if (!days.length) {
    emptyState(svg, wrap, "No readings yet — power up the node and start walking.");
    return;
  }

  const g = setupSvg(svg, 220);
  const yMax = niceMax(Math.max(1, ...days.map((d) => d.steps || 0)));
  drawYAxis(svg, g, yMax, g.plotW, (v) => fmtInt(v));

  const GAP = 2;                       // surface gap between adjacent bars
  const slot = g.plotW / days.length;
  const barW = Math.max(2, slot - GAP);

  days.forEach((d, i) => {
    const v = d.steps || 0;
    const h = (v / yMax) * g.plotH;
    const x = PAD.left + i * slot + GAP / 2;
    const y = PAD.top + g.plotH - h;

    if (h > 0) {
      const p = el("path", { class: "bar", d: barPath(x, y, barW, h, 4) });
      svg.appendChild(p);
    }

    // Hit target spans the full slot, so thin bars stay hoverable.
    const hit = el("rect", {
      x: PAD.left + i * slot, y: PAD.top, width: slot, height: g.plotH,
      fill: "transparent",
    });
    hit.addEventListener("mousemove", (e) => {
      const box = wrap.getBoundingClientRect();
      showTip(tip, wrap, e.clientX - box.left, e.clientY - box.top,
        `<div class="tt-key">${fmtDay(d.day)}</div>` +
        `<div><span class="tt-val">${fmtInt(v)}</span> steps</div>` +
        `<div class="tt-key">${fmt((d.walking_sec || 0) / 60, 0)} min walking` +
        (d.cadence_spm ? ` · ${fmt(d.cadence_spm, 0)} steps/min` : "") + `</div>`);
    });
    hit.addEventListener("mouseleave", () => hideTip(tip));
    svg.appendChild(hit);
  });

  // Direct-label only the most recent day; the axis carries the rest.
  const last = days[days.length - 1];
  if (last.steps > 0) {
    const h = (last.steps / yMax) * g.plotH;
    svg.appendChild(el("text", {
      class: "tick-text", "text-anchor": "end",
      x: PAD.left + g.plotW, y: PAD.top + g.plotH - h - 6,
    }, fmtInt(last.steps)));
  }

  // X labels: first, middle and last only, to avoid a collided axis.
  [0, Math.floor(days.length / 2), days.length - 1]
    .filter((v, i, a) => a.indexOf(v) === i)
    .forEach((i) => {
      const anchor = i === 0 ? "start" : i === days.length - 1 ? "end" : "middle";
      svg.appendChild(el("text", {
        class: "tick-text", "text-anchor": anchor,
        x: PAD.left + i * slot + slot / 2, y: PAD.top + g.plotH + 16,
      }, fmtDay(days[i].day)));
    });

  renderTable("steps-table", ["Day", "Steps", "Walking (min)", "Cadence"],
    days.map((d) => [fmtDay(d.day), fmtInt(d.steps),
                     fmt((d.walking_sec || 0) / 60, 0), fmt(d.cadence_spm, 0)]));
}

/* ------------------------------------------------------------ line charts */

function renderLine({ svgId, wrapId, tipId, tableId, points, yMax, yMin = 0,
                      fmtTick, tipHtml, xLabel, bands, alt, emptyMsg,
                      tableHead, tableRows }) {
  const svg = $(svgId), wrap = $(wrapId), tip = $(tipId);

  if (!points.length) {
    emptyState(svg, wrap, emptyMsg);
    if (tableId) renderTable(tableId, tableHead, []);
    return;
  }

  const g = setupSvg(svg, 220);
  const span = Math.max(1e-9, yMax - yMin);
  const xAt = (i) => points.length === 1
    ? PAD.left + g.plotW / 2
    : PAD.left + (i / (points.length - 1)) * g.plotW;
  const yAt = (v) => PAD.top + g.plotH - ((v - yMin) / span) * g.plotH;

  // Band shading sits behind the grid so it reads as background, not as a mark.
  if (bands) {
    bands.forEach((b) => {
      const top = yAt(b.hi), bottom = yAt(b.lo);
      svg.appendChild(el("rect", {
        class: "band-rect", x: PAD.left, y: top,
        width: g.plotW, height: Math.max(0, bottom - top),
      }));
      svg.appendChild(el("line", {
        class: "band-edge", x1: PAD.left, x2: PAD.left + g.plotW,
        y1: top, y2: top,
      }));
      if (b.label) {
        svg.appendChild(el("text", {
          class: "band-label", x: PAD.left + 6, y: top + 13,
        }, b.label));
      }
    });
  }

  drawYAxis(svg, g, yMax, g.plotW, fmtTick);

  const defined = points.map((p, i) => ({ ...p, i })).filter((p) => p.v !== null);
  if (!defined.length) {
    emptyState(svg, wrap, emptyMsg);
    return;
  }

  // Break the line across gaps rather than interpolating over days with no
  // data -- a straight line through a missing day would invent a measurement.
  let d = "";
  let prevIdx = null;
  defined.forEach((p) => {
    const cmd = (prevIdx === null || p.i !== prevIdx + 1) ? "M" : "L";
    d += `${cmd}${xAt(p.i).toFixed(2)},${yAt(p.v).toFixed(2)}`;
    prevIdx = p.i;
  });
  svg.appendChild(el("path", { class: alt ? "line alt" : "line", d }));

  // Markers only when the series is short enough that they do not merge.
  if (defined.length <= 40) {
    defined.forEach((p) => svg.appendChild(el("circle", {
      class: alt ? "marker alt" : "marker",
      cx: xAt(p.i), cy: yAt(p.v), r: 4,
    })));
  }

  // Direct-label the latest value only.
  const last = defined[defined.length - 1];
  svg.appendChild(el("text", {
    class: "tick-text", "text-anchor": "end",
    x: PAD.left + g.plotW, y: yAt(last.v) - 10,
  }, fmtTick(last.v)));

  // X labels: ends and middle.
  [0, Math.floor(points.length / 2), points.length - 1]
    .filter((v, i, a) => a.indexOf(v) === i)
    .forEach((i) => {
      const anchor = i === 0 ? "start" : i === points.length - 1 ? "end" : "middle";
      svg.appendChild(el("text", {
        class: "tick-text", "text-anchor": anchor,
        x: xAt(i), y: PAD.top + g.plotH + 16,
      }, xLabel(points[i], i)));
    });

  // Crosshair + nearest-point tooltip across the whole plot.
  const cross = el("line", {
    class: "crosshair", y1: PAD.top, y2: PAD.top + g.plotH,
    x1: 0, x2: 0, opacity: 0,
  });
  svg.appendChild(cross);

  const overlay = el("rect", {
    x: PAD.left, y: PAD.top, width: g.plotW, height: g.plotH, fill: "transparent",
  });
  overlay.addEventListener("mousemove", (e) => {
    const box = wrap.getBoundingClientRect();
    const px = e.clientX - box.left;
    let best = defined[0], bestDist = Infinity;
    defined.forEach((p) => {
      const dist = Math.abs(xAt(p.i) - px);
      if (dist < bestDist) { bestDist = dist; best = p; }
    });
    cross.setAttribute("x1", xAt(best.i));
    cross.setAttribute("x2", xAt(best.i));
    cross.setAttribute("opacity", 1);
    showTip(tip, wrap, px, e.clientY - box.top, tipHtml(best));
  });
  overlay.addEventListener("mouseleave", () => {
    hideTip(tip);
    cross.setAttribute("opacity", 0);
  });
  svg.appendChild(overlay);

  if (tableId) renderTable(tableId, tableHead, tableRows());
}

function renderRiskChart() {
  const days = (state.history?.days || []).slice(-30);
  const bandEdges = state.history?.bands || { low: 0.35, high: 0.65 };

  renderLine({
    svgId: "risk-chart", wrapId: "risk-wrap", tipId: "risk-tip",
    tableId: "risk-table",
    points: days.map((d) => ({ ...d, v: d.prob_median })),
    yMin: 0, yMax: 1,
    fmtTick: (v) => fmt(v, 2),
    bands: [{ lo: bandEdges.low, hi: bandEdges.high, label: "model cannot separate" }],
    xLabel: (p) => fmtDay(p.day),
    emptyMsg: "No scored windows yet — needs a couple of minutes of walking.",
    tipHtml: (p) =>
      `<div class="tt-key">${fmtDay(p.day)}</div>` +
      `<div><span class="tt-val">${fmt(p.v, 3)}</span> median indicator</div>` +
      `<div class="tt-key">${fmtInt(p.scored_windows)} scored windows</div>`,
    tableHead: ["Day", "Median indicator", "Scored windows"],
    tableRows: () => days.map((d) => [
      fmtDay(d.day), d.prob_median === null ? "—" : fmt(d.prob_median, 3),
      fmtInt(d.scored_windows)]),
  });
}

function renderCadenceChart() {
  const readings = (state.readings?.readings || []).filter((r) => r.walking);
  const values = readings.map((r) => r.cadence_spm).filter((v) => v !== null);
  const yMax = niceMax(Math.max(120, ...values));

  // In live use these windows span an hour or so and a clock time is enough.
  // Over a longer history they cross midnight, where a bare clock time reads
  // as going backwards -- so add the date whenever the range spans more than
  // one calendar day. Comparing dates rather than elapsed milliseconds,
  // because 23:00 to 09:00 crosses midnight in well under 24 hours.
  const localDay = (ms) => new Date(ms).toLocaleDateString();
  const multiDay = readings.length > 1 &&
    localDay(readings[0].ts_ms) !== localDay(readings[readings.length - 1].ts_ms);
  const stamp = (ms) => multiDay
    ? `${new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${fmtClock(ms)}`
    : fmtClock(ms);

  renderLine({
    svgId: "cadence-chart", wrapId: "cadence-wrap", tipId: "cadence-tip",
    tableId: "cadence-table",
    points: readings.map((r) => ({ ...r, v: r.cadence_spm })),
    yMin: 0, yMax,
    fmtTick: (v) => fmt(v, 0),
    xLabel: (p) => stamp(p.ts_ms),
    alt: true,
    emptyMsg: "No walking detected yet.",
    tipHtml: (p) =>
      `<div class="tt-key">${stamp(p.ts_ms)}</div>` +
      `<div><span class="tt-val">${fmt(p.v, 0)}</span> steps/min</div>` +
      `<div class="tt-key">${fmtInt(p.steps_window)} steps in window` +
      (p.scored ? ` · scored` : ` · not scored`) + `</div>`,
    tableHead: ["Time", "Cadence", "Steps in window", "Scored"],
    tableRows: () => readings.map((r) => [
      stamp(r.ts_ms), fmt(r.cadence_spm, 0), fmtInt(r.steps_window),
      r.scored ? "yes" : "no"]),
  });
}

/* ----------------------------------------------------------- table views */

function renderTable(containerId, head, rows) {
  const host = $(containerId);
  if (!host) return;
  host.innerHTML = "";
  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  const t = document.createElement("table");
  t.className = "data";

  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  head.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  t.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    r.forEach((c) => {
      const td = document.createElement("td");
      td.textContent = c;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  t.appendChild(tbody);
  scroll.appendChild(t);
  host.appendChild(scroll);
}

document.querySelectorAll("[data-table-for]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.getAttribute("data-table-for");
    const table = $(`${key}-table`);
    const chart = $(`${key}-wrap`);
    const showing = !table.hidden;
    table.hidden = showing;
    chart.hidden = !showing;
    btn.setAttribute("aria-pressed", String(!showing));
    btn.textContent = showing ? "Table" : "Chart";
  });
});

/* -------------------------------------------------------------- sections */

function renderTiles() {
  const s = state.summary;
  if (!s) return;

  $("stat-steps").textContent = fmtInt(s.steps);
  $("stat-steps-foot").textContent = s.avg_daily_steps
    ? `30-day average ${fmtInt(s.avg_daily_steps)}` : " ";

  $("stat-walking").innerHTML =
    `${fmt((s.walking_sec || 0) / 60, 0)}<span class="unit">min</span>`;
  $("stat-walking-foot").textContent = `${fmtInt(s.windows)} windows recorded`;

  $("stat-cadence").innerHTML = s.cadence_spm
    ? `${fmt(s.cadence_spm, 0)}<span class="unit">steps/min</span>`
    : `—<span class="unit">steps/min</span>`;
  $("stat-cadence-foot").textContent = s.stride_time_mean
    ? `Stride time ${fmt(s.stride_time_mean, 2)} s` : " ";

  $("stat-windows").textContent = fmtInt(s.scored_windows);
  $("stat-windows-foot").textContent =
    `of ${fmtInt(s.windows)} met the walking + complete-features bar`;
}

function renderAssessment() {
  const a = state.summary?.assessment;
  if (!a) return;
  const card = a.model_card;

  $("assessment-what").textContent = card.what_it_measures;
  $("assessment-label").textContent = a.label;
  $("assessment-prob").textContent = a.probability === null
    ? ""
    : `P = ${fmt(a.probability, 3)} · median of ${fmtInt(a.n_scored_windows)} windows`;
  $("assessment-detail").textContent = a.detail;

  $("assessment-notice").innerHTML =
    `<p><strong>This does not predict falls.</strong> ${card.what_it_does_not_measure}</p>` +
    `<p>${card.accuracy_plain}</p>` +
    `<p>${card.trustworthy_instead}</p>`;

  const dl = $("model-card-body");
  dl.innerHTML = "";
  const entries = [
    ["What it measures", card.what_it_measures],
    ["What it does not measure", card.what_it_does_not_measure],
    ["Measured accuracy", card.accuracy_plain],
    ["Known confound", card.known_confound],
    ["Status", card.not_medical_advice],
  ];
  for (const [term, desc] of entries) {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = desc;
    dl.append(dt, dd);
  }

  // A device/server disagreement means the flashed model.c no longer matches
  // models/model.json, so say so rather than quietly showing a stale number.
  const drift = state.summary?.model_drift;
  if (drift !== null && drift !== undefined && drift > 1e-4) {
    const p = document.createElement("p");
    p.innerHTML = `<strong>Model mismatch:</strong> the device's score differs ` +
      `from the server's by up to ${fmt(drift, 4)}. The flashed firmware is ` +
      `probably built from an older model than <code>models/model.json</code>.`;
    $("assessment-notice").appendChild(p);
  }
}

function exerciseCard(ex, withReason) {
  const d = document.createElement("div");
  d.className = "ex";

  const top = document.createElement("div");
  top.className = "ex-top";
  const h = document.createElement("h3");
  h.textContent = ex.name;
  const cat = document.createElement("span");
  cat.className = "cat";
  cat.textContent = ex.category.replace(/_/g, " ");
  top.append(h, cat);

  const dose = document.createElement("div");
  dose.className = "dose";
  dose.textContent = ex.dose;

  d.append(top, dose);

  if (withReason && ex.reason) {
    const r = document.createElement("div");
    r.className = "reason";
    r.textContent = ex.reason;
    d.appendChild(r);
  }

  const ol = document.createElement("ol");
  ex.how.forEach((step) => {
    const li = document.createElement("li");
    li.textContent = step;
    ol.appendChild(li);
  });

  const why = document.createElement("div");
  why.className = "why";
  why.textContent = ex.why;

  d.append(ol, why);
  return d;
}

function renderExercises() {
  const x = state.exercises;
  if (!x) return;

  $("ex-basis").textContent = x.basis;
  $("ex-safety").textContent = x.safety_note;

  const rec = $("ex-recommended");
  rec.innerHTML = "";
  x.recommended.forEach((ex) => rec.appendChild(exerciseCard(ex, true)));

  const lib = $("ex-library");
  lib.innerHTML = "";
  x.library.forEach((ex) => lib.appendChild(exerciseCard(ex, false)));
}

function renderDevices() {
  const devices = state.summary?.devices || [];
  const host = $("devices");
  host.innerHTML = "";

  const pillText = $("device-pill-text");
  const pillDot = $("device-pill").querySelector(".dot");

  if (!devices.length) {
    host.innerHTML =
      `<p class="empty">No device has reported yet. Flash the firmware in ` +
      `<code>firmware/</code>, set the server URL and token in ` +
      `<code>idf.py menuconfig</code>, and power it up.</p>`;
    pillText.textContent = "No device yet";
    pillDot.className = "dot offline";
    return;
  }

  const online = devices.find((d) => d.online) || devices[0];
  pillText.textContent = online.online
    ? `${online.device_id} · online`
    : `${online.device_id} · last seen ${fmtAgo(online.last_seen_ms)}`;
  pillDot.className = `dot ${online.online ? "online" : "offline"}`;

  devices.forEach((d) => {
    const row = document.createElement("div");
    row.className = "dev-row";
    row.innerHTML =
      `<span class="dot ${d.online ? "online" : "offline"}"></span>` +
      `<span class="id">${d.device_id}</span>` +
      `<span class="meta">fw ${d.fw || "?"}</span>` +
      `<span class="meta">${fmtInt(d.total_windows)} windows</span>` +
      `<span class="meta">RSSI ${d.rssi ?? "—"} dBm</span>` +
      `<span class="meta">clock: ${d.ts_source === "device" ? "device (SNTP)" : "server arrival"}</span>` +
      `<span class="meta">${fmtAgo(d.last_seen_ms)}</span>`;
    host.appendChild(row);
  });
}

/* ------------------------------------------------------------------ boot */

function renderAll() {
  renderTiles();
  renderAssessment();
  renderDevices();
  renderStepsChart();
  renderRiskChart();
  renderCadenceChart();
  renderExercises();
}

async function refresh() {
  try {
    const [summary, history, readings, ex] = await Promise.all([
      getJSON("/api/summary"),
      getJSON("/api/history?days=30"),
      getJSON("/api/readings?limit=180"),
      getJSON("/api/exercises"),
    ]);
    Object.assign(state, { summary, history, readings, exercises: ex });
    renderAll();
  } catch (e) {
    console.error("refresh failed", e);
  }
}

$("theme-toggle").addEventListener("click", () => {
  const root = document.documentElement;
  const dark = root.getAttribute("data-theme") === "dark" ||
    (!root.hasAttribute("data-theme") &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.setAttribute("data-theme", dark ? "light" : "dark");
  try { localStorage.setItem("gaitsense-theme", dark ? "light" : "dark"); } catch {}
  renderAll();   // markers carry a surface-coloured ring, so redraw on swap
});

try {
  const saved = localStorage.getItem("gaitsense-theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
} catch {}

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderAll, 150);
});

refresh();
setInterval(refresh, REFRESH_MS);
