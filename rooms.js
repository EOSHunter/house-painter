/*
 * Rooms + paintable surfaces, derived from house-data.js (load that first).
 *
 * A "surface" is one face of one wall, cut wherever the room on that side changes.
 * Room zones are a first-match list of rectangles (feet, same coordinates as house-data.js):
 * walls are tested first, so a point inside any wall belongs to no room.
 * The open great room is split into Kitchen / Dining / Living by invisible zone lines:
 *   kitchen | dining at the stub wall (x = 29.7), dining | living on the old divider line (y = 9.2).
 *
 * Exposes window.ROOMS = { rooms, surfaces, roomAt, ceilingHeight, doorHeight, windowHead }.
 */
(function () {
  const H = window.HOUSE;
  const CEIL = 8.0, DOOR_H = 6.667, HEAD = 6.667, SILL = 3.0;   // same defaults as build_house.py

  // ---- room list (order = first match wins) ----
  const rooms = [
    { id: 'whcl',    name: 'Water heater closet', short: 'WH',   rects: [[10.7, 5.5, 12.95, 9.74]] },
    { id: 'laundry', name: 'Laundry',             short: 'LAU',  rects: [[10.7, 0, 18.8, 9.74]] },
    { id: 'bed1',    name: 'Bedroom 1',           short: 'BR1',  rects: [[0, 0, 10.7, 13.2]] },
    { id: 'wic1',    name: 'Bedroom 1 closet',    short: 'WIC1', rects: [[0, 13.2, 3.8, 19.7]] },
    { id: 'wic2',    name: 'Bedroom 2 closet',    short: 'WIC2', rects: [[0, 19.7, 3.8, 26.67]] },
    { id: 'bed2',    name: 'Bedroom 2',           short: 'BR2',  rects: [[3.8, 13.2, 14.65, 26.67]] },
    { id: 'hbath',   name: 'Hall bath',           short: 'HB',   rects: [[14.65, 16.25, 20.1, 26.67]] },
    { id: 'gcl',     name: 'Guest closet',        short: 'GC',   rects: [[20.1, 16.25, 24.37, 18.75]] },
    { id: 'foyer',   name: 'Foyer',               short: 'FOY',  rects: [[20.1, 18.75, 24.37, 26.67]] },   // zone line = guest-closet east face
    { id: 'hall',    name: 'Hall',                short: 'HALL', rects: [[10.7, 9.74, 18.8, 13.2], [14.65, 13.2, 24.37, 16.25]] },
    { id: 'mcl',     name: 'Master closet',       short: 'MWIC', rects: [[51.6, 13.2, 56, 20.4]] },
    { id: 'mtoil',   name: 'Toilet & shower',     short: 'MTS',  rects: [[51.6, 20.4, 56, 26.67]] },
    { id: 'mbath',   name: 'Master bath',         short: 'MB',   rects: [[42.5, 16.25, 51.6, 26.67]] },
    { id: 'master',  name: 'Master bedroom',      short: 'MBR',  rects: [[42.5, 0, 56, 13.2], [44.2, 13.2, 51.6, 16.25]] },
    { id: 'kitchen', name: 'Kitchen',             short: 'KIT',  rects: [[18.8, 0, 29.7, 13.2]] },
    { id: 'dining',  name: 'Dining',              short: 'DIN',  rects: [[29.7, 0, 42.5, 9.2]] },
    { id: 'living',  name: 'Living room',         short: 'LIV',  rects: [[24.2, 9.2, 44.2, 26.67]] }
  ];
  const byId = Object.fromEntries(rooms.map(r => [r.id, r]));

  const walls = H.walls.filter(w => w.status !== 'removed');
  const inWall = (x, y) => walls.some(w => x > w.x0 && x < w.x1 && y > w.y0 && y < w.y1);
  function roomAt(x, y) {
    if (x < 0 || y < 0 || x > H.W || y > H.D) return 'exterior';
    if (inWall(x, y)) return null;
    for (const r of rooms) for (const [x0, y0, x1, y1] of r.rects) if (x >= x0 && x < x1 && y >= y0 && y < y1) return r.id;
    return null;
  }

  // ---- wall faces \u2192 surfaces ----
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
      if (o.type === 'door') ar += ov * DOOR_H;
      else if (o.type === 'window') ar += ov * (HEAD - (o.sill || SILL));
    }
    return ar;
  }

  const surfaces = [];
  for (const r of raw) {
    const w = H.walls[r.wi], len = r.b - r.a;
    const dir = r.cap ? 'Wall end' : facing[r.n.join(',')];
    const area = r.cap ? r.th * CEIL : Math.max(0, len * CEIL - openingArea(w, r.a, r.b));
    // geometry of the painted strip, in plan feet: a segment along the face
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

  // ceiling / floor area per room (0.25 ft grid)
  const G = 0.25;
  for (const r of rooms) r.area = 0;
  for (let x = G / 2; x < H.W; x += G) for (let y = G / 2; y < H.D; y += G) {
    const id = roomAt(x, y);
    if (id && id !== 'exterior') byId[id].area += G * G;
  }
  rooms.forEach(r => { r.area = +r.area.toFixed(0); r.wallArea = +surfaces.filter(s => s.room === r.id).reduce((t, s) => t + s.area, 0).toFixed(0); });

  window.ROOMS = { rooms, byId, surfaces, roomAt, ceilingHeight: CEIL, doorHeight: DOOR_H, windowHead: HEAD };
})();
