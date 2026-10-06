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

// ---------------------------------------------------------------------------------------------- curved walls
const round = () => load('round-cottage');

test('curves: an arc is worked out as a circle through its ends and its middle', () => {
  const A = HouseCore.arcInfo([0, 0, 12, 0, 3]);                       // east, bowing 3 ft to the south (the right of the way it runs)
  const R = (36 + 9) / 6, mid = A.pts[Math.floor(A.pts.length / 2)];
  assert.ok(Math.abs(A.R - R) < 1e-9, 'radius ' + A.R);
  assert.deepEqual(A.pts[0], [0, 0]); assert.deepEqual(A.pts[A.pts.length - 1], [12, 0]);
  for (const q of A.pts) assert.ok(Math.abs(Math.hypot(q[0] - A.C[0], q[1] - A.C[1]) - R) < 1e-6, 'every point is on the circle');
  assert.ok(Math.abs(A.C[0] - 6) < 1e-9 && A.C[1] < 0, 'the centre is on the other side');
  assert.ok(A.pts.some(q => Math.abs(q[0] - 6) < 1e-6 && Math.abs(q[1] - 3) < 1e-6) || mid[1] > 2, 'the middle bows to the right');
  assert.ok(Math.abs(A.length - A.R * A.sweep) < 1e-9 && A.n >= 2);
  assert.equal(HouseCore.arcInfo([0, 0, 12, 0, 0]).straight, true);
  const half = HouseCore.arcInfo([0, 0, 12, 0, -6]);                    // a half circle, bowing north
  assert.ok(Math.abs(half.sweep - Math.PI) < 1e-9 && half.pts.every(q => q[1] <= 1e-9));
});

test('curves: validation explains a bad arc', () => {
  const bad = (arc, re) => { const h = round(); h.walls[1].arc = arc; assert.ok(HouseCore.validate(h).some(p => re.test(p)), JSON.stringify(arc)); };
  bad([26, 0, 32, 6], /arc/); bad([26, 0, 26.1, 0, 0], /half a foot/); bad([26, 0, 32, 6, 20], /half its chord/);
  const op = round(); op.walls[1].openings = [{ a: 1, b: 40, type: 'window' }];
  assert.ok(HouseCore.validate(op).some(p => /Wall 1, opening 0/.test(p)));
  assert.deepEqual(HouseCore.validate(round()), []);
});

test('curves: a curved wall is a run of short straight ones, closed up, and the plan is as big as everything in it', () => {
  const { HOUSE } = HouseCore.build(round());
  const bay = HOUSE.slants.filter(S => S.arc === 1);
  assert.ok(bay.length >= 7, 'facets ' + bay.length);
  for (let i = 1; i < bay.length; i++) assert.ok(Math.hypot(bay[i].p0[0] - bay[i - 1].p1[0], bay[i].p0[1] - bay[i - 1].p1[1]) < 0.2, 'facets meet end to end');
  assert.ok(HOUSE.D > 25.5 && HOUSE.D < 26.5, 'depth ' + HOUSE.D);                  // the bay stands out past the 22 ft the file gives
});

test('curves: each face of a curve is one paint surface, however many facets it has', () => {
  const { ROOMS } = HouseCore.build(round());
  const curved = ROOMS.surfaces.filter(s => s.parts);
  assert.deepEqual(curved.map(s => s.id).sort(), ['EXT-C1', 'EXT-C2', 'LIV-C1', 'LIV-C2']);
  const arcLen = { 'LIV-C1': HouseCore.arcInfo([26, 0, 32, 6, -1.757]).length, 'LIV-C2': HouseCore.arcInfo([22, 22, 10, 22, -3.6]).length };
  for (const [id, L] of Object.entries(arcLen)) { const s = curved.find(x => x.id === id); assert.ok(Math.abs(s.length - L) / L < 0.06, `${id}: ${s.length} along a curve of ${L}`); }
  for (const s of curved) { assert.ok(s.parts.length >= 5); assert.ok(Math.abs(s.parts.reduce((t, q) => t + q.area, 0) - s.area) < 0.2); }
  assert.equal(new Set(ROOMS.surfaces.map(s => s.id)).size, ROOMS.surfaces.length);
});

test('curves: rooms and the outside follow the curve', () => {
  const { ROOMS } = HouseCore.build(round());
  assert.equal(ROOMS.roomAt(16, 24.5), 'living', 'inside the bay');
  assert.equal(ROOMS.roomAt(16, 26.3), 'exterior', 'beyond it');
  assert.equal(ROOMS.roomAt(31.3, 0.7), 'exterior', 'outside the rounded corner');
  assert.equal(ROOMS.roomAt(28, 8), 'living');
});

