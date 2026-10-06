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
      let len = Infinity;
      if (w.arc !== undefined) {
        if (!Array.isArray(w.arc) || w.arc.length !== 5 || !w.arc.every(num)) p.push(`Wall ${i}: "arc" must be [x0, y0, x1, y1, bulge]: the two ends, and how far (in feet) the middle bows out to the right of the way it runs.`);
        else {
          const chord = Math.hypot(w.arc[2] - w.arc[0], w.arc[3] - w.arc[1]);
          if (chord < 0.5) p.push(`Wall ${i}: the arc's ends are less than half a foot apart.`);
          else if (Math.abs(w.arc[4]) > chord / 2 + 1e-6) p.push(`Wall ${i}: the bulge of an arc can be at most half its chord (a half circle): ${Math.round(chord * 50) / 100} ft here.`);
          else len = arcInfo(w.arc).length;
        }
        if (w.t !== undefined && !(num(w.t) && w.t > 0 && w.t < 3)) p.push(`Wall ${i}: "t" (thickness in feet) must be between 0 and 3.`);
      } else if (w.line !== undefined) {
        if (!Array.isArray(w.line) || w.line.length !== 4 || !w.line.every(num)) p.push(`Wall ${i}: "line" must be [x0, y0, x1, y1], the wall's centre line in feet.`);
        else if ((len = Math.hypot(w.line[2] - w.line[0], w.line[3] - w.line[1])) < 0.5) p.push(`Wall ${i}: the line is shorter than half a foot.`);
        if (w.t !== undefined && !(num(w.t) && w.t > 0 && w.t < 3)) p.push(`Wall ${i}: "t" (thickness in feet) must be between 0 and 3.`);
      } else if (![w.x0, w.y0, w.x1, w.y1].every(num) || w.x1 <= w.x0 || w.y1 <= w.y0) p.push(`Wall ${i}: needs x0 < x1 and y0 < y1 (a rectangle in feet), or a "line" or an "arc".`);
      (w.openings || []).forEach((o, j) => {
        if (!num(o.a) || !num(o.b) || o.b <= o.a) p.push(`Wall ${i}, opening ${j}: needs a < b (feet along the wall).`);
        else if ((w.line !== undefined || w.arc !== undefined) && len !== undefined && (o.a < -1e-6 || o.b > len + 1e-6)) p.push(`Wall ${i}, opening ${j}: on an angled or curved wall, a and b are feet from the start, from 0 to ${Math.round(len * 100) / 100}.`);
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
        const hasPolys = Array.isArray(r.polys) && r.polys.length;
        if (r.rects !== undefined || !hasPolys) {
          if (!Array.isArray(r.rects) || (!r.rects.length && !hasPolys) || !r.rects.every(q => Array.isArray(q) && q.length === 4 && q.every(num))) p.push(`Room ${i}: "rects" must be a list of [x0, y0, x1, y1].`);
        }
        if (r.ceiling !== undefined) {
          const c = r.ceiling, ok = v => num(v) && v > 3 && v < 40;
          if (num(c)) { if (!ok(c)) p.push(`Room ${i}: "ceiling" is a height in feet, between 3 and 40.`); }
          else if (!c || typeof c !== 'object' || !['flat', 'shed', 'vault'].includes(c.type || 'flat')) p.push(`Room ${i}: "ceiling" is a height, or { "type": "flat" | "shed" | "vault", ... }.`);
          else if ((c.type || 'flat') === 'flat' && c.height !== undefined && !ok(c.height)) p.push(`Room ${i}: ceiling "height" is in feet, between 3 and 40.`);
          else if (c.type === 'shed' && !(ok(c.low) && ok(c.high) && (c.rise === undefined || 'nesw'.includes(c.rise) && String(c.rise).length === 1))) p.push(`Room ${i}: a "shed" ceiling needs "low" and "high" heights, and "rise" (n, e, s or w).`);
          else if (c.type === 'vault' && !(ok(c.eave) && ok(c.peak) && (c.ridge === undefined || c.ridge === 'x' || c.ridge === 'y'))) p.push(`Room ${i}: a "vault" ceiling needs "eave" and "peak" heights, and "ridge" ("x" or "y").`);
        }
        if (r.polys !== undefined && (!Array.isArray(r.polys) || !r.polys.every(poly => Array.isArray(poly) && poly.length >= 3 && poly.every(v => Array.isArray(v) && v.length === 2 && v.every(num))))) p.push(`Room ${i}: "polys" must be a list of polygons, each a list of at least three [x, y] points.`);
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

  // ------------------------------------------------------------------ angled walls
  /*
   * A wall given as { "line": [x0, y0, x1, y1], "t": thickness } runs between any two points. A line that happens to be
   * horizontal or vertical becomes an ordinary rectangle wall (so everything that already works for those still does);
   * a truly angled one becomes a "slant", handled alongside the rectangles. Openings on a slant are measured in feet
   * from the start of its line, and a door's swing is 'l' or 'r' (left or right of the way the line runs).
   */
  const EPS_LINE = 1e-6, FACET = 15 * Math.PI / 180;
  // a curved wall as a circle's arc: ends P0 and P1, and `bulge`, how far the middle stands out to the right of the way it runs
  function arcInfo(arc) {
    const [x0, y0, x1, y1, s] = arc, c = Math.hypot(x1 - x0, y1 - y0), u = [(x1 - x0) / c, (y1 - y0) / c], nr = [-u[1], u[0]];
    if (Math.abs(s) < 1e-3) return { straight: true, length: c, n: 1 };
    const R = (c * c / 4 + s * s) / (2 * Math.abs(s)), sg = Math.sign(s), B = [(x0 + x1) / 2 + nr[0] * s, (y0 + y1) / 2 + nr[1] * s];
    const C = [B[0] - nr[0] * sg * R, B[1] - nr[1] * sg * R];
    const ang = (a, b) => Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);          // signed angle from a to b
    const v0 = [x0 - C[0], y0 - C[1]], vb = [B[0] - C[0], B[1] - C[1]], half = ang(v0, vb), sweep = 2 * Math.abs(half), dir = Math.sign(half) || 1;
    const n = Math.max(2, Math.min(64, Math.ceil(sweep / FACET - 1e-9))), th0 = Math.atan2(v0[1], v0[0]);
    const pts = []; for (let k = 0; k <= n; k++) { const th = th0 + dir * sweep * k / n; pts.push(k === 0 ? [x0, y0] : k === n ? [x1, y1] : [C[0] + R * Math.cos(th), C[1] + R * Math.sin(th)]); }
    return { straight: false, R, C, sweep, length: R * sweep, n, pts, th0, dir };
  }
  // the facets of an arc wall: a short straight wall for each, carrying its share of the openings (measured along the arc)
  function expandArc(w, arcIdx) {
    const { arc, openings, t, ...rest } = w, A = arcInfo(arc);
    if (A.straight) return [{ ...rest, t, line: [arc[0], arc[1], arc[2], arc[3]], openings: openings || [] }];
    const out = [], L = A.length, ops = openings || [];
    for (let k = 0; k < A.n; k++) {
      const s0 = L * k / A.n, s1 = L * (k + 1) / A.n, pieces = [];
      for (const o of ops) {
        const a = Math.max(o.a, s0), b = Math.min(o.b, s1), mid = (o.a + o.b) / 2;
        if (b - a < 0.08) continue;
        if (o.type === 'door' && !(mid >= s0 - 1e-9 && mid < s1 + 1e-9 || (k === A.n - 1 && mid >= s0))) continue;     // a door lives in one facet: the one its middle is in
        const q = { ...o, a: a - s0, b: b - s0 };
        if (o.type === 'window' && o.panes) q.panes = Math.max(1, Math.round(o.panes * (b - a) / (o.b - o.a)));
        pieces.push(q);
      }
      out.push({ ...rest, ...(t !== undefined ? { t } : {}), id: (w.id || 'curve') + '-' + (k + 1), line: [...A.pts[k], ...A.pts[k + 1]], arc: arcIdx, arcK: k, openings: pieces });
    }
    return out;
  }
  function splitWalls(list, E, T) {
    const ortho = [], slants = []; let arcN = 0;
    list = list.flatMap(w => (w.arc ? expandArc(w, arcN++) : [w]));
    for (const w of list) {
      if (!w.line) { ortho.push(w); continue; }
      const [x0, y0, x1, y1] = w.line, t = w.t || (w.ext ? E : T), { line, t: _t, openings, ...rest } = w;
      const horiz = Math.abs(y1 - y0) < EPS_LINE, vert = Math.abs(x1 - x0) < EPS_LINE;
      if ((horiz || vert) && w.arc === undefined) {                 // an ordinary wall in a different notation (a piece of a curve stays a piece of the curve)
        const rev = horiz ? x1 < x0 : y1 < y0, start = horiz ? x0 : y0, lo = Math.min(horiz ? x0 : y0, horiz ? x1 : y1), hi = Math.max(horiz ? x0 : y0, horiz ? x1 : y1);
        const ux = horiz ? (rev ? -1 : 1) : 0, uy = vert ? (rev ? -1 : 1) : 0;
        const ops = (openings || []).map(o => {
          const q = { ...o };
          if (rev) { q.a = start - o.b; q.b = start - o.a; if (o.hinge) q.hinge = o.hinge === 'a' ? 'b' : 'a'; } else { q.a = start + o.a; q.b = start + o.b; }
          if (o.swing === 'l' || o.swing === 'r') { const nx = o.swing === 'l' ? uy : -uy, ny = o.swing === 'l' ? -ux : ux; q.swing = horiz ? (ny < 0 ? 'n' : 's') : (nx > 0 ? 'e' : 'w'); }
          return q;
        });
        ortho.push(horiz ? { ...rest, x0: lo, x1: hi, y0: y0 - t / 2, y1: y0 + t / 2, openings: ops } : { ...rest, x0: x0 - t / 2, x1: x0 + t / 2, y0: lo, y1: hi, openings: ops });
      } else slants.push({ ...rest, line: [x0, y0, x1, y1], t, openings: openings || [] });
    }
    return { ortho, slants };
  }
  function slantGeometry(w, i, heights) {
    const [x0, y0, x1, y1] = w.line, len = Math.hypot(x1 - x0, y1 - y0), u = [(x1 - x0) / len, (y1 - y0) / len];
    const S = { i, id: w.id || null, arc: w.arc ?? null, arcK: w.arcK ?? 0, ext: !!w.ext, status: w.status || 'keep', t: w.t, p0: [x0, y0], p1: [x1, y1], len, u, nl: [u[1], -u[0]], nr: [-u[1], u[0]], e0: 0, e1: 0, openings: w.openings.map(o => ({ ...o })) };
    for (const o of S.openings) {
      if (o.type === 'window') { o.z0 = o.sill ?? heights.windowSill; o.z1 = o.head ?? heights.windowHead; } else { o.z0 = 0; o.z1 = o.height ?? heights.door; }
    }
    return S;
  }
  // the four corners of a slant, ends included (counter-clockwise from the start's left side)
  function slantPoly(S) {
    const a = [S.p0[0] - S.u[0] * S.e0, S.p0[1] - S.u[1] * S.e0], b = [S.p1[0] + S.u[0] * S.e1, S.p1[1] + S.u[1] * S.e1], h = S.t / 2;
    return [[a[0] + S.nl[0] * h, a[1] + S.nl[1] * h], [b[0] + S.nl[0] * h, b[1] + S.nl[1] * h], [b[0] + S.nr[0] * h, b[1] + S.nr[1] * h], [a[0] + S.nr[0] * h, a[1] + S.nr[1] * h]];
  }
  /*
   * Where two walls meet end to end at an angle, each is carried on past the point where their centre lines meet, until the
   * outer faces meet (a mitre). For walls of thickness tA and tB with angle theta between them, wall A is carried on by
   * tA/2 * cot(theta) + tB/2 / sin(theta). A right angle gives half the other wall's thickness, as for ordinary corners.
   * Walls that meet in the middle of another wall (a T) are left alone: the end hides inside the wall it meets.
   */
  function joinSlants(slants, ortho, orig) {
    const ends = [];
    slants.forEach(S => { if (S.status === 'removed') return;
      ends.push({ k: 's', ref: S, end: 'a', P: S.p0, out: S.u, t: S.t }); ends.push({ k: 's', ref: S, end: 'b', P: S.p1, out: [-S.u[0], -S.u[1]], t: S.t }); });
    ortho.forEach((w, i) => { if (w.status === 'removed') return;
      const o = orig[i], h = o.axis === 'h', t = h ? w.y1 - w.y0 : w.x1 - w.x0;
      if (Math.abs((h ? w.x0 : w.y0) - o.a) < 1e-6) ends.push({ k: 'o', ref: w, end: 'a', P: h ? [o.a, o.c] : [o.c, o.a], out: h ? [1, 0] : [0, 1], t });
      if (Math.abs((h ? w.x1 : w.y1) - o.b) < 1e-6) ends.push({ k: 'o', ref: w, end: 'b', P: h ? [o.b, o.c] : [o.c, o.b], out: h ? [-1, 0] : [0, -1], t });
    });
    const done = new Set(), clamp = v => Math.max(-0.5, Math.min(3, v));
    for (const e1 of ends) {
      if (e1.k !== 's') continue;
      const near = ends.filter(q => q !== e1 && Math.hypot(q.P[0] - e1.P[0], q.P[1] - e1.P[1]) < 0.2);
      if (near.length !== 1) continue;                                           // a corner of exactly two walls
      const e2 = near[0], key = (a, b) => ends.indexOf(a) + ',' + ends.indexOf(b);
      if (done.has(key(e1, e2)) || done.has(key(e2, e1))) continue;
      done.add(key(e1, e2));
      const cos = Math.max(-1, Math.min(1, e1.out[0] * e2.out[0] + e1.out[1] * e2.out[1])), th = Math.acos(cos);
      if (th > 175 * Math.PI / 180 || th < 8 * Math.PI / 180) continue;           // nearly straight on, or folded back: nothing to mitre
      const eA = clamp((e1.t / 2) / Math.tan(th) + (e2.t / 2) / Math.sin(th)), eB = clamp((e2.t / 2) / Math.tan(th) + (e1.t / 2) / Math.sin(th));
      e1.ref[e1.end === 'a' ? 'e0' : 'e1'] = eA;
      if (e2.k === 's') e2.ref[e2.end === 'a' ? 'e0' : 'e1'] = eB;
      else { const w = e2.ref, h = e2.out[0] !== 0;                              // carry the rectangle on along its own axis
        if (h) { if (e2.end === 'a') w.x0 -= eB; else w.x1 += eB; } else { if (e2.end === 'a') w.y0 -= eB; else w.y1 += eB; } }
      // the slant starts exactly where the other wall's centre line ends
      const P = e2.P; if (e1.end === 'a') { e1.ref.p0 = [P[0], P[1]]; } else { e1.ref.p1 = [P[0], P[1]]; }
    }
    for (const S of slants) {                                                     // direction and length may have shifted a little
      const dx = S.p1[0] - S.p0[0], dy = S.p1[1] - S.p0[1], len = Math.hypot(dx, dy), shift = len - S.len;
      S.len = len; S.u = [dx / len, dy / len]; S.nl = [S.u[1], -S.u[0]]; S.nr = [-S.u[1], S.u[0]];
      if (Math.abs(shift) > 1e-9 && S.openings.length) { /* openings stay where they were measured from the start of the line */ }
      S.poly = slantPoly(S);
    }
  }

  const COMPASS = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'], COMPASS_ID = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  // which way the wall lies from the room: the face's normal points into the room, so the wall is the other way
  function compassOf(n) { const a = (Math.atan2(-n[0], n[1]) * 180 / Math.PI + 360) % 360; return Math.round(a / 45) % 8; }
  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // ------------------------------------------------------------------ build
  function build(src) {
    const problems = validate(src);
    if (problems.length) { const e = new Error('This house file has problems:\n- ' + problems.join('\n- ')); e.problems = problems; throw e; }
    src = JSON.parse(JSON.stringify(src));
    const heights = Object.assign({}, DEFAULT_HEIGHTS, src.heights || {});
    const E = (src.wallThickness && src.wallThickness.exterior) || 0.5, T = (src.wallThickness && src.wallThickness.interior) || 0.33;
    const { ortho: walls, slants: rawSlants } = splitWalls(src.walls, E, T);
    const orig = walls.map(w => (w.x1 - w.x0) >= (w.y1 - w.y0) ? { axis: 'h', c: (w.y0 + w.y1) / 2, a: w.x0, b: w.x1 } : { axis: 'v', c: (w.x0 + w.x1) / 2, a: w.y0, b: w.y1 });   // centre lines before joinery
    joinWalls(walls);
    const slants = rawSlants.map((w, i) => slantGeometry(w, i, heights));
    if (slants.length) joinSlants(slants, walls, orig);
    for (const S of slants) if (!S.poly) S.poly = slantPoly(S);
    // every opening gets its resolved height span, so renderers never need the defaults
    for (const w of walls) for (const o of w.openings || []) {
      if (o.type === 'window') { o.z0 = o.sill ?? heights.windowSill; o.z1 = o.head ?? heights.windowHead; }
      else { o.z0 = 0; o.z1 = o.height ?? heights.door; }
    }
    const plan = src.plan || {};
    let W = src.W, D = src.D;                                           // a bay or a curve can stand out past the size the file gives: the plan is as big as everything in it
    for (const S of slants) for (const q of slantPoly(S)) { W = Math.max(W, Math.ceil(q[0] * 100) / 100); D = Math.max(D, Math.ceil(q[1] * 100) / 100); }
    const HOUSE = {
      id: src.id || 'house', name: src.name || 'My house', subtitle: src.subtitle || '',
      W, D, E, T, heights,
      floor: Object.assign({ name: 'Floor', color: '#B09672', plankW: 7 / 12, plankL: 4, dir: 'x' }, src.floor || {}),
      floorRects: src.floorRects || [[E, E, W - E, D - E]],
      walls, slants, fixtures: src.fixtures || [], items: src.items || [],
      start: src.start || null, renderRooms: src.renderRooms || null,
      tints: plan.tints || [], labels: plan.labels || [], plan
    };
    const ROOMS = buildRooms(HOUSE, src.rooms, src.roomOrder);
    // with angled walls the outline is not a rectangle, so the floor is what the rooms cover (unless the file says otherwise)
    if (slants.length && !src.floorRects) HOUSE.floorRects = ROOMS.rooms.flatMap(r => r.shape);
    if (!HOUSE.start) HOUSE.start = startPoint(HOUSE, ROOMS);
    if (!HOUSE.renderRooms) HOUSE.renderRooms = ROOMS.rooms.filter(r => r.area >= 40).map(r => r.id);
    return { HOUSE, ROOMS };
  }

  // ------------------------------------------------------------------ ceilings
  // A room's ceiling is flat (at the house height, or its own), a shed (one plane, rising toward n/e/s/w), or a vault (two planes
  // meeting at a ridge down the middle of the room, along x or y). The shapes work from the room's bounding box.
  function ceilingSpec(spec, bbox, def) {
    if (typeof spec === 'number') return { type: 'flat', h: spec };
    if (!spec || (spec.type || 'flat') === 'flat') return { type: 'flat', h: spec && spec.height !== undefined ? spec.height : def };
    if (spec.type === 'shed') return { type: 'shed', low: spec.low, high: spec.high, rise: spec.rise || 'n', bbox };
    return { type: 'vault', eave: spec.eave, peak: spec.peak, ridge: spec.ridge || 'x', bbox };
  }
  function ceilingH(c, x, y) {
    if (c.type === 'flat') return c.h;
    const [x0, y0, x1, y1] = c.bbox, wx = Math.max(1e-6, x1 - x0), wy = Math.max(1e-6, y1 - y0), clamp = v => Math.max(0, Math.min(1, v));
    if (c.type === 'shed') {
      const t = c.rise === 'n' ? (y1 - y) / wy : c.rise === 's' ? (y - y0) / wy : c.rise === 'e' ? (x - x0) / wx : (x1 - x) / wx;
      return c.low + (c.high - c.low) * clamp(t);
    }
    const t = c.ridge === 'x' ? 1 - Math.abs(y - (y0 + y1) / 2) / (wy / 2) : 1 - Math.abs(x - (x0 + x1) / 2) / (wx / 2);
    return c.eave + (c.peak - c.eave) * clamp(t);
  }
  const ceilingMaxOf = c => (c.type === 'flat' ? c.h : c.type === 'shed' ? Math.max(c.low, c.high) : Math.max(c.eave, c.peak));
  // where a ceiling bends: the coordinate of its ridge, as ['x' | 'y', value]
  const ceilingKinks = c => (c.type === 'vault' ? [c.ridge === 'x' ? ['y', (c.bbox[1] + c.bbox[3]) / 2] : ['x', (c.bbox[0] + c.bbox[2]) / 2]] : []);

  // ------------------------------------------------------------------ rooms + paintable surfaces
  /*
   * A "surface" is one face of one wall, cut wherever the room on that side changes. Room zones are a first-match
   * list of rectangles: walls are tested first, so a point inside any wall belongs to no room. Open-plan spaces are
   * split into rooms by the zone rectangles alone (no wall needed).
   */
  function buildRooms(H, roomList, roomOrder) {
    const CEIL = H.heights.ceiling;
    const rooms = roomList.map(r => ({ id: r.id, name: r.name || r.id, short: r.short || r.id.toUpperCase().slice(0, 4), rects: r.rects || [], polys: r.polys || [], ceilingSpec: r.ceiling }));
    const byId = Object.fromEntries(rooms.map(r => [r.id, r]));

    const walls = H.walls.filter(w => w.status !== 'removed'), slants = H.slants.filter(S => S.status !== 'removed');
    const inSlant = (x, y) => slants.some(S => { const dx = x - S.p0[0], dy = y - S.p0[1], s = dx * S.u[0] + dy * S.u[1], d = dx * S.nr[0] + dy * S.nr[1]; return s > -S.e0 && s < S.len + S.e1 && d > -S.t / 2 && d < S.t / 2; });
    const inWall = (x, y) => walls.some(w => x > w.x0 && x < w.x1 && y > w.y0 && y < w.y1) || (slants.length > 0 && inSlant(x, y));
    // with angled walls, "outside" is found by flooding in from the edge of the plan (a house with only straight walls never needs this)
    let outsideCell = null;
    if (slants.length) {
      const G = 0.1, x0 = -1, y0 = -1, nx = Math.ceil((H.W + 2) / G), ny = Math.ceil((H.D + 2) / G), blocked = new Uint8Array(nx * ny), out = new Uint8Array(nx * ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) blocked[j * nx + i] = inWall(x0 + (i + 0.5) * G, y0 + (j + 0.5) * G) ? 1 : 0;
      const stack = [0]; out[0] = 1;
      while (stack.length) {
        const k = stack.pop(), i = k % nx, j = (k / nx) | 0;
        for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) { if (a < 0 || b < 0 || a >= nx || b >= ny) continue; const q = b * nx + a; if (!blocked[q] && !out[q]) { out[q] = 1; stack.push(q); } }
      }
      outsideCell = (x, y) => {
        const i = Math.floor((x - x0) / G), j = Math.floor((y - y0) / G);
        if (i < 0 || j < 0 || i >= nx || j >= ny || out[j * nx + i]) return true;
        // a point just off a wall's face can share a cell with the wall: it is outside if the cell touches the outside
        if (blocked[j * nx + i]) for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) if (a < 0 || b < 0 || a >= nx || b >= ny || out[b * nx + a]) return true;
        return false;
      };
    }
    function roomAt(x, y) {
      if (inWall(x, y)) return null;                              // (a wall whose centre line is on the plan's edge sticks out past it)
      if (x < 0 || y < 0 || x > H.W || y > H.D) return 'exterior';
      for (const r of rooms) {
        for (const [x0, y0, x1, y1] of r.rects) if (x >= x0 && x < x1 && y >= y0 && y < y1) return r.id;
        for (const poly of r.polys) if (pointInPoly(x, y, poly)) return r.id;
      }
      return outsideCell && outsideCell(x, y) ? 'exterior' : null;
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

    // angled walls: the same idea along the line, with the face's normal pointing into the room
    const rawS = [];
    slants.forEach(S => {
      for (const side of ['lo', 'hi']) {
        const n = side === 'lo' ? S.nl : S.nr, d = S.t / 2 + OFF;
        let run = null, gapAt = null;
        const flushS = end => { if (run && end - run.a > 0.12) rawS.push({ S, side, n, room: run.room, a: run.a, b: end }); run = null; };
        for (let t = -S.e0 + STEP / 2; t < S.len + S.e1; t += STEP) {
          const r = roomAt(S.p0[0] + S.u[0] * t + n[0] * d, S.p0[1] + S.u[1] * t + n[1] * d);
          if (run && run.room === r) { gapAt = null; continue; }
          if (run && r === null) {                                          // a short stretch inside a neighbouring wall (where facets of a curve meet) does not end the run
            if (gapAt === null) gapAt = t - STEP / 2;
            if (t - gapAt > 0.2) { flushS(gapAt); gapAt = null; }
            continue;
          }
          flushS(gapAt !== null ? gapAt : t - STEP / 2); gapAt = null;
          if (r) run = { room: r, a: t - STEP / 2 };
        }
        flushS(gapAt !== null ? gapAt : S.len + S.e1);
      }
    });
    const slantOpeningArea = (S, a, b) => S.openings.reduce((t, o) => { const ov = Math.min(b, o.b) - Math.max(a, o.a); return ov > 0 && (o.type === 'door' || o.type === 'window') ? t + ov * (o.z1 - o.z0) : t; }, 0);

    // the ceiling height at a point of a wall face, as the room it lies in (or, for the outside of a wall, the room behind it) has it
    let ceilings = null;                                                // set once the rooms' shapes are known (below); until then every ceiling is the house's
    const roomCeiling = id => (ceilings && ceilings[id]) || null;
    function heightAtFace(room, n, p) {
      if (room !== 'exterior') { const c = roomCeiling(room); return c ? ceilingH(c, p[0], p[1]) : CEIL; }
      for (const d of [0.45, 0.9, 1.6]) { const id = roomAt(p[0] - n[0] * d, p[1] - n[1] * d); if (id && id !== 'exterior') { const c = roomCeiling(id); return c ? ceilingH(c, p[0], p[1]) : CEIL; } }
      return CEIL;
    }
    function wallFaceArea(room, n, at, a, b) {
      const c = room === 'exterior' ? null : roomCeiling(room);
      if (c && c.type === 'flat') return (b - a) * c.h;
      if (!ceilings || (room !== 'exterior' && !c)) return (b - a) * CEIL;
      let t = 0; const N = 24;
      for (let i = 0; i < N; i++) t += heightAtFace(room, n, at(a + (b - a) * (i + 0.5) / N));
      return (b - a) * t / N;
    }
    const surfaces = [], curved = new Map();
    for (const r of rawS) {
      const S = r.S, len = r.b - r.a, h = S.t / 2, ci = compassOf(r.n);
      const pt = t => [S.p0[0] + S.u[0] * t + r.n[0] * h, S.p0[1] + S.u[1] * t + r.n[1] * h];
      if (S.arc !== null) {                                              // a face of a curve: its facets are one surface, painted as one
        const key = S.arc + '|' + r.side + '|' + r.room;
        const part = { slant: S.i, k: S.arcK, a: +r.a.toFixed(2), b: +r.b.toFixed(2), length: +len.toFixed(2),
          area: +Math.max(0, wallFaceArea(r.room, r.n, t => [S.p0[0] + S.u[0] * t, S.p0[1] + S.u[1] * t], r.a, r.b) - slantOpeningArea(S, r.a, r.b)).toFixed(1), seg: [pt(r.a).map(v => +v.toFixed(3)), pt(r.b).map(v => +v.toFixed(3))], normal: r.n.map(v => +v.toFixed(5)) };
        if (!curved.has(key)) { const g = { room: r.room, slant: S.i, side: r.side, dir: 'Curved', letter: 'C', curve: S.arc, kind: r.room === 'exterior' ? 'siding' : 'wall', parts: [] }; curved.set(key, g); surfaces.push(g); }
        curved.get(key).parts.push(part); continue;
      }
      surfaces.push({ room: r.room, slant: S.i, side: r.side, dir: COMPASS[ci], letter: COMPASS_ID[ci], normal: r.n.map(v => +v.toFixed(5)), a: +r.a.toFixed(2), b: +r.b.toFixed(2),
                      length: +len.toFixed(2), area: +Math.max(0, wallFaceArea(r.room, r.n, t => [S.p0[0] + S.u[0] * t, S.p0[1] + S.u[1] * t], r.a, r.b) - slantOpeningArea(S, r.a, r.b)).toFixed(1), seg: [pt(r.a).map(v => +v.toFixed(3)), pt(r.b).map(v => +v.toFixed(3))],
                      kind: r.room === 'exterior' ? 'siding' : 'wall' });
    }
    for (const g of curved.values()) {                                  // total up each curved surface from its facets
      g.parts.sort((p, q) => p.k - q.k);
      const mid = g.parts[g.parts.length >> 1], first = g.parts[0], last = g.parts[g.parts.length - 1];
      Object.assign(g, { normal: mid.normal, a: first.a, b: first.b, length: +g.parts.reduce((t, q) => t + q.length, 0).toFixed(2), area: +g.parts.reduce((t, q) => t + q.area, 0).toFixed(1), seg: [first.seg[0], last.seg[1]] });
    }
    for (const r of raw) {
      const w = H.walls[r.wi], len = r.b - r.a;
      const dir = r.cap ? 'Wall end' : facing[r.n.join(',')];
      const at = r.horiz ? (t => [t, r.side === 'lo' ? w.y0 : w.y1]) : (t => [r.side === 'lo' ? w.x0 : w.x1, t]);
      const area = r.cap ? r.th * CEIL : Math.max(0, wallFaceArea(r.room, r.n, at, r.a, r.b) - openingArea(w, r.a, r.b));
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
        s.id = `${short}-${s.dir === 'Wall end' ? 'END' : (s.letter || s.dir[0])}${list.length > 1 ? i + 1 : ''}`;
      });
    }
    surfaces.sort((p, q) => p.id.localeCompare(q.id, 'en', { numeric: true }));

    // room shapes: 0.25 ft grid of roomAt(), merged into rectangles; area from the same grid
    const G = slants.length ? 0.05 : 0.25, cells = {};          // finer with angled walls, so the edges follow them closely
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

    // ceilings. Only when some room has its own do the areas and the wall tops need working out again; a plain house is untouched.
    for (const r of rooms) {
      const all = r.shape.length ? r.shape : r.rects;
      const bbox = all.length ? [Math.min(...all.map(q => q[0])), Math.min(...all.map(q => q[1])), Math.max(...all.map(q => q[2])), Math.max(...all.map(q => q[3]))] : [0, 0, H.W, H.D];
      r.ceiling = ceilingSpec(r.ceilingSpec, bbox, CEIL); delete r.ceilingSpec;
    }
    const custom = rooms.some(r => !(r.ceiling.type === 'flat' && r.ceiling.h === CEIL));
    const ceilingMax = Math.max(CEIL, ...rooms.map(r => ceilingMaxOf(r.ceiling)));
    if (custom) {
      ceilings = Object.fromEntries(rooms.map(r => [r.id, r.ceiling]));
      for (const s of surfaces) {                                       // wall areas again, now that a room's ceiling can be higher, lower or sloped
        if (s.kind === 'end') continue;
        if (s.wall !== undefined) {
          const w = H.walls[s.wall], horiz = (w.x1 - w.x0) >= (w.y1 - w.y0), at = horiz ? (t => [t, s.side === 'lo' ? w.y0 : w.y1]) : (t => [s.side === 'lo' ? w.x0 : w.x1, t]);
          s.area = +Math.max(0, wallFaceArea(s.room, s.normal, at, s.a, s.b) - openingArea(w, s.a, s.b)).toFixed(1);
        } else if (s.parts) {
          for (const q of s.parts) { const S = H.slants[q.slant]; q.area = +Math.max(0, wallFaceArea(s.room, q.normal, t => [S.p0[0] + S.u[0] * t, S.p0[1] + S.u[1] * t], q.a, q.b) - slantOpeningArea(S, q.a, q.b)).toFixed(1); }
          s.area = +s.parts.reduce((t, q) => t + q.area, 0).toFixed(1);
        } else if (s.slant !== undefined) {
          const S = H.slants[s.slant];
          s.area = +Math.max(0, wallFaceArea(s.room, s.normal, t => [S.p0[0] + S.u[0] * t, S.p0[1] + S.u[1] * t], s.a, s.b) - slantOpeningArea(S, s.a, s.b)).toFixed(1);
        }
      }
      for (const r of rooms) r.wallArea = +surfaces.filter(s => s.room === r.id).reduce((t, s) => t + s.area, 0).toFixed(0);
    }
    const ceilingAt = (id, x, y) => { const r = byId[id]; return r ? ceilingH(r.ceiling, x, y) : CEIL; };
    // the top of a wall at a point: the higher of the ceilings on its two sides (n: the wall's normal there, t: its thickness)
    function topOrNull(x, y, nx, ny, t) {
      const d = t / 2 + 0.12; let best = null;
      for (const sg of [-1, 1]) { const id = roomAt(x + nx * d * sg, y + ny * d * sg); if (id && id !== 'exterior') best = Math.max(best === null ? 0 : best, ceilingAt(id, x, y)); }
      return best;
    }
    const topAround = (x, y, nx, ny, t) => { const v = topOrNull(x, y, nx, ny, t); return v === null ? CEIL : v; };
    // each wall's top, as straight pieces along it ({ a, b, za, zb }), cut where a ceiling bends or the room on a side changes
    if (custom) {
      const kinks = rooms.flatMap(r => ceilingKinks(r.ceiling));
      const profile = (len, from, pt, nrm, thick, cutsIn) => {                   // from: coordinate of the start; pt(t): the point; cutsIn: extra cuts (absolute)
        const cuts = new Set([from, from + len, ...cutsIn.filter(c => c > from + 1e-3 && c < from + len - 1e-3)]), ts = [...cuts].sort((p, q) => p - q), out = [];
        const side = (a, b, sg) => {                                              // the ceiling of the room on one side, as a straight line along this piece (null if no room there)
          const good = [];
          for (let k = 0; k < 7; k++) {
            const t = a + (b - a) * (0.06 + 0.88 * k / 6), q = pt(t), d = thick / 2 + 0.12, id = roomAt(q[0] + nrm[0] * d * sg, q[1] + nrm[1] * d * sg);
            if (id && id !== 'exterior') good.push([t, ceilingAt(id, q[0], q[1])]);
          }
          if (!good.length) return null;
          const g0 = good[0], g1 = good[good.length - 1], k = g1[0] > g0[0] + 1e-6 ? (g1[1] - g0[1]) / (g1[0] - g0[0]) : 0;
          return { za: g0[1] + k * (a - g0[0]), zb: g0[1] + k * (b - g0[0]) };
        };
        const put = (a, b, za, zb) => out.push({ a: +a.toFixed(3), b: +b.toFixed(3), za: +za.toFixed(3), zb: +zb.toFixed(3) });
        for (let i = 0; i < ts.length - 1; i++) {
          const a = ts[i], b = ts[i + 1], L = side(a, b, -1), R = side(a, b, 1);
          if (!L && !R) { put(a, b, CEIL, CEIL); continue; }
          if (!L || !R) { const o = L || R; put(a, b, o.za, o.zb); continue; }
          const da = L.za - R.za, db = L.zb - R.zb;                               // the wall is as high as the higher side: where the two cross, the top bends
          if (da * db < -1e-9) {
            const m = a + (b - a) * da / (da - db), zm = L.za + (L.zb - L.za) * (m - a) / (b - a);
            put(a, m, Math.max(L.za, R.za), zm); put(m, b, zm, Math.max(L.zb, R.zb));
          } else put(a, b, Math.max(L.za, R.za), Math.max(L.zb, R.zb));
        }
        return out;
      };
      H.walls.forEach((w, wi) => {
        if (w.status === 'removed') return;
        const horiz = (w.x1 - w.x0) >= (w.y1 - w.y0), s0 = horiz ? w.x0 : w.y0, e0 = horiz ? w.x1 : w.y1;
        const cuts = [];
        for (const sf of surfaces) if (sf.wall === wi && sf.kind !== 'end') cuts.push(sf.a, sf.b);
        for (const [ax, v] of kinks) if ((horiz && ax === 'x') || (!horiz && ax === 'y')) cuts.push(v);
        const mid = horiz ? (w.y0 + w.y1) / 2 : (w.x0 + w.x1) / 2, th = horiz ? w.y1 - w.y0 : w.x1 - w.x0;
        w.tops = profile(e0 - s0, s0, horiz ? (t => [t, mid]) : (t => [mid, t]), horiz ? [0, 1] : [1, 0], th, cuts);
      });
      H.slants.forEach((S, si) => {
        if (S.status === 'removed') return;
        const cuts = [];
        for (const sf of surfaces) if (sf.slant === si) cuts.push(sf.a, sf.b);
        for (const [ax, v] of kinks) {                                     // where the line crosses the ridge
          const du = ax === 'x' ? S.u[0] : S.u[1], p0 = ax === 'x' ? S.p0[0] : S.p0[1];
          if (Math.abs(du) > 1e-6) cuts.push((v - p0) / du);
        }
        S.tops = profile(S.len + S.e0 + S.e1, -S.e0, t => [S.p0[0] + S.u[0] * t, S.p0[1] + S.u[1] * t], S.nr, S.t, cuts);
      });
    }
    return { rooms, byId, order, surfaces, roomAt, ceilingHeight: CEIL, ceilingMax, ceilingAt, topAround, doorHeight: H.heights.door, windowHead: H.heights.windowHead };
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
      return { id: r.id, name: r.name, area: r.area, rects: out.map(q => q.map(v => +v.toFixed(3))), ceiling: r.ceiling };
    });
    const surfaces = R.surfaces.map(s => ({ id: s.id, name: s.name, room: s.room, wall: s.wall, slant: s.slant, side: s.side, kind: s.kind, dir: s.dir,
      a: s.a, b: s.b, normal: s.normal, seg: s.seg, area: s.area, parts: s.parts }));
    return {
      format: 'house-painter/built-house', version: 1, id: H.id, name: H.name,
      W: H.W, D: H.D, E: H.E, T: H.T, heights: H.heights, floor: H.floor, floorRects: H.floorRects,
      walls: H.walls, slants: H.slants, fixtures: H.fixtures, items: H.items, renderRooms: H.renderRooms,
      surfaces, rooms, ceilingHeight: R.ceilingHeight, ceilingMax: R.ceilingMax, doorHeight: R.doorHeight, windowHead: R.windowHead
    };
  }

  return { FORMAT, DEFAULT_HEIGHTS, validate, build, joinWalls, forBlender, arcInfo };
});
