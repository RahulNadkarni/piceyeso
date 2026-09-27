import { Viewer } from "./viewer.js";
import { parseEtdrsCsv, parseTimeSeriesCsv, lerpSeries, tableFromFrame } from "./csv.js";
import { resolveStack, sectorCenter, SUBFIELDS, SUBFIELD_LABELS, totalValues } from "./etdrs.js";
import {
  ascanSlabs, clickToAscan, enfaceToScan, legendHtml, paintBscan, readoutHtml,
  scanExtentX, scanToEnface,
} from "./bscan.js";
const $ = (id) => document.getElementById(id);
const viewer = new Viewer($("view3d"), $("view2d"), $("cbar"));
viewer.onSelect = (i) => { paintSubfields(i); paintHud(i); if ($("view").value === "bullseye") render(); };
viewer.onPick = (x, y) => pickEnface(x, y);

let manifest = null;
const opened = new Map();
let current = { table: null, info: null, fields: null, baseCap: null, series: null };
let playing = false;

function status(msg, opts = {}) {
  const wrap = $("topStatus");
  const fill = $("topBar");
  $("status").textContent = msg || "";
  if (!msg) {
    wrap.hidden = true;
    wrap.classList.remove("busy", "metered");
    fill.style.width = "";
    return;
  }
  wrap.hidden = false;
  const frac = opts.fraction;
  const known = Number.isFinite(frac);
  wrap.classList.toggle("busy", Boolean(opts.busy) && !known);
  wrap.classList.toggle("metered", known);
  if (known) fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  else if (opts.busy) fill.style.width = "";
  else fill.style.width = "100%";
}

function jobId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function pollJob(id, stop) {
  while (!stop.done) {
    try {
      const res = await fetch(`./api/job/${id}`);
      if (res.ok) {
        const job = await res.json();
        if (job.message) status(job.message, { busy: !job.done, fraction: job.fraction });
      }
    } catch (e) { /* still opening */ }
    if (stop.done) break;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
}

async function openWithProgress(startMsg, send) {
  const id = jobId();
  const stop = { done: false };
  status(startMsg, { busy: true, fraction: 0 });
  const polling = pollJob(id, stop);
  try {
    const res = await send(id);
    return { res, jobId: id };
  } finally {
    stop.done = true;
    await polling;
  }
}

async function waitForJob(id) {
  for (;;) {
    try {
      const res = await fetch(`./api/job/${id}`);
      if (res.ok) {
        const job = await res.json();
        if (job.message) status(job.message, { busy: !job.done, fraction: job.fraction });
        if (job.error) throw new Error(job.message || "Could not read that scan.");
        if (job.done) return job;
      }
    } catch (e) {
      if (e && e.message && !String(e.message).includes("fetch")) throw e;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
}

function rangesFor(layer) {
  const r = (manifest && manifest.ranges_um && manifest.ranges_um[layer]) || null;
  return r || [200, 500];
}

function fillLayers(table) {
  const sel = $("layer");
  const keep = sel.value;
  sel.innerHTML = "";
  const stack = resolveStack(table);
  const names = stack.singleSlab
    ? ["total"]
    : [...new Set([...stack.layers.map((L) => L.name), ...Object.keys(table).filter((k) => k !== "choroid"), "total"])];
  for (const n of names) {
    const o = document.createElement("option");
    o.value = n; o.textContent = n;
    sel.appendChild(o);
  }
  sel.value = names.includes(keep) ? keep : (names.includes("total") ? "total" : names[0]);
}

function applyRangeDefaults() {
  const [lo, hi] = rangesFor($("layer").value);
  $("vmin").value = lo;
  $("vmax").value = hi;
}

function opts() {
  return {
    layer: $("layer").value,
    cmap: $("cmap").value,
    vmin: Number($("vmin").value),
    vmax: Number($("vmax").value),
    laterality: $("laterality").value,
    opacity: Number($("opacity").value),
    zScale: Number($("zscale").value),
  };
}

function layerValues() {
  const layer = $("layer").value;
  return layer === "total" ? totalValues(current.table) : SUBFIELDS.map((s) => current.table[layer][s]);
}

function paintSubfields(selected) {
  const box = $("subfields");
  const vals = current.table ? layerValues() : [];
  box.innerHTML = SUBFIELD_LABELS.map((label, i) => {
    const um = Number.isFinite(vals[i]) ? `${vals[i].toFixed(0)} µm` : "n/a";
    const on = selected === i ? "true" : "false";
    return `<button type="button" role="option" data-i="${i}" aria-selected="${on}"><span>${label}</span><span class="um">${um}</span></button>`;
  }).join("");
  box.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      const i = Number(b.dataset.i);
      viewer.select(i);
      if (bscanMeta && i >= 0) {
        const [x, y] = sectorCenter(i, $("laterality").value);
        pickEnface(x, y);
      }
    });
  });
}

