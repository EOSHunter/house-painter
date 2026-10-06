/*
 * Reads the scale of a floor plan from its dimension text: the "12'-6\"" written beside a dimension line. Plain code, no AI service:
 * the text itself is read by an OCR engine the page loads on request (tesseract.js, running in your browser); this file does the rest.
 *
 *   HouseDimensions.parse("12'-6\"")                  -> 12.5     (feet; null if it is not a length)
 *   HouseDimensions.findLines(gray, w, h)             -> { h: [{ c, a, b }], v: [{ c, a, b }] }   long thin straight lines, in pixels
 *   HouseDimensions.estimate(words, lines)            -> { scale, confidence, used: [...], all: [...] }   scale in pixels per foot
 *
 * words: [{ text, x0, y0, x1, y1, vertical }] in image pixels (vertical: the text reads up the page, so it labels a vertical line).
 * Needs tracer.js (for its line finder) when findLines is used.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./tracer.js'));
  else root.HouseDimensions = factory(root.HouseTracer);
})(typeof self !== 'undefined' ? self : this, function (Tracer) {
  'use strict';

  // ------------------------------------------------------------------ text -> feet
  const FRAC = { '\u00bd': 0.5, '\u00bc': 0.25, '\u00be': 0.75, '\u215b': 0.125, '\u215c': 0.375, '\u215d': 0.625, '\u215e': 0.875 };
  // 12'-6", 12' 6", 12'6, 12'-6 1/2", 12-6, 3.5', 42", 12.5 ft, 3.65 m, 3650 mm, 365 cm
  function parse(text, opts) {
    if (text == null) return null;
    let t = String(text).trim().replace(/[\u2019\u2018\u2032`\u00b4]/g, "'").replace(/[\u201d\u201c\u2033]/g, '"').replace(/\u2013|\u2014|\u2212/g, '-').replace(/''/g, '"').replace(/\s+/g, ' ');
    for (const [k, v] of Object.entries(FRAC)) t = t.replace(k, ' ' + v);
    t = t.replace(/\b[Oo]\b/g, '0');
    let m;
    if ((m = /^(\d+(?:\.\d+)?)\s*(mm|cm|m)\.?$/i.exec(t))) { const v = +m[1], u = m[2].toLowerCase(); return (u === 'mm' ? v / 1000 : u === 'cm' ? v / 100 : v) / 0.3048; }
    if ((m = /^(\d+(?:\.\d+)?)\s*(?:ft|feet|foot)\.?$/i.exec(t))) return +m[1];
    const fraction = s => { const f = /^(\d+)\s*\/\s*(\d+)$/.exec(s.trim()); return f ? (+f[1]) / (+f[2]) : (isFinite(+s) ? +s : NaN); };
    const inches = s => { s = s.trim(); if (!s) return 0; const p = s.split(/\s+/); let v = 0; for (const q of p) { const x = fraction(q); if (!isFinite(x)) return NaN; v += x; } return v; };
    // feet and inches: 12'-6 1/2"
    if ((m = /^(\d+(?:\.\d+)?)\s*'\s*-?\s*([\d\s\/.]*?)\s*"?$/.exec(t))) { const inch = inches(m[2]); if (isFinite(inch) && inch < 12 + 1e-9) return +m[1] + inch / 12; return null; }
    // 12-6 (feet-inches written without marks), only when the inches are plausible
    if ((m = /^(\d{1,3})\s*-\s*(\d{1,2}(?:\s\d+\/\d+)?)\s*"?$/.exec(t))) { const inch = inches(m[2]); if (isFinite(inch) && inch < 12) return +m[1] + inch / 12; return null; }
    // inches only: 42"
    if ((m = /^(\d+(?:\.\d+)?)\s*"$/.exec(t))) return +m[1] / 12;
    if (opts && opts.metric && (m = /^(\d{3,5})$/.exec(t))) return (+m[1] / 1000) / 0.3048;           // a bare 3650 on a metric plan is millimetres
    return null;
  }

  // What else a reading could mean. OCR often loses the small marks (the ' - and "), so "240" may be 24'-0", and "15.0\"" may be 15'-0".
  // The first is the reading as written; the others are guesses, used only when they agree with the readings that are not guesses.
  function candidates(text, opts) {
    const out = [], first = parse(text, opts);
    if (first > 0) out.push({ feet: first, alt: false });
    const t = String(text == null ? '' : text).trim().replace(/\s+/g, '');
    let m;
    const inch = v => v >= 0 && v < 12;
    if ((m = /^(\d{1,3})\.(\d{1,2})"?$/.exec(t)) && inch(+m[2]) && +m[1] >= 1) out.push({ feet: +m[1] + +m[2] / 12, alt: true });
    if ((m = /^(\d{2,3})(\d)$/.exec(t))) out.push({ feet: +m[1] + +m[2] / 12, alt: true });
    if ((m = /^(\d{1,3})(\d{2})$/.exec(t)) && inch(+m[2]) && +m[1] >= 1) out.push({ feet: +m[1] + +m[2] / 12, alt: true });
    return out.filter((c, i) => c.feet > 0.5 && out.findIndex(d => Math.abs(d.feet - c.feet) < 1e-9) === i);
  }

  // ------------------------------------------------------------------ the dimension lines in the picture
  // Long, thin, straight lines: found the way the tracer finds bars, but thin, and joined across the gap the text sits in.
  function findLines(gray, w, h, opts) {
    const o = Object.assign({ minLen: Math.max(60, Math.round(Math.min(w, h) * 0.08)), maxGap: Math.max(80, Math.round(Math.max(w, h) * 0.06)), maxThick: 4, sens: 0.85 }, opts || {});
    const I = Tracer._internals, win = (Math.max(15, Math.round(Math.max(w, h) / 25)) | 1), ink = I.binarize(gray, w, h, win, o.sens);
    const P = { minLen: o.minLen, minT: 1, thick: 0, maxT: o.maxThick, bridge: 0 };
    const group = bars => {                                                       // pieces on one line (within 2.5 px), joined across gaps up to maxGap
      const lines = [];
      for (const b of bars.slice().sort((p, q) => p.c - q.c || p.a - q.a)) {
        const ln = lines.find(l => Math.abs(l.c - b.c) < 2.5);
        if (ln) { ln.bars.push(b); ln.c = (ln.c * ln.n + b.c * (b.b - b.a)) / (ln.n + b.b - b.a); ln.n += b.b - b.a; } else lines.push({ c: b.c, n: b.b - b.a, bars: [b] });
      }
      const out = [];
      for (const ln of lines) {
        ln.bars.sort((p, q) => p.a - q.a);
        let cur = null;
        for (const b of ln.bars) { if (cur && b.a - cur.b <= o.maxGap) cur.b = Math.max(cur.b, b.b); else { if (cur) out.push(cur); cur = { c: ln.c, a: b.a, b: b.b }; } }
        if (cur) out.push(cur);
      }
      return out.filter(l => l.b - l.a >= o.minLen);
    };
    return { h: group(I.findBars(ink, w, h, P)), v: group(I.findBars(I.transpose(ink, w, h), h, w, P)) };
  }

  // ------------------------------------------------------------------ words + lines -> scale
  function estimate(words, lines, opts) {
    const o = Object.assign({ metric: false, agree: 0.04 }, opts || {}), all = [], seen = [];
    for (let wi = 0; wi < words.length; wi++) {
      const wd = words[wi], cands = candidates(wd.text, { metric: o.metric }); if (!cands.length) continue;
      if (seen.some(q => q.text === wd.text && Math.hypot(q.cx - (wd.x0 + wd.x1) / 2, q.cy - (wd.y0 + wd.y1) / 2) < 12)) continue;       // the same text found twice (as a word and as a line)
      seen.push({ text: wd.text, cx: (wd.x0 + wd.x1) / 2, cy: (wd.y0 + wd.y1) / 2 });
      const cx = (wd.x0 + wd.x1) / 2, cy = (wd.y0 + wd.y1) / 2, th = Math.max(8, wd.vertical ? wd.x1 - wd.x0 : wd.y1 - wd.y0), tw = wd.vertical ? wd.y1 - wd.y0 : wd.x1 - wd.x0;
      const list = wd.vertical ? lines.v : lines.h, along = wd.vertical ? cy : cx, across = wd.vertical ? cx : cy;
      let best = null;
      for (const l of list) {
        const d = Math.abs(l.c - across); if (d > th * 3 + 6 || along < l.a - tw || along > l.b + tw) continue;
        if (!best || d < best.d) best = { l, d };
      }
      if (!best) continue;
      const px = best.l.b - best.l.a;
      for (const cd of cands) all.push({ text: wd.text, feet: cd.feet, px, scale: px / cd.feet, alt: cd.alt, word: wi, vertical: !!wd.vertical, at: [cx, cy] });
    }
    if (!all.length) return { scale: null, confidence: 0, used: [], all };
    // the scale most readings agree on (within 4%), weighted by how long the dimension is: a long one is measured more accurately
    let best = null;
    for (const a of all) {
      const group = all.filter(b => Math.abs(b.scale - a.scale) / a.scale <= o.agree), one = new Map();
      for (const b of group) { const cur = one.get(b.word); if (!cur || (cur.alt && !b.alt)) one.set(b.word, b); }       // a word counts once; a plain reading beats a guess
      const near = [...one.values()], weight = near.reduce((t, b) => t + (b.alt ? 0.6 : 1), 0), plain = near.filter(b => !b.alt).length, wgt = near.reduce((t, b) => t + b.feet, 0);
      if (!plain) continue;                                                      // guesses alone prove nothing
      if (!best || weight > best.weight || (weight === best.weight && wgt > best.wgt)) best = { near, weight, wgt };
    }
    if (!best) return { scale: null, confidence: 0, used: [], all };
    const sorted = best.near.map(b => b.scale).sort((p, q) => p - q), wordSet = new Set(all.map(b => b.word));
    return { scale: sorted[sorted.length >> 1], confidence: best.near.length / wordSet.size, used: best.near, all };
  }

  return { parse, candidates, findLines, estimate };
});
