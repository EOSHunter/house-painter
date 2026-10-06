// Dumps the plan (house-data.js) plus the paint surfaces and room shapes (rooms.js) to house.json for the Blender build.
//   node export_house_json.js
const fs = require('fs'), path = require('path');
global.window = {};
require('./house-data.js');
require('./rooms.js');
const H = window.HOUSE, R = window.ROOMS;

// room floor/ceiling shapes: 0.25 ft grid, merged into rectangles (same method as house3d.js)
const G = 0.25, cells = {};
for (let y = G / 2; y < H.D; y += G) {
  let run = null;
  const close = x => { if (run) (cells[run.id] ||= []).push([run.x0, y - G / 2, x, y + G / 2]); run = null; };
  for (let x = G / 2; x < H.W; x += G) {
    const id = R.roomAt(x, y), ok = id && id !== 'exterior';
    if (run && (!ok || id !== run.id)) close(x - G / 2);
    if (ok && !run) run = { id, x0: x - G / 2 };
  }
  close(H.W);
}
const rooms = R.rooms.map(r => {
  const out = [];
  for (const c of cells[r.id] || []) {
    const prev = out.find(p => Math.abs(p[0] - c[0]) < 1e-6 && Math.abs(p[2] - c[2]) < 1e-6 && Math.abs(p[3] - c[1]) < 1e-6);
    if (prev) prev[3] = c[3]; else out.push(c.slice());
  }
  // grid cells stop short of wall faces: run each edge that meets a wall out to the wall's centreline (no light gaps)
  const walls = H.walls.filter(w => w.status !== 'removed');
  // snap edges to the room's zone lines first, so open-plan neighbours (kitchen | dining) meet on exactly the same line
  const zx = r.rects.flatMap(z => [z[0], z[2]]), zy = r.rects.flatMap(z => [z[1], z[3]]);
  const snap = (v, list) => { const e = list.reduce((b, c) => (Math.abs(c - v) < Math.abs(b - v) ? c : b), Infinity); return Math.abs(e - v) < 0.26 ? e : v; };
  for (const q of out) { q[0] = snap(q[0], zx); q[2] = snap(q[2], zx); q[1] = snap(q[1], zy); q[3] = snap(q[3], zy); }
  for (const q of out) {
    const [x0, y0, x1, y1] = q, n = [x0, y0, x1, y1];          // measure from the original edges; nearest wall per side only
    let best = [Infinity, Infinity, Infinity, Infinity];
    for (const w of walls) {
      const vertical = (w.y1 - w.y0) > (w.x1 - w.x0);           // east/west edges meet vertical walls, north/south edges horizontal ones
      const overlapY = vertical && w.y0 < y1 - 1e-6 && w.y1 > y0 + 1e-6, overlapX = !vertical && w.x0 < x1 - 1e-6 && w.x1 > x0 + 1e-6;
      const cxw = (w.x0 + w.x1) / 2, cyw = (w.y0 + w.y1) / 2;
      const gaps = [overlapY ? x0 - w.x1 : NaN, overlapX ? y0 - w.y1 : NaN, overlapY ? w.x0 - x1 : NaN, overlapX ? w.y0 - y1 : NaN];
      const to = [cxw, cyw, cxw, cyw];
      gaps.forEach((g, i) => { if (g > -0.05 && g < 0.3 && g < best[i]) { best[i] = g; n[i] = to[i]; } });
    }
    q[0] = Math.min(x0, n[0]); q[1] = Math.min(y0, n[1]); q[2] = Math.max(x1, n[2]); q[3] = Math.max(y1, n[3]);
  }
  return { id: r.id, name: r.name, area: r.area, rects: out.map(q => q.map(v => +v.toFixed(3))) };
});

const surfaces = R.surfaces.map(s => ({ id: s.id, name: s.name, room: s.room, wall: s.wall, side: s.side, kind: s.kind, dir: s.dir,
  a: s.a, b: s.b, normal: s.normal, seg: s.seg, area: s.area }));

const out = Object.assign({}, H, { surfaces, rooms, ceilingHeight: R.ceilingHeight, doorHeight: R.doorHeight, windowHead: R.windowHead });
fs.writeFileSync(path.join(__dirname, 'house.json'), JSON.stringify(out, null, 1));
console.log('wrote house.json —', H.walls.length, 'walls,', H.fixtures.length, 'fixtures,', surfaces.length, 'surfaces,', rooms.length, 'rooms');