function paintHud(i) {
  const hud = $("hud");
  if (i < 0 || !current.table) { hud.hidden = true; return; }
  const v = layerValues()[i];
  hud.hidden = false;
  hud.innerHTML = `<strong>${SUBFIELD_LABELS[i]}</strong><span>${$("layer").value} · ${Number.isFinite(v) ? v.toFixed(1) + " µm" : "not scanned"}</span>`;
}

function render() {
  if (!current.table) return;
  const o = opts();
  $("zscaleVal").textContent = `${o.zScale}×`;
  const view = $("view").value;
  if (view === "3d") viewer.show3d(o);
  else if (view === "layered") viewer.showLayered(o);
  else if (view === "section") viewer.showSection(o);
  else viewer.showBullseye(o);
  paintSubfields(viewer.selected);
  paintHud(viewer.selected);
  applyScanMark();
}

async function loadFromBase(base) {
  status("Loading…", { busy: true });
  const [info, fields, tableText, baseCap] = await Promise.all([
    fetch(`${base}/info.json`).then((r) => r.json()),
    fetch(`${base}/fields.json`).then((r) => r.json()),
    fetch(`${base}/etdrs.csv`).then((r) => r.text()),
    fetch(`${base}/base_cap.json`).then((r) => r.json()),
  ]);
  const table = parseEtdrsCsv(tableText);
  current = { table, info, fields, baseCap, series: null };
  fillLayers(table);
  applyRangeDefaults();
  $("laterality").value = info.laterality || "OD";
  $("zscale").value = info.z_scale || 4;
  await viewer.loadEye(base, info, fields, table, baseCap);
  $("play").hidden = true;
  const lead = info.synthetic
    ? "CSV-built mesh: the 9 numbers are heights, not just colours."
    : "Reconstructed from OCT";
  status(info.note ? `${lead} ${info.note}` : lead);
  revealScan();
  await loadBscan(base);
  viewer.resize();
  render();
}

function revealScan() {
  $("empty").hidden = true;
  $("tools").hidden = false;
  $("eyeWrap").hidden = false;
}

let bscanMeta = null;
let bscanBase = null;
let bscanToken = 0;
let scanCursor = null;
let bscanLayout = null;

function hideBscan() {
  bscanMeta = null;
  bscanBase = null;
  bscanToken += 1;
  scanCursor = null;
  bscanLayout = null;
  $("bscanPane").hidden = true;
  $("bscanReadout").hidden = true;
  $("bscanReadout").innerHTML = "";
  viewer.clearScanMark();
}

function pickEnface(x, y) {
  if (!bscanMeta) return;
  scanCursor = enfaceToScan(x, y, bscanMeta);
  $("bscanSlider").value = String(scanCursor.bscan);
  showBscan(scanCursor.bscan);
}

function applyScanMark() {
  if (!bscanMeta || !scanCursor) {
    viewer.clearScanMark();
    return;
  }
  const ascan = Number.isFinite(scanCursor.ascan) ? scanCursor.ascan : (bscanMeta.fovea_ascan ?? 0);
  const { x, y } = scanToEnface(scanCursor.bscan, ascan, bscanMeta);
  const { x0, x1 } = scanExtentX(bscanMeta);
  viewer.showScanMark({ x, y, x0, x1 });
}

async function loadBscan(base) {
  hideBscan();
  let meta = null;
  try {
    const res = await fetch(`${base}/bscan_meta.json`);
    if (res.ok) meta = await res.json();
  } catch (e) {
    meta = null;
  }
  if (!meta) {
    viewer.resize();
    return;
  }
  bscanMeta = meta;
  bscanBase = base;
  const pane = $("bscanPane");
  pane.hidden = false;
  $("bscanLegend").innerHTML = legendHtml(meta.surfaces);
  const slider = $("bscanSlider");
  slider.max = String(Math.max(meta.n_bscans - 1, 0));
  slider.value = String(meta.fovea_bscan || 0);
  slider.hidden = Boolean(meta.preview_only) || meta.n_bscans <= 1;
  scanCursor = { bscan: Number(slider.value), ascan: meta.fovea_ascan ?? Math.floor(meta.width / 2) };
  await showBscan(scanCursor.bscan);
  viewer.resize();
}

