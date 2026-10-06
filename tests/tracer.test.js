// The assisted tracer, tested against blueprints drawn from the shipped houses (with noise, uneven light and a tilt),
// so a change that makes it miss walls, invent walls or lose the tilt fails here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Tracer = require('../tracer.js');
const { drawBlueprint, rotate, score } = require('./helpers/blueprint.js');

const house = id => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'houses', id, 'house.json'), 'utf8'));
const run = (id, opts, detectOpts) => {
  const bp = drawBlueprint(house(id), opts);
  const found = Tracer.detect(bp.gray, bp.w, bp.h, bp.ppf, detectOpts);
  return { bp, found, s: score(found.walls, bp.house, bp.margin) };
};

for (const id of ['starter-cottage', 'waterford-4563c']) {
  test(`${id}: finds the walls of a clean scan`, () => {
    const { s, found } = run(id, { noise: 6, light: 0.1 });
    assert.ok(s.recall > 0.85, "recall " + s.recall.toFixed(3));
    assert.ok(s.precision > 0.9, 'precision ' + s.precision.toFixed(3));
    assert.ok(found.walls.length > 4);
  });

  test(`${id}: still finds them with noise and uneven lighting`, () => {
    const { s } = run(id, { noise: 22, light: 0.35, seed: 3 });
    assert.ok(s.recall > 0.88, 'recall ' + s.recall.toFixed(3));
    assert.ok(s.precision > 0.88, 'precision ' + s.precision.toFixed(3));
  });

  test(`${id}: tells outside walls from inside walls`, () => {
    const { s } = run(id, {});
    assert.ok(s.extAgreement > 0.9, 'agreement ' + s.extAgreement.toFixed(3));
  });

  test(`${id}: measures the tilt of a skewed photo, and straightening it gives the same walls`, () => {
    for (const tilt of [-3.4, 2.1]) {
      const bp = drawBlueprint(house(id), { tilt, noise: 12 });
      const sk = Tracer.estimateSkew(bp.gray, bp.w, bp.h);
      assert.ok(Math.abs(sk.angle - tilt) < 0.4, `tilt ${tilt}: measured ${sk.angle.toFixed(2)}`);
      assert.ok(sk.confidence > 0.1, 'confidence ' + sk.confidence);
      const flat = rotate(bp.gray, bp.w, bp.h, -sk.angle);                          // what the editor does by rotating the underlay
      const found = Tracer.detect(flat, bp.w, bp.h, bp.ppf);
      const s = score(found.walls, bp.house, bp.margin);
      assert.ok(s.recall > 0.85 && s.precision > 0.85, `tilt ${tilt}: recall ${s.recall.toFixed(2)} precision ${s.precision.toFixed(2)}`);
    }
  });
}

test('gaps in walls become doors and windows, and the walls stay in one piece', () => {
  const { found, bp } = run('starter-cottage', {});
  const total = found.walls.reduce((t, w) => t + w.openings.length, 0);
  const truth = bp.house.walls.reduce((t, w) => t + (w.openings || []).filter(o => o.type === 'door' || o.type === 'window').length, 0);
  assert.ok(total >= truth * 0.6 && total <= truth * 1.4, `found ${total} gaps for ${truth} openings`);
  for (const w of found.walls) for (const o of w.openings) { assert.ok(o.b > o.a && o.a >= w.a - 0.01 && o.b <= w.b + 0.01, 'opening inside its wall'); assert.ok(['door', 'window', 'cased'].includes(o.type)); }
});

test('walls are on exact centre lines and meet at corners', () => {
  const { found } = run('starter-cottage', {});
  const ext = found.walls.filter(w => w.ext);
  assert.ok(ext.length >= 4, 'outside walls ' + ext.length);
  // every wall end is on another wall's centre line, or is a free end (at most a few of those in this house)
  let loose = 0;
  for (const w of found.walls) for (const end of ['a', 'b']) {
    const touches = found.walls.some(p => p !== w && p.axis !== w.axis && Math.abs(w[end] - p.c) < 0.02 && w.c >= p.a - 0.7 && w.c <= p.b + 0.7);
    if (!touches) loose++;
  }
  assert.ok(loose <= 4, loose + ' loose ends');
});

test('drawn marks that are not walls are left alone: dimension lines, text, fixture outlines (even when a soft camera smears them)', () => {
  const { found, bp } = run('starter-cottage', { blur: 1, noise: 14 });
  const margin = bp.margin;
  for (const w of found.walls) {                                                    // nothing outside the house's own bounds
    const lo = -0.6 + margin, hiX = bp.house.W + 0.6 + margin, hiY = bp.house.D + 0.6 + margin;
    const x0 = w.axis === 'h' ? w.a : w.c, x1 = w.axis === 'h' ? w.b : w.c, y0 = w.axis === 'h' ? w.c : w.a, y1 = w.axis === 'h' ? w.c : w.b;
    assert.ok(x0 >= lo && y0 >= lo && x1 <= hiX && y1 <= hiY, `wall outside the house: ${JSON.stringify(w)}`);
  }
});

