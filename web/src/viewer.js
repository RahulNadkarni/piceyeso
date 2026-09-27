import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { colorize, legendGradient, sampleCmap } from "./colormap.js";
import {
  assignSubfield, layerField, resolveStack, samplePolar, smoothLayerField,
  SUBFIELDS, SUBFIELD_LABELS, totalValues,
} from "./etdrs.js";

const LAYER_CMAPS = ["viridis", "plasma", "inferno", "magma", "turbo", "viridis"];

function finiteRange(obj) {
  const xs = Object.values(obj).filter((v) => Number.isFinite(v));
  if (!xs.length) return [0, 1];
  return [Math.min(...xs), Math.max(...xs)];
}

export class Viewer {
  constructor(canvas3d, canvas2d, cbar) {
    this.canvas3d = canvas3d;
    this.canvas2d = canvas2d;
    this.cbar = cbar;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8a8a8a);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 80);
    this.camera.position.set(0.4, -6.8, 4.2);
    this.renderer = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.controls = new OrbitControls(this.camera, canvas3d);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(2.5, -4, 6);
    this.scene.add(key);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.loader = new GLTFLoader();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.selected = -1;
    this.onSelect = null;
    this._opts = null;
    this._baseColors = null;
    this._pickMesh = null;
    this._drag = null;
    this._framed = false;
    this.onPick = null;
    this._scanGroup = new THREE.Group();
    this.scene.add(this._scanGroup);
    this.resize();
    addEventListener("resize", () => this.resize());
    canvas3d.addEventListener("pointerdown", (e) => { this._drag = { x: e.clientX, y: e.clientY }; });
    canvas3d.addEventListener("pointerup", (e) => this._on3dClick(e));
    canvas2d.addEventListener("click", (e) => this._on2dClick(e));
    const tick = () => { this.controls.update(); this.renderer.render(this.scene, this.camera); requestAnimationFrame(tick); };
    tick();
  }

  select(index) {
    this.selected = this.selected === index ? -1 : index;
    this._applyHighlight();
    this.onSelect?.(this.selected);
  }

  resize() {
    const w = this.canvas3d.parentElement.clientWidth;
    const h = this.canvas3d.parentElement.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
    this.canvas2d.width = w;
    this.canvas2d.height = h;
  }

  clear() {
    while (this.group.children.length) {
      const o = this.group.children[0];
      o.geometry?.dispose();
      o.material?.dispose();
      this.group.remove(o);
    }
  }

  async loadEye(basePath, info, fields, table, baseCap) {
    this._framed = false;
    this.state = { basePath, info, fields, table, baseCap, meshes: {} };
    const names = ["retinal_cap", "retinal_surface",
      ...info.layers.filter((n) => n !== "total").map((n) => `layer_${n.replace("/", "_")}`)];
    await Promise.all(names.map(async (name) => {
      const url = `${basePath}/${name}.glb`;
      try {
        const gltf = await this.loader.loadAsync(url);
        const mesh = gltf.scene.children.find((c) => c.isMesh) || gltf.scene.children[0].children[0];
        this.state.meshes[name] = mesh;
      } catch { /* optional layer */ }
    }));
  }

  setCsvEye(baseCap, table, info) {
    this._framed = false;
    this.state = { basePath: null, info, fields: null, table, baseCap, meshes: {} };
  }

  valuesFor(layer) {
    const t = this.state.table;
    if (layer === "total") return totalValues(t);
    return SUBFIELDS.map((s) => t[layer][s]);
  }

  vertexValues(layer, laterality) {
    const { fields, meshes } = this.state;
    const mesh = meshes.retinal_surface || meshes.retinal_cap;
    if (fields && mesh) {
      const idx = fields.layers.indexOf(layer);
      if (idx >= 0) {
        const pos = mesh.geometry.attributes.position;
        const out = new Float32Array(pos.count);
        for (let i = 0; i < pos.count; i++) {
          out[i] = samplePolar(fields.polar[idx], fields.rho_mm, fields.theta,
            pos.getX(i), pos.getY(i));
        }
        return out;
      }
    }
    const pos = (this.state.baseCap && this.state.baseCap.positions) || [];
    if (!pos.length) return new Float32Array();
    return smoothLayerField(pos, this.state.table, layer, laterality);
  }

  drawColorbar(vmin, vmax, cmap, label) {
    this.cbar.innerHTML = `
      <img alt="" src="${legendGradient(cmap)}" />
      <div class="cbar-scale"><span>${vmax.toFixed(0)}</span><span>${label}</span><span>${vmin.toFixed(0)}</span></div>`;
  }

  show3d({ layer, cmap, vmin, vmax, laterality, zScale }) {
    this.canvas3d.hidden = false;
    this.canvas2d.hidden = true;
    this.clear();
    this._opts = { layer, cmap, vmin, vmax, laterality, zScale, view: "3d" };
    const src = this.state.meshes.retinal_surface;
    const mesh = (src && this.state.fields)
      ? this._colouredMesh(src.geometry.clone(), layer, cmap, vmin, vmax, laterality)
      : this._csvSurface(layer, cmap, vmin, vmax, laterality, zScale);
    this._pickMesh = mesh;
    this.group.add(mesh);
    this.group.add(etdrsGrid(mesh.geometry));
    this._frameOnce(mesh);
    this._applyHighlight();
    this.drawColorbar(vmin, vmax, cmap, `${layer} µm`);
  }

  showLayered({ opacity, laterality, zScale }) {
    this.canvas3d.hidden = false;
    this.canvas2d.hidden = true;
    this.clear();
    if (!this.state.fields && this.state.baseCap) {
      this._csvStack(opacity, laterality, zScale);
      return;
    }
    const layers = this.state.info.layers.filter((n) => n !== "total");
    layers.forEach((name, i) => {
      const cmap = LAYER_CMAPS[i % LAYER_CMAPS.length];
      const mesh = this.state.meshes[`layer_${name.replace("/", "_")}`];
      if (mesh && this.state.fields) {
        const geo = mesh.geometry.clone();
        const table = this.state.table[name];
        const [lo, hi] = finiteRange(table);
        geo.setAttribute("color", new THREE.BufferAttribute(
          colorize(this.vertexValues(name, laterality), lo, hi, cmap), 3));
        const mat = litMaterial();
        mat.transparent = true;
        mat.opacity = opacity;
        mat.depthWrite = false;
        const sheet = new THREE.Mesh(geo, mat);
        this.group.add(sheet);
        if (i === 0) this._pickMesh = sheet;
      }
    });
    this.cbar.innerHTML = layers.map((n, i) =>
      `<div class="mini"><img src="${legendGradient(LAYER_CMAPS[i % LAYER_CMAPS.length])}" alt="" /><span>${n}</span></div>`
    ).join("");
    const top = this.group.children[this.group.children.length - 1];
    if (top) this._frameOnce(top);
  }

  _frameOnce(obj) {
    if (this._framed || !obj) return;
    this._framed = true;
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = 0.5 * Math.max(size.x, size.y, 0.4);
    const dist = radius / Math.tan((this.camera.fov * Math.PI) / 360) * 1.45;
    this.controls.target.copy(center);
    this.camera.position.set(center.x + dist * 0.06, center.y - dist * 0.82, center.z + dist * 0.5);
    this.camera.near = Math.max(dist / 80, 0.01);
    this.camera.far = dist * 30;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  clearScanMark() {
    while (this._scanGroup.children.length) {
      const o = this._scanGroup.children[0];
      o.geometry?.dispose();
      o.material?.dispose();
      this._scanGroup.remove(o);
    }
  }

  showScanMark({ x, y, x0, x1 }) {
    this.clearScanMark();
    const mesh = this._pickMesh;
    if (!mesh || this.canvas3d.hidden) return;
    const zAt = (px, py) => this._heightAt(mesh, px, py) + 0.03;
    const pts = [];
    const n = 56;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const px = x0 + (x1 - x0) * t;
      pts.push(px, y, zAt(px, y));
    }
    const line = new THREE.BufferGeometry();
    line.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this._scanGroup.add(new THREE.Line(line, new THREE.LineBasicMaterial({
      color: 0xfff4c2, transparent: true, opacity: 0.95,
    })));
    if (Number.isFinite(x)) {
      const sph = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0xfff4c2 }),
      );
      sph.position.set(x, y, zAt(x, y) + 0.02);
      this._scanGroup.add(sph);
    }
  }

  _heightAt(mesh, x, y) {
    const pos = mesh.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 5000));
    let best = 0, d2 = Infinity;
    for (let i = 0; i < pos.count; i += step) {
      const dx = pos.getX(i) - x, dy = pos.getY(i) - y;
      const d = dx * dx + dy * dy;
      if (d < d2) { d2 = d; best = pos.getZ(i); }
    }
    return best;
  }

  _colouredMesh(geo, layer, cmap, vmin, vmax, laterality) {
    const colors = colorize(this.vertexValues(layer, laterality), vmin, vmax, cmap);
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, litMaterial());
  }

  _subfieldsOn(geo, laterality) {
    const pos = geo.attributes.position;
    const out = new Int16Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      out[i] = assignSubfield(pos.getX(i), pos.getY(i), laterality);
    }
    return out;
  }

  _applyHighlight() {
    if (!this._pickMesh || !this._opts) return;
    const geo = this._pickMesh.geometry;
    const laterality = this._opts.laterality;
    const base = colorize(
      this.vertexValues(this._opts.layer, laterality),
      this._opts.vmin, this._opts.vmax, this._opts.cmap,
    );
    const sub = this._subfieldsOn(geo, laterality);
    if (this.selected >= 0) {
      for (let i = 0; i < sub.length; i++) {
        const k = i * 3;
        if (sub[i] === this.selected) {
          base[k] = Math.min(1, base[k] * 0.35 + 0.85);
          base[k + 1] = Math.min(1, base[k + 1] * 0.35 + 0.85);
          base[k + 2] = Math.min(1, base[k + 2] * 0.35 + 0.85);
        } else if (sub[i] >= 0) {
          base[k] *= 0.45; base[k + 1] *= 0.45; base[k + 2] *= 0.45;
        }
      }
    }
    geo.setAttribute("color", new THREE.BufferAttribute(base, 3));
  }

  _on3dClick(e) {
    if (this.canvas3d.hidden || !this._pickMesh || !this._drag) return;
    if (Math.hypot(e.clientX - this._drag.x, e.clientY - this._drag.y) > 6) return;
    const rect = this.canvas3d.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this._pickMesh, false)[0];
    if (!hit) { this.select(-1); return; }
    const laterality = this._opts.laterality;
    this.select(assignSubfield(hit.point.x, hit.point.y, laterality));
    this.onPick?.(hit.point.x, hit.point.y);
  }

  _on2dClick(e) {
    if (this.canvas2d.hidden || !this._opts || this._opts.view !== "bullseye") return;
    const rect = this.canvas2d.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const w = this.canvas2d.width, h = this.canvas2d.height;
    const cx = w * 0.48, cy = h * 0.5, R = Math.min(w, h) * 0.36;
    const dataX = (x - cx) / R * 3.0;
    const dataY = -(y - cy) / R * 3.0;
    this.select(assignSubfield(dataX, dataY, this._opts.laterality));
    this.onPick?.(dataX, dataY);
  }

  _csvSurface(layer, cmap, vmin, vmax, laterality, zScale) {
    const cap = this.state.baseCap;
    const pos = Float32Array.from(cap.positions);
    const um = smoothLayerField(pos, this.state.table, layer, laterality);
    for (let i = 0; i < um.length; i++) pos[i * 3 + 2] += (um[i] / 1000) * zScale;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(Array.from(cap.faces));
    geo.computeVertexNormals();
    const colors = colorize(um, vmin, vmax, cmap);
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return new THREE.Mesh(geo, litMaterial());
  }

  _csvStack(opacity, laterality, zScale) {
    const cap = this.state.baseCap;
    const stack = resolveStack(this.state.table);
    const layers = stack.layers;
    let cum = new Float32Array(cap.positions.length / 3);
    const topIndex = layers.length - 1;
    [...layers].reverse().forEach((layer, rev) => {
      const i = topIndex - rev;
      const um = layerField(cap.positions, layer, laterality);
      for (let k = 0; k < cum.length; k++) cum[k] += um[k];
      const pos = Float32Array.from(cap.positions);
      for (let k = 0; k < cum.length; k++) pos[k * 3 + 2] += (cum[k] / 1000) * zScale;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setIndex(Array.from(cap.faces));
      geo.computeVertexNormals();
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k < um.length; k++) {
        if (!Number.isFinite(um[k])) continue;
        lo = Math.min(lo, um[k]);
        hi = Math.max(hi, um[k]);
      }
      if (!(hi > lo)) { lo = 0; hi = 1; }
      geo.setAttribute("color", new THREE.BufferAttribute(
        colorize(um, lo, hi, LAYER_CMAPS[i % LAYER_CMAPS.length]), 3));
      const mat = litMaterial();
      mat.transparent = true;
      mat.opacity = opacity;
      mat.depthWrite = false;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = rev;
      this.group.add(mesh);
      if (i === 0) this._pickMesh = mesh;
    });
    this.cbar.innerHTML = layers.map((L, i) =>
      `<div class="mini"><img src="${legendGradient(LAYER_CMAPS[i % LAYER_CMAPS.length])}" alt="" /><span>${L.name}</span></div>`
    ).join("");
  }

  showBullseye({ layer, cmap, vmin, vmax, laterality }) {
    this.canvas3d.hidden = true;
    this.canvas2d.hidden = false;
    this._opts = { layer, cmap, vmin, vmax, laterality, view: "bullseye" };
    this._pickMesh = null;
    const ctx = this.canvas2d.getContext("2d");
    const w = this.canvas2d.width, h = this.canvas2d.height;
    ctx.fillStyle = "#f4f4f4";
    ctx.fillRect(0, 0, w, h);
    const vals = this.valuesFor(layer);
    const cx = w * 0.48, cy = h * 0.5, R = Math.min(w, h) * 0.36;
    const rings = [1 / 6, 0.5, 1];
    const quads = [
      { a0: 45, a1: 135, i: 1 }, { a0: -45, a1: 45, i: 2 },
      { a0: -135, a1: -45, i: 3 }, { a0: 135, a1: 225, i: 4 },
    ];
    const flip = laterality === "OS";
    const paint = (i, path) => {
      const t = (vals[i] - vmin) / Math.max(vmax - vmin, 1e-6);
      const [r, g, b] = Number.isFinite(vals[i]) ? sampleCmap(cmap, t) : [0.75, 0.75, 0.75];
      ctx.fillStyle = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
      path();
      ctx.fill();
      ctx.strokeStyle = this.selected === i ? "#fff" : "rgba(255,255,255,0.85)";
      ctx.lineWidth = this.selected === i ? 5 : 2;
      ctx.stroke();
    };
    paint(0, () => { ctx.beginPath(); ctx.arc(cx, cy, R * rings[0], 0, Math.PI * 2); });
    for (const ring of [0, 1]) {
      for (const q of quads) {
        const idx = (ring === 0 ? 1 : 5) + (flip && (q.i === 2 || q.i === 4) ? (q.i === 2 ? 3 : 1) : q.i - 1);
        // q.i 1=sup 2=nas 3=inf 4=tem; OS swaps nas/tem
        const nasTem = q.i === 2 || q.i === 4;
        const qi = nasTem && flip ? (q.i === 2 ? 4 : 2) : q.i;
        const ii = (ring === 0 ? 1 : 5) + (qi - 1);
        paint(ii, () => {
          const r0 = R * rings[ring], r1 = R * rings[ring + 1];
          const a0 = (q.a0 * Math.PI) / 180, a1 = (q.a1 * Math.PI) / 180;
          ctx.beginPath();
          ctx.arc(cx, cy, r1, a0, a1, false);
          ctx.arc(cx, cy, r0, a1, a0, true);
          ctx.closePath();
        });
      }
    }
    ctx.fillStyle = "#111";
    ctx.font = "14px ui-sans-serif, system-ui";
    ctx.textAlign = "center";
    const labelAt = (i, x, y) => {
      ctx.fillText(Number.isFinite(vals[i]) ? vals[i].toFixed(0) : "n/a", x, y);
    };
    labelAt(0, cx, cy + 5);
    const mid = [R * 0.33, R * 0.75];
    const dirs = [[0, -1, 1], [1, 0, 2], [0, 1, 3], [-1, 0, 4]];
    dirs.forEach(([dx, dy, q]) => {
      const nasTem = q === 2 || q === 4;
      const qi = nasTem && flip ? (q === 2 ? 4 : 2) : q;
      labelAt(qi, cx + dx * mid[0], cy + dy * mid[0] + 5);
      labelAt(4 + qi, cx + dx * mid[1], cy + dy * mid[1] + 5);
    });
    ctx.fillStyle = "#444";
    ctx.fillText("S", cx, cy - R - 12);
    ctx.fillText("I", cx, cy + R + 22);
    ctx.fillText(laterality === "OD" ? "N" : "T", cx + R + 18, cy + 5);
    ctx.fillText(laterality === "OD" ? "T" : "N", cx - R - 18, cy + 5);
    this.drawColorbar(vmin, vmax, cmap, `${layer} µm`);
  }

  showSection({ laterality }) {
    this.canvas3d.hidden = true;
    this.canvas2d.hidden = false;
    const ctx = this.canvas2d.getContext("2d");
    const w = this.canvas2d.width, h = this.canvas2d.height;
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, w, h);
    const csvStack = this.state.fields ? null : resolveStack(this.state.table);
    const layers = csvStack
      ? csvStack.layers.map((L) => L.name)
      : this.state.info.layers.filter((n) => n !== "total");
    const xs = [];
    for (let x = -3; x <= 3.0001; x += 0.02) xs.push(x);
    const bands = layers.map((name, li) => xs.map((x) => {
      if (this.state.fields) {
        const idx = this.state.fields.layers.indexOf(name);
        return samplePolar(this.state.fields.polar[idx], this.state.fields.rho_mm,
          this.state.fields.theta, x, 0) || 0;
      }
      const layer = csvStack.layers[li];
      const um = layerField([x, 0, 0], layer, laterality);
      return um[0];
    }));
    const totals = xs.map((_, i) => bands.reduce((a, b) => a + b[i], 0));
    const maxH = Math.max(...totals, 1);
    const pad = 60;
    const xMap = (x) => pad + ((x + 3) / 6) * (w - pad * 2);
    const yMap = (um) => h - pad - (um / (maxH * 1.1)) * (h - pad * 2);
    const colors = ["#3b82f6", "#38bdf8", "#22c55e", "#84cc16", "#f97316", "#ef4444", "#a855f7", "#ca8a04"];
    let acc = xs.map(() => 0);
    [...bands].reverse().forEach((band, rev) => {
      const i = layers.length - 1 - rev;
      ctx.beginPath();
      xs.forEach((x, k) => ctx.lineTo(xMap(x), yMap(acc[k] + band[k])));
      for (let k = xs.length - 1; k >= 0; k--) ctx.lineTo(xMap(xs[k]), yMap(acc[k]));
      ctx.closePath();
      ctx.fillStyle = colors[i % colors.length];
      ctx.globalAlpha = 0.9;
      ctx.fill();
      acc = acc.map((v, k) => v + band[k]);
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff";
    ctx.font = "13px ui-sans-serif, system-ui";
    ctx.fillText(laterality === "OD" ? "temporal  ←  fovea  →  nasal" : "nasal  ←  fovea  →  temporal", w / 2 - 90, h - 18);
    layers.forEach((n, i) => {
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillText(n, w - 90, 28 + i * 18);
    });
    this.cbar.innerHTML = "";
  }

  async exportPng() {
    const src = this.canvas3d.hidden ? this.canvas2d : this.canvas3d;
    const data = src.toDataURL("image/png");
    const api = window.pywebview && window.pywebview.api;
    if (api && api.save_png) return api.save_png(data);
    const a = document.createElement("a");
    a.href = data;
    a.download = "retinapainter.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return "";
  }
}

