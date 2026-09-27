export const SUBFIELDS = [
  "central",
  "inner_superior", "inner_nasal", "inner_inferior", "inner_temporal",
  "outer_superior", "outer_nasal", "outer_inferior", "outer_temporal",
];

export const SUBFIELD_LABELS = [
  "Central",
  "Inner superior", "Inner nasal", "Inner inferior", "Inner temporal",
  "Outer superior", "Outer nasal", "Outer inferior", "Outer temporal",
];

/** ETDRS subfield index at en-face (x, y) mm. -1 outside the 6 mm grid. */
export function assignSubfield(x, y, laterality = "OD", rings = [0.5, 1.5, 3.0]) {
  const dx = laterality === "OS" ? -x : x;
  const rho = Math.hypot(dx, y);
  const ang = (Math.atan2(y, dx) * 180) / Math.PI;
  let quad = 3;
  if (ang >= 45 && ang < 135) quad = 0;
  else if (ang >= -45 && ang < 45) quad = 1;
  else if (ang >= -135 && ang < -45) quad = 2;
  if (rho < rings[0]) return 0;
  if (rho < rings[1]) return 1 + quad;
  if (rho <= rings[2]) return 5 + quad;
  return -1;
}

/** Bilinear sample of a polar field (R, T) at en-face (x, y). NaN outside. */
export function samplePolar(field, rho, theta, x, y) {
  const r = Math.hypot(x, y);
  if (!Number.isFinite(r) || r > rho[rho.length - 1]) return NaN;
  let ri = 0;
  while (ri < rho.length - 1 && rho[ri + 1] <= r) ri += 1;
  const r1 = Math.min(ri + 1, rho.length - 1);
  const wr = r1 === ri ? 0 : (r - rho[ri]) / (rho[r1] - rho[ri]);
  let ang = Math.atan2(y, x);
  if (ang < 0) ang += Math.PI * 2;
  const T = theta.length;
  const ft = (ang / (Math.PI * 2)) * T;
  const t0 = ((Math.floor(ft) % T) + T) % T;
  const t1 = (t0 + 1) % T;
  const wt = ft - Math.floor(ft);
  const a = field[ri][t0], b = field[ri][t1], c = field[r1][t0], d = field[r1][t1];
  if ([a, b, c, d].some((v) => v == null || !Number.isFinite(v))) return NaN;
  return (1 - wr) * (1 - wt) * a + (1 - wr) * wt * b + wr * (1 - wt) * c + wr * wt * d;
}

/**
 * Healthy macular thickness (µm) versus distance from the foveola (mm).
 * Inner layers go to zero at the centre, which is the pit. A one-slab
 * ETDRS row is split by these fractions; a sector value only scales them.
 */
export const DISPLAY_LAYERS = ["NFL", "GCL", "IPL", "INL", "OPL", "ONL", "IS/OS", "RPE"];
const PRIOR_R = [0, 0.5, 1.0, 1.5, 2.25, 3.0];
const PRIOR_UM = {
  NFL: [0, 8, 24, 36, 48, 52],
  GCL: [0, 22, 62, 45, 30, 22],
  IPL: [0, 16, 42, 36, 30, 26],
  INL: [8, 30, 42, 38, 34, 30],
  OPL: [20, 34, 36, 32, 28, 26],
  ONL: [130, 105, 80, 72, 66, 62],
  "IS/OS": [36, 34, 32, 30, 28, 26],
  RPE: [26, 25, 24, 23, 22, 22],
};

function canon(name) {
  return String(name).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

const FULL_SLAB = new Set(["total", "ilmrpe", "ilmbm", "retina", "fullretina", "slab"]);
const ROW_PARTS = {
  nfl: ["NFL"], rnfl: ["NFL"],
  gcl: ["GCL"], ipl: ["IPL"],
  nflipl: ["NFL", "GCL", "IPL"],
  gclipl: ["GCL", "IPL"],
  inl: ["INL"], opl: ["OPL"], onl: ["ONL"],
  isos: ["IS/OS"], ez: ["IS/OS"],
  rpe: ["RPE"],
};

export function priorUm(layer, rMm) {
  const stops = PRIOR_UM[layer];
  const r = Math.min(Math.max(rMm, 0), PRIOR_R[PRIOR_R.length - 1]);
  let i = 0;
  while (i < PRIOR_R.length - 2 && PRIOR_R[i + 1] < r) i += 1;
  const span = PRIOR_R[i + 1] - PRIOR_R[i];
  const f = span === 0 ? 0 : (r - PRIOR_R[i]) / span;
  return stops[i] * (1 - f) + stops[i + 1] * f;
}

function ringMean(layer, r0, r1) {
  let num = 0, den = 0;
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const r = r0 + ((r1 - r0) * i) / steps;
    const w = Math.max(r, 1e-3);
    num += priorUm(layer, r) * w;
    den += w;
  }
  return num / den;
}

const PRIOR_MEANS = {};
function priorSectorMeans(layer) {
  if (!PRIOR_MEANS[layer]) {
    const c = ringMean(layer, 0, 0.5);
    const inner = ringMean(layer, 0.5, 1.5);
    const outer = ringMean(layer, 1.5, 3);
    PRIOR_MEANS[layer] = [c, inner, inner, inner, inner, outer, outer, outer, outer];
  }
  return PRIOR_MEANS[layer];
}