async function showBscan(index) {
  if (!bscanMeta || !bscanBase) return;
  const mine = ++bscanToken;
  const meta = bscanMeta;
  $("bscanWhere").textContent = index === meta.fovea_bscan
    ? `${index + 1} / ${meta.n_bscans} · fovea`
    : `${index + 1} / ${meta.n_bscans}`;
  try {
    const [blob, lines] = await Promise.all([
      fetch(`${bscanBase}/bscan/${index}.png`).then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      }),
      fetch(`${bscanBase}/bscan/${index}.json`).then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      }),
    ]);
    if (mine !== bscanToken) return;
    const bitmap = await createImageBitmap(blob);
    if (mine !== bscanToken) return;
    if (scanCursor) scanCursor.bscan = index;
    const ascan = Number.isFinite(scanCursor?.ascan) ? scanCursor.ascan : (meta.fovea_ascan ?? 0);
    bscanLayout = paintBscan($("bscan"), bitmap, lines, meta, ascan);
    const slabs = ascanSlabs(lines, ascan, Number(meta.axial_um_per_px) || 3.87);
    const box = $("bscanReadout");
    box.innerHTML = readoutHtml(slabs);
    box.hidden = slabs.length === 0;
    $("bscanWhere").textContent = [
      index === meta.fovea_bscan ? `${index + 1} / ${meta.n_bscans} · fovea` : `${index + 1} / ${meta.n_bscans}`,
      `A-scan ${ascan + 1}`,
    ].join(" · ");
    applyScanMark();
  } catch (e) {
    if (mine === bscanToken) $("bscanWhere").textContent = "Could not read this B-scan.";
  }
}

async function loadDemo(id) {
  const entry = manifest.eyes.find((e) => e.id === id);
  await loadFromBase(`./demo/${entry.path}`);
}

function rememberOpened(id, label) {
  opened.set(id, `./session/${id}`);
  const sel = $("eye");
  let option = [...sel.options].find((o) => o.value === id);
  if (!option) {
    option = document.createElement("option");
    option.value = id;
    sel.appendChild(option);
  }
  option.textContent = label;
  sel.value = id;
}

async function openResponse(res, label, job) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    status(body.error || "Could not read that scan.");
    return;
  }
  rememberOpened(body.id, body.label || label);
  const base = `./session/${body.id}`;
  if (body.partial) {
    $("empty").hidden = true;
    $("tools").hidden = true;
    $("eyeWrap").hidden = false;
    status("Showing B-scans. Segmenting layers…", { busy: true, fraction: 0.14 });
    await loadBscan(base);
    viewer.resize();
    try {
      await waitForJob(job);
    } catch (e) {
      status(e.message || "Could not finish that scan.");
      return;
    }
    $("tools").hidden = false;
  }
  await loadFromBase(base);
}

function filePath(file) {
  const raw = typeof file.path === "string" ? file.path : "";
  if (raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw)) return raw;
  return "";
}

function desktopApi() {
  return (window.pywebview && window.pywebview.api) ? window.pywebview.api : null;
}

async function waitForDesktopApi(ms = 4000) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    const api = desktopApi();
    if (api) return api;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return desktopApi();
}

async function pickNative(kind) {
  const api = desktopApi() || await waitForDesktopApi();
  if (!api) return false;
  const path = kind === "folder" ? await api.open_folder() : await api.open_scan();
  if (path) await openPath(path);
  return true;
}

function hijackOpen(id, kind) {
  $(id).addEventListener("click", (ev) => {
    if (!window.pywebview) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    pickNative(kind);
  }, true);
}

function isCsvName(name) {
  return /\.csv$/i.test(String(name || ""));
}

