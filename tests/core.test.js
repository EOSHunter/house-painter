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

// ---------------------------------------------------------------------------------------------- angled walls
const bay = () => load('bay-cottage');

test('angled walls: validation checks line walls and room outlines', () => {
  const ok = bay(); assert.deepEqual(HouseCore.validate(ok), []);
  const short = bay(); short.walls[0].line = [0, 0, 0.1, 0];
  assert.ok(HouseCore.validate(short).some(p => /Wall 0/.test(p)), 'a wall under half a foot is refused');
  const bad = bay(); bad.walls[1].line = [26, 0, 32];
  assert.ok(HouseCore.validate(bad).some(p => /Wall 1/.test(p)));
  const op = bay(); op.walls[1].openings = [{ a: 2, b: 50, type: 'door' }];
  assert.ok(HouseCore.validate(op).some(p => /Wall 1/.test(p)), 'an opening has to lie along the wall');
  const poly = bay(); poly.rooms[2].polys = [[[0, 0], [5, 5]]];
  assert.ok(HouseCore.validate(poly).some(p => /Room 2/.test(p)), 'an outline needs three points');
});

test('angled walls: a line wall that runs along an axis is the same wall as a plain one', () => {
  const a = box(), b = box();
  b.walls[0] = { line: [0, 0.25, 20, 0.25], t: 0.5, ext: 1, openings: a.walls[0].openings };
  const A = HouseCore.build(a).ROOMS, B = HouseCore.build(b).ROOMS;
  assert.equal(HouseCore.build(b).HOUSE.slants.length, 0);
  assert.deepEqual(B.surfaces.map(s => [s.id, s.area]), A.surfaces.map(s => [s.id, s.area]));
});

test('angled walls: the corner is mitred so two walls at an angle close up with no gap', () => {
  const { HOUSE } = HouseCore.build(bay());
  assert.equal(HOUSE.slants.length, 3);
  const cut = HOUSE.slants.find(s => s.id === 'entry-cut');
  assert.ok(Math.abs(cut.len - Math.hypot(6, 6)) < 1e-6);
  // a 0.5 ft wall meeting a 0.5 ft wall at 45 degrees: each runs on past the line by (t/2)/tan + (t/2)/sin of the turn, less the far wall's own half
  assert.ok(cut.e0 > 0.05 && cut.e0 < 0.2 && Math.abs(cut.e0 - cut.e1) < 1e-6, [cut.e0, cut.e1].join());
});

test('angled walls: rooms follow the outline, and what is outside the angled corner is outside', () => {
  const { ROOMS } = HouseCore.build(bay());
  assert.equal(ROOMS.roomAt(5, 5), 'bedroom');
  assert.equal(ROOMS.roomAt(28, 10), 'living');
  assert.equal(ROOMS.roomAt(15, 5), 'bath');
  assert.equal(ROOMS.roomAt(31.5, 0.5), 'exterior', 'the corner the cut removed');
  assert.equal(ROOMS.roomAt(15, 23.5), 'living', 'inside the bay');
  assert.equal(ROOMS.roomAt(11, 23.8), 'exterior', 'beside the bay');
  assert.equal(ROOMS.roomAt(29, 2.9), null, 'inside the angled wall itself');
});

test('angled walls: every face is a surface named by compass, with no slivers', () => {
  const { ROOMS } = HouseCore.build(bay());
  const slant = ROOMS.surfaces.filter(s => s.slant !== undefined);
  assert.deepEqual(slant.map(s => s.id).sort(), ['EXT-NE', 'EXT-NW', 'EXT-SW', 'LIV-NE', 'LIV-SE', 'LIV-SW']);
  for (const s of ROOMS.surfaces) assert.ok(s.length > 0.3, `${s.id} is ${s.length} ft long`);
  const ne = slant.find(s => s.id === 'LIV-NE');
  assert.ok(Math.abs(ne.length - 8.49) < 0.3, 'length ' + ne.length);
  // the door in the cut corner is 3 ft wide and 6.833 ft tall
  assert.ok(Math.abs(ne.area - (ne.length * 9 - 3 * 6.833)) < 0.6, 'area ' + ne.area);
});

test('angled walls: drawing a line the other way round changes nothing', () => {
  const flip = bay();
  const w = flip.walls[1], len = Math.hypot(6, 6);
  flip.walls[1] = { ...w, line: [32, 6, 26, 0], openings: [{ a: len - 5.7, b: len - 2.7, type: 'door', hinge: 'b', swing: 'l' }] };
  const A = HouseCore.build(bay()).ROOMS.surfaces.map(s => [s.id, s.length, s.area]);
  const B = HouseCore.build(flip).ROOMS.surfaces.map(s => [s.id, s.length, s.area]);
  assert.deepEqual(B, A);
});

test('angled walls: the Blender export carries the angled walls', () => {
  const { HOUSE, ROOMS } = HouseCore.build(bay());
  const b = HouseCore.forBlender(HOUSE, ROOMS);
  assert.equal(b.slants.length, 3);
  assert.ok(b.surfaces.some(s => s.slant !== undefined));
});

// ---------------------------------------------------------------------------------------------- ceilings
const cabin = () => load('vaulted-cabin');

