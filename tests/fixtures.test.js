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
