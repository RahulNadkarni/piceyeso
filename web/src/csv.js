import { SUBFIELDS } from "./etdrs.js";

export const DEFAULT_ETDRS_UM = [276, 339, 337, 331, 333, 292, 300, 289, 288];

function parseNumber(x) {
  const v = Number(String(x).replace(/[, ]+$/g, ""));
  return Number.isFinite(v) ? v : NaN;
}

function delimiter(line) {
  const tab = (line.match(/\t/g) || []).length;
  const semi = (line.match(/;/g) || []).length;
  const comma = (line.match(/,/g) || []).length;
  if (tab >= semi && tab >= comma && tab > 0) return "\t";
  if (semi > comma) return ";";
  return ",";
}

function splitTable(text) {
  const lines = String(text || "").trim().split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = delimiter(lines[0]);
  return lines.map((r) => r.split(sep).map((c) => c.trim()));
}

export function tableFromNine(vals) {
  const um = SUBFIELDS.map((_, i) => {
    const v = Number(vals[i]);
    return Number.isFinite(v) ? v : DEFAULT_ETDRS_UM[i];
  });
  return { total: Object.fromEntries(SUBFIELDS.map((s, i) => [s, um[i]])) };
}

/** One-eye table: {layer: {subfield: number}} */
export function parseEtdrsCsv(text) {
  const rows = splitTable(text);
  if (!rows.length) return {};
  const firstNums = rows[0].map(parseNumber);
  if (firstNums.filter(Number.isFinite).length >= 9 && !/[a-zA-Z]/.test(rows[0][0] || "")) {
    return tableFromNine(firstNums);
  }
  const header = rows[0].slice(1).map((h) => h.toLowerCase());
  const named = SUBFIELDS.every((s) => header.includes(s));
  const body = named || firstNums.slice(1).filter(Number.isFinite).length < 8
    ? rows.slice(1) : rows;
  const table = {};
  for (const r of body) {
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
  const rows = splitTable(text);
  if (!rows.length) return null;
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