function etdrsGrid(geo) {
  const pos = geo.attributes.position;
  const step = Math.max(1, Math.floor(pos.count / 4000));
  const nearestZ = (x, y) => {
    let best = 0, d2 = Infinity;
    for (let i = 0; i < pos.count; i += step) {
      const dx = pos.getX(i) - x, dy = pos.getY(i) - y;
      const d = dx * dx + dy * dy;
      if (d < d2) { d2 = d; best = pos.getZ(i); }
    }
    return best + 0.02;
  };
  let limit = 0;
  const stride = Math.max(1, Math.floor(pos.count / 8000));
  for (let i = 0; i < pos.count; i += stride) {
    limit = Math.max(limit, Math.hypot(pos.getX(i), pos.getY(i)));
  }
  const pts = [];
  const push = (x, y) => pts.push(x, y, nearestZ(x, y));
  for (const r of [0.5, 1.5, 3.0]) {
    if (r > limit + 0.08) continue;
    for (let k = 0; k < 96; k++) {
      const a0 = (k / 96) * Math.PI * 2, a1 = ((k + 1) / 96) * Math.PI * 2;
      push(r * Math.cos(a0), r * Math.sin(a0));
      push(r * Math.cos(a1), r * Math.sin(a1));
    }
  }
  const rim = Math.min(3, limit);
  if (rim > 0.5) {
    for (const deg of [45, 135, 225, 315]) {
      const a = (deg * Math.PI) / 180;
      push(0.5 * Math.cos(a), 0.5 * Math.sin(a));
      push(rim * Math.cos(a), rim * Math.sin(a));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }));
}

function litMaterial() {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.65,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
}