function rowSector(table, key) {
  return SUBFIELDS.map((s) => {
    const v = Number(table[key][s]);
    return Number.isFinite(v) ? v : NaN;
  });
}

export function sectorCenter(i, laterality) {
  if (i === 0) return [0, 0];
  const ring = i <= 4 ? 1.0 : 2.25;
  const q = (i - 1) % 4;
  const deg = [90, 0, -90, 180][q];
  const a = (deg * Math.PI) / 180;
  const nasalSign = laterality === "OS" ? -1 : 1;
  return [nasalSign * Math.cos(a) * ring, Math.sin(a) * ring];
}

function smoothScale(x, y, scales, laterality) {
  let wsum = 0, vsum = 0;
  for (let i = 0; i < 9; i++) {
    if (!Number.isFinite(scales[i])) continue;
    const [cx, cy] = sectorCenter(i, laterality);
    const dx = x - cx, dy = y - cy;
    const w = Math.exp(-(dx * dx + dy * dy) / (2 * 0.55 * 0.55));
    wsum += w;
    vsum += w * scales[i];
  }
  return wsum > 0 ? vsum / wsum : 1;
}

function scalesFor(sectorUm, parts) {
  const sumMeans = priorSectorMeans(parts[0]).map((_, i) => (
    parts.reduce((a, n) => a + priorSectorMeans(n)[i], 0)
  ));
  return sectorUm.map((v, i) => {
    if (!Number.isFinite(v) || sumMeans[i] < 1) return NaN;
    return Math.min(4, Math.max(0.2, v / sumMeans[i]));
  });
}

/**
 * Turn a CSV table into the layers the stack and the cross-section draw.
 * A single ILM–RPE (or total) row is one total surface — not a fake NFL/GCL/IPL
 * stack. An NFL–IPL row is split into NFL, GCL, and IPL. `singleSlab` means
 * the file had no per-layer rows.
 */
export function resolveStack(table) {
  const keys = Object.keys(table).filter((k) => canon(k) !== "choroid");
  const anatomical = [];
  for (const key of keys) {
    const parts = ROW_PARTS[canon(key)];
    if (parts) anatomical.push({ key, parts });
  }
  if (anatomical.length) {
    const layers = [];
    for (const name of DISPLAY_LAYERS) {
      const src = anatomical.find((a) => a.parts.includes(name));
      if (!src) continue;
      layers.push({ name, parts: src.parts, sectorUm: rowSector(table, src.key) });
    }
    return {
      layers,
      singleSlab: false,
      splitInner: anatomical.some((a) => a.parts.includes("NFL") && a.parts.length > 1),
    };
  }
  const slabKey = keys.find((k) => FULL_SLAB.has(canon(k)) && canon(k) !== "total")
    || keys.find((k) => canon(k) === "total")
    || keys[0];
  const sectorUm = slabKey && table[slabKey] ? rowSector(table, slabKey) : totalValues(table);
  return {
    layers: [{ name: "total", parts: ["total"], sectorUm }],
    singleSlab: true,
    splitInner: false,
  };
}

/** Per-vertex thickness (µm) of one display layer, smooth through the fovea. */
export function layerField(positions, layer, laterality) {
  const n = positions.length / 3;
  if (!PRIOR_UM[layer.name]) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = smoothScale(positions[i * 3], positions[i * 3 + 1], layer.sectorUm, laterality);
    }
    return out;
  }
  const scales = scalesFor(layer.sectorUm, layer.parts);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1];
    const r = Math.min(3, Math.hypot(x, y));
    out[i] = priorUm(layer.name, r) * smoothScale(x, y, scales, laterality);
  }
  return out;
}

/** Thickness (µm) along the cap for the layer named in the UI (or their sum). */
export function smoothLayerField(positions, table, layerName, laterality) {
  const stack = resolveStack(table);
  const c = canon(layerName);
  const wanted = (c === "total" || FULL_SLAB.has(c))
    ? stack.layers
    : stack.layers.filter((L) => {
      if (canon(L.name) === c) return true;
      const parts = ROW_PARTS[c];
      return parts && parts.includes(L.name) && L.parts.join() === parts.join();
    });
  const use = wanted.length ? wanted : stack.layers;
  const n = positions.length / 3;
  const out = new Float32Array(n);
  for (const layer of use) {
    const field = layerField(positions, layer, laterality);
    for (let i = 0; i < n; i++) out[i] += field[i];
  }
  return out;
}

/** Per-vertex height (mm) from 9 ETDRS values. BM stays put; ILM rises. */
export function heightsFromValues(positions, values, zScale, laterality) {
  const n = positions.length / 3;
  const h = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = assignSubfield(positions[i * 3], positions[i * 3 + 1], laterality);
    const um = s >= 0 ? values[s] : values[0];
    h[i] = ((Number.isFinite(um) ? um : 0) / 1000) * zScale;
  }
  return h;
}

export function totalValues(table) {
  if (table.total) return SUBFIELDS.map((s) => table.total[s]);
  const layers = Object.keys(table).filter((k) => k.toLowerCase() !== "choroid");
  return SUBFIELDS.map((s) => layers.reduce((a, n) => a + (Number(table[n][s]) || 0), 0));
}
