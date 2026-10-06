// Draws a house the way a scanned blueprint looks, for testing the tracer: solid walls with gaps for doors and windows,
// door swings and window lines, dimension lines, fixture outlines, noise, uneven lighting and a tilt.
const HouseCore = require('../../house-core.js');

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// opts: { ppf, margin, noise, light, tilt (degrees clockwise), seed, outlined }
function drawBlueprint(houseJson, opts = {}) {
  const { ppf = 10, margin = 6, noise = 10, light = 0.2, tilt = 0, seed = 7, outlined = false, blur = 0 } = opts;
  const { HOUSE } = HouseCore.build(JSON.parse(JSON.stringify(houseJson)));
  const w = Math.round((HOUSE.W + 2 * margin) * ppf), h = Math.round((HOUSE.D + 2 * margin) * ppf);
  const img = new Float32Array(w * h).fill(250);
  const X = v => Math.round((v + margin) * ppf);
  // exact-coverage fill: a pixel the rectangle only half covers is half as dark, like a scan (no rounding to whole pixels)
  const fill = (x0, y0, x1, y1, v) => {
    const X0 = (x0 + margin) * ppf, X1 = (x1 + margin) * ppf, Y0 = (y0 + margin) * ppf, Y1 = (y1 + margin) * ppf;
    for (let y = Math.max(0, Math.floor(Y0)); y < Math.min(h, Math.ceil(Y1)); y++) {
      const oy = Math.min(Y1, y + 1) - Math.max(Y0, y);
      for (let x = Math.max(0, Math.floor(X0)); x < Math.min(w, Math.ceil(X1)); x++) {
        const cov = oy * (Math.min(X1, x + 1) - Math.max(X0, x));
        if (cov > 0) img[y * w + x] = img[y * w + x] * (1 - cov) + v * cov;
      }
    }
  };
  const line = (x0, y0, x1, y1, v) => {                                           // 1 px line
    const a = [(x0 + margin) * ppf, (y0 + margin) * ppf], b = [(x1 + margin) * ppf, (y1 + margin) * ppf], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
    for (let i = 0; i <= n; i++) { const x = Math.round(a[0] + (b[0] - a[0]) * i / n), y = Math.round(a[1] + (b[1] - a[1]) * i / n); if (x >= 0 && y >= 0 && x < w && y < h) img[y * w + x] = v; }
  };
  const live = HOUSE.walls.filter(q => q.status !== 'removed');
  for (const q of live) {
    if (outlined) { fill(q.x0, q.y0, q.x1, q.y1, 250); line(q.x0, q.y0, q.x1, q.y0, 20); line(q.x0, q.y1, q.x1, q.y1, 20); line(q.x0, q.y0, q.x0, q.y1, 20); line(q.x1, q.y0, q.x1, q.y1, 20); }
    else fill(q.x0, q.y0, q.x1, q.y1, 25);
  }
  for (const q of live) {                                                          // openings: cut the gap, then draw the symbol
    const horiz = (q.x1 - q.x0) >= (q.y1 - q.y0);
    for (const o of q.openings || []) {
      if (o.type !== 'door' && o.type !== 'window' && o.type !== 'cased') continue;
      const [x0, y0, x1, y1] = horiz ? [o.a, q.y0 - 0.02, o.b, q.y1 + 0.02] : [q.x0 - 0.02, o.a, q.x1 + 0.02, o.b];
      fill(x0, y0, x1, y1, 250);
      if (outlined) { if (horiz) { line(o.a, q.y0, o.a, q.y1, 20); line(o.b, q.y0, o.b, q.y1, 20); } else { line(q.x0, o.a, q.x1, o.a, 20); line(q.x1, o.b, q.x0, o.b, 20); } }
      const mid = horiz ? (q.y0 + q.y1) / 2 : (q.x0 + q.x1) / 2;
      if (o.type === 'window') horiz ? line(o.a, mid, o.b, mid, 90) : line(mid, o.a, mid, o.b, 90);
      if (o.type === 'door') {                                                     // leaf + swing arc, thin
        const wd = o.b - o.a;
        for (let i = 0; i <= 12; i++) { const t = i / 12 * Math.PI / 2; horiz ? line(o.a + Math.cos(t) * wd, mid + Math.sin(t) * wd, o.a + Math.cos(t + 0.13) * wd, mid + Math.sin(t + 0.13) * wd, 120) : line(mid + Math.sin(t) * wd, o.a + Math.cos(t) * wd, mid + Math.sin(t + 0.13) * wd, o.a + Math.cos(t + 0.13) * wd, 120); }
      }
    }
  }
  for (const f of HOUSE.fixtures) if (f.w && f.h && f.x != null && f.st !== 'removed' && f.k !== 'steps' && f.k !== 'deck') {   // fixture outlines
    line(f.x, f.y, f.x + f.w, f.y, 70); line(f.x, f.y + f.h, f.x + f.w, f.y + f.h, 70); line(f.x, f.y, f.x, f.y + f.h, 70); line(f.x + f.w, f.y, f.x + f.w, f.y + f.h, 70);
  }
  line(0, -3, HOUSE.W, -3, 40); line(0, -3.3, 0, -2.7, 40); line(HOUSE.W, -3.3, HOUSE.W, -2.7, 40);       // a dimension line with end ticks
  line(-3, 0, -3, HOUSE.D, 40);
  for (let i = 0; i < 40; i++) { const x = 1 + i * 0.3; fill(x, -4.4, x + 0.12, -3.7, 35); }              // "text"
  // lighting gradient, noise
  const rnd = rng(seed);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const g = 1 - light * (x / w * 0.6 + y / h * 0.4);
    img[y * w + x] = Math.max(0, Math.min(255, img[y * w + x] * g + (rnd() + rnd() + rnd() - 1.5) * noise));
  }
  if (blur) {                                                                      // a camera's softness: average each pixel with its neighbours
    const src = Float32Array.from(img);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { let t = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) t += src[(y + j) * w + x + i]; img[y * w + x] = src[y * w + x] * (1 - blur) + (t / 9) * blur; }
  }
  const gray = new Uint8ClampedArray(w * h); for (let i = 0; i < gray.length; i++) gray[i] = img[i];
  return { gray: tilt ? rotate(gray, w, h, tilt) : gray, w, h, ppf, margin, house: HOUSE };
}

