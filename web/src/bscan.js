/** Layer lines drawn on a real OCT B-scan. Order is vitreous side to choroid. */
export const SURFACE_STYLE = [
  ["ILM", "ILM", "#ffffff"],
  ["NFL_GCL", "NFL", "#ffe14a"],
  ["RNFL", "NFL", "#ffe14a"],
  ["GCL_IPL", "GCL", "#ff8a3d"],
  ["GCL+IPL", "GCL+IPL", "#ff8a3d"],
  ["IPL_INL", "IPL", "#7dff6b"],
  ["INL", "INL", "#3ec6ff"],
  ["INL_OPL", "INL", "#3ec6ff"],
  ["OPL", "OPL", "#c792ea"],
  ["OPL_ONL", "OPL", "#c792ea"],
  ["ONL", "ONL", "#8ab4ff"],
  ["ELM", "ELM", "#f2f2f2"],
  ["EZ", "EZ", "#ff5ad1"],
  ["IS/OS", "IS/OS", "#ff5ad1"],
  ["RPE", "RPE", "#ff5a5a"],
  ["BM", "BM", "#b8c0cc"],
];

export function scanPitches(meta) {
  const row = Number(meta.azimuthal_mm || meta.lateral_mm) / Math.max(meta.n_bscans - 1, 1);
  const col = Number(meta.lateral_mm) / Math.max(meta.width, 1);
  return { row, col };
}

export function enfaceToScan(x, y, meta) {
  const { row, col } = scanPitches(meta);
  const fb = meta.fovea_bscan || 0;
  const fa = meta.fovea_ascan ?? Math.floor(meta.width / 2);
  return {
    bscan: Math.min(meta.n_bscans - 1, Math.max(0, Math.round(fb - y / row))),
    ascan: Math.min(meta.width - 1, Math.max(0, Math.round(fa + x / col))),
  };
}

export function scanToEnface(bscan, ascan, meta) {
  const { row, col } = scanPitches(meta);
  const fb = meta.fovea_bscan || 0;
  const fa = meta.fovea_ascan ?? Math.floor(meta.width / 2);
  return { x: (ascan - fa) * col, y: (fb - bscan) * row };
}

export function scanExtentX(meta) {
  const { col } = scanPitches(meta);
  const fa = meta.fovea_ascan ?? Math.floor(meta.width / 2);
  return { x0: (0 - fa) * col, x1: (meta.width - 1 - fa) * col };
}

export function clickToAscan(layout, clientX, clientY, canvas) {
  if (!layout) return null;
  const rect = canvas.getBoundingClientRect();
  const mx = clientX - rect.left;
  const my = clientY - rect.top;
  if (mx < layout.ox || mx > layout.ox + layout.drawW || my < layout.oy || my > layout.oy + layout.drawH) {
    return null;
  }
  return Math.min(layout.width - 1, Math.max(0, Math.round((mx - layout.ox) / layout.sx - 0.5)));
}

const SLAB_ORDER = ["ILM", "NFL_GCL", "GCL_IPL", "IPL_INL", "INL_OPL", "OPL_ONL", "ELM", "EZ", "RPE", "BM"];
const CANONICAL = { RNFL: "NFL_GCL", "IS/OS": "EZ" };
const LAYER_BETWEEN = {
  "ILM|NFL_GCL": "NFL",
  "NFL_GCL|GCL_IPL": "GCL",
  "GCL_IPL|IPL_INL": "IPL",
  "IPL_INL|INL_OPL": "INL",
  "INL_OPL|OPL_ONL": "OPL",
  "OPL_ONL|ELM": "ONL",
  "OPL_ONL|EZ": "ONL",
  "ELM|EZ": "IS/OS",
  "ELM|RPE": "IS/OS",
  "EZ|RPE": "IS/OS",
  "EZ|BM": "RPE",
  "RPE|BM": "RPE",
};