async function openVolume(file) {
  if (isCsvName(file.name)) {
    loadCsvText(await file.text(), file.name);
    $("volume").value = "";
    return;
  }
  const input = $("volume");
  input.disabled = true;
  try {
    const local = filePath(file);
    const headers = { "X-Filename": file.name };
    if (local) headers["X-Local-Path"] = local;
    const { res, jobId } = await openWithProgress(
      `Reading ${file.name} on this computer. It is not uploaded.`,
      (id) => fetch("./api/open", {
        method: "POST",
        headers: { ...headers, "X-Job-Id": id },
        body: local ? "" : file,
      }),
    );
    await openResponse(res, file.name, jobId);
  } catch (e) {
    status("Could not reach the local viewer.");
  } finally {
    input.disabled = false;
    input.value = "";
  }
}

async function openFolder(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  $("folder").disabled = true;
  try {
    const local = filePath(files[0]);
    const folder = local ? local.replace(/[/\\][^/\\]+$/, "") : "";
    if (folder) {
      const { res, jobId } = await openWithProgress(
        `Reading ${files.length} files from that folder. They stay on this computer.`,
        (id) => fetch("./api/open", {
          method: "POST",
          headers: { "X-Local-Path": folder, "X-Job-Id": id },
          body: "",
        }),
      );
      await openResponse(res, folder.split(/[/\\]/).pop() || "folder", jobId);
      return;
    }
    const fd = new FormData();
    for (const f of files) fd.append("file", f, f.webkitRelativePath || f.name);
    const { res, jobId } = await openWithProgress(
      `Reading ${files.length} files from that folder. They stay on this computer.`,
      (id) => fetch("./api/open", { method: "POST", headers: { "X-Job-Id": id }, body: fd }),
    );
    await openResponse(res, (files[0].webkitRelativePath || files[0].name).split("/")[0] || "folder", jobId);
  } catch (e) {
    status("Could not reach the local viewer.");
  } finally {
    $("folder").disabled = false;
    $("folder").value = "";
  }
}

async function openPath(raw) {
  const path = (raw || "").trim();
  if (!path) return;
  if (isCsvName(path)) {
    const api = desktopApi();
    if (api && api.read_text) {
      const text = await api.read_text(path);
      if (text) loadCsvText(text, path.split(/[/\\]/).pop() || path);
      else status("Could not read that CSV.");
      return;
    }
  }
  $("pathOpen").disabled = true;
  try {
    const { res, jobId } = await openWithProgress(
      `Reading ${path} on this computer. It is not uploaded.`,
      (id) => fetch("./api/open", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Job-Id": id },
        body: JSON.stringify({ path }),
      }),
    );
    await openResponse(res, path.split(/[/\\]/).pop() || path, jobId);
  } catch (e) {
    status("Could not reach the local viewer.");
  } finally {
    $("pathOpen").disabled = false;
  }
}

function loadCsvText(text, name) {
  const series = parseTimeSeriesCsv(text);
  if (series) {
    current.series = series;
    current.table = tableFromFrame(series.values[0]);
    current.info = {
      layers: series.layers.includes("total") ? series.layers : [...series.layers, "total"],
      laterality: $("laterality").value, z_scale: Number($("zscale").value), id: name,
    };
    current.fields = null;
    hideBscan();
    $("play").hidden = false;
    status(`Time series: ${series.timepoints.length} visits. Play interpolates the surface.`);
  } else {
    current.series = null;
    current.table = parseEtdrsCsv(text);
    current.info = {
      layers: Object.keys(current.table).filter((n) => n !== "choroid").concat(["total"]),
      laterality: $("laterality").value, z_scale: Number($("zscale").value), id: name,
    };
    current.fields = null;
    hideBscan();
    $("play").hidden = true;
    const stack = resolveStack(current.table);
    status(stack.singleSlab
      ? "One ILM–RPE row. The cap is that total thickness; it is not split into layers."
      : stack.splitInner
        ? "NFL, GCL, and IPL are split from the combined inner slab along a foveal profile."
        : "Uploaded CSV. Thickness follows a foveal profile, not flat ETDRS blocks.");
  }
  if (!current.baseCap) {
    status("The thickness surface is not available yet.");
    return;
  }
  revealScan();
  viewer.setCsvEye(current.baseCap, current.table, current.info);
  fillLayers(current.table);
  applyRangeDefaults();
  render();
}