test('the three styles: outlined (double-line) walls are found, and a blank page finds nothing', () => {
  const { s } = run('starter-cottage', { outlined: true, noise: 8 }, { style: 'outlined' });
  assert.ok(s.recall > 0.9 && s.precision > 0.8, `outlined: recall ${s.recall.toFixed(2)} precision ${s.precision.toFixed(2)}`);
  const blank = new Uint8ClampedArray(400 * 300).fill(240);
  assert.equal(Tracer.detect(blank, 400, 300, 10).walls.length, 0);
  assert.deepEqual(Tracer.estimateSkew(blank, 400, 300).angle, 0);
});

test('a soft, blurred photo still gives the walls, and thin smeared lines do not become walls', () => {
  for (const id of ['starter-cottage', 'waterford-4563c']) {
    const { s, found, bp } = run(id, { blur: 1, noise: 18, light: 0.3 });
    assert.ok(s.recall > 0.85 && s.precision > 0.85, `${id}: recall ${s.recall.toFixed(2)} precision ${s.precision.toFixed(2)}`);
    for (const w of found.walls) assert.ok((w.axis === 'h' ? w.c : w.c) >= bp.margin - 0.7, 'a wall left of / above the house: ' + JSON.stringify(w));
  }
});

test('a wide window in an outside wall stays one wall with an opening, so the house is closed', () => {
  const { found, bp } = run('waterford-4563c', {});
  const south = found.walls.filter(w => w.axis === 'h' && w.ext && Math.abs(w.c - (bp.house.D - 0.25 + bp.margin)) < 0.6);
  assert.equal(south.length, 1, 'south wall pieces: ' + south.length);
  assert.ok(south[0].b - south[0].a > bp.house.W - 2, 'south wall length ' + (south[0].b - south[0].a));
  assert.ok(south[0].openings.some(o => o.b - o.a > 7), 'the 8 ft living-room window is an opening');
});

// ------------------------------------------------------------------ angled walls and door symbols
const angledHouse = () => ({
  format: 'house-painter/house', version: 1, id: 'angles', name: 'Angles', W: 36, D: 24, wallThickness: { exterior: 0.5, interior: 0.33 },
  walls: [
    { line: [0, 0, 28, 0], ext: 1 }, { line: [28, 0, 36, 8], ext: 1, openings: [{ a: 3, b: 6, type: 'door', hinge: 'a', swing: 'r' }] },
    { line: [36, 8, 36, 24], ext: 1 }, { line: [36, 24, 0, 24], ext: 1 }, { line: [0, 24, 0, 0], ext: 1 },
    { line: [14, 24, 22, 8], t: 0.33, openings: [{ a: 4.2, b: 7.2, type: 'cased' }] }, { line: [0, 12, 12, 12], t: 0.33 }
  ],
  rooms: [{ id: 'all', name: 'All', rects: [[0, 0, 36, 24]] }]
});

test('walls at an angle are found: a cut corner and a diagonal partition', () => {
  const { found, s, bp } = (() => { const bp = drawBlueprint(angledHouse(), { noise: 8, light: 0.15 }); const found = Tracer.detect(bp.gray, bp.w, bp.h, bp.ppf); return { bp, found, s: score(found.walls, bp.house, bp.margin) }; })();
  const slants = found.walls.filter(w => w.axis === 'l');
  assert.equal(slants.length, 2, 'angled walls: ' + JSON.stringify(slants.map(w => w.p)));
  const near = (w, p) => { const q = w.p.map(v => v - bp.margin); return Math.min(Math.hypot(q[0] - p[0], q[1] - p[1]) + Math.hypot(q[2] - p[2], q[3] - p[3]), Math.hypot(q[0] - p[2], q[1] - p[3]) + Math.hypot(q[2] - p[0], q[3] - p[1])); };
  assert.ok(slants.some(w => near(w, [28, 0, 36, 8]) < 1.0 && w.ext), 'the cut corner, as an outside wall');
  assert.ok(slants.some(w => near(w, [14, 24, 22, 8]) < 1.0 && !w.ext), 'the partition, as an inside wall');
  assert.ok(s.recall > 0.9 && s.precision > 0.88, `recall ${s.recall.toFixed(2)} precision ${s.precision.toFixed(2)}`);
  assert.ok(s.extAgreement > 0.95, 'outside agreement ' + s.extAgreement.toFixed(3));
  const door = slants.find(w => w.ext).openings;
  assert.equal(door.length, 1);
});