/** Thicknesses at one A-scan from the layer lines (pixel row × µm/px). */
export function ascanSlabs(lines, ascan, axialUm) {
  const y = {};
  for (const [name, row] of Object.entries(lines || {})) {
    const key = CANONICAL[name] || name;
    if (y[key] != null || !row || ascan < 0 || ascan >= row.length) continue;
    const v = row[ascan];
    if (Number.isFinite(v)) y[key] = v;
  }
  const present = SLAB_ORDER.filter((name) => Number.isFinite(y[name]));
  const slabs = [];
  if (Number.isFinite(y.ILM) && Number.isFinite(y.BM)) {
    slabs.push(["total", Math.round((y.BM - y.ILM) * axialUm * 10) / 10]);
  } else if (Number.isFinite(y.ILM) && Number.isFinite(y.RPE)) {
    slabs.push(["total", Math.round((y.RPE - y.ILM) * axialUm * 10) / 10]);
  }
  for (let i = 0; i < present.length - 1; i++) {
    const inner = present[i], outer = present[i + 1];
    const layer = LAYER_BETWEEN[`${inner}|${outer}`];
    if (!layer) continue;
    const um = (y[outer] - y[inner]) * axialUm;
    if (um >= 0) slabs.push([layer, Math.round(um * 10) / 10]);
  }
  return slabs;
}

export function readoutHtml(slabs) {
  return slabs.map(([name, um]) =>
    `<span><b>${name}</b> ${Number.isFinite(um) ? `${um.toFixed(0)} µm` : "n/a"}</span>`
  ).join("");
}

export function legendHtml(surfaces) {
  const present = new Set(surfaces);
  const seen = new Set();
  const bits = [];
  for (const [key, label, color] of SURFACE_STYLE) {
    if (!present.has(key) || seen.has(label)) continue;
    seen.add(label);
    bits.push(`<span class="swatch"><i style="background:${color}"></i>${label}</span>`);
  }
  return bits.join("");
}

function lineSpan(lines, height) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of Object.values(lines)) {
    if (!row) continue;
    for (const y of row) {
      if (!Number.isFinite(y)) continue;
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
  }
  if (!Number.isFinite(lo)) return [0, height];
  const pad = Math.max(16, (hi - lo) * 0.28);
  return [Math.max(0, lo - pad), Math.min(height, hi + pad)];
}

/** Draw one B-scan framed on the retina, with layer lines in image pixels. */
export function paintBscan(canvas, bitmap, lines, meta, ascan) {
  const boxW = Math.max(canvas.clientWidth, 1);
  const boxH = Math.max(canvas.clientHeight, 1);
  const [y0, y1] = lineSpan(lines, meta.height);
  const srcH = Math.max(y1 - y0, 1);
  let drawW = boxW;
  let drawH = drawW * (srcH / meta.width);
  if (drawH > boxH) {
    drawH = boxH;
    drawW = drawH * (meta.width / srcH);
  }
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(boxW * dpr);
  canvas.height = Math.round(boxH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, boxW, boxH);
  const ox = (boxW - drawW) / 2;
  const oy = (boxH - drawH) / 2;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, y0, meta.width, srcH, ox, oy, drawW, drawH);
  const sx = drawW / meta.width;
  const sy = drawH / srcH;
  ctx.lineWidth = 1.4;
  ctx.lineJoin = "round";
  for (const [key, , color] of SURFACE_STYLE) {
    const row = lines[key];
    if (!row) continue;
    ctx.beginPath();
    ctx.strokeStyle = color;
    let drawing = false;
    for (let x = 0; x < row.length; x++) {
      const y = row[x];
      if (!Number.isFinite(y)) {
        drawing = false;
        continue;
      }
      const px = ox + (x + 0.5) * sx;
      const py = oy + (y - y0 + 0.5) * sy;
      if (!drawing) {
        ctx.moveTo(px, py);
        drawing = true;
      } else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  if (Number.isFinite(ascan)) {
    const px = ox + (ascan + 0.5) * sx;
    ctx.strokeStyle = "rgba(255, 244, 194, 0.95)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(px, oy);
    ctx.lineTo(px, oy + drawH);
    ctx.stroke();
  }
  return { ox, oy, drawW, drawH, sx, width: meta.width };
}