function playSeries() {
  if (!current.series || playing) return;
  playing = true;
  $("play").textContent = "Playing…";
  const t0 = performance.now();
  const dur = 4000;
  const step = (now) => {
    const t = ((now - t0) % dur) / dur;
    const frame = lerpSeries(current.series, t);
    current.table = tableFromFrame(frame);
    viewer.state.table = current.table;
    render();
    if (playing) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  setTimeout(() => { playing = false; $("play").textContent = "Play time series"; }, dur);
}

async function boot() {
  let local = false;
  try {
    const health = await fetch("./api/health");
    local = health.ok;
  } catch (e) {
    local = false;
  }
  $("openWrap").hidden = !local;
  $("localHint").hidden = local;
  $("eye").addEventListener("change", () => {
    const id = $("eye").value;
    if (!id) return;
    if (opened.has(id)) loadFromBase(opened.get(id));
    else loadDemo(id);
  });
  $("layer").addEventListener("change", () => { applyRangeDefaults(); render(); });
  ["view", "cmap", "laterality", "vmin", "vmax", "opacity", "zscale"].forEach((id) => {
    $(id).addEventListener("input", render);
  });
  $("png").addEventListener("click", async () => {
    try {
      const dest = await viewer.exportPng();
      if (dest) status(`Saved ${String(dest).split(/[/\\]/).pop()}.`);
    } catch (e) {
      status("Could not export a PNG.");
    }
  });
  $("play").addEventListener("click", playSeries);
  $("csv").addEventListener("change", async (ev) => {
    const f = ev.target.files[0];
    if (f) loadCsvText(await f.text(), f.name);
  });
  $("volume").addEventListener("change", (ev) => {
    const f = ev.target.files[0];
    if (f) openVolume(f);
  });
  $("folder").addEventListener("change", (ev) => openFolder(ev.target.files));
  $("pathForm").addEventListener("submit", (ev) => {
    ev.preventDefault();
    openPath($("localPath").value);
  });
  hijackOpen("volume", "scan");
  hijackOpen("folder", "folder");
  hijackOpen("emptyOpen", "scan");
  hijackOpen("emptyFolder", "folder");
  $("emptyOpen").addEventListener("click", () => $("volume").click());
  $("emptyFolder").addEventListener("click", () => $("folder").click());
  $("bscanSlider").addEventListener("input", () => showBscan(Number($("bscanSlider").value)));
  $("bscan").addEventListener("click", (ev) => {
    if (!bscanMeta) return;
    const ascan = clickToAscan(bscanLayout, ev.clientX, ev.clientY, $("bscan"));
    if (ascan == null) return;
    if (!scanCursor) scanCursor = { bscan: Number($("bscanSlider").value), ascan };
    else scanCursor.ascan = ascan;
    showBscan(scanCursor.bscan);
  });
  $("bscan").addEventListener("wheel", (ev) => {
    if ($("bscanPane").hidden || !bscanMeta) return;
    ev.preventDefault();
    const slider = $("bscanSlider");
    const next = Math.min(Number(slider.max), Math.max(0, Number(slider.value) + (ev.deltaY > 0 ? 1 : -1)));
    slider.value = String(next);
    if (scanCursor) scanCursor.bscan = next;
    showBscan(next);
  }, { passive: false });
  addEventListener("resize", () => {
    if (bscanMeta) showBscan(Number($("bscanSlider").value));
  });
  try {
    manifest = await fetch("./demo/manifest.json").then((r) => r.json());
  } catch (e) {
    manifest = null;
  }
  if (manifest) {
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "Example eye…";
    $("eye").appendChild(blank);
    for (const e of manifest.eyes) {
      const o = document.createElement("option");
      o.value = e.id; o.textContent = e.label;
      $("eye").appendChild(o);
    }
  }
  $("eyeWrap").hidden = !manifest;
  $("tools").hidden = true;
  $("empty").hidden = false;
  $("emptyOpen").hidden = !local;
  $("emptyFolder").hidden = !local;
  $("emptyDownload").hidden = local;
  $("downloadApp").hidden = local;
  try {
    current.baseCap = await fetch("./demo/NORMAL1/base_cap.json").then((r) => r.json());
  } catch (e) {
    current.baseCap = null;
  }
  if (local) {
    status("Open a scan from this computer. It is not uploaded.");
    return;
  }
  $("emptyCopy").textContent = manifest
    ? "Pick an example eye, or drop a 9-number ETDRS CSV. A patient's cube opens in the local app."
    : "Demo data missing. Run: python scripts/export_web.py";
  status(manifest
    ? "Example eyes and CSV stay in the browser. A volume opens locally."
    : "Demo data missing. Run: python scripts/export_web.py");
}

boot();
