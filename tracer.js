/*
 * Assisted tracing: finds walls in a picture of a floor plan. Plain image processing, no AI service and no upload:
 * it runs in the browser (window.HouseTracer) and in Node (require('./tracer.js')), on a grey-scale image.
 *
 *   HouseTracer.estimateSkew(gray, w, h)            -> { angle, confidence }   how many degrees clockwise the drawing is tilted
 *   HouseTracer.detect(gray, w, h, pxPerFt, opts)   -> { walls, stats }
 *
 * gray: Uint8Array / Uint8ClampedArray of w*h values, 0 = black, 255 = white, row by row.
 * Coordinates come back in feet from the image's top-left corner (x right, y down), the same axes as a house file.
 * Each wall is { axis: 'h'|'v', c, a, b, t, ext, openings: [{ a, b, type }] }:
 *   c = centre line, a..b = extent along the axis, t = thickness, ext = an outside wall, openings = gaps found in it.
 * A wall at any other angle comes back as { axis: 'l', p: [x0, y0, x1, y1], a: 0, b: length, c: 0, t, ext, openings: [] }
 * (its centre line, from the image's top-left corner, in feet).
 * Doors in straight walls carry their `hinge` ('a'|'b') and `swing` ('n'|'s'|'e'|'w') when the swing arc is drawn.
 *
 * How it works: (1) turn the picture into ink and paper with a threshold that follows the lighting; (2) keep only long,
 * thick, straight bars, which is what walls are and what text, dimension lines and symbols are not; (3) tidy: line the
 * bars up, bridge door and window gaps, join the corners; (4) work out which walls are on the outside and what each gap is.
 * Nothing it finds is final: the editor shows every wall as a suggestion to accept or reject.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HouseTracer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = {
    style: 'solid',      // 'solid' (filled walls), 'outlined' (walls drawn as two thin lines), 'thin' (walls are single lines)
    minLen: 2.5,         // ft: shorter bars are not walls
    minThick: 0.2,       // ft: thinner bars are dimension lines and text (not used by 'thin')
    maxThick: 1.2,       // ft: thicker marks are fixtures and fills
    maxGap: 4.6,         // ft: a break this wide or less inside one wall is a doorway or a window
    sensitivity: 0.8,    // 0.6 (only the darkest ink) .. 0.95 (faint ink too)
    openings: true,      // also turn the gaps in walls into doors and windows
    symbols: true,       // tell doors from windows by the swing arc and the window lines drawn in the gap
    angled: true,        // also look for walls that are neither level nor plumb
    ink: null,           // a ready-made mask of wall pixels (Uint8Array, w*h), from a learned model: used instead of looking for dark ink
    doors: null,         // masks of door and window pixels (same size), used to tell a door from a window
    windows: null
  };

  // ------------------------------------------------------------------ skew
  // Try tilts from -20 to +20 degrees: at the right one, the ink of the walls lines up in rows and columns, so the
  // row and column counts are as lumpy as they can be (the sum of their squares peaks).
  function estimateSkew(gray, w, h) {
    const step = Math.max(1, Math.ceil(Math.max(w, h) / 800));
    const sw = Math.floor(w / step), sh = Math.floor(h / step);
    if (sw < 16 || sh < 16) return { angle: 0, confidence: 0 };
    const g = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {                      // box-average down to the working size
      let s = 0; for (let j = 0; j < step; j++) for (let i = 0; i < step; i++) s += gray[(y * step + j) * w + x * step + i];
      g[y * sw + x] = s / (step * step);
    }
    const ink = binarize(g, sw, sh, (Math.round(sw / 30) | 1) + 2, 0.8);
    const px = [], py = [];
    let count = 0; for (let i = 0; i < ink.length; i++) count += ink[i];
    if (count < 200) return { angle: 0, confidence: 0 };
    const keep = Math.max(1, Math.floor(count / 120000)); let n = 0;
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (ink[y * sw + x] && (n++ % keep === 0)) { px.push(x); py.push(y); }
    const N = px.length, size = 2 * (sw + sh) + 4, off = sw + sh, hx = new Int32Array(size), hy = new Int32Array(size);
    const score = deg => {
      const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      hx.fill(0); hy.fill(0);
      for (let i = 0; i < N; i++) { hx[Math.round(px[i] * c + py[i] * s) + off]++; hy[Math.round(-px[i] * s + py[i] * c) + off]++; }
      let t = 0; for (let i = 0; i < size; i++) t += hx[i] * hx[i] + hy[i] * hy[i];
      return t;
    };
    const scores = []; let best = 0, bs = -1;
    for (let d = -20; d <= 20.0001; d += 0.5) { const sc = score(d); scores.push(sc); if (sc > bs) { bs = sc; best = d; } }
    let fine = best, fs = bs;
    for (let d = best - 0.5; d <= best + 0.5001; d += 0.05) { const sc = score(d); if (sc > fs) { fs = sc; fine = d; } }
    const sortedScores = scores.slice().sort((p, q) => p - q), median = sortedScores[sortedScores.length >> 1];
    return { angle: Math.round(fine * 100) / 100, confidence: Math.max(0, Math.min(1, (fs - median) / fs)) };
  }

  // ------------------------------------------------------------------ ink and paper
  function binarize(gray, w, h, win, sens) {
    const I = new Float64Array((w + 1) * (h + 1));                                   // integral image: fast local averages
    for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += gray[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
    const r = win >> 1, ink = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const mean = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
        const v = gray[y * w + x];
        ink[y * w + x] = (v < 60 || v < mean * sens) && v < 200 ? 1 : 0;
      }
    }
    return ink;
  }
  const transpose = (a, w, h) => { const t = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t[x * h + y] = a[y * w + x]; return t; };
  // fill white gaps of up to g pixels between ink, down each column (so two thin parallel lines become one thick bar)
  function bridgeColumns(ink, w, h, g) {
    const out = Uint8Array.from(ink);
    for (let x = 0; x < w; x++) {
      let lastInk = -1;
      for (let y = 0; y < h; y++) {
        if (ink[y * w + x]) { if (lastInk >= 0 && y - lastInk - 1 > 0 && y - lastInk - 1 <= g) for (let k = lastInk + 1; k < y; k++) out[k * w + x] = 1; lastInk = y; }
      }
    }
    return out;
  }

  // drop ink that is thinner than `t` pixels down its column: thin lines (window symbols, door swings, dimension lines) go,
  // and with them the false links they make between wall pieces
  function thickOnly(ink, w, h, t) {
    const out = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) {
      let y = 0;
      while (y < h) {
        if (!ink[y * w + x]) { y++; continue; }
        let e = y; while (e + 1 < h && ink[(e + 1) * w + x]) e++;
        if (e - y + 1 >= t) for (let k = y; k <= e; k++) out[k * w + x] = 1;
        y = e + 1;
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ bars: long, thick, horizontal runs of ink
  function findBars(ink, w, h, P) {
    let src = P.bridge ? bridgeColumns(ink, w, h, P.bridge) : ink;
    if (P.thick > 1) src = thickOnly(src, w, h, P.thick);
    const runs = [];                                                                 // { y, x0, x1, root }
    let prev = [], parent = [];
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
    for (let y = 0; y < h; y++) {
      const cur = [];
      let x = 0;
      while (x < w) {
        if (!src[y * w + x]) { x++; continue; }
        let s = x, e = x;
        for (;;) {                                                                   // extend through ink, and over one-pixel breaks
          while (e + 1 < w && src[y * w + e + 1]) e++;
          let k = e + 1, gap = 0; while (k < w && !src[y * w + k] && gap <= 1) { k++; gap++; }
          if (k < w && src[y * w + k] && gap <= 1) e = k; else break;
        }
        if (e - s + 1 >= P.minLen) { const id = runs.length; runs.push({ y, x0: s, x1: e }); parent.push(id); cur.push(id); }
        x = e + 1;
      }
      let i = 0, j = 0;                                                              // join runs that touch the row above
      while (i < prev.length && j < cur.length) {
        const a = runs[prev[i]], b = runs[cur[j]];
        if (a.x1 >= b.x0 && b.x1 >= a.x0) union(prev[i], cur[j]);
        if (a.x1 < b.x1) i++; else j++;
      }
      prev = cur;
    }
    const comps = new Map();
    runs.forEach((r, id) => {
      const k = find(id); let c = comps.get(k);
      if (!c) comps.set(k, c = { x0: r.x0, x1: r.x1, y0: r.y, y1: r.y, n: 0, ys: 0 });
      c.x0 = Math.min(c.x0, r.x0); c.x1 = Math.max(c.x1, r.x1); c.y0 = Math.min(c.y0, r.y); c.y1 = Math.max(c.y1, r.y);
      const len = r.x1 - r.x0 + 1; c.n += len; c.ys += (r.y + 0.5) * len;
    });
    // a bar is as thick as it is in most places along its length: a cabinet drawn against a wall, or a door swing, may add
    // to it in a few places without changing what it is
    const keep = new Map();
    for (const [k, c] of comps) { c.len = c.x1 - c.x0 + 1; if (c.len >= P.minLen) { c.cols = new Uint16Array(c.len); keep.set(k, c); } }
    runs.forEach((r, id) => { const c = keep.get(find(id)); if (c) for (let x = r.x0; x <= r.x1; x++) c.cols[x - c.x0]++; });
    const bars = [];
    for (const c of keep.values()) {
      const sorted = Array.from(c.cols).sort((p, q) => p - q), t = sorted[sorted.length >> 1];
      if (t < P.minT || t > P.maxT) continue;
      let solid = 0; for (let i = 0; i < c.len; i++) if (Math.abs(c.cols[i] - t) <= Math.max(1, t * 0.35)) solid++;
      if (solid / c.len < 0.6) continue;                                           // a wall is the same thickness all along; lettering and hatching are not
      // the middle: the mean row of the columns that are the usual thickness
      let sy = 0, sn = 0; runs.forEach((r, id) => { if (keep.get(find(id)) === c) { const len = r.x1 - r.x0 + 1; sy += (r.y + 0.5) * len; sn += len; } });
      bars.push({ a: c.x0, b: c.x1 + 1, c: sy / sn, t });
    }
    return bars;
  }

  // ------------------------------------------------------------------ tidying
  // group numbers that are within tol of each other; returns the group index of each value
  function cluster(values, tol) {
    const idx = values.map((v, i) => i).sort((p, q) => values[p] - values[q]);
    const group = new Array(values.length); let g = -1, last = -Infinity;
    for (const i of idx) { if (values[i] - last > tol) g++; group[i] = g; last = values[i]; }
    return group;
  }

  function tidy(bars, o) {
    // 1. one centre line for every group of bars that sit on the same line
    for (const axis of ['h', 'v']) {
      const list = bars.filter(b => b.axis === axis); if (!list.length) continue;
      const grp = cluster(list.map(b => b.c), 0.3), sums = {};
      list.forEach((b, i) => { const s = (sums[grp[i]] ||= { w: 0, c: 0 }); const wt = b.b - b.a; s.w += wt; s.c += b.c * wt; });
      list.forEach((b, i) => { b.c = sums[grp[i]].c / sums[grp[i]].w; b.line = grp[i]; });
    }
    // 2. along each line: join bars across gaps, and keep the gaps as openings
    const walls = [];
    for (const axis of ['h', 'v']) {
      const list = bars.filter(b => b.axis === axis), lines = {};
      list.forEach(b => (lines[b.line] ||= []).push(b));
      for (const arr of Object.values(lines)) {
        arr.sort((p, q) => p.a - q.a);
        let cur = null;
        for (const b of arr) {
          if (cur && b.a - cur.b <= o.maxGap) {
            const gap = b.a - cur.b;
            if (gap > 0.9) cur.openings.push({ a: cur.b, b: b.a });                  // a real break, not noise
            cur.t = (cur.t * (cur.b - cur.a) + b.t * (b.b - b.a)) / ((cur.b - cur.a) + (b.b - b.a));
            cur.b = Math.max(cur.b, b.b);
          } else { if (cur) walls.push(cur); cur = { axis, c: b.c, a: b.a, b: b.b, t: b.t, openings: [] }; }
        }
        if (cur) walls.push(cur);
      }
    }
    // 3. walls meet: an end that is close to a crossing wall goes onto that wall's centre line
    for (const w of walls) {
      for (const end of ['a', 'b']) {
        let best = null, bd = 1.0;
        for (const p of walls) {
          if (p.axis === w.axis) continue;
          const pa = p.a, pb = p.b;
          if (w.c < pa - 0.6 || w.c > pb + 0.6) continue;                            // the crossing wall must reach this wall's line
          const d = Math.abs(w[end] - p.c); if (d < bd) { bd = d; best = p; }
        }
        if (best) w[end] = best.c;
      }
    }
    return walls.filter(w => w.b - w.a >= o.minLen * 0.8);
  }

  // Measure each wall properly from the grey levels. Across the wall, find the dark band that holds the wall's middle, with its
  // two edges worked out to a fraction of a pixel. (The ink threshold finds the wall; this sharpens it, and ignores marks that
  // sit near the wall without touching it.)
  function refine(gray, w, h, ppf, walls) {
    for (const wl of walls) {
      const n = 11, ts = [], cs = [], cores = [], papers = [];
      const gaps = wl.openings.concat([{ a: -1, b: wl.a + 0.4 }, { a: wl.b - 0.4, b: 1e9 }]);
      for (let k = 0; k < n; k++) {
        const t = wl.a + (wl.b - wl.a) * (k + 0.5) / n;
        if (gaps.some(g => t > g.a - 0.3 && t < g.b + 0.3)) continue;
        const lo = Math.floor((wl.c - wl.t / 2 - 0.8) * ppf), hi = Math.ceil((wl.c + wl.t / 2 + 0.8) * ppf), pos = Math.round(t * ppf);
        const prof = [];
        for (let q = lo; q <= hi; q++) {
          const x = wl.axis === 'h' ? pos : q, y = wl.axis === 'h' ? q : pos;
          prof.push(x < 0 || y < 0 || x >= w || y >= h ? 255 : gray[y * w + x]);
        }
        const sorted = prof.slice().sort((p, q) => p - q), ink = (sorted[0] + sorted[1]) / 2, paper = sorted[Math.floor(sorted.length * 0.92)];
        if (paper - ink < 40) continue;
        const cov = prof.map(v => Math.max(0, Math.min(1, (paper - v) / (paper - ink))));   // how much of each pixel is ink
        const mid0 = wl.c * ppf - lo;
        let i = Math.round(mid0 - 0.5);
        if (i < 0 || i >= cov.length || cov[i] < 0.5) { let best = -1; cov.forEach((v, j) => { if (v >= 0.5 && (best < 0 || Math.abs(j + 0.5 - mid0) < Math.abs(best + 0.5 - mid0))) best = j; }); if (best < 0) continue; i = best; }
        let l = i, r = i; while (l > 0 && cov[l - 1] > 0.12) l--; while (r < cov.length - 1 && cov[r + 1] > 0.12) r++;
        let sum = 0, mom = 0; for (let j = l; j <= r; j++) { sum += cov[j]; mom += cov[j] * (j + 0.5); }
        const thick = sum, mid = mom / sum + lo;
        if (thick > 0) { ts.push(thick / ppf); cs.push(mid / ppf); cores.push(ink); papers.push(paper); }
      }
      if (ts.length >= 2) {
        ts.sort((p, q) => p - q); cs.sort((p, q) => p - q);
        const t = ts[ts.length >> 1];
        if (t > wl.t * 0.6 && t < wl.t * 1.6) { wl.t = t; wl.c = cs[cs.length >> 1]; }   // trust it unless clutter threw it off
        cores.sort((p, q) => p - q); papers.sort((p, q) => p - q); wl.core = cores[cores.length >> 1]; wl.paper = papers[papers.length >> 1];
      }
    }
  }

  // a doorway at the very end of a wall leaves no wall piece beyond it, so the wall seems to stop short of the one it meets:
  // carry it on to that wall and keep the gap as the doorway (otherwise the two rooms either side look joined up)
  function carryOn(walls) {
    for (const w of walls) for (const end of ['a', 'b']) {
      let best = null, bd = Infinity;
      for (const p of walls) {
        if (p.axis === w.axis || w.c < p.a - 0.6 || w.c > p.b + 0.6) continue;
        const beyond = end === 'b' ? p.c - w.b : w.a - p.c;                           // how far past the end the crossing wall is
        if (beyond < 1.2 || beyond > 4.2 || beyond >= bd) continue;
        best = p; bd = beyond;
      }
      if (!best) continue;
      const gap = end === 'b' ? { a: w.b, b: best.c } : { a: best.c, b: w.a };
      if (walls.some(q => q !== w && q.axis === w.axis && Math.abs(q.c - w.c) < 0.3 && q.a < gap.b && q.b > gap.a)) continue;   // something else is already there
      if (bd >= 2.0) w.openings.push(gap);
      w[end] = best.c;
    }
  }

  // two outside walls on one line with a wide gap between them (a picture window, a patio door) are one wall with an opening
  function joinOutsideWalls(walls, maxGap) {
    const out = [], used = new Set();
    const sorted = walls.slice().sort((p, q) => (p.axis < q.axis ? -1 : p.axis > q.axis ? 1 : p.c - q.c || p.a - q.a));
    for (const w of sorted) {
      if (used.has(w)) continue;
      let cur = w;
      if (w.ext) for (const q of sorted) {
        if (used.has(q) || q === cur || !q.ext || q.axis !== cur.axis || Math.abs(q.c - cur.c) > 0.3 || q.a < cur.b || q.a - cur.b > maxGap) continue;
        const crossed = walls.some(p => p.axis !== cur.axis && p.c > cur.b && p.c < q.a && p.a <= cur.c + 0.3 && p.b >= cur.c - 0.3);   // a wall running into the gap: not one opening
        if (crossed) continue;
        cur.openings.push({ a: cur.b, b: q.a }); cur.b = q.b; cur.openings = cur.openings.concat(q.openings); used.add(q);
      }
      used.add(w); out.push(cur);
    }
    return out;
  }

  // which walls have the outside on one of their faces? (flood from the edge of a 0.25 ft grid; walls are treated as solid, so a door gap does not leak)
  function markOutside(walls, slants) {
    slants = slants || [];
    if (!walls.length) return;
    const G = 0.25, rect = w => w.axis === 'h' ? [w.a, w.c - w.t / 2, w.b, w.c + w.t / 2] : [w.c - w.t / 2, w.a, w.c + w.t / 2, w.b];
    const rs = walls.map(rect);
    // a gap that was too wide to join into one wall (a patio door, an open end) still shuts the outside out
    for (const p of walls) for (const q of walls) {
      if (p === q || p.axis !== q.axis || Math.abs(p.c - q.c) > 0.3 || q.a < p.b || q.a - p.b > 12) continue;
      rs.push(p.axis === 'h' ? [p.b, p.c - p.t / 2, q.a, p.c + p.t / 2] : [p.c - p.t / 2, p.b, p.c + p.t / 2, q.a]);
    }
    const x0 = Math.min(...rs.map(r => r[0])) - 2, y0 = Math.min(...rs.map(r => r[1])) - 2, x1 = Math.max(...rs.map(r => r[2])) + 2, y1 = Math.max(...rs.map(r => r[3])) + 2;
    const nx = Math.ceil((x1 - x0) / G), ny = Math.ceil((y1 - y0) / G), cell = new Uint8Array(nx * ny);
    const inSlant = (S, x, y) => { const dx = S.p[2] - S.p[0], dy = S.p[3] - S.p[1], L = Math.hypot(dx, dy) || 1, u = ((x - S.p[0]) * dx + (y - S.p[1]) * dy) / L, v = (-(x - S.p[0]) * dy + (y - S.p[1]) * dx) / L; return u > -S.t / 2 && u < L + S.t / 2 && Math.abs(v) < S.t / 2 + 0.05; };
    for (const S of slants) { const xa = Math.min(S.p[0], S.p[2]) - S.t, xb = Math.max(S.p[0], S.p[2]) + S.t, ya = Math.min(S.p[1], S.p[3]) - S.t, yb = Math.max(S.p[1], S.p[3]) + S.t;
      for (let j = Math.max(0, Math.floor((ya - y0) / G)); j <= Math.min(ny - 1, Math.ceil((yb - y0) / G)); j++) for (let i = Math.max(0, Math.floor((xa - x0) / G)); i <= Math.min(nx - 1, Math.ceil((xb - x0) / G)); i++) if (inSlant(S, x0 + (i + 0.5) * G, y0 + (j + 0.5) * G)) cell[j * nx + i] = 1; }
    for (const r of rs) for (let j = Math.max(0, Math.ceil((r[1] - y0) / G - 0.5)); j <= Math.min(ny - 1, Math.floor((r[3] - y0) / G - 0.5)); j++)
      for (let i = Math.max(0, Math.ceil((r[0] - x0) / G - 0.5)); i <= Math.min(nx - 1, Math.floor((r[2] - x0) / G - 0.5)); i++) cell[j * nx + i] = 1;   // cells whose centre is inside
    const out = new Uint8Array(nx * ny), stack = [0]; out[0] = 1;
    while (stack.length) {
      const k = stack.pop(), i = k % nx, j = (k / nx) | 0;
      for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
        if (a < 0 || b < 0 || a >= nx || b >= ny) continue; const q = b * nx + a;
        if (!cell[q] && !out[q]) { out[q] = 1; stack.push(q); }
      }
    }
    const outside = (x, y) => { const i = Math.floor((x - x0) / G), j = Math.floor((y - y0) / G); return i < 0 || j < 0 || i >= nx || j >= ny ? true : !!out[j * nx + i]; };
    for (const w of walls) {
      let lo = 0, hi = 0, n = 0;
      for (let t = w.a + 0.6; t <= w.b - 0.6; t += 0.5) {
        n++;
        const d = w.t / 2 + 0.4;
        if (w.axis === 'h') { if (outside(t, w.c - d)) lo++; if (outside(t, w.c + d)) hi++; }
        else { if (outside(w.c - d, t)) lo++; if (outside(w.c + d, t)) hi++; }
      }
      w.ext = n > 0 && (lo / n > 0.5 || hi / n > 0.5);
    }
    for (const S of slants) {
      const L = Math.hypot(S.p[2] - S.p[0], S.p[3] - S.p[1]), u = [(S.p[2] - S.p[0]) / L, (S.p[3] - S.p[1]) / L], n = [-u[1], u[0]], d = S.t / 2 + 0.4;
      let lo = 0, hi = 0, m = 0;
      for (let t = 0.6; t <= L - 0.6; t += 0.5) { m++; const c = [S.p[0] + u[0] * t, S.p[1] + u[1] * t]; if (outside(c[0] - n[0] * d, c[1] - n[1] * d)) lo++; if (outside(c[0] + n[0] * d, c[1] + n[1] * d)) hi++; }
      S.ext = m > 0 && (lo / m > 0.5 || hi / m > 0.5);
    }
  }

  // what is each gap? Outside walls: a window, unless it is about a door wide. Inside walls: a door, or an open doorway when wide.
  function guessOpenings(walls) {
    for (const w of walls) for (const o of w.openings) {
      const wd = o.b - o.a;
      if (w.ext) o.type = 'window';                                                  // front and back doors are fixed by hand: a gap alone can't tell
      else o.type = wd > 4.2 ? 'cased' : 'door';
    }
  }

  // ------------------------------------------------------------------ walls at an angle
  // Take away the ink the level and plumb walls explain; find the directions the rest lines up in (the same lumpy-profile idea
  // as the skew search); turn the picture so each direction is level and find its bars the way level ones are found.
  const RAD = Math.PI / 180;
  function slantAngles(ink, w, h, keep) {
    // the direction of every edge in what is left: smooth the mask a little, take its gradient, and vote (weighted by strength)
    // for the line direction, which runs across the gradient. Walls at one angle give one tall peak, however short they are.
    const B = new Float32Array(w * h), T = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 1; x < w - 1; x++) T[y * w + x] = (keep[y * w + x - 1] + keep[y * w + x] + keep[y * w + x + 1]) / 3;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) B[y * w + x] = (T[(y - 1) * w + x] + T[y * w + x] + T[(y + 1) * w + x]) / 3;
    const NB = 360, votes = new Float64Array(NB);
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      const i = y * w + x, v = B[i]; if (v <= 0.04 || v >= 0.96) continue;
      const gx = (B[i - w + 1] + 2 * B[i + 1] + B[i + w + 1]) - (B[i - w - 1] + 2 * B[i - 1] + B[i + w - 1]);
      const gy = (B[i + w - 1] + 2 * B[i + w] + B[i + w + 1]) - (B[i - w - 1] + 2 * B[i - w] + B[i - w + 1]);
      const m = Math.hypot(gx, gy); if (m < 0.15) continue;
      let a = (Math.atan2(gy, gx) / RAD + 90 + 360) % 180;                           // the line's direction, 0..180
      votes[Math.floor(a * 2) % NB] += m;
    }
    const sm = new Float64Array(NB);                                                // smooth over +-1.5 degrees
    for (let b = 0; b < NB; b++) { let t = 0; for (let k = -3; k <= 3; k++) t += votes[(b + k + NB) % NB]; sm[b] = t / 7; }
    const sorted = Array.from(sm).sort((p, q) => p - q), med = sorted[NB >> 1];
    const peaks = [];
    for (let b = 0; b < NB; b++) {
      const deg = b / 2, off = Math.min(deg % 90, 90 - (deg % 90));
      if (off < 10) continue;                                                       // level and plumb are found already
      let top = true; for (let k = -8; k <= 8; k++) if (k && sm[(b + k + NB) % NB] > sm[b]) { top = false; break; }
      if (top && sm[b] > Math.max(3 * med, 4)) peaks.push({ deg: deg + 0.25, v: sm[b] });
    }
    const out = [];
    for (const pk of peaks.sort((p, q) => q.v - p.v)) if (out.length < 6 && out.every(d => Math.abs(d - pk.deg) > 6)) out.push(pk.deg);
    return out;
  }
  function findSlants(ink, w, h, ppf, walls, P, o) {
    // ink that belongs to the level and plumb walls goes
    const keep = Uint8Array.from(ink), pad = Math.max(1, Math.round(0.06 * ppf));        // just past the wall's own edge: angled walls meet these ones, and lose as little as possible
    for (const wl of walls) {
      const r = wl.axis === 'h' ? [wl.a, wl.c - wl.t / 2, wl.b, wl.c + wl.t / 2] : [wl.c - wl.t / 2, wl.a, wl.c + wl.t / 2, wl.b];
      for (let y = Math.max(0, Math.floor(r[1] * ppf) - pad); y < Math.min(h, Math.ceil(r[3] * ppf) + pad); y++) for (let x = Math.max(0, Math.floor(r[0] * ppf) - pad); x < Math.min(w, Math.ceil(r[2] * ppf) + pad); x++) keep[y * w + x] = 0;
    }
    const found = [];
    for (const deg of slantAngles(ink, w, h, keep)) {
      const cs = Math.cos(deg * RAD), sn = Math.sin(deg * RAD);
      // u runs along the direction, v across it
      const U = [0, w, 0, w].map((x, i) => x * cs + (i < 2 ? 0 : h) * sn), V = [0, w, 0, w].map((x, i) => -x * sn + (i < 2 ? 0 : h) * cs);
      const u0 = Math.floor(Math.min(...U)), v0 = Math.floor(Math.min(...V)), ru = Math.ceil(Math.max(...U)) - u0, rv = Math.ceil(Math.max(...V)) - v0;
      if (ru * rv > 2.4e7) continue;
      const rot = new Uint8Array(ru * rv);
      for (let j = 0; j < rv; j++) for (let i = 0; i < ru; i++) {
        const u = i + u0 + 0.5, v = j + v0 + 0.5, x = Math.floor(u * cs - v * sn), y = Math.floor(u * sn + v * cs);
        if (x >= 0 && y >= 0 && x < w && y < h && keep[y * w + x]) rot[j * ru + i] = 1;
      }
      // pieces on one line, with door- and window-sized gaps between them, are one wall (as for the level ones)
      const bars = findBars(rot, ru, rv, P).sort((p, q) => p.c - q.c || p.a - q.a), lines = [];
      for (const b of bars) {
        const ln = lines.find(l => Math.abs(l.c - b.c) < 0.3 * ppf);
        if (ln) { ln.bars.push(b); ln.c = (ln.c * ln.n + b.c * (b.b - b.a)) / (ln.n + b.b - b.a); ln.n += b.b - b.a; } else lines.push({ c: b.c, n: b.b - b.a, bars: [b] });
      }
      for (const ln of lines) {
        ln.bars.sort((p, q) => p.a - q.a);
        let cur = null; const walls = [];
        for (const b of ln.bars) {
          if (cur && b.a - cur.b <= o.maxGap * ppf) { if (b.a - cur.b > 0.9 * ppf) cur.gaps.push([cur.b, b.a]); cur.t = (cur.t * (cur.b - cur.a) + b.t * (b.b - b.a)) / ((cur.b - cur.a) + (b.b - b.a)); cur.b = Math.max(cur.b, b.b); }
          else { if (cur) walls.push(cur); cur = { a: b.a, b: b.b, t: b.t, gaps: [] }; }
        }
        if (cur) walls.push(cur);
        for (const m of walls) {
          if ((m.b - m.a) / ppf < Math.min(o.minLen, 1.2) + 0.2) continue;                  // short pieces are kept for now: a bay's sides are short, but only if they join up at both ends
          const pt = (u, v) => [((u + u0) * cs - (v + v0) * sn) / ppf, ((u + u0) * sn + (v + v0) * cs) / ppf];
          found.push({ p: [...pt(m.a, ln.c), ...pt(m.b, ln.c)], t: m.t / ppf, gaps: m.gaps.map(g => [pt(g[0], ln.c), pt(g[1], ln.c)]) });
        }
      }
    }
    // the same bar can come up from two nearby directions: keep one
    const slants = [];
    for (const f of found.sort((p, q) => Math.hypot(q.p[2] - q.p[0], q.p[3] - q.p[1]) - Math.hypot(p.p[2] - p.p[0], p.p[3] - p.p[1]))) {
      const mid = [(f.p[0] + f.p[2]) / 2, (f.p[1] + f.p[3]) / 2];
      if (slants.some(q => [[f.p[0], f.p[1]], [f.p[2], f.p[3]], mid].every(e => distToSeg(e, q.p) < Math.max(f.t, q.t) + 0.5))) continue;      // lies along a longer one already found
      slants.push(f);
    }
    // a long thin smear along a straight wall is that wall's own edge, not another wall
    const alongWall = f => walls.some(wl => { const c = wl.axis === 'h' ? [wl.a, wl.c, wl.b, wl.c] : [wl.c, wl.a, wl.c, wl.b];
      return [[f.p[0], f.p[1]], [f.p[2], f.p[3]], [(f.p[0] + f.p[2]) / 2, (f.p[1] + f.p[3]) / 2]].every(q => distToSeg(q, c) < wl.t / 2 + 0.9); });
    const steep = f => {                                                           // a wall that meets a straight one at a shallow angle is nearly always leftover ink, not a wall
      const a = Math.abs(Math.atan2(f.p[3] - f.p[1], f.p[2] - f.p[0]) / RAD) % 90, off = Math.min(a, 90 - a);
      return off >= 20 || (off >= 10 && Math.hypot(f.p[2] - f.p[0], f.p[3] - f.p[1]) >= 8);
    };
    return connectSlants(slants.filter(f => !alongWall(f) && steep(f)), walls, o.minLen);
  }
  function distToSeg(q, p) {
    const dx = p[2] - p[0], dy = p[3] - p[1], L2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((q[0] - p[0]) * dx + (q[1] - p[1]) * dy) / L2));
    return Math.hypot(q[0] - p[0] - t * dx, q[1] - p[1] - t * dy);
  }
  // an angled wall goes on to the centre line of the wall it meets (or the end of the angled wall it meets); one that meets nothing is clutter
  function connectSlants(slants, walls, minLen) {
    const centre = wl => (wl.axis === 'h' ? [wl.a, wl.c, wl.b, wl.c] : [wl.c, wl.a, wl.c, wl.b]);
    const hit = (E, d, tgt, slack) => {                                              // where the line from E along d crosses the target segment's line; null if it misses
      const T = tgt, ex = T[2] - T[0], ey = T[3] - T[1], den = d[0] * ey - d[1] * ex;
      if (Math.abs(den) < 0.12 * Math.hypot(ex, ey)) return null;                     // nearly parallel
      const s = ((T[0] - E[0]) * ey - (T[1] - E[1]) * ex) / den, u = ((T[0] - E[0]) * d[1] - (T[1] - E[1]) * d[0]) / den;
      if (s < -1.0 || s > 1.5 || u < -slack || u > 1 + slack) return null;
      return { s, pt: [E[0] + d[0] * s, E[1] + d[1] * s] };
    };
    const live = slants.map(x => ({ ...x, linked: [false, false] }));
    for (let pass = 0; pass < 2; pass++) for (const f of live) for (const end of [0, 1]) {
      const E = end ? [f.p[2], f.p[3]] : [f.p[0], f.p[1]], O = end ? [f.p[0], f.p[1]] : [f.p[2], f.p[3]];
      const L = Math.hypot(E[0] - O[0], E[1] - O[1]) || 1, d = [(E[0] - O[0]) / L, (E[1] - O[1]) / L];
      let best = null;
      const consider = (tgt, slack) => { const r = hit(E, d, tgt, slack / (Math.hypot(tgt[2] - tgt[0], tgt[3] - tgt[1]) || 1)); if (r && (!best || Math.abs(r.s) < Math.abs(best.s))) best = r; };
      for (const wl of walls) consider(centre(wl), 0.5);
      for (const g of live) if (g !== f) consider(g.p, 1.0);
      if (best) { if (end) { f.p[2] = best.pt[0]; f.p[3] = best.pt[1]; } else { f.p[0] = best.pt[0]; f.p[1] = best.pt[1]; } f.linked[end] = true; }
    }
    return live.filter(f => (f.linked[0] || f.linked[1]) && Math.hypot(f.p[2] - f.p[0], f.p[3] - f.p[1]) >= (f.linked[0] && f.linked[1] ? 1.2 : minLen)).map(f => {
      const L = Math.hypot(f.p[2] - f.p[0], f.p[3] - f.p[1]), u = [(f.p[2] - f.p[0]) / L, (f.p[3] - f.p[1]) / L];
      const at = q => (q[0] - f.p[0]) * u[0] + (q[1] - f.p[1]) * u[1];                    // distance along the wall from its start
      f.openings = (f.gaps || []).map(g => ({ a: Math.max(0, at(g[0])), b: Math.min(L, at(g[1])) })).filter(g => g.b - g.a > 0.9);
      return f;
    });
  }

  // a learned model marks door and window pixels: a gap that is mostly one or the other takes that type
  function typeByMask(walls, o, w, h, ppf) {
    const count = (mask, x0, y0, x1, y1) => { if (!mask) return 0; let n = 0, m = 0; for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, Math.ceil(x1)); x++) { m++; n += mask[y * w + x] ? 1 : 0; } return m ? n / m : 0; };
    for (const wl of walls) for (const q of wl.openings) {
      const pad = 0.4, hz = wl.axis === 'h';
      const r = hz ? [q.a * ppf, (wl.c - wl.t / 2 - pad) * ppf, q.b * ppf, (wl.c + wl.t / 2 + pad) * ppf] : [(wl.c - wl.t / 2 - pad) * ppf, q.a * ppf, (wl.c + wl.t / 2 + pad) * ppf, q.b * ppf];
      const d = count(o.doors, ...r), n = count(o.windows, ...r);
      if (n > 0.2 && n >= d) q.type = 'window'; else if (d > 0.2) q.type = 'door';
    }
  }

  // ------------------------------------------------------------------ door and window symbols
  // A door is drawn as a quarter-circle swing from its hinge; a window as a line or two along the gap. Look for those in the ink.
  function symbols(ink, w, h, ppf, walls) {
    const at = (x, y) => { x = Math.round(x); y = Math.round(y); for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const X = x + i, Y = y + j; if (X >= 0 && Y >= 0 && X < w && Y < h && ink[Y * w + X]) return 1; } return 0; };
    for (const wl of walls) for (const o of wl.openings) {
      const hz = wl.axis === 'h', wd = o.b - o.a; if (wd < 1.5) continue;
      const P = (t, off) => (hz ? [t * ppf, (wl.c + off) * ppf] : [(wl.c + off) * ppf, t * ppf]);
      // a window: a line that runs the whole way along the gap
      let win = 0;
      for (let off = -wl.t / 2; off <= wl.t / 2 + 1e-9; off += 1 / ppf) {
        let n = 0, m = 0; for (let t = o.a + 0.25; t <= o.b - 0.25; t += 1 / ppf) { m++; const q = P(t, off); n += at(q[0], q[1]); }
        if (m && n / m > win) win = n / m;
      }
      // a door: the arc, from either end, to either side
      let door = 0, pick = null;
      for (const hinge of ['a', 'b']) for (const side of [1, -1]) {
        const hp = hinge === 'a' ? o.a : o.b, dir = hinge === 'a' ? 1 : -1; let n = 0, m = 0;
        for (let deg = 12; deg <= 78; deg += 3) {
          m++; const q = P(hp + dir * Math.cos(deg * RAD) * wd, side * Math.sin(deg * RAD) * wd); n += at(q[0], q[1]);
        }
        // the leaf: the line from the hinge straight out
        let lf = 0, lm = 0; for (let r = 0.2; r < wd - 0.1; r += 1 / ppf) { lm++; const q = P(hp, side * r); lf += at(q[0], q[1]); }
        const sc = 0.75 * (n / m) + 0.25 * (lm ? lf / lm : 0);
        if (sc > door) { door = sc; pick = { hinge, side }; }
      }
      o.score = { door, win };
      if (door >= 0.5 && door > win - 0.05) {
        o.type = 'door'; o.hinge = pick.hinge;
        o.swing = hz ? (pick.side > 0 ? 's' : 'n') : (pick.side > 0 ? 'e' : 'w');
      } else if (win >= 0.6) o.type = 'window';
    }
  }

  // ------------------------------------------------------------------ the whole thing
  function detect(gray, w, h, ppf, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const maxT = o.maxThick * ppf, minT = o.style === 'thin' ? 1 : Math.max(2.5, o.minThick * ppf);
    const win = Math.max(15, Math.round(maxT * 3)) | 1;
    const ink = o.ink || binarize(gray, w, h, win, o.sensitivity);
    const learned = !!o.ink;                                                          // a learned model has already said what is wall: no need to measure the grey levels
    const P = { minLen: Math.max(4, Math.round(o.minLen * ppf * 0.4)), minT, thick: o.style === 'thin' ? 0 : Math.max(3, Math.round(o.minThick * ppf)), maxT: o.style === 'thin' ? Math.max(3, 0.25 * ppf) : maxT, bridge: o.style === 'outlined' ? Math.ceil(Math.min(o.maxThick, 0.75) * ppf) : 0 };
    if (o.style === 'outlined') P.maxT = Math.min(P.maxT, P.bridge + 2);                // two lines no more than ~9 inches apart make a wall; cabinets and shelves are deeper
    const hBars = findBars(ink, w, h, P), vBars = findBars(transpose(ink, w, h), h, w, P);
    const bars = [];
    for (const b of hBars) bars.push({ axis: 'h', a: b.a / ppf, b: b.b / ppf, c: b.c / ppf, t: b.t / ppf });
    for (const b of vBars) bars.push({ axis: 'v', a: b.a / ppf, b: b.b / ppf, c: b.c / ppf, t: b.t / ppf });
    let walls = tidy(bars, o);
    const slants = o.angled ? findSlants(ink, w, h, ppf, walls, P, o) : [];                  // before the clean-up, so walls that only touch an angled wall are not taken for clutter
    if (o.style === 'thin' || o.style === 'outlined') {                             // lines drawn thin: a line that touches nothing is probably a dimension line, or a cabinet
      walls = walls.filter(a => walls.some(b => b !== a && b.axis !== a.axis && ((Math.abs(a.a - b.c) < 0.8 || Math.abs(a.b - b.c) < 0.8) && a.c >= b.a - 0.8 && a.c <= b.b + 0.8))
        || slants.some(sl => [[sl.p[0], sl.p[1]], [sl.p[2], sl.p[3]]].some(e => (a.axis === 'h' ? Math.abs(e[1] - a.c) < 0.8 && e[0] > a.a - 0.8 && e[0] < a.b + 0.8 : Math.abs(e[0] - a.c) < 0.8 && e[1] > a.a - 0.8 && e[1] < a.b + 0.8))));
      if (o.style === 'thin') for (const wl of walls) wl.t = 0.4;                   // a single line has no thickness of its own
    }
    if (o.style === 'solid' && !learned) {
      refine(gray, w, h, ppf, walls);
      const known = walls.filter(x => x.core != null).sort((p, q) => (q.b - q.a) - (p.b - p.a)).slice(0, Math.max(3, Math.ceil(walls.length / 2)));   // the longer walls say how dark a wall is
      if (known.length) {
        const cs = known.map(x => x.core).sort((p, q) => p - q), ps = known.map(x => x.paper).sort((p, q) => p - q), core = cs[cs.length >> 1], paper = ps[ps.length >> 1];
        walls = walls.filter(x => x.core == null || x.core <= core + 0.4 * (paper - core));
      }
    }
    else if (o.style === 'outlined') walls.forEach(x => { x.t = Math.max(0.2, x.t - 1 / ppf); });   // the bar includes the width of its two lines
    // regular thickness: the typical outside and inside wall, rounded to the nearest half inch
    carryOn(walls);
    markOutside(walls, slants);
    walls = joinOutsideWalls(walls, 12);
    for (const cls of [true, false]) {
      const ts = walls.filter(x => x.ext === cls).map(x => x.t).sort((p, q) => p - q);
      if (!ts.length) continue;
      const med = Math.round(ts[ts.length >> 1] * 24) / 24;
      walls.filter(x => x.ext === cls).forEach(x => { if (o.style !== 'thin') x.t = Math.abs(x.t - med) < 0.1 ? med : Math.round(x.t * 24) / 24; });
    }
    if (o.openings) { guessOpenings(walls); if (o.doors || o.windows) typeByMask(walls, o, w, h, ppf); if (o.symbols) symbols(ink, w, h, ppf, walls); } else walls.forEach(x => { x.openings = []; });
    const r = v => Math.round(v * 1000) / 1000;
    for (const S of slants) {                                                        // angled walls: the thickness of the straight walls on the same side of the house, to the nearest half inch
      const same = walls.filter(x => x.ext === !!S.ext).map(x => x.t).sort((p, q) => p - q), med = same.length ? same[same.length >> 1] : null;
      S.t = o.style === 'thin' ? 0.4 : med && Math.abs(S.t - med) < 0.15 ? med : Math.round(S.t * 24) / 24;
      const len = Math.hypot(S.p[2] - S.p[0], S.p[3] - S.p[1]);
      walls.push({ axis: 'l', p: S.p.map(r), a: 0, b: r(len), c: 0, t: r(S.t), ext: !!S.ext, openings: (S.openings || []).map(g => ({ a: r(g.a), b: r(g.b), type: S.ext ? 'window' : g.b - g.a > 4.2 ? 'cased' : 'door' })) });
    }
    walls.forEach(x => { if (x.axis === 'l') return; x.a = r(x.a); x.b = r(x.b); x.c = r(x.c); x.t = r(x.t); x.openings.forEach(q => { q.a = r(q.a); q.b = r(q.b); }); });
    return { walls, stats: { bars: bars.length, walls: walls.length, angled: slants.length, ext: walls.filter(x => x.ext).length, openings: walls.reduce((t, x) => t + x.openings.length, 0) } };
  }

  return { DEFAULTS, estimateSkew, detect, _internals: { binarize, findBars, transpose, slantAngles, findSlants, connectSlants } };
});
