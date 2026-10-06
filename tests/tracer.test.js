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
