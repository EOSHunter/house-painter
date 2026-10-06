/*
 * House Painter core: turns a house file (houses/<id>/house.json, format "house-painter/house") into the model every
 * part of the project uses: joined walls, room zones, paintable wall surfaces, room shapes and heights.
 * Pure data in, data out. Runs in the browser (window.HouseCore) and in Node (require('./house-core.js')).
 *
 *   const { HOUSE, ROOMS } = HouseCore.build(houseJson);
 *   HouseCore.validate(houseJson)       -> [] or a list of problems (strings)
 *   HouseCore.forBlender(HOUSE, ROOMS)  -> the plain-JSON house that build_house.py reads
 *
 * Units: feet. Origin = one outside corner of the plan; +x -> right/east, +y -> down/south, z up.
 * See docs/house-format.md for every field.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HouseCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const FORMAT = 'house-painter/house';
  const DEFAULT_HEIGHTS = { ceiling: 8.0, door: 6.667, windowHead: 6.667, windowSill: 3.0 };

  // ------------------------------------------------------------------ validation
  function validate(src) {
    const p = [];
    const num = v => typeof v === 'number' && isFinite(v);
    if (!src || typeof src !== 'object') return ['The file is not a JSON object.'];
    if (src.format !== FORMAT) p.push(`"format" should be "${FORMAT}".`);
    if (!num(src.W) || src.W <= 0 || !num(src.D) || src.D <= 0) p.push('"W" and "D" (overall width and depth in feet) must be positive numbers.');
    if (!Array.isArray(src.walls) || !src.walls.length) p.push('"walls" must be a non-empty list.');
    else src.walls.forEach((w, i) => {
      if (![w.x0, w.y0, w.x1, w.y1].every(num) || w.x1 <= w.x0 || w.y1 <= w.y0) p.push(`Wall ${i}: needs x0 < x1 and y0 < y1 (a rectangle in feet).`);
      (w.openings || []).forEach((o, j) => {
        if (!num(o.a) || !num(o.b) || o.b <= o.a) p.push(`Wall ${i}, opening ${j}: needs a < b (feet along the wall).`);
        if (!['door', 'window', 'cased', 'panel'].includes(o.type)) p.push(`Wall ${i}, opening ${j}: type must be door, window, cased or panel.`);
      });
    });
    if (!Array.isArray(src.rooms) || !src.rooms.length) p.push('"rooms" must be a non-empty list.');
    else {
      const ids = new Set();
      src.rooms.forEach((r, i) => {
        if (!r.id || !/^[a-z0-9_]+$/i.test(r.id)) p.push(`Room ${i}: "id" must be letters, digits or _.`);
        else if (ids.has(r.id)) p.push(`Room ${i}: duplicate id "${r.id}".`);
        ids.add(r.id);
        if (r.id === 'exterior' || r.id === 'house') p.push(`Room ${i}: "${r.id}" is a reserved id.`);
        if (!Array.isArray(r.rects) || !r.rects.length || !r.rects.every(q => Array.isArray(q) && q.length === 4 && q.every(num))) p.push(`Room ${i}: "rects" must be a list of [x0, y0, x1, y1].`);
      });
    }
    (src.items || []).forEach((it, i) => {
      if (!it.key || !/^\w+$/.test(it.key)) p.push(`Item ${i}: "key" must be letters, digits or _.`);
      if (it.room && it.room !== 'house' && !(src.rooms || []).some(r => r.id === it.room)) p.push(`Item ${i}: room "${it.room}" does not exist.`);
    });
    return p;
  }

  // ------------------------------------------------------------------ wall joinery
  /*
   * Walls are traced centre-to-centre, which leaves notches at L corners and walls poking through each other at
   * T junctions. Resolve every end against the perpendicular wall it meets:
   *   T junction -> the stem stops at the near face of the through-wall
   *   L corner   -> the horizontal wall runs to the far face (covers the corner), the vertical stops at its face
   * Ends within 0.2 ft of a wall are snapped to it (tracing slop). Openings are clamped to the new extents.
   */
  function joinWalls(list) {
    const live = list.filter(w => w.status !== 'removed');
    const isH = w => (w.x1 - w.x0) >= (w.y1 - w.y0);
    const SNAP = 0.2, EPS = 0.01;
    const hits = (w, along, across) => isH(w)
      ? (along >= w.y0 - SNAP && along <= w.y1 + SNAP && across >= w.x0 - EPS && across <= w.x1 + EPS)
      : (along >= w.x0 - SNAP && along <= w.x1 + SNAP && across >= w.y0 - EPS && across <= w.y1 + EPS);
    const edits = [];
    for (const w of live) {
      const h = isH(w), c = h ? (w.y0 + w.y1) / 2 : (w.x0 + w.x1) / 2;
      for (const end of ['s', 'e']) {
        const p = h ? (end === 's' ? w.x0 : w.x1) : (end === 's' ? w.y0 : w.y1);
        for (const j of live) {
          if (j === w || isH(j) === h || !hits(j, p, c)) continue;
          const jc = h ? (j.x0 + j.x1) / 2 : (j.y0 + j.y1) / 2;
          const jEnds = h ? [j.y0, j.y1] : [j.x0, j.x1];
          const corner = jEnds.some(q => hits(w, q, jc));
          let np;
          if (corner && h) np = end === 's' ? j.x0 : j.x1;
          else if (corner) np = end === 's' ? j.y1 : j.y0;
          else np = h ? (end === 's' ? j.x1 : j.x0) : (end === 's' ? j.y1 : j.y0);
          edits.push([w, h, end, np]);
          break;
        }
      }
    }
    for (const [w, h, end, np] of edits) {
      if (h) w[end === 's' ? 'x0' : 'x1'] = np; else w[end === 's' ? 'y0' : 'y1'] = np;
    }
    for (const w of live) {
      const h = isH(w), lo = h ? w.x0 : w.y0, hi = h ? w.x1 : w.y1;
      (w.openings || []).forEach(o => { o.a = Math.max(o.a, lo); o.b = Math.min(o.b, hi); });
    }
  }

  // ------------------------------------------------------------------ build
  function build(src) {
    const problems = validate(src);
    if (problems.length) { const e = new Error('This house file has problems:\n- ' + problems.join('\n- ')); e.problems = problems; throw e; }
    src = JSON.parse(JSON.stringify(src));
    const heights = Object.assign({}, DEFAULT_HEIGHTS, src.heights || {});
    const E = (src.wallThickness && src.wallThickness.exterior) || 0.5, T = (src.wallThickness && src.wallThickness.interior) || 0.33;
    const walls = src.walls;
    joinWalls(walls);
    // every opening gets its resolved height span, so renderers never need the defaults
    for (const w of walls) for (const o of w.openings || []) {
      if (o.type === 'window') { o.z0 = o.sill ?? heights.windowSill; o.z1 = o.head ?? heights.windowHead; }
      else { o.z0 = 0; o.z1 = o.height ?? heights.door; }
    }
    const plan = src.plan || {};
    const HOUSE = {
      id: src.id || 'house', name: src.name || 'My house', subtitle: src.subtitle || '',
      W: src.W, D: src.D, E, T, heights,
      floor: Object.assign({ name: 'Floor', color: '#B09672', plankW: 7 / 12, plankL: 4, dir: 'x' }, src.floor || {}),
      floorRects: src.floorRects || [[E, E, src.W - E, src.D - E]],
      walls, fixtures: src.fixtures || [], items: src.items || [],
      start: src.start || null, renderRooms: src.renderRooms || null,
      tints: plan.tints || [], labels: plan.labels || [], plan
    };
    const ROOMS = buildRooms(HOUSE, src.rooms, src.roomOrder);
    if (!HOUSE.start) HOUSE.start = startPoint(HOUSE, ROOMS);
    if (!HOUSE.renderRooms) HOUSE.renderRooms = ROOMS.rooms.filter(r => r.area >= 40).map(r => r.id);
    return { HOUSE, ROOMS };
  }

  // ------------------------------------------------------------------ rooms + paintable surfaces
  /*
   * A "surface" is one face of one wall, cut wherever the room on that side changes. Room zones are a first-match
   * list of rectangles: walls are tested first, so a point inside any wall belongs to no room. Open-plan spaces are
   * split into rooms by the zone rectangles alone (no wall needed).
   */
  function buildRooms(H, roomList, roomOrder) {
    const CEIL = H.heights.ceiling;
    const rooms = roomList.map(r => ({ id: r.id, name: r.name || r.id, short: r.short || r.id.toUpperCase().slice(0, 4), rects: r.rects }));
    const byId = Object.fromEntries(rooms.map(r => [r.id, r]));

    const walls = H.walls.filter(w => w.status !== 'removed');
    const inWall = (x, y) => walls.some(w => x > w.x0 && x < w.x1 && y > w.y0 && y < w.y1);
    function roomAt(x, y) {
      if (x < 0 || y < 0 || x > H.W || y > H.D) return 'exterior';
      if (inWall(x, y)) return null;
      for (const r of rooms) for (const [x0, y0, x1, y1] of r.rects) if (x >= x0 && x < x1 && y >= y0 && y < y1) return r.id;
      return null;
    }

    const STEP = 0.05, OFF = 0.04;
    // a face's normal points INTO the room; the wall it forms is on the opposite side of the room
    const facing = { '0,1': 'North', '0,-1': 'South', '1,0': 'West', '-1,0': 'East' };
    const raw = [];
    H.walls.forEach((w, wi) => {
      if (w.status === 'removed') return;
      const horiz = (w.x1 - w.x0) >= (w.y1 - w.y0);
      const s = horiz ? w.x0 : w.y0, e = horiz ? w.x1 : w.y1;
      const faces = horiz
        ? [{ side: 'lo', n: [0, -1], at: t => [t, w.y0 - OFF] }, { side: 'hi', n: [0, 1], at: t => [t, w.y1 + OFF] }]
        : [{ side: 'lo', n: [-1, 0], at: t => [w.x0 - OFF, t] }, { side: 'hi', n: [1, 0], at: t => [w.x1 + OFF, t] }];
      for (const f of faces) {
        let run = null;
        const flush = end => { if (run && end - run.a > 0.12) raw.push({ wi, horiz, side: f.side, n: f.n, room: run.room, a: run.a, b: end }); run = null; };
        for (let t = s + STEP / 2; t < e; t += STEP) {
          const [x, y] = f.at(t), r = roomAt(x, y);
          if (run && run.room === r) continue;
          flush(t - STEP / 2);
          if (r) run = { room: r, a: t - STEP / 2 };
        }
        flush(e);
      }
      // free wall ends (stub walls, returns) get their own small surface
      const cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2, th = horiz ? (w.y1 - w.y0) : (w.x1 - w.x0);
      for (const [end, dir] of [[s, -1], [e, 1]]) {
        const [x, y] = horiz ? [end + dir * OFF, cy] : [cx, end + dir * OFF];
        const r = roomAt(x, y);
        // an end that is flush with a perpendicular wall's face is just the corner of that face, not a free end
        const flush = walls.some(j => j !== w && ((j.x1 - j.x0) >= (j.y1 - j.y0)) !== horiz && (horiz
          ? (Math.abs(j.x0 - end) < 0.01 || Math.abs(j.x1 - end) < 0.01) && j.y0 <= w.y1 + 0.01 && j.y1 >= w.y0 - 0.01
          : (Math.abs(j.y0 - end) < 0.01 || Math.abs(j.y1 - end) < 0.01) && j.x0 <= w.x1 + 0.01 && j.x1 >= w.x0 - 0.01));
        if (flush) continue;
        if (r && r !== 'exterior') raw.push({ wi, horiz, side: dir < 0 ? 'start' : 'end', n: horiz ? [dir, 0] : [0, dir], room: r, a: horiz ? w.y0 : w.x0, b: horiz ? w.y1 : w.x1, cap: true, at: end, th });
      }
    });

    // area: full height minus any door/window on that wall that overlaps the run
    function openingArea(w, a, b) {
      let ar = 0;
      for (const o of w.openings || []) {
        const ov = Math.min(b, o.b) - Math.max(a, o.a);
        if (ov <= 0) continue;
        if (o.type === 'door' || o.type === 'window') ar += ov * (o.z1 - o.z0);
      }
      return ar;
    }

    const surfaces = [];
    for (const r of raw) {
      const w = H.walls[r.wi], len = r.b - r.a;
      const dir = r.cap ? 'Wall end' : facing[r.n.join(',')];
      const area = r.cap ? r.th * CEIL : Math.max(0, len * CEIL - openingArea(w, r.a, r.b));
      let seg;
      if (r.cap) seg = r.horiz ? [[r.at, w.y0], [r.at, w.y1]] : [[w.x0, r.at], [w.x1, r.at]];
      else if (r.horiz) { const y = r.side === 'lo' ? w.y0 : w.y1; seg = [[r.a, y], [r.b, y]]; }
      else { const x = r.side === 'lo' ? w.x0 : w.x1; seg = [[x, r.a], [x, r.b]]; }
      surfaces.push({ room: r.room, wall: r.wi, side: r.side, dir, normal: r.n, a: +r.a.toFixed(2), b: +r.b.toFixed(2),
                      length: +len.toFixed(2), area: +area.toFixed(1), seg, kind: r.room === 'exterior' ? 'siding' : (r.cap ? 'end' : 'wall') });
    }

    // names + ids: "Bedroom 1 \u00b7 North wall", numbered when a room has several walls facing the same way
    const groups = {};
    for (const s of surfaces) (groups[s.room + '|' + s.dir] ||= []).push(s);
    for (const list of Object.values(groups)) {
      list.sort((p, q) => (p.seg[0][0] + p.seg[0][1]) - (q.seg[0][0] + q.seg[0][1]));
      list.forEach((s, i) => {
        const n = list.length > 1 ? ' ' + (i + 1) : '';
        const roomName = s.room === 'exterior' ? 'Exterior' : byId[s.room].name;
        const short = s.room === 'exterior' ? 'EXT' : byId[s.room].short;
        s.name = `${roomName} \u00b7 ${s.dir}${s.dir === 'Wall end' ? '' : ' wall'}${n}`;
        s.id = `${short}-${s.dir === 'Wall end' ? 'END' : s.dir[0]}${list.length > 1 ? i + 1 : ''}`;
      });
    }
    surfaces.sort((p, q) => p.id.localeCompare(q.id, 'en', { numeric: true }));

    // room shapes: 0.25 ft grid of roomAt(), merged into rectangles; area from the same grid
    const G = 0.25, cells = {};
    for (let y = G / 2; y < H.D; y += G) {
      let run = null;
      const close = x => { if (run) (cells[run.id] ||= []).push([run.x0, y - G / 2, x, y + G / 2]); run = null; };
      for (let x = G / 2; x < H.W; x += G) {
        const id = roomAt(x, y), ok = id && id !== 'exterior';
        if (run && (!ok || id !== run.id)) close(x - G / 2);
        if (ok && !run) run = { id, x0: x - G / 2 };
      }
      close(H.W);
    }
    for (const r of rooms) {
      const out = [];
      for (const c of cells[r.id] || []) {
        const prev = out.find(p => Math.abs(p[0] - c[0]) < 1e-6 && Math.abs(p[2] - c[2]) < 1e-6 && Math.abs(p[3] - c[1]) < 1e-6);
        if (prev) prev[3] = c[3]; else out.push(c.slice());
      }
      r.shape = out;
      r.area = +out.reduce((t, q) => t + (q[2] - q[0]) * (q[3] - q[1]), 0).toFixed(0);
      r.wallArea = +surfaces.filter(s => s.room === r.id).reduce((t, s) => t + s.area, 0).toFixed(0);
    }

    const order = (roomOrder || []).filter(id => byId[id]);
    rooms.forEach(r => { if (!order.includes(r.id)) order.push(r.id); });
    return { rooms, byId, order, surfaces, roomAt, ceilingHeight: CEIL, doorHeight: H.heights.door, windowHead: H.heights.windowHead };
  }

  // where the walkthrough starts when the file doesn't say: just inside the first outside door, facing in
  function startPoint(H, R) {
    for (const w of H.walls) {
      if (!w.ext || w.status === 'removed') continue;
      const d = (w.openings || []).find(o => o.type === 'door'); if (!d) continue;
      const horiz = (w.x1 - w.x0) >= (w.y1 - w.y0), m = (d.a + d.b) / 2;
      if (horiz) { const inS = (w.y0 + w.y1) / 2 < H.D / 2; return { x: m, y: inS ? w.y1 + 2.2 : w.y0 - 2.2, yaw: inS ? Math.PI : 0 }; }
      const inE = (w.x0 + w.x1) / 2 < H.W / 2; return { x: inE ? w.x1 + 2.2 : w.x0 - 2.2, y: m, yaw: inE ? -Math.PI / 2 : Math.PI / 2 };
    }
    const big = R.rooms.slice().sort((a, b) => b.area - a.area)[0], q = big.shape[0] || big.rects[0];
    return { x: (q[0] + q[2]) / 2, y: (q[1] + q[3]) / 2, yaw: 0 };
  }

  // ------------------------------------------------------------------ Blender export
  // Plain JSON with everything build_house.py needs: joined walls (openings carry z0/z1), fixtures, paint surfaces,
  // paint items, and ceiling rectangles that run out to the wall centrelines so no light leaks at the edges.
  function forBlender(H, R) {
    const walls = H.walls.filter(w => w.status !== 'removed');
    const rooms = R.rooms.map(r => {
      const out = r.shape.map(q => q.slice());
      // snap edges to the room's zone lines first, so open-plan neighbours (kitchen | dining) meet on exactly the same line
      const zx = r.rects.flatMap(z => [z[0], z[2]]), zy = r.rects.flatMap(z => [z[1], z[3]]);
      const snap = (v, list) => { const e = list.reduce((b, c) => (Math.abs(c - v) < Math.abs(b - v) ? c : b), Infinity); return Math.abs(e - v) < 0.26 ? e : v; };
      for (const q of out) { q[0] = snap(q[0], zx); q[2] = snap(q[2], zx); q[1] = snap(q[1], zy); q[3] = snap(q[3], zy); }
      for (const q of out) {                                        // measure from the original edges; nearest wall per side only
        const [x0, y0, x1, y1] = q, n = [x0, y0, x1, y1];
        const best = [Infinity, Infinity, Infinity, Infinity];
        for (const w of walls) {
          const vertical = (w.y1 - w.y0) > (w.x1 - w.x0);
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
    return {
      format: 'house-painter/built-house', version: 1, id: H.id, name: H.name,
      W: H.W, D: H.D, E: H.E, T: H.T, heights: H.heights, floor: H.floor, floorRects: H.floorRects,
      walls: H.walls, fixtures: H.fixtures, items: H.items, renderRooms: H.renderRooms,
      surfaces, rooms, ceilingHeight: R.ceilingHeight, doorHeight: R.doorHeight, windowHead: R.windowHead
    };
  }

  return { FORMAT, DEFAULT_HEIGHTS, validate, build, joinWalls, forBlender };
});
