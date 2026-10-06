const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../fixtures.js');

const close = (a, b, msg) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-6, `${msg || ''} ${JSON.stringify(a)} vs ${JSON.stringify(b)}`));

test('the catalogue creates every fixture with a footprint that matches its size', () => {
  for (const c of F.CATALOG) {
    for (const front of ['n', 'e', 's', 'w']) {
      const [W, D] = c.size, wide = front === 'n' || front === 's';
      const rect = wide ? [10, 10, 10 + W, 10 + D] : [10, 10, 10 + D, 10 + W];
      const f = F.create(c.id, front, rect);
      close(F.footprint(f), rect, `${c.id} facing ${front}`);
      assert.ok(F.editable(f), c.id + ' editable');
      assert.ok(F.describe(f), c.id + ' described');
    }
  }
});

test('turning four times comes back to where it started', () => {
  for (const c of F.CATALOG) {
    const f = F.create(c.id, 's', [4, 4, 4 + c.size[0], 4 + c.size[1]]), start = F.footprint(f).slice();
    for (let i = 0; i < 4; i++) F.spin(f);
    close(F.footprint(f), start, c.id);
    assert.equal(F.facing(f), F.facing(F.create(c.id, 's', [4, 4, 5, 5])) || null, c.id + ' facing');
  }
});

test('a quarter turn keeps the centre and swaps width and depth', () => {
  const f = F.create('base', 's', [2, 10, 5, 12]);
  F.spin(f);
  assert.equal(F.facing(f), 'w');
  const r = F.footprint(f);
  close([(r[0] + r[2]) / 2, (r[1] + r[3]) / 2], [3.5, 11]);
  close([r[2] - r[0], r[3] - r[1]], [2, 3]);
});

test('files that never said which way a fixture faces keep the old directions', () => {
  assert.equal(F.facing({ k: 'range', x: 0, y: 0, w: 2, h: 2 }), 'e');
  assert.equal(F.facing({ k: 'box', c: 'app', x: 0, y: 0, w: 2, h: 2 }), 'e');
  assert.equal(F.facing({ k: 'front', x: 0, y: 0, w: 2, h: 2 }), 'e');
  assert.equal(F.facing({ k: 'shower', x: 0, y: 0, w: 3, h: 3 }), 'n');
  assert.equal(F.facing({ k: 'toilet', cx: 1, cy: 1 }), 'w');
  assert.equal(F.facing({ k: 'box', c: 'cabB', x: 0, y: 0, w: 3, h: 2, front: 'n' }), 'n');
});

test('the frame puts the back at the back and the front at the front, whichever way it faces', () => {
  const rect = [10, 20, 13, 22];                                   // 3 wide, 2 deep when facing north or south
  for (const [front, backEdge] of [['s', [10, 20, 13, 20.2]], ['n', [10, 21.8, 13, 22]]]) {
    const fr = F.frame(F.create('base', front, rect));
    close(fr.box(0, 0, 0.2, fr.Q), backEdge, front);
    assert.equal(fr.P, 2); assert.equal(fr.Q, 3);
  }
  const rect2 = [10, 20, 12, 23];                                  // 2 deep, 3 wide when facing east or west
  for (const [front, backEdge] of [['e', [10, 20, 10.2, 23]], ['w', [11.8, 20, 12, 23]]]) {
    const fr = F.frame(F.create('base', front, rect2));
    close(fr.box(0, 0, 0.2, fr.Q), backEdge, front);
  }
});

test('resizing keeps the back edge and the middle of the width', () => {
  const f = F.create('base', 'n', [2, 10, 5, 12]);               // back edge at y = 12
  F.resize(f, 4, 2.5);
  close(F.footprint(f), [1.5, 9.5, 5.5, 12]);
  assert.equal(F.width(f), 4); assert.equal(F.depth(f), 2.5);
});

test('wall cabinets and shelves sit above floor-level fixtures', () => {
  assert.ok(F.high({ k: 'upper' }) && F.high({ k: 'shelf' }) && !F.high({ k: 'box' }));
});

test('a toilet is a fixed size and turns about its own centre', () => {
  const t = F.create('toilet', 'e', [10, 10, 11.8, 11.2]);
  close(F.footprint(t), [10, 10, 11.8, 11.2]);
  F.spin(t);
  assert.equal(t.dir, 's');
  const r = F.footprint(t);
  close([r[2] - r[0], r[3] - r[1]], [1.2, 1.8]);
});

test('the newer catalogue entries are named, sized and kept apart by layer', () => {
  const ids = F.CATALOG.map(c => c.id);
  for (const id of ['cornerbase', 'cornerupper', 'pantry', 'sink', 'dishwasher', 'range2', 'vanity2', 'ftub']) assert.ok(ids.includes(id), id);
  const name = id => F.describe(F.create(id, 's', [0, 0, 5, 3]));
  assert.equal(name('dishwasher'), 'Dishwasher');
  assert.equal(name('range2'), 'Range');
  assert.equal(name('range'), 'Range + microwave');
  assert.equal(name('pantry'), 'Pantry cabinet');
  assert.equal(name('ftub'), 'Freestanding tub');
  // a drop-in sink sits on a counter, so it does not collide with the base cabinet under it
  assert.notEqual(F.layer(F.create('sink', 's', [0, 0, 2, 1])), F.layer(F.create('base', 's', [0, 0, 2, 1])));
  assert.equal(F.layer(F.create('upper', 's', [0, 0, 2, 1])), 1);
  // a freestanding tub is an oval with no front, and resizing changes its radii
  const t = F.create('ftub', 'e', [0, 0, 5.5, 2.8]);
  assert.equal(F.facing(t), null);
  assert.deepEqual(F.footprint(t), [0, 0, 5.5, 2.8]);
  F.resize(t, 6, 3); assert.deepEqual(F.footprint(t), [0, 0, 6, 3]);
});

test('a rectangular fixture can be turned about its centre, to sit square to an angled wall', () => {
  const f = F.create('base', 's', [0, 0, 4, 2]);
  assert.equal(F.rotatable(f), true);
  assert.deepEqual(F.bounds(f), [0, 0, 4, 2], 'not turned: its footprint');
  f.rot = 90;
  const o = F.outline(f), c = [2, 1];
  for (const q of o) assert.ok(Math.abs(Math.hypot(q[0] - c[0], q[1] - c[1]) - Math.hypot(2, 1)) < 1e-9, 'corners stay the same distance from the centre');
  const b = F.bounds(f);
  close(b, [1, -1, 3, 3], 'a quarter turn swaps width and depth about the centre');
  assert.deepEqual(F.footprint(f), [0, 0, 4, 2], 'footprint is the rectangle before the turn, so moving and resizing work as before');
  f.rot = 45;
  const d = F.bounds(f); assert.ok(Math.abs((d[2] - d[0]) - (4 + 2) / Math.SQRT2) < 1e-9);
  assert.equal(F.rotatable(F.create('toilet', 'w', [0, 0, 1.8, 1.2])), false, 'a toilet is turned with its direction, not a free angle');
});