// rotate by `deg` clockwise about the centre, same size, bilinear, white outside
function rotate(gray, w, h, deg) {
  const out = new Uint8ClampedArray(w * h).fill(250), a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x - cx, dy = y - cy, sx = c * dx + s * dy + cx, sy = -s * dx + c * dy + cy;   // inverse rotation
    const x0 = Math.floor(sx), y0 = Math.floor(sy);
    if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) continue;
    const fx = sx - x0, fy = sy - y0, i = y0 * w + x0;
    out[y * w + x] = gray[i] * (1 - fx) * (1 - fy) + gray[i + 1] * fx * (1 - fy) + gray[i + w] * (1 - fx) * fy + gray[i + w + 1] * fx * fy;
  }
  return out;
}

// how well do detected walls cover the real ones? Compared on a 0.05 ft grid (areas), plus outside/inside agreement.
function score(detected, house, margin) {
  const G = 0.05, W = house.W + 2 * margin, D = house.D + 2 * margin, nx = Math.ceil(W / G), ny = Math.ceil(D / G);
  const truth = new Uint8Array(nx * ny), det = new Uint8Array(nx * ny), truthExt = new Int8Array(nx * ny).fill(-1), detExt = new Int8Array(nx * ny).fill(-1);
  const paint = (arr, ext, x0, y0, x1, y1, e) => { for (let j = Math.max(0, Math.floor((y0 + margin) / G)); j < Math.min(ny, Math.ceil((y1 + margin) / G)); j++) for (let i = Math.max(0, Math.floor((x0 + margin) / G)); i < Math.min(nx, Math.ceil((x1 + margin) / G)); i++) { arr[j * nx + i] = 1; ext[j * nx + i] = e; } };
  for (const q of house.walls) if (q.status !== 'removed') paint(truth, truthExt, q.x0, q.y0, q.x1, q.y1, q.ext ? 1 : 0);
  for (const q of detected) { const r = q.axis === 'h' ? [q.a, q.c - q.t / 2, q.b, q.c + q.t / 2] : [q.c - q.t / 2, q.a, q.c + q.t / 2, q.b]; paint(det, detExt, r[0] - margin, r[1] - margin, r[2] - margin, r[3] - margin, q.ext ? 1 : 0); }
  let t = 0, d = 0, both = 0, extOk = 0, extN = 0;
  for (let i = 0; i < truth.length; i++) { if (truth[i]) t++; if (det[i]) d++; if (truth[i] && det[i]) { both++; extN++; if (truthExt[i] === detExt[i]) extOk++; } }
  return { recall: both / t, precision: both / d, extAgreement: extN ? extOk / extN : 0 };
}

module.exports = { drawBlueprint, rotate, score };
