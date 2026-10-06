// Reading the scale from dimension text: the text -> feet parser, finding dimension lines in a picture, and matching the two.
// (The OCR that turns pixels into text is a separate engine the page loads on request; here its words are given.)
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../dimensions.js');

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('dimension text is read as feet: feet and inches, fractions, inches alone, feet alone, metric', () => {
  close(D.parse("12'-6\""), 12.5); close(D.parse("12' 6\""), 12.5); close(D.parse("12'6"), 12.5); close(D.parse("28'-0\""), 28);
  close(D.parse("10' - 2\""), 10 + 2 / 12); close(D.parse("12'-6 1/2\""), 12 + 6.5 / 12); close(D.parse("12'-6½\""), 12 + 6.5 / 12);
  close(D.parse("3.5'"), 3.5); close(D.parse('42"'), 3.5); close(D.parse('12.5 ft'), 12.5);
  close(D.parse('3.65 m'), 3.65 / 0.3048); close(D.parse('3650 mm'), 3.65 / 0.3048); close(D.parse('365 cm'), 3.65 / 0.3048);
  close(D.parse("12’-6”"), 12.5, 1e-9);                                  // typographic quotes
});

test('text that is not a length is refused', () => {
  for (const t of ['KITCHEN', 'BEDROOM 1', '', null, "12'-13\"", '3/4', 'N', "A-101", '12']) assert.equal(D.parse(t), null, String(t));
  assert.equal(D.parse('3650'), null, 'a bare number is not a length unless the plan is metric');
  close(D.parse('3650', { metric: true }), 3.65 / 0.3048);
});

// a white picture with thin dark lines: a dimension line with its end ticks, with a gap where the text sits
function picture(w, h, draw) {
  const g = new Uint8ClampedArray(w * h).fill(250);
  draw({ hline: (y, x0, x1, th = 1) => { for (let k = 0; k < th; k++) for (let x = x0; x <= x1; x++) g[(y + k) * w + x] = 30; }, vline: (x, y0, y1, th = 1) => { for (let k = 0; k < th; k++) for (let y = y0; y <= y1; y++) g[y * w + x + k] = 30; } });
  return g;
}

test('dimension lines are found, and joined across the gap the text leaves', () => {
  const w = 700, h = 500;
  const g = picture(w, h, d => { d.hline(100, 100, 280); d.hline(100, 360, 560); d.vline(100, 90, 110); d.vline(560, 90, 110); d.vline(60, 150, 450); d.hline(450, 50, 70); });
  const L = D.findLines(g, w, h);
  assert.equal(L.h.length, 1, JSON.stringify(L.h)); assert.ok(Math.abs(L.h[0].a - 100) <= 2 && Math.abs(L.h[0].b - 561) <= 3, 'the two pieces are one line: ' + JSON.stringify(L.h[0]));
  assert.equal(L.v.length, 1); assert.ok(Math.abs(L.v[0].a - 150) <= 2 && Math.abs(L.v[0].b - 451) <= 3);
});

test('the scale is the pixels along a dimension line divided by the feet its text says', () => {
  const w = 700, h = 500, ppf = 18;
  // 459 px along the top line = 25'-6" at 18 px/ft, with a gap in the middle where the text sits; 300 px down the side = 16'-8"
  const g = picture(w, h, d => { d.hline(100, 100, 100 + 209); d.hline(100, 100 + 249, 100 + 459); d.vline(60, 150, 150 + 300); });
  const lines = D.findLines(g, w, h);
  const words = [{ text: "25'-6\"", x0: 280, y0: 88, x1: 330, y1: 108 }, { text: "16'-8\"", x0: 40, y0: 270, x1: 58, y1: 330, vertical: true }, { text: 'KITCHEN', x0: 300, y0: 300, x1: 380, y1: 320 }];
  const r = D.estimate(words, lines);
  assert.ok(Math.abs(r.scale - ppf) / ppf < 0.02, 'scale ' + r.scale);
  assert.equal(r.used.length, 2); assert.equal(r.all.length, 2, 'room names are not dimensions');
  assert.ok(r.confidence > 0.99);
});

test('a reading that disagrees with the others is left out; with no dimension text there is no scale', () => {
  const lines = { h: [{ c: 100, a: 100, b: 460 }, { c: 200, a: 100, b: 280 }, { c: 300, a: 100, b: 400 }], v: [] };
  const words = [{ text: "20'-0\"", x0: 250, y0: 90, x1: 300, y1: 108 }, { text: "10'-0\"", x0: 170, y0: 190, x1: 210, y1: 208 }, { text: "30'-0\"", x0: 230, y0: 290, x1: 280, y1: 308 }];
  const r = D.estimate(words, lines);                              // 360/20 = 18, 180/10 = 18, 300/30 = 10: the third is the odd one out
  close(r.scale, 18, 0.01); assert.equal(r.used.length, 2); assert.equal(r.all.length, 3); assert.ok(Math.abs(r.confidence - 2 / 3) < 1e-9);
  const none = D.estimate([{ text: 'BATH', x0: 0, y0: 0, x1: 10, y1: 10 }], lines);
  assert.equal(none.scale, null);
  const far = D.estimate([{ text: "20'-0\"", x0: 250, y0: 400, x1: 300, y1: 418 }], lines);
  assert.equal(far.scale, null, 'text far from any line labels nothing');
});

test('OCR often loses the small marks: "240" may be 24\'-0", "15.0\\"" may be 15\'-0"; such guesses count only beside a plain reading', () => {
  const C = D.candidates;
  assert.deepEqual(C("40'-0\"").map(c => c.feet), [40]);
  assert.ok(C('240').some(c => c.alt && Math.abs(c.feet - 24) < 1e-9));
  assert.ok(C('15.0"').some(c => c.alt && Math.abs(c.feet - 15) < 1e-9) && C('15.0"').some(c => !c.alt && Math.abs(c.feet - 15 / 12) < 1e-9));
  assert.ok(C('1206').some(c => c.alt && Math.abs(c.feet - 12.5) < 1e-9));
  assert.deepEqual(C('KITCHEN'), []);
  const lines = { h: [{ c: 100, a: 100, b: 900 }, { c: 200, a: 100, b: 400 }], v: [{ c: 60, a: 100, b: 580 }] };
  const words = [{ text: '40-0"', x0: 480, y0: 90, x1: 520, y1: 108 }, { text: '15.0"', x0: 230, y0: 190, x1: 270, y1: 208 }, { text: '240', x0: 44, y0: 330, x1: 58, y1: 360, vertical: true }];
  const r = D.estimate(words, lines);                              // 800/40 = 20, 300/15 = 20 (the guess), 480/24 = 20 (the guess)
  assert.ok(Math.abs(r.scale - 20) < 0.01, String(r.scale)); assert.equal(r.used.length, 3);
  const lone = D.estimate([{ text: '240', x0: 44, y0: 330, x1: 58, y1: 360, vertical: true }], lines);
  assert.equal(lone.scale, null, 'a guess with nothing to back it up gives no scale');
  const dup = D.estimate([{ text: '40-0"', x0: 480, y0: 90, x1: 520, y1: 108 }, { text: '40-0"', x0: 482, y0: 91, x1: 521, y1: 108 }], lines);
  assert.equal(dup.used.length, 1, 'the same text found as a word and as a line counts once');
});
