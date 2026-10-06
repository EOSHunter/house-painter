/*
 * Fleetwood Waterford Park 4563C \u2014 remodel model (Rev A)
 * Units: feet. Origin = back-left (north-west) outside corner. +x \u2192 east/right, +y \u2192 south/front.
 * Source: original 1998 Fleetwood sheet, re-traced, plus photos of the current remodel.
 *
 * status: 'keep' (default) | 'removed' (existed in the original, gone now) | 'new'
 * walls  : filled rectangles; openings are measured along the wall's long axis (absolute feet)
 *          type 'door' {hinge:'a'|'b', swing:'n|s|e|w'}, 'window' {panes}, 'cased'
 * Everything here is traced from a skewed photo of the sheet \u2192 treat as \u00b10.3 ft until field-measured.
 */
(function () {
  const W = 56, D = 26.667, E = 0.5, T = 0.33, YM = 13.2; // YM = module joint / bed1-bed2 wall
  const H = (yc, xa, xb, o = {}) => Object.assign({ x0: xa, x1: xb, y0: yc - (o.t || T) / 2, y1: yc + (o.t || T) / 2 }, o);
  const V = (xc, ya, yb, o = {}) => Object.assign({ x0: xc - (o.t || T) / 2, x1: xc + (o.t || T) / 2, y0: ya, y1: yb }, o);
  const win = (a, b, panes = 1, sill) => ({ a, b, type: 'window', panes, sill });   // sill height (ft) optional
  const door = (a, b, hinge, swing) => ({ a, b, type: 'door', hinge, swing });

  const walls = [
    // ---- exterior ----
    { x0: 0, y0: 0, x1: W, y1: E, ext: 1, openings: [
      win(3.9, 7.7),                       // bedroom 1
      door(13.8, 16.8, 'a', 'n'),          // utility back door
      win(21.7, 24.1, 1, 3.6), win(24.4, 26.9, 1, 3.6),    // kitchen, over sink (sits above the counter + backsplash)
      win(31.0, 33.4), win(39.0, 41.4),    // dining
      win(52.0, 54.4)                      // master bedroom
    ] },
    { x0: 0, y0: D - E, x1: W, y1: D, ext: 1, openings: [
      win(6.9, 10.9),                      // bedroom 2
      door(20.3, 23.3, 'a', 'n'),          // front door
      win(29.5, 37.7, 3),                  // living-room triple window
      win(43.9, 46.3)                      // master bath
    ] },
    { x0: 0, y0: E, x1: E, y1: D - E, ext: 1 },
    { x0: W - E, y0: E, x1: W, y1: D - E, ext: 1, openings: [win(1.4, 3.9)] },

    // ---- west wing: bed 1 / utility / bed 2 / closets ----
    V(10.7, E, YM + T / 2, { id: 'bed1-east', openings: [door(9.8, 12.5, 'b', 'w')] }),
    H(YM, E, 15.0, { id: 'bed1-south', openings: [door(0.5, 2.4, 'b', 's')] }),
    V(14.65, YM, D - E, { id: 'bed2-east', openings: [door(13.55, 16.0, 'a', 'w')] }),
    V(3.8, YM, D - E, { id: 'closets-east', openings: [door(22.0, 24.2, 'b', 'e')] }),
    H(19.7, E, 3.8),
    V(18.8, E, YM, { id: 'kitchen-west' }),
    H(9.74, 10.7, 18.8, { openings: [door(13.1, 15.2, 'a', 'n')] }),     // utility south partition + door
    // water heater / pump closet in the SW corner of the utility room (panel pops off for access)
    H(5.5, 10.7, 12.95),
    V(12.95, 5.5, 9.74, { openings: [{ a: 6.0, b: 9.2, type: 'panel' }] }),

    // ---- hall bath / guest closet ----
    H(16.25, 14.65, 24.2, { openings: [door(14.8, 17.1, 'a', 's'), door(21.1, 23.2, 'a', 'n')] }),
    V(20.1, 16.25, D - E),
    V(24.2, 16.25, 18.75),
    H(18.75, 20.1, 24.2),

    // ---- kitchen edges ----
    H(YM, 18.8, 21.1),                                                   // under pantry cabinet
    V(24.7, 10.9, YM),                                                   // desk nook west
    H(YM, 24.5, 29.9),                                                   // desk nook back
    V(29.7, 9.1, YM, { id: 'stub' }),                                    // stub wall east of desk (stays)

    // ---- master suite ----
    V(42.5, E, YM, { id: 'master-west' }),
    H(YM, 42.35, 44.4),                                                  // return at master entry
    V(44.2, YM, 16.25, { openings: [door(13.5, 16.0, 'b', 'e')] }),      // master bedroom door (jambs + leaf)
    H(16.25, 42.35, 51.6, { openings: [door(48.8, 51.6, 'b', 's')] }),   // bath north wall + bath door
    V(42.5, 16.25, D - E, { id: 'mbath-west' }),                         // bath west wall (borders the living room)
    H(YM, 51.6, W - E),                                                  // walk-in closet top
    V(51.6, YM, 20.4, { openings: [door(13.55, 15.6, 'a', 'e')] }),      // closet west + door
    H(20.4, 51.6, W - E),
    V(51.6, 20.4, D - E, { openings: [door(20.8, 22.8, 'b', 'w')] }),    // toilet / shower room

    // ---- REMOVED: solid part of the dining/living divider (fireplace wall) ----
    H(9.2, 33.0, 39.1, { t: 0.45, status: 'removed', id: 'divider' })
  ];
  joinWalls(walls);

  /*
   * Wall joinery: walls were traced centre-to-centre, which leaves notches at L corners and walls
   * poking through each other at T junctions. Resolve every end against the perpendicular wall it meets:
   *   T junction \u2192 the stem stops at the near face of the through-wall
   *   L corner   \u2192 the horizontal wall runs to the far face (covers the corner), the vertical stops at its face
   * Ends within 0.2 ft of a wall are snapped to it (tracing slop). Openings are clamped to the new extents.
   */
  function joinWalls(list) {
    const live = list.filter(w => w.status !== 'removed');
    const isH = w => (w.x1 - w.x0) >= (w.y1 - w.y0);
    const SNAP = 0.2, EPS = 0.01;
    const hits = (w, along, across) => isH(w)   // is the point (along-axis value of a perpendicular wall, its centre) on w?
      ? (along >= w.y0 - SNAP && along <= w.y1 + SNAP && across >= w.x0 - EPS && across <= w.x1 + EPS)
      : (along >= w.x0 - SNAP && along <= w.x1 + SNAP && across >= w.y0 - EPS && across <= w.y1 + EPS);
    const edits = [];
    for (const w of live) {
      const h = isH(w), c = h ? (w.y0 + w.y1) / 2 : (w.x0 + w.x1) / 2;
      for (const end of ['s', 'e']) {
        const p = h ? (end === 's' ? w.x0 : w.x1) : (end === 's' ? w.y0 : w.y1);
        for (const j of live) {
          if (j === w || isH(j) === h || !hits(j, p, c)) continue;
          const jc = h ? (j.x0 + j.x1) / 2 : (j.y0 + j.y1) / 2;          // j's centre across w's axis
          const jEnds = h ? [j.y0, j.y1] : [j.x0, j.x1];
          const corner = jEnds.some(q => hits(w, q, jc));               // j also ends on w \u2192 L corner
          let np;
          if (corner && h) np = end === 's' ? j.x0 : j.x1;               // horizontal covers the corner square
          else if (corner) np = end === 's' ? j.y1 : j.y0;               // vertical stops at the horizontal's face
          else np = h ? (end === 's' ? j.x1 : j.x0) : (end === 's' ? j.y1 : j.y0);   // T: stop at near face
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

  // floor tints (interior rectangles) \u2014 everything else inside the house is the open area
  const rooms = [
    { k: 'bed',   x0: 0.5,   y0: 0.5,   x1: 10.53, y1: YM - T / 2 },                    // bedroom 1
    { k: 'clos',  x0: 0.5,   y0: YM + T / 2, x1: 3.63, y1: 19.53 },                       // closet 1
    { k: 'clos',  x0: 0.5,   y0: 19.87, x1: 3.63, y1: D - E },                            // closet 2
    { k: 'bed',   x0: 3.97,  y0: YM + T / 2, x1: 14.48, y1: D - E },                      // bedroom 2
    { k: 'wet',   x0: 14.82, y0: 16.42, x1: 19.93, y1: D - E },                           // hall bath
    { k: 'clos',  x0: 20.27, y0: 16.42, x1: 24.03, y1: 18.58 },                           // guest closet
    { k: 'util',  x0: 10.87, y0: 0.5,   x1: 18.63, y1: 9.57 },                            // utility
    { k: 'bed',   x0: 42.67, y0: 0.5,   x1: 55.5,  y1: YM - T / 2 },                      // master bedroom
    { k: 'bed',   x0: 44.4,  y0: YM - T / 2, x1: 51.45, y1: 16.08 },                      // master entry gallery
    { k: 'clos',  x0: 51.77, y0: YM + T / 2, x1: 55.5, y1: 20.23 },                       // master closet
    { k: 'wet',   x0: 42.67, y0: 16.42, x1: 51.45, y1: D - E },                           // master bath
    { k: 'wet',   x0: 51.77, y0: 20.57, x1: 55.5,  y1: D - E }                            // toilet + shower
  ];

  const fixtures = [
    // ---- laundry / utility ----
    { k: 'heater', cx: 11.8, cy: 6.65, r: 0.7 },                                          // water heater (SW alcove)
    { k: 'pumps', x: 11.1, y: 8.0, w: 1.45, h: 1.4 },                                     // well/pressure pumps
    { k: 'front', x: 10.87, y: 0.6, w: 2.45, h: 2.2, label: 'WASHER' },                   // under the west shelf
    { k: 'front', x: 10.87, y: 2.95, w: 2.45, h: 2.2, label: 'DRYER' },
    { k: 'barn', x1: 13.1, x2: 15.2, y: 9.74 },                                           // sliding barn door on the hall side
    { k: 'shelf', x: 10.87, y: 0.55, w: 1.0, h: 4.7 },                                    // shelf above W/D (west wall)
    { k: 'shelf', x: 17.5, y: 0.55, w: 1.05, h: 4.8, label: 'WIRE SHELF' },              // east wall

    // ---- kitchen (L along north + west walls, island, desk) ----
    { k: 'box', c: 'cabB', x: 18.97, y: 0.5, w: 9.4, h: 2.0, paint: 'kbase', front: 's' },                           // north run
    { k: 'sink2', x: 23.1, y: 0.75, w: 2.4, h: 1.4 },
    { k: 'box', c: 'cabB', x: 18.97, y: 2.5, w: 2.0, h: 1.5, paint: 'kbase', front: 'e' },                           // corner base
    { k: 'range', x: 18.97, y: 4.0, w: 2.1, h: 2.5 },
    { k: 'box', c: 'cabB', x: 18.97, y: 6.5, w: 2.0, h: 1.2, paint: 'kbase', front: 'e' },
    { k: 'box', c: 'app', x: 18.97, y: 7.7, w: 2.6, h: 3.0, label: 'FRIDGE', size: 8 },
    { k: 'box', c: 'cabB', x: 18.97, y: 10.7, w: 2.15, h: 2.33, label: 'PANTRY', size: 7.5, paint: 'pantry', front: 'e' },
    { k: 'box', c: 'cabB', x: 23.7, y: 5.6, w: 3.9, h: 2.4, label: 'ISLAND', size: 9, paint: 'island', front: 's' },
    // desk nook (walls: x=24.7, y=13.2, stub x=29.7)
    { k: 'box', c: 'counter', x: 24.87, y: 11.0, w: 4.65, h: 2.03 },
    { k: 'box', c: 'cabB', x: 24.87, y: 11.0, w: 1.85, h: 2.03, paint: 'deskbase', front: 'n' },
    { k: 'dash', x1: 26.8, y1: 11.45, x2: 29.4, y2: 11.45 },                            // upper cabinets above desk
    { k: 'label', x: 28.1, y: 12.4, t: 'DESK', size: 8, weight: 600 },
    // wall cabinets + backsplash (heights in ft; from the kitchen photos). Not drawn on the plan.
    { k: 'upper', x: 18.97, y: 0.5,  w: 2.68, h: 1.0, z0: 4.5, z1: 7.0, paint: 'uppers', front: 's' },
    { k: 'upper', x: 26.95, y: 0.5,  w: 1.42, h: 1.0, z0: 4.5, z1: 7.0, paint: 'uppers', front: 's' },
    { k: 'upper', x: 18.97, y: 2.5,  w: 1.0,  h: 1.5, z0: 4.5, z1: 7.0, paint: 'uppers', front: 'e' },
    { k: 'upper', x: 18.97, y: 4.0,  w: 1.0,  h: 2.5, z0: 6.3, z1: 7.0, paint: 'uppers', front: 'e' },
    { k: 'upper', x: 18.97, y: 6.5,  w: 1.0,  h: 1.2, z0: 4.5, z1: 7.0, paint: 'uppers', front: 'e' },
    { k: 'upper', x: 18.97, y: 7.7,  w: 2.0,  h: 3.0, z0: 6.0, z1: 7.5, paint: 'uppers', front: 'e' },
    { k: 'upper', x: 24.9,  y: 12.03, w: 4.52, h: 1.0, z0: 4.5, z1: 7.0, paint: 'deskup', front: 'n' },
    { k: 'splash', x: 18.97, y: 0.5,  w: 2.68, h: 0.02, z0: 3.125, z1: 4.5 },
    { k: 'splash', x: 21.65, y: 0.5,  w: 5.3,  h: 0.02, z0: 3.125, z1: 3.55 },          // under the sink window
    { k: 'splash', x: 26.95, y: 0.5,  w: 1.42, h: 0.02, z0: 3.125, z1: 4.5 },
    { k: 'splash', x: 18.97, y: 2.5,  w: 0.02, h: 5.2,  z0: 3.125, z1: 4.5 },
    { k: 'splash', x: 24.87, y: 13.01, w: 4.65, h: 0.02, z0: 2.625, z1: 4.5 },

    // ---- hall bath ----
    { k: 'box', c: 'cabW', x: 17.9, y: 16.42, w: 2.03, h: 3.6, paint: 'hvanity', front: 'w' },
    { k: 'oval', cx: 18.92, cy: 18.2, rx: 0.55, ry: 0.78 },
    { k: 'toilet', cx: 18.98, cy: 21.3, dir: 'w' },
    { k: 'tub', x: 14.82, y: 23.95, w: 5.11, h: 2.22 },

    // ---- master bath ----
    { k: 'box', c: 'cabW', x: 42.67, y: 16.42, w: 1.95, h: 1.55, label: 'LINEN', size: 7, paint: 'mvanity', front: 'e' },
    { k: 'box', c: 'cabW', x: 42.67, y: 17.97, w: 1.95, h: 3.5, paint: 'mvanity', front: 'e' },
    { k: 'oval', cx: 43.65, cy: 19.7, rx: 0.55, ry: 0.78 },
    { k: 'box', c: 'cabW', x: 47.8, y: 24.3, w: 3.65, h: 1.87, paint: 'mvanity', front: 'n' },
    { k: 'oval', cx: 49.62, cy: 25.25, rx: 0.78, ry: 0.55 },
    { k: 'toilet', cx: 54.55, cy: 22.0, dir: 'w' },
    { k: 'shower', x: 52.0, y: 23.75, w: 3.5, h: 2.42 },
    { k: 'label', x: 45.2, y: 25.0, t: 'former tub area', sub: 'open \u2014 layout TBD', size: 8, st: 'new', italic: 1 },

    // ---- REMOVED in the remodel ----
    { k: 'gtub', x: 42.67, y: 21.8, w: 4.9, h: 4.37, st: 'removed' },
    { k: 'skylight', x: 44.2, y: 21.9, w: 1.9, h: 3.8, st: 'removed' },
    { k: 'fireplace', x: 33.6, y: 9.4, w: 5.0, h: 1.9, st: 'removed' },
    { k: 'arch', x1: 29.9, x2: 33.0, y: 9.2, st: 'removed' },
    { k: 'arch', x1: 39.1, x2: 42.33, y: 9.2, st: 'removed' },

    // ---- outside ----
    { k: 'steps', x: 18.3, y: 26.667, w: 6.5, h: 4.6, label: 'ENTRANCE' },
    { k: 'deck', x: 13.6, y: -2.4, w: 3.6, h: 2.4, label: 'BACK STEPS' }
  ];

  const labels = [
    { x: 5.4, y: 6.3, t: 'BEDROOM', sub: '10\'-2" \u00d7 13\'-0"' },
    { x: 2.15, y: 16.2, t: 'WALK-IN', t2: 'CLOSET', size: 8 },
    { x: 2.15, y: 22.9, t: 'WALK-IN', t2: 'CLOSET', size: 8 },
    { x: 9.3, y: 19.6, t: 'BEDROOM', sub: '10\'-4" \u00d7 12\'-10"' },
    { x: 15.0, y: 3.6, t: 'UTILITY' },
    { x: 24.2, y: 4.1, t: 'KITCHEN' },
    { x: 36.0, y: 4.3, t: 'DINING AREA' },
    { x: 33.0, y: 20.6, t: 'LIVING ROOM' },
    { x: 22.15, y: 22.5, t: 'FOYER' },
    { x: 22.15, y: 17.5, t: 'GUEST', t2: 'CLOSET', size: 8 },
    { x: 17.0, y: 21.0, t: 'BATH', size: 10, rot: -90 },
    { x: 19.3, y: 14.8, t: 'HALL', size: 9, italic: 1 },
    { x: 49.3, y: 6.5, t: 'MASTER', t2: 'BEDROOM', sub: '12\'-10" \u00d7 13\'-0"' },
    { x: 53.55, y: 16.7, t: 'WALK-IN', t2: 'CLOSET', size: 8 },
    { x: 47.4, y: 19.6, t: 'M. BATH' }
  ];

  // Flooring: one product through the whole house (baths, closets and utility included).
  // Colour sampled from the shop photo; planks run east\u2013west (long dimension of the house).
  const floor = { name: 'Desert Sand', spec: '4.5 mm / 12 mil rigid-core LVP', color: '#b09672', plankW: 7 / 12, plankL: 4, dir: 'x', texture: 'textures/desert_sand_plank.png' };

  window.HOUSE = { W, D, E, T, YM, floor, walls, rooms, fixtures, labels };
})();
