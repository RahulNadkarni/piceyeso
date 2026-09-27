const STOPS = {
  viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  plasma: [[13, 8, 135], [126, 3, 168], [204, 71, 120], [248, 149, 64], [240, 249, 33]],
  inferno: [[0, 0, 4], [87, 16, 110], [188, 55, 84], [249, 142, 9], [252, 255, 164]],
  magma: [[0, 0, 4], [81, 18, 124], [183, 55, 121], [252, 137, 97], [252, 253, 191]],
  turbo: [[48, 18, 59], [70, 117, 238], [35, 213, 175], [205, 223, 41], [239, 85, 17]],
};

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function sampleCmap(name, t) {
  const stops = STOPS[name] || STOPS.viridis;
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  return [
    lerp(stops[i][0], stops[i + 1][0], f) / 255,
    lerp(stops[i][1], stops[i + 1][1], f) / 255,
    lerp(stops[i][2], stops[i + 1][2], f) / 255,
  ];
}

export function colorize(values, vmin, vmax, name) {
  const colors = new Float32Array(values.length * 3);
  const span = Math.max(vmax - vmin, 1e-6);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const [r, g, b] = Number.isFinite(v) ? sampleCmap(name, (v - vmin) / span) : [0.5, 0.5, 0.5];
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
  }
  return colors;
}

export function legendGradient(name) {
  const c = document.createElement("canvas");
  c.width = 8; c.height = 256;
  const ctx = c.getContext("2d");
  fillBar(ctx, 0, 0, 8, 256, name);
  return c.toDataURL();
}

function fillBar(ctx, x, y, w, h, cmap) {
  const n = Math.max(1, Math.round(h));
  for (let i = 0; i < n; i++) {
    const [r, g, b] = sampleCmap(cmap, 1 - i / Math.max(n - 1, 1));
    ctx.fillStyle = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
    ctx.fillRect(x, y + i, w, 2);
  }
}

/** Draw the on-screen colorbar onto an export canvas. `px` is CSS-pixel scale. */
export function paintLegend(ctx, width, height, legend, px = 1) {
  if (!legend || !ctx) return;
  ctx.save();
  ctx.shadowColor = "#000";
  ctx.shadowBlur = 4 * px;
  ctx.fillStyle = "#fff";
  if (legend.kind === "layers") {
    const items = legend.items || [];
    const barW = 10 * px;
    const barH = 48 * px;
    const top = 24 * px;
    ctx.font = `${Math.max(10, 11 * px)}px ui-sans-serif, system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const col = Math.max(28 * px, ...items.map((it) => ctx.measureText(it.name).width + 8 * px));
    let x = width - 16 * px - col * items.length;
    items.forEach((it, i) => {
      const bx = x + i * col + (col - barW) / 2;
      fillBar(ctx, bx, top, barW, barH, it.cmap);
      ctx.fillText(it.name, x + i * col + col / 2, top + barH + 6 * px);
    });
  } else {
    const vmin = Number(legend.vmin);
    const vmax = Number(legend.vmax);
    const label = String(legend.label || "");
    const barW = 12 * px;
    const barH = 180 * px;
    const top = 24 * px;
    const gap = 8 * px;
    ctx.font = `${Math.max(10, 11 * px)}px ui-sans-serif, system-ui`;
    const hi = Number.isFinite(vmax) ? vmax.toFixed(0) : "";
    const lo = Number.isFinite(vmin) ? vmin.toFixed(0) : "";
    const tw = Math.max(ctx.measureText(hi).width, ctx.measureText(lo).width, ctx.measureText(label).width);
    const x = width - 16 * px - tw - gap - barW;
    fillBar(ctx, x, top, barW, barH, legend.cmap || "viridis");
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(hi, x + barW + gap, top);
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + barW + gap, top + barH / 2);
    ctx.textBaseline = "bottom";
    ctx.fillText(lo, x + barW + gap, top + barH);
  }
  ctx.restore();
}
