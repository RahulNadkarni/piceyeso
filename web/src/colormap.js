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
  for (let y = 0; y < 256; y++) {
    const [r, g, b] = sampleCmap(name, 1 - y / 255);
    ctx.fillStyle = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
    ctx.fillRect(0, y, 8, 1);
  }
  return c.toDataURL();
}
