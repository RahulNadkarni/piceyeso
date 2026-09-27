import { SUBFIELDS } from "./etdrs.js";

function parseNumber(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : NaN;
}

/** One-eye table: {layer: {subfield: number}} */
export function parseEtdrsCsv(text) {
  const rows = text.trim().split(/\r?\n/).map((r) => r.split(",").map((c) => c.trim()));
  const header = rows[0].slice(1).map((h) => h.toLowerCase());
  const named = SUBFIELDS.every((s) => header.includes(s));
  const table = {};
  for (const r of rows.slice(1)) {
    if (!r[0]) continue;
    const vals = r.slice(1).map(parseNumber);
    table[r[0]] = Object.fromEntries(SUBFIELDS.map((s, i) => [
      s, named ? vals[header.indexOf(s)] : vals[i],
    ]));
  }
  return table;
}

/** Time series: {timepoints, layers, values[t][layer][9]} */
export function parseTimeSeriesCsv(text) {
  const rows = text.trim().split(/\r?\n/).map((r) => r.split(",").map((c) => c.trim()));
  const header = rows[0].map((h) => h.toLowerCase());
  if (header[0] !== "timepoint") return null;
  const sub = header.slice(2);
  const named = SUBFIELDS.every((s) => sub.includes(s));
  const series = [];
  const index = new Map();
  for (const r of rows.slice(1)) {
    const tp = r[0], layer = r[1];
    if (!index.has(tp)) {
      index.set(tp, series.length);
      series.push({ timepoint: tp, layers: {} });
    }
    const vals = r.slice(2).map(parseNumber);
    series[index.get(tp)].layers[layer] = named
      ? SUBFIELDS.map((s) => vals[sub.indexOf(s)])
      : vals.slice(0, 9);
  }
  const layers = Object.keys(series[0].layers);
  return {
    timepoints: series.map((s) => s.timepoint),
    layers,
    values: series.map((s) => Object.fromEntries(layers.map((l) => [l, s.layers[l]]))),
  };
}

export function lerpSeries(series, t) {
  const n = series.values.length;
  if (n === 1) return series.values[0];
  const x = Math.min(1, Math.max(0, t)) * (n - 1);
  const i = Math.min(n - 2, Math.floor(x));
  const f = x - i;
  const a = series.values[i], b = series.values[i + 1];
  const out = {};
  for (const layer of series.layers) {
    out[layer] = a[layer].map((v, k) => v * (1 - f) + b[layer][k] * f);
  }
  return out;
}

export function tableFromFrame(frame) {
  return Object.fromEntries(Object.entries(frame).map(([layer, vals]) => [
    layer, Object.fromEntries(SUBFIELDS.map((s, i) => [s, vals[i]])),
  ]));
}