test('curves: a window across several facets is split among them, keeping its width', () => {
  const { HOUSE } = HouseCore.build(round());
  const bay = HOUSE.slants.filter(S => S.arc === 1), wins = bay.flatMap(S => S.openings.filter(o => o.type === 'window'));
  const total = wins.reduce((t, o) => t + (o.b - o.a), 0);
  assert.ok(wins.length >= 4 && Math.abs(total - 6.4) < 0.1, `${wins.length} pieces, ${total} ft`);
  assert.ok(bay.some(S => S.openings.some(o => o.panes)), 'panes are shared out');
});

test('curves: the Blender export carries the pieces of each curved surface', () => {
  const { HOUSE, ROOMS } = HouseCore.build(round());
  const b = HouseCore.forBlender(HOUSE, ROOMS);
  assert.ok(b.surfaces.filter(s => s.parts).length === 4 && b.slants.some(S => S.arc === 1));
});

// ---------------------------------------------------------------------------------------------- more than one floor
const two = () => load('two-storey');

test('floors: a house can have floors above the ground floor, each with its own walls, rooms and fixtures', () => {
  assert.deepEqual(HouseCore.validate(two()), []);
  const { HOUSE, ROOMS, LEVELS } = HouseCore.build(two());
  assert.equal(LEVELS.length, 2);
  assert.equal(LEVELS[0].elevation, 0);
  assert.ok(Math.abs(LEVELS[1].elevation - (LEVELS[0].ROOMS.ceilingMax + 0.9)) < 1e-9, 'the next floor stands on a 0.9 ft slab over the ceiling: ' + LEVELS[1].elevation);
  assert.equal(HOUSE, LEVELS[0].HOUSE, 'HOUSE is the ground floor');
  assert.equal(ROOMS.rooms.length, 6, 'ROOMS lists every floor\'s rooms');
  assert.deepEqual(ROOMS.rooms.map(r => r.level), [0, 0, 0, 1, 1, 1]);
  assert.ok(ROOMS.byId.study && ROOMS.byId.hall);
});

test('floors: outside walls of an upper floor have ids of their own, so every surface id is unique', () => {
  const { ROOMS } = HouseCore.build(two());
  const ids = ROOMS.surfaces.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('EXT-N') && ids.includes('EXT2-N'));
  assert.ok(ROOMS.surfaces.filter(s => s.id.startsWith('EXT2-')).every(s => s.level === 1));
});

test('floors: validation catches a room id used on two floors, and a bad stairwell', () => {
  const dup = two(); dup.levels[0].rooms[0].id = 'living';
  assert.ok(HouseCore.validate(dup).some(p => /more than one floor/.test(p)), HouseCore.validate(dup).join('|'));
  const bad = two(); bad.levels[0].voids = [[5, 5, 4, 4]];
  assert.ok(HouseCore.validate(bad).some(p => /Level 2: "voids"/.test(p)));
  const broken = two(); delete broken.levels[0].walls;
  assert.ok(HouseCore.validate(broken).some(p => /^Level 2:/.test(p)));
});

test('floors: stairs climb to the next floor, and its floor and the ceilings below have the stairwell cut out', () => {
  const { LEVELS } = HouseCore.build(two());
  const st = LEVELS[0].HOUSE.fixtures.find(f => f.k === 'stairs');
  assert.ok(Math.abs(st.rise - LEVELS[1].elevation) < 1e-9, 'rise ' + st.rise);
  const v = LEVELS[1].HOUSE.voids[0];
  assert.deepEqual(LEVELS[0].ROOMS.ceilVoids, LEVELS[1].HOUSE.voids);
  const covers = (rects, x, y) => rects.some(([a, b, c, d]) => x > a && x < c && y > b && y < d);
  assert.ok(covers(LEVELS[1].HOUSE.floorRects, 20, 10), 'floor elsewhere');
  assert.ok(!covers(LEVELS[1].HOUSE.floorRects, (v[0] + v[2]) / 2, (v[1] + v[3]) / 2), 'a hole where the stairs come up');
  assert.deepEqual(HouseCore.subtractRects([[0, 0, 10, 10]], [[4, 4, 6, 6]]).reduce((t, [a, b, c, d]) => t + (c - a) * (d - b), 0), 96);
});

test('floors: a house of one floor has one level and nothing else changes', () => {
  const { ROOMS, LEVELS } = HouseCore.build(load('starter-cottage'));
  assert.equal(LEVELS.length, 1); assert.equal(LEVELS[0].ROOMS, ROOMS); assert.equal(ROOMS.levels, undefined);
});

