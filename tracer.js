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
    openings: true       // also turn the gaps in walls into doors and windows
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
  function markOutside(walls) {
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
  }

  // what is each gap? Outside walls: a window, unless it is about a door wide. Inside walls: a door, or an open doorway when wide.
  function guessOpenings(walls) {
    for (const w of walls) for (const o of w.openings) {
      const wd = o.b - o.a;
      if (w.ext) o.type = 'window';                                                  // front and back doors are fixed by hand: a gap alone can't tell
      else o.type = wd > 4.2 ? 'cased' : 'door';
    }
  }

  // ------------------------------------------------------------------ the whole thing
  function detect(gray, w, h, ppf, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const maxT = o.maxThick * ppf, minT = o.style === 'thin' ? 1 : Math.max(2.5, o.minThick * ppf);
    const win = Math.max(15, Math.round(maxT * 3)) | 1;
    const ink = binarize(gray, w, h, win, o.sensitivity);
    const P = { minLen: Math.max(4, Math.round(o.minLen * ppf * 0.4)), minT, thick: o.style === 'thin' ? 0 : Math.max(3, Math.round(o.minThick * ppf)), maxT: o.style === 'thin' ? Math.max(3, 0.25 * ppf) : maxT, bridge: o.style === 'outlined' ? Math.ceil(Math.min(o.maxThick, 0.75) * ppf) : 0 };
    if (o.style === 'outlined') P.maxT = Math.min(P.maxT, P.bridge + 2);                // two lines no more than ~9 inches apart make a wall; cabinets and shelves are deeper
    const hBars = findBars(ink, w, h, P), vBars = findBars(transpose(ink, w, h), h, w, P);
    const bars = [];
    for (const b of hBars) bars.push({ axis: 'h', a: b.a / ppf, b: b.b / ppf, c: b.c / ppf, t: b.t / ppf });
    for (const b of vBars) bars.push({ axis: 'v', a: b.a / ppf, b: b.b / ppf, c: b.c / ppf, t: b.t / ppf });
    let walls = tidy(bars, o);
    if (o.style === 'thin' || o.style === 'outlined') {                             // lines drawn thin: a line that touches nothing is probably a dimension line, or a cabinet
      walls = walls.filter(a => walls.some(b => b !== a && b.axis !== a.axis && ((Math.abs(a.a - b.c) < 0.8 || Math.abs(a.b - b.c) < 0.8) && a.c >= b.a - 0.8 && a.c <= b.b + 0.8)));
      if (o.style === 'thin') for (const wl of walls) wl.t = 0.4;                   // a single line has no thickness of its own
    }
    if (o.style === 'solid') {
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
    markOutside(walls);
    walls = joinOutsideWalls(walls, 12);
    for (const cls of [true, false]) {
      const ts = walls.filter(x => x.ext === cls).map(x => x.t).sort((p, q) => p - q);
      if (!ts.length) continue;
      const med = Math.round(ts[ts.length >> 1] * 24) / 24;
      walls.filter(x => x.ext === cls).forEach(x => { if (o.style !== 'thin') x.t = Math.abs(x.t - med) < 0.1 ? med : Math.round(x.t * 24) / 24; });
    }
    if (o.openings) guessOpenings(walls); else walls.forEach(x => { x.openings = []; });
    const r = v => Math.round(v * 1000) / 1000;
    walls.forEach(x => { x.a = r(x.a); x.b = r(x.b); x.c = r(x.c); x.t = r(x.t); x.openings.forEach(q => { q.a = r(q.a); q.b = r(q.b); }); });
    return { walls, stats: { bars: bars.length, walls: walls.length, ext: walls.filter(x => x.ext).length, openings: walls.reduce((t, x) => t + x.openings.length, 0) } };
  }

  return { DEFAULTS, estimateSkew, detect, _internals: { binarize, findBars, transpose } };
});