test('ceilings: a room can have its own height, a shed ceiling or a vault, and the file says so plainly', () => {
  assert.deepEqual(HouseCore.validate(cabin()), []);
  const bad = cabin(); bad.rooms[0].ceiling = { type: 'dome' };
  assert.ok(HouseCore.validate(bad).some(p => /Room 0/.test(p)));
  const low = cabin(); low.rooms[0].ceiling = 1;
  assert.ok(HouseCore.validate(low).some(p => /between 3 and 40/.test(p)));
  const shed = cabin(); shed.rooms[0].ceiling = { type: 'shed', low: 8 };
  assert.ok(HouseCore.validate(shed).some(p => /shed/.test(p)));
  const vault = cabin(); vault.rooms[0].ceiling = { type: 'vault', eave: 8, peak: 12, ridge: 'z' };
  assert.ok(HouseCore.validate(vault).some(p => /vault/.test(p)));
});

test('ceilings: a house with none of them is exactly as before (every room flat at the house height)', () => {
  const { ROOMS, HOUSE } = HouseCore.build(load('starter-cottage'));
  for (const r of ROOMS.rooms) assert.deepEqual(r.ceiling, { type: 'flat', h: HOUSE.heights.ceiling });
  assert.ok(HOUSE.walls.every(w => !w.tops), 'no wall tops are worked out when nothing needs them');
  assert.equal(ROOMS.ceilingMax, HOUSE.heights.ceiling);
});

test('ceilings: height at a point follows the room (flat, shed, vault)', () => {
  const { ROOMS } = HouseCore.build(cabin());
  const liv = ROOMS.byId.living.ceiling, bb = liv.bbox, mid = (bb[1] + bb[3]) / 2;
  assert.equal(liv.type, 'vault');
  assert.ok(Math.abs(ROOMS.ceilingAt('living', 10, mid) - 13) < 1e-6, 'the ridge is the peak');
  assert.ok(Math.abs(ROOMS.ceilingAt('living', 10, bb[1]) - 8) < 1e-6, 'the eave');
  assert.ok(Math.abs(ROOMS.ceilingAt('living', 10, (bb[1] + mid) / 2) - 10.5) < 1e-6, 'halfway up the slope');
  const bed = ROOMS.byId.bed1.ceiling, bx = bed.bbox;
  assert.ok(Math.abs(ROOMS.ceilingAt('bed1', bx[0], 5) - 8) < 1e-6 && Math.abs(ROOMS.ceilingAt('bed1', bx[2], 5) - 10.5) < 1e-6, 'a shed ceiling rises to the east');
  assert.equal(ROOMS.ceilingAt('bed2', 30, 20), 9);
  assert.equal(ROOMS.ceilingMax, 13);
});

test('ceilings: wall areas follow the height, so a vaulted room has more wall to paint than a flat one', () => {
  const house = c => { const h = load('starter-cottage'); h.rooms.find(r => r.id === 'living').ceiling = c; return h; };
  const area = (R, id) => R.surfaces.filter(s => s.room === id).reduce((t, s) => t + s.area, 0);
  const at8 = HouseCore.build(house(8)).ROOMS, at10 = HouseCore.build(house(10)).ROOMS, vault = HouseCore.build(house({ type: 'vault', eave: 8, peak: 13, ridge: 'x' })).ROOMS;
  assert.ok(Math.abs(area(at10, 'living') / area(at8, 'living') - 1.25) < 0.02 || area(at10, 'living') > area(at8, 'living'), 'a taller flat room has more wall');
  assert.ok(area(vault, 'living') > area(at8, 'living') * 1.2, `${area(vault, 'living')} vs ${area(at8, 'living')}`);
  assert.ok(area(vault, 'living') < area(at10, 'living') * 1.2);
  // other rooms are untouched by it
  assert.equal(area(vault, 'bed1'), area(at8, 'bed1'));
});

test('ceilings: each wall carries the pieces of its top, and a gable wall peaks at the ridge', () => {
  const { HOUSE, ROOMS } = HouseCore.build(cabin());
  const mid = (ROOMS.byId.living.ceiling.bbox[1] + ROOMS.byId.living.ceiling.bbox[3]) / 2;
  const withTops = HOUSE.walls.filter(w => w.tops);
  assert.ok(withTops.length > 0);
  // find a wall whose top reaches the ridge height, at the ridge
  const peak = withTops.flatMap(w => w.tops).find(q => Math.abs(q.a - mid) < 1e-2 || Math.abs(q.b - mid) < 1e-2);
  assert.ok(peak, 'a piece starts or ends at the ridge');
  for (const w of withTops) for (let i = 1; i < w.tops.length; i++) assert.ok(Math.abs(w.tops[i].a - w.tops[i - 1].b) < 1e-6, 'the pieces run on from each other');
  const max = Math.max(...withTops.flatMap(w => w.tops.flatMap(q => [q.za, q.zb])));
  assert.ok(Math.abs(max - 13) < 0.02, 'tallest wall point ' + max);
});

test('ceilings: the Blender export carries them', () => {
  const { HOUSE, ROOMS } = HouseCore.build(cabin());
  const b = HouseCore.forBlender(HOUSE, ROOMS);
  assert.equal(b.ceilingMax, 13);
  assert.equal(b.rooms.find(r => r.id === 'living').ceiling.type, 'vault');
  assert.ok(b.walls.some(w => w.tops));
});