test('no angled walls are invented on houses that have none', () => {
  for (const id of ['starter-cottage', 'waterford-4563c']) {
    for (const opts of [{}, { noise: 20, light: 0.3, blur: 1 }]) {
      const { found } = run(id, opts);
      assert.equal(found.walls.filter(w => w.axis === 'l').length, 0, id + ' ' + JSON.stringify(opts));
    }
  }
});

test('angled walls can be switched off', () => {
  const bp = drawBlueprint(angledHouse(), { noise: 6 });
  const found = Tracer.detect(bp.gray, bp.w, bp.h, bp.ppf, { angled: false });
  assert.equal(found.walls.filter(w => w.axis === 'l').length, 0);
});

test('doors are told from windows by their swing arcs, with the hinge and the side they swing to', () => {
  const bp = drawBlueprint(house('waterford-4563c'), { noise: 8, light: 0.15 });
  const found = Tracer.detect(bp.gray, bp.w, bp.h, bp.ppf);
  let doors = 0, right = 0, windows = 0, winRight = 0;
  for (const q of bp.house.walls) {
    const horiz = (q.x1 - q.x0) >= (q.y1 - q.y0), c = horiz ? (q.y0 + q.y1) / 2 : (q.x0 + q.x1) / 2;
    const w = found.walls.find(x => x.axis === (horiz ? 'h' : 'v') && Math.abs(x.c - (c + bp.margin)) < 0.4 && x.a <= (horiz ? q.x0 : q.y0) + bp.margin + 0.5 && x.b >= (horiz ? q.x1 : q.y1) + bp.margin - 0.5);
    if (!w) continue;
    for (const o of q.openings || []) {
      const f = w.openings.find(g => Math.abs(g.a - (o.a + bp.margin)) < 0.6 && Math.abs(g.b - (o.b + bp.margin)) < 0.6);
      if (!f) continue;
      if (o.type === 'door' && !q.ext) { doors++; if (f.type === 'door' && f.hinge === (o.hinge || 'a') && f.swing === o.swing) right++; }
      if (o.type === 'window') { windows++; if (f.type === 'window') winRight++; }
    }
  }
  assert.ok(doors >= 5 && right / doors >= 0.8, `doors with the right hinge and swing: ${right} of ${doors}`);
  assert.ok(windows >= 3 && winRight / windows >= 0.9, `windows: ${winRight} of ${windows}`);
});

// ------------------------------------------------------------------ a mask from a learned model
test('a ready-made wall mask is used instead of looking for dark ink, and door and window masks type the gaps', () => {
  const bp = drawBlueprint(house('starter-cottage'), { noise: 8, light: 0.15 });
  const ppf = bp.ppf, I = Tracer._internals;
  const ink = I.binarize(bp.gray, bp.w, bp.h, Math.max(15, Math.round(1.2 * ppf * 3)) | 1, 0.8);
  const base = Tracer.detect(bp.gray, bp.w, bp.h, ppf), withMask = Tracer.detect(bp.gray, bp.w, bp.h, ppf, { ink });
  const sBase = score(base.walls, bp.house, bp.margin), sMask = score(withMask.walls, bp.house, bp.margin);
  assert.ok(sMask.recall > 0.8 && sMask.precision > 0.85, `recall ${sMask.recall.toFixed(2)} precision ${sMask.precision.toFixed(2)} (without: ${sBase.recall.toFixed(2)} ${sBase.precision.toFixed(2)})`);
  // mark every gap as a window, then as a door: the types follow
  const mk = type => { const m = new Uint8Array(bp.w * bp.h); for (const wl of base.walls) for (const q of wl.openings) {
    const hz = wl.axis === 'h', r = hz ? [q.a, wl.c - wl.t / 2, q.b, wl.c + wl.t / 2] : [wl.c - wl.t / 2, q.a, wl.c + wl.t / 2, q.b];
    for (let y = Math.floor(r[1] * ppf); y < Math.ceil(r[3] * ppf); y++) for (let x = Math.floor(r[0] * ppf); x < Math.ceil(r[2] * ppf); x++) m[y * bp.w + x] = 1; } return m; };
  const asWin = Tracer.detect(bp.gray, bp.w, bp.h, ppf, { windows: mk(), symbols: false }), asDoor = Tracer.detect(bp.gray, bp.w, bp.h, ppf, { doors: mk(), symbols: false });
  assert.ok(asWin.walls.flatMap(w => w.openings).every(o => o.type === 'window'));
  assert.ok(asDoor.walls.flatMap(w => w.openings).every(o => o.type === 'door'));
});
