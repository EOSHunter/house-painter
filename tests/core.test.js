// The core turns a house file into walls, rooms and paint surfaces. Surface IDs (like "BR1-N") are what saved schemes
// refer to, so for each shipped house they are locked by a snapshot: if one changes, the test fails and shows which.
// After a change you meant to make:  UPDATE_SNAPSHOTS=1 npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const HouseCore = require('../house-core.js');

const ROOT = path.join(__dirname, '..');
const houseIds = fs.readdirSync(path.join(ROOT, 'houses')).filter(d => fs.existsSync(path.join(ROOT, 'houses', d, 'house.json')));
const load = id => JSON.parse(fs.readFileSync(path.join(ROOT, 'houses', id, 'house.json'), 'utf8'));
const clone = o => JSON.parse(JSON.stringify(o));

function matchSnapshot(name, data) {
  const file = path.join(__dirname, 'snapshots', name + '.json');
  if (process.env.UPDATE_SNAPSHOTS) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 1) + '\n'); return; }
  assert.ok(fs.existsSync(file), `no snapshot for ${name}: run UPDATE_SNAPSHOTS=1 npm test`);
  assert.deepEqual(clone(data), JSON.parse(fs.readFileSync(file, 'utf8')));
}

test('there is at least one house to test', () => assert.ok(houseIds.length >= 2, houseIds.join()));