test('floors: the Blender export carries each floor with its height', () => {
  const { HOUSE, ROOMS } = HouseCore.build(two());
  const b = HouseCore.forBlender(HOUSE, ROOMS);
  assert.equal(b.levels.length, 1);
  assert.ok(b.levels[0].elevation > 8 && b.levels[0].house.walls.length > 0 && b.levels[0].house.surfaces.length > 0);
  assert.ok(b.ceilVoids.length === 1 && b.levels[0].house.voids.length === 1);
});

// ---------------------------------------------------------------------------------------------- roof and siding
const roofed = type => { const h = load('starter-cottage'); h.roof = { type, pitch: 6, overhang: 1.5, rise: 'n' }; return h; };

test('roof: validation', () => {
  assert.deepEqual(HouseCore.validate(roofed('gable')), []);
  const bad = (r, re) => { const h = load('starter-cottage'); h.roof = r; assert.ok(HouseCore.validate(h).some(p => re.test(p)), JSON.stringify(r)); };
  bad({ type: 'dome' }, /"roof"/); bad({ type: 'gable', pitch: 40 }, /pitch/); bad({ type: 'gable', overhang: -1 }, /overhang/); bad({ type: 'gable', ridge: 'q' }, /ridge/); bad({ type: 'shed', rise: 'x' }, /rise/);
  const sd = load('starter-cottage'); sd.siding = { profile: 'zigzag' }; assert.ok(HouseCore.validate(sd).some(p => /siding/.test(p)));
});

test('roof: a gable roof is two planes meeting at a ridge over the outside walls, with a gable wall at each end', () => {
  const { HOUSE, LEVELS } = HouseCore.build(roofed('gable')), r = HOUSE.roof, [x0, y0, x1, y1] = r.footprint;
  assert.equal(r.planes.length, 2); assert.equal(r.gables.length, 2);
  assert.deepEqual([x0, y0, x1, y1], [0, 0, 36, 24]);
  const top = LEVELS[0].ROOMS.ceilingMax, zs = r.planes.flat().map(q => q[2]);
  assert.ok(Math.abs(Math.max(...zs) - (top + 12 * 0.5)) < 1e-6, 'the ridge is half the span times the pitch above the walls: ' + Math.max(...zs));
  assert.ok(Math.abs(Math.min(...zs) - (top - 1.5 * 0.5)) < 1e-6, 'the eaves hang below the wall top');
  assert.ok(r.planes.every(pl => pl.every(q => q[0] >= -1.5 - 1e-9 && q[0] <= 37.5 + 1e-9)), 'the roof reaches past the walls by the overhang');
  assert.deepEqual(r.gables.map(g => g.side).sort(), ['E', 'W']);
  assert.ok(r.gables.every(g => /^EXT-/.test(g.key)), 'each gable takes the siding of the wall under it: ' + r.gables.map(g => g.key));
});

test('roof: hip, shed and flat roofs', () => {
  const hip = HouseCore.build(roofed('hip')).HOUSE.roof; assert.equal(hip.planes.length, 4); assert.equal(hip.gables.length, 0);
  const shed = HouseCore.build(roofed('shed')).HOUSE.roof; assert.equal(shed.planes.length, 1); assert.ok(shed.gables.length >= 3, 'walls rise to meet a shed roof');
  const flat = HouseCore.build(roofed('flat')).HOUSE.roof; assert.equal(flat.planes.length, 1); assert.ok(flat.planes[0].every(q => Math.abs(q[2] - flat.planes[0][0][2]) < 1e-9));
  assert.equal(HouseCore.build(load('starter-cottage')).HOUSE.roof, undefined, 'no roof unless the file asks for one');
});

test('roof: on a house of two floors it sits on the top one', () => {
  const h = load('two-storey'); h.roof = { type: 'gable', pitch: 6 };
  const { HOUSE, LEVELS } = HouseCore.build(h);
  assert.ok(Math.abs(HOUSE.roof.wallTop - (LEVELS[1].elevation + LEVELS[1].ROOMS.ceilingMax)) < 1e-9);
});

test('roof and siding reach the Blender export', () => {
  const h = roofed('gable'); h.siding = { profile: 'lap', exposure: 0.5 };
  const { HOUSE, ROOMS } = HouseCore.build(h), b = HouseCore.forBlender(HOUSE, ROOMS);
  assert.equal(b.roof.planes.length, 2); assert.deepEqual(b.siding, { profile: 'lap', exposure: 0.5 });
});

test('the porch is a fixture with its back to the house and an open side in front', () => {
  const FX = require('../fixtures.js');
  const f = FX.create('porch', 's', [6, 24, 13, 29.5]);
  assert.deepEqual(FX.footprint(f), [6, 24, 13, 29.5]); assert.equal(FX.facing(f), 's'); assert.equal(FX.describe(f), 'Porch');
  assert.ok(FX.editable(f));
});
