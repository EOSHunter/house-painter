/*
 * Fixtures: the catalogue the plan editor places, and the geometry every renderer shares.
 * Browser (window.HouseFixtures) and Node (require('./fixtures.js')).
 *
 * Every fixture that has a front uses the same local frame:
 *   p = depth, from the back (usually against a wall) to the front, 0..P
 *   q = width, across the front, 0..Q
 * frame(f).box(p0, q0, p1, q1) -> the world rectangle [x0, y0, x1, y1] (plan feet), whatever way the fixture faces.
 * Facing ('n' | 'e' | 's' | 'w') is the side the doors, controls or open side point to:
 *   f.front for most fixtures, f.dir for toilets (the way the bowl points).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HouseFixtures = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // fixtures drawn before facing existed all assumed these; files that leave `front` out keep looking the same
  const DEFAULT_FRONT = { app: 'e', range: 'e', front: 'e', shower: 'n', sink2: 's', barn: 's', stairs: 'e', porch: 's' };
  const kindKey = f => (f.k === 'box' && f.c === 'app' ? 'app' : f.k);
  const facing = f => (f.k === 'toilet' ? (f.dir || 'w') : f.front || DEFAULT_FRONT[kindKey(f)] || null);
  const along = d => d === 'n' || d === 's';                       // the front runs along x

  // toilet footprint around its centre: tank back 0.95 behind the centre, bowl front 0.85 ahead, 0.6 each side
  const TOILET = { back: 0.95, front: 0.85, half: 0.6 };
  function footprint(f) {
    if (f.k === 'toilet') {
      const d = f.dir || 'w', { back, front, half } = TOILET;
      if (d === 'w') return [f.cx - front, f.cy - half, f.cx + back, f.cy + half];
      if (d === 'e') return [f.cx - back, f.cy - half, f.cx + front, f.cy + half];
      if (d === 'n') return [f.cx - half, f.cy - front, f.cx + half, f.cy + back];
      return [f.cx - half, f.cy - back, f.cx + half, f.cy + front];
    }
    if (f.k === 'heater') return [f.cx - f.r, f.cy - f.r, f.cx + f.r, f.cy + f.r];
    if (f.k === 'oval' || f.k === 'ftub') return [f.cx - f.rx, f.cy - f.ry, f.cx + f.rx, f.cy + f.ry];
    if (f.k === 'barn') return [f.x1, f.y - 0.2, f.x2, f.y + 0.2];
    if ([f.x, f.y, f.w, f.h].every(v => typeof v === 'number')) return [f.x, f.y, f.x + f.w, f.y + f.h];
    return null;
  }
  // move / resize a fixture so its footprint is rect (the editor's only way of changing geometry)
  function place(f, [x0, y0, x1, y1]) {
    const r4 = v => Math.round(v * 1e4) / 1e4;
    if (f.k === 'toilet') {
      const d = f.dir || 'w', { back, front } = TOILET;
      f.cx = r4(d === 'w' ? x0 + front : d === 'e' ? x0 + back : (x0 + x1) / 2);
      f.cy = r4(d === 'n' ? y0 + front : d === 's' ? y0 + back : (y0 + y1) / 2);
    } else if (f.k === 'heater') { f.cx = r4((x0 + x1) / 2); f.cy = r4((y0 + y1) / 2); f.r = r4(Math.min(x1 - x0, y1 - y0) / 2); }
    else if (f.k === 'oval' || f.k === 'ftub') { f.cx = r4((x0 + x1) / 2); f.cy = r4((y0 + y1) / 2); f.rx = r4((x1 - x0) / 2); f.ry = r4((y1 - y0) / 2); }
    else if (f.k === 'barn') { f.x1 = r4(x0); f.x2 = r4(x1); f.y = r4((y0 + y1) / 2); }
    else { f.x = r4(x0); f.y = r4(y0); f.w = r4(x1 - x0); f.h = r4(y1 - y0); }
    return f;
  }
  // turn a fixture to face d, about the centre of its footprint (width and depth keep their meaning)
  function turn(f, d) {
    const old = facing(f), r = footprint(f);
    if (!old || !r) return f;
    if (f.k === 'toilet') { f.dir = d; const c = [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2], n = footprint(f); return place(f, [n[0] + c[0] - (n[0] + n[2]) / 2, n[1] + c[1] - (n[1] + n[3]) / 2, n[2] + c[0] - (n[0] + n[2]) / 2, n[3] + c[1] - (n[1] + n[3]) / 2]); }
    f.front = d;
    if (along(old) !== along(d)) {
      const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2, w = r[2] - r[0], h = r[3] - r[1];
      place(f, [cx - h / 2, cy - w / 2, cx + h / 2, cy + w / 2]);
    }
    return f;
  }

  const CW = { n: 'e', e: 's', s: 'w', w: 'n' };
  // quarter turn clockwise: a fixture with a front faces the next side; one without (tub, shelf) swaps its width and depth
  function spin(f) {
    const old = facing(f);
    if (old) return turn(f, CW[old]);
    const r = footprint(f); if (!r || f.k === 'heater' || f.k === 'oval' || f.k === 'barn') return f;
    const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2, w = r[2] - r[0], h = r[3] - r[1];
    return place(f, [cx - h / 2, cy - w / 2, cx + h / 2, cy + w / 2]);
  }
  // w = width across the front, d = depth (back to front); the back edge and the middle of the width stay put
  function resize(f, w, d) {
    const r = footprint(f), fc = facing(f);
    if (!r || ['toilet', 'heater', 'oval', 'barn'].includes(f.k)) return f;
    const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2;
    if (!fc) return place(f, [r[0], r[1], r[0] + w, r[1] + d]);
    if (fc === 'e') return place(f, [r[0], cy - w / 2, r[0] + d, cy + w / 2]);
    if (fc === 'w') return place(f, [r[2] - d, cy - w / 2, r[2], cy + w / 2]);
    if (fc === 's') return place(f, [cx - w / 2, r[1], cx + w / 2, r[1] + d]);
    return place(f, [cx - w / 2, r[3] - d, cx + w / 2, r[3]]);
  }
  // fixtures at counter or floor level collide with each other; wall cabinets, shelves and tile sit above them
  const high = f => f.k === 'upper' || f.k === 'shelf' || f.k === 'splash';
  // fixtures only collide within their own layer: floor and counter level, wall level, and things that sit on a counter (a drop-in sink)
  const layer = f => (f.k === 'sink2' ? 2 : high(f) ? 1 : 0);
  const width = f => { const r = footprint(f), d = facing(f); return !r ? 0 : (d ? (along(d) ? r[2] - r[0] : r[3] - r[1]) : r[2] - r[0]); };
  const depth = f => { const r = footprint(f), d = facing(f); return !r ? 0 : (d ? (along(d) ? r[3] - r[1] : r[2] - r[0]) : r[3] - r[1]); };

  function frame(f) {
    const [x0, y0, x1, y1] = footprint(f), d = facing(f) || 'e';
    const P = along(d) ? y1 - y0 : x1 - x0, Q = along(d) ? x1 - x0 : y1 - y0;
    const pt = (p, q) => d === 'e' ? [x0 + p, y0 + q] : d === 'w' ? [x1 - p, y1 - q] : d === 's' ? [x1 - q, y0 + p] : [x0 + q, y1 - p];
    const box = (p0, q0, p1, q1) => { const a = pt(p0, q0), b = pt(p1, q1); return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]; };
    return { P, Q, d, pt, box, swap: along(d) };              // swap: local p runs along world y
  }

  // cabinet fronts: how many columns, and what each column holds
  function cabinetLayout(f, counter) {
    const fr = frame(f), n = Math.max(1, f.doors || Math.round(fr.Q / 1.5));
    const style = f.style || (counter ? 'door-drawer' : 'doors');
    return { n, style };
  }

  /*
   * The editor's library. size: [width across the front, depth]. item: the paint group a new cabinet joins
   * (one per room and kind, e.g. kitchen_base), created when it doesn't exist yet. free: doesn't back onto a wall.
   */
  const CATALOG = [
    { id: 'base', group: 'Kitchen', name: 'Base cabinets', size: [3, 2], make: () => ({ k: 'box', c: 'cabB', z1: 3 }), item: ['base', 'Base cabinets', '#E8E4DA'] },
    { id: 'sinkbase', group: 'Kitchen', name: 'Sink base', size: [3, 2], make: () => ({ k: 'box', c: 'cabB', z1: 3, sink: true }), item: ['base', 'Base cabinets', '#E8E4DA'] },
    { id: 'drawers', group: 'Kitchen', name: 'Drawer base', size: [1.5, 2], make: () => ({ k: 'box', c: 'cabB', z1: 3, style: 'drawers' }), item: ['base', 'Base cabinets', '#E8E4DA'] },
    { id: 'upper', group: 'Kitchen', name: 'Upper cabinets', size: [3, 1], make: () => ({ k: 'upper', z0: 4.5, z1: 7 }), item: ['uppers', 'Upper cabinets', '#E8E4DA'] },
    { id: 'tall', group: 'Kitchen', name: 'Tall cabinet', size: [2, 2], make: () => ({ k: 'box', c: 'cabB', z1: 7, counter: false }), item: ['tall', 'Tall cabinet', '#E8E4DA'] },
    { id: 'island', group: 'Kitchen', name: 'Island', size: [5, 2.5], free: true, make: () => ({ k: 'box', c: 'cabB', z1: 3, counter: 'all', label: 'ISLAND' }), item: ['island', 'Island', '#3E5A4C'] },
    { id: 'cornerbase', group: 'Kitchen', name: 'Corner base cabinet', size: [3, 3], make: () => ({ k: 'box', c: 'cabB', z1: 3, doors: 1, name: 'Corner base cabinet' }), item: ['base', 'Base cabinets', '#E8E4DA'] },
    { id: 'cornerupper', group: 'Kitchen', name: 'Corner upper cabinet', size: [2, 2], make: () => ({ k: 'upper', z0: 4.5, z1: 7, doors: 1, name: 'Corner upper cabinet' }), item: ['uppers', 'Upper cabinets', '#E8E4DA'] },
    { id: 'pantry', group: 'Kitchen', name: 'Pantry cabinet', size: [3, 2], make: () => ({ k: 'box', c: 'cabB', z1: 7.2, counter: false, doors: 2, name: 'Pantry cabinet' }), item: ['pantry', 'Pantry cabinet', '#E8E4DA'] },
    { id: 'sink', group: 'Kitchen', name: 'Sink (on a counter)', size: [2.4, 1.4], free: true, make: () => ({ k: 'sink2' }) },
    { id: 'dishwasher', group: 'Kitchen', name: 'Dishwasher', size: [2, 2.1], make: () => ({ k: 'box', c: 'app', label: 'DW', size: 8, z1: 2.9 }) },
    { id: 'fridge', group: 'Kitchen', name: 'Refrigerator', size: [3, 2.6], make: () => ({ k: 'box', c: 'app', label: 'FRIDGE', size: 8 }) },
    { id: 'range', group: 'Kitchen', name: 'Range + microwave', size: [2.5, 2.1], make: () => ({ k: 'range' }) },
    { id: 'range2', group: 'Kitchen', name: 'Range (no microwave)', size: [2.5, 2.1], make: () => ({ k: 'range', micro: false }) },
    { id: 'vanity', group: 'Bath', name: 'Vanity with basin', size: [3, 1.75], make: () => ({ k: 'box', c: 'cabW', z1: 2.8, basin: true }), item: ['vanity', 'Vanity', '#F1F0EC'] },
    { id: 'vanity2', group: 'Bath', name: 'Double vanity', size: [5, 1.75], make: () => ({ k: 'box', c: 'cabW', z1: 2.8, basin: 2, name: 'Double vanity' }), item: ['vanity', 'Vanity', '#F1F0EC'] },
    { id: 'linen', group: 'Bath', name: 'Linen cabinet', size: [1.75, 1.75], make: () => ({ k: 'box', c: 'cabW', z1: 6.5, counter: false }), item: ['vanity', 'Vanity', '#F1F0EC'] },
    { id: 'toilet', group: 'Bath', name: 'Toilet', size: [1.2, 1.8], make: () => ({ k: 'toilet' }) },
    { id: 'tub', group: 'Bath', name: 'Bathtub', size: [5, 2.5], make: () => ({ k: 'tub' }) },
    { id: 'ftub', group: 'Bath', name: 'Freestanding tub', size: [5.5, 2.8], free: true, make: () => ({ k: 'ftub' }) },
    { id: 'shower', group: 'Bath', name: 'Shower', size: [3.5, 3], make: () => ({ k: 'shower' }) },
    { id: 'washer', group: 'Laundry', name: 'Washer', size: [2.3, 2.2], make: () => ({ k: 'front', label: 'WASHER' }) },
    { id: 'dryer', group: 'Laundry', name: 'Dryer', size: [2.3, 2.2], make: () => ({ k: 'front', label: 'DRYER' }) },
    { id: 'stairs', group: 'Stairs', name: 'Straight stairs (up toward the front)', size: [3.5, 11], make: () => ({ k: 'stairs' }) },
    { id: 'porch', group: 'Outside', name: 'Porch with a roof (open side to the front)', size: [10, 6], make: () => ({ k: 'porch' }) },
    { id: 'heater', group: 'Laundry', name: 'Water heater', size: [1.6, 1.6], free: true, make: () => ({ k: 'heater', r: 0.8 }) },
    { id: 'shelf', group: 'Laundry', name: 'Wire shelf', size: [4, 1], make: () => ({ k: 'shelf' }) }
  ];
  // a catalogue entry turned into a fixture: back against the wall on the side opposite `front`
  function create(id, front, rect) {
    const c = CATALOG.find(x => x.id === id), f = c.make();
    if (f.k === 'toilet') f.dir = front; else if (f.k !== 'heater' && f.k !== 'tub' && f.k !== 'shelf' && f.k !== 'ftub') f.front = front;
    return place(f, rect);
  }
  // what the editor calls a fixture in its lists and inspector
  function describe(f) {
    if (f.name) return f.name;
    if (f.k === 'box' && f.paint) {
      if (f.counter === 'all') return 'Island';
      if (f.basin) return 'Vanity';
      if (f.sink) return 'Sink base';
      if (f.style === 'drawers') return 'Drawer base';
      if (f.counter === false || (f.z1 || 3) > 4.5) return 'Tall cabinet';
      return 'Base cabinets';
    }
    if (f.k === 'box' && f.c === 'app') return f.label === 'DW' ? 'Dishwasher' : 'Refrigerator';
    if (f.k === 'box' && f.c === 'counter') return 'Counter';
    return { upper: 'Upper cabinets', range: f.micro === false ? 'Range' : 'Range + microwave', ftub: 'Freestanding tub', toilet: 'Toilet', tub: 'Bathtub', shower: 'Shower', front: f.label ? f.label[0] + f.label.slice(1).toLowerCase() : 'Washer', heater: 'Water heater',
      shelf: 'Wire shelf', stairs: 'Stairs', porch: 'Porch', pumps: 'Pumps', sink2: 'Sink', oval: 'Basin', splash: 'Backsplash', barn: 'Barn door', steps: 'Steps', deck: 'Back steps' }[f.k] || f.k;
  }
  // kinds the editor can select and move (the rest are plan drawings: labels, dashed lines, removed items)
  const EDITABLE = new Set(['box', 'upper', 'range', 'toilet', 'tub', 'ftub', 'stairs', 'porch', 'shower', 'front', 'heater', 'shelf', 'pumps', 'sink2', 'oval', 'splash', 'barn', 'steps', 'deck']);
  const editable = f => EDITABLE.has(f.k) && f.st !== 'removed' && !!footprint(f);

  return { DEFAULT_FRONT, CATALOG, facing, footprint, place, turn, spin, resize, high, layer, width, depth, frame, cabinetLayout, create, describe, editable };
});