for (const id of houseIds) {
  test(`${id}: the file is valid`, () => assert.deepEqual(HouseCore.validate(load(id)), []));

  test(`${id}: surfaces, rooms and areas match the snapshot`, () => {
    const { HOUSE, ROOMS } = HouseCore.build(load(id));
    matchSnapshot(id, {
      size: [HOUSE.W, HOUSE.D],
      surfaces: ROOMS.surfaces.map(s => [s.id, s.room, s.kind, s.side, s.a, s.b, s.area]),
      rooms: ROOMS.rooms.map(r => [r.id, r.area, r.wallArea, r.shape]),
      start: HOUSE.start
    });
  });

  test(`${id}: every surface id is unique and every room has walls`, () => {
    const { ROOMS } = HouseCore.build(load(id));
    const ids = ROOMS.surfaces.map(s => s.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate surface ids');
    for (const r of ROOMS.rooms) assert.ok(ROOMS.surfaces.some(s => s.room === r.id), `room ${r.id} has no wall surfaces`);
  });

  test(`${id}: the walkthrough starts inside a room`, () => {
    const { HOUSE, ROOMS } = HouseCore.build(load(id));
    const r = ROOMS.roomAt(HOUSE.start.x, HOUSE.start.y);
    assert.ok(r && r !== 'exterior', `start ${JSON.stringify(HOUSE.start)} is in ${r}`);
  });

  test(`${id}: building does not change the file it was given`, () => {
    const src = load(id), before = JSON.stringify(src);
    HouseCore.build(src);
    assert.equal(JSON.stringify(src), before);
  });

  test(`${id}: the Blender export carries everything build_house.py reads`, () => {
    const { HOUSE, ROOMS } = HouseCore.build(load(id));
    const b = HouseCore.forBlender(HOUSE, ROOMS);
    assert.equal(b.format, 'house-painter/built-house');
    for (const k of ['W', 'D', 'E', 'T', 'floor', 'walls', 'fixtures', 'items', 'surfaces', 'rooms', 'ceilingHeight']) assert.ok(k in b, 'missing ' + k);
    for (const w of b.walls) for (const o of w.openings || []) assert.ok(o.z1 > o.z0, 'opening heights resolved');
  });
}

test('validation explains what is wrong', () => {
  const problems = HouseCore.validate({ format: 'house-painter/house', W: 10, D: 10, walls: [{ x0: 0, y0: 0, x1: -1, y1: 1 }], rooms: [] });
  assert.ok(problems.some(p => /Wall 0/.test(p)), problems.join('|'));
  assert.ok(problems.some(p => /rooms/.test(p)), problems.join('|'));
  assert.ok(HouseCore.validate({}).length > 0);
  assert.ok(HouseCore.validate(null).length > 0);
  assert.throws(() => HouseCore.build({ format: 'nope' }), /problems/);
});

test('validation rejects duplicate and reserved room ids and bad openings', () => {
  const base = () => ({ format: 'house-painter/house', W: 10, D: 10, walls: [{ x0: 0, y0: 0, x1: 10, y1: 0.5, ext: 1 }], rooms: [{ id: 'a', rects: [[0, 0, 5, 5]] }] });
  const dup = base(); dup.rooms.push({ id: 'a', rects: [[5, 5, 9, 9]] });
  assert.ok(HouseCore.validate(dup).some(p => /duplicate/.test(p)));
  const res = base(); res.rooms[0].id = 'exterior';
  assert.ok(HouseCore.validate(res).some(p => /reserved/.test(p)));
  const op = base(); op.walls[0].openings = [{ a: 5, b: 3, type: 'door' }, { a: 1, b: 2, type: 'banana' }];
  assert.equal(HouseCore.validate(op).length, 2);
});

// a 20 x 12 box with one inside wall: the smallest house that exercises joinery, rooms and surfaces
function box() {
  return {
    format: 'house-painter/house', id: 'box', W: 20, D: 12, heights: { ceiling: 9 },
    walls: [
      { x0: 0, y0: 0, x1: 20, y1: 0.5, ext: 1, openings: [{ a: 3, b: 6, type: 'window', sill: 3.5 }] },
      { x0: 0, y0: 11.5, x1: 20, y1: 12, ext: 1, openings: [{ a: 4, b: 7, type: 'door', hinge: 'a', swing: 'n' }] },
      { x0: 0, y0: 0.5, x1: 0.5, y1: 11.5, ext: 1 }, { x0: 19.5, y0: 0.5, x1: 20, y1: 11.5, ext: 1 },
      { x0: 9.835, y0: 0.5, x1: 10.165, y1: 11.5, openings: [{ a: 5, b: 7.5, type: 'door', hinge: 'a', swing: 'e' }] }
    ],
    rooms: [{ id: 'left', name: 'Left', short: 'L', rects: [[0, 0, 10, 12]] }, { id: 'right', name: 'Right', short: 'R', rects: [[10, 0, 20, 12]] }]
  };
}

test('joinery: a wall that meets another stops at its face', () => {
  const { HOUSE } = HouseCore.build(box());
  const inner = HOUSE.walls[4];
  assert.ok(Math.abs(inner.y0 - 0.5) < 1e-9 && Math.abs(inner.y1 - 11.5) < 1e-9, [inner.y0, inner.y1].join());
});

test('openings get resolved heights from the house defaults and their own overrides', () => {
  const src = box(); src.walls[1].openings[0].height = 7;
  const { HOUSE } = HouseCore.build(src);
  assert.deepEqual([HOUSE.walls[0].openings[0].z0, HOUSE.walls[0].openings[0].z1], [3.5, HOUSE.heights.windowHead]);
  assert.deepEqual([HOUSE.walls[1].openings[0].z0, HOUSE.walls[1].openings[0].z1], [0, 7]);
  assert.deepEqual([HOUSE.walls[4].openings[0].z0, HOUSE.walls[4].openings[0].z1], [0, HOUSE.heights.door]);
  assert.equal(HOUSE.heights.ceiling, 9);
});

test('a box with one inside wall: two rooms, a wall surface per face, and wall area uses the ceiling height', () => {
  const { ROOMS } = HouseCore.build(box());
  const ids = ROOMS.surfaces.map(s => s.id).sort();
  assert.deepEqual(ids, ['EXT-E', 'EXT-N', 'EXT-S', 'EXT-W', 'L-E', 'L-N', 'L-S', 'L-W', 'R-E', 'R-N', 'R-S', 'R-W'].sort());
  const ln = ROOMS.surfaces.find(s => s.id === 'L-N');
  assert.ok(Math.abs(ln.length - 9.5) < 0.2, 'length ' + ln.length);
  assert.ok(Math.abs(ln.area - (ln.length * 9 - 3 * (HouseCore.build(box()).HOUSE.heights.windowHead - 3.5))) < 0.2, 'area ' + ln.area);
});

test('open-plan rooms need no wall between them: two zones, one space', () => {
  const src = box(); src.walls.pop();
  const { ROOMS } = HouseCore.build(src);
  const ids = ROOMS.surfaces.map(s => s.id);
  assert.ok(!ids.includes('L-E') && !ids.includes('R-W'), ids.join());
  assert.equal(ROOMS.roomAt(5, 6), 'left'); assert.equal(ROOMS.roomAt(15, 6), 'right');
});

test('a removed wall disappears from rooms and surfaces', () => {
  const src = box(); src.walls[4].status = 'removed';
  const { ROOMS } = HouseCore.build(src);
  assert.ok(!ROOMS.surfaces.some(s => s.id === 'L-E'));
});
