/*
 * Plan editor: trace a blueprint into a house file (docs/house-format.md).
 *
 * Editor model (feet, same axes as the house file):
 *   wall    { uid, axis: 'h'|'v', c (centre line), a, b (extent along the axis), t, ext, status, extra, openings[] }
 *           an angled wall has axis 'l' and p [x0,y0,x1,y1] (its centre line); a = 0, b = its length, c = 0, and its openings
 *           run along the line from its start (swing 'l'/'r' = left/right of the way it runs)
 *   opening { uid, type, a, b, ...door/window fields }       (a, b absolute along the wall's axis, as in the file)
 *   room    { uid, id, name, short, rects, polys?, extra }   (first match wins, as in the file; polys are outlines [[x,y],...])
 *   split   { uid, axis, c, a, b }                          (invisible zone lines that divide open-plan rooms)
 *   underlay{ key, name, w, h, s (ft per px), ox, oy, rot, opacity, calibrated }   (the image itself is in IndexedDB)
 * Everything the editor doesn't edit yet (fixtures, items, plan extras, ...) rides along in S.keep.
 * Saved files are shifted so the outside corner sits at 0,0.
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const svg = $('#plan');
  const COARSE = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  const GRID = 1 / 12, SNAP_PX = COARSE ? 16 : 9, HANDLE_PX = COARSE ? 11 : 6, AUTOSAVE = 'housepainter.editor.v1', BACKUP = 'housepainter.editor.v1.prev';
  const LOCAL_HOUSE = 'housepainter.localHouse';
  const r4 = v => Math.round(v * 1e4) / 1e4;
  let uidN = 1; const uid = () => 'u' + (uidN++).toString(36);
  const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };

  // ------------------------------------------------------------------ units: 12'-6" in, feet out
  function parseLen(str) {
    if (typeof str === 'number') return str;
    const s = String(str).trim().toLowerCase().replace(/\s*(feet|foot|ft)\b/g, "'").replace(/\s*(inches|inch|in)\b/g, '"').replace(/[\u2019\u2032]/g, "'").replace(/[\u201d\u2033]/g, '"');
    if (!s) return NaN;
    let m = /^(-?\d*\.?\d+)\s*"$/.exec(s); if (m) return +m[1] / 12;
    m = /^(-?\d*\.?\d+)\s*(?:'\s*-?\s*(?:(\d*\.?\d+)\s*"?)?)?$/.exec(s); if (m) return +m[1] + (m[2] ? +m[2] / 12 : 0);
    m = /^(\d+)\s*-\s*(\d*\.?\d+)\s*"?$/.exec(s); if (m) return +m[1] + +m[2] / 12;
    return NaN;
  }
  function fmt(ft) {
    if (!isFinite(ft)) return '';
    const neg = ft < 0; ft = Math.abs(ft);
    let f = Math.floor(ft + 1e-9), i = Math.round((ft - f) * 48) / 4;
    if (i >= 12) { f++; i = 0; }
    return (neg ? '-' : '') + (i ? `${f}'-${i}"` : `${f}'`);
  }

  // ------------------------------------------------------------------ state
  const DEF = { heights: { ceiling: 8, door: 6.667, windowHead: 6.667, windowSill: 3 }, wallThickness: { exterior: 0.5, interior: 0.375 },
    floor: { name: 'Natural oak', color: '#B58E62', plankW: 0.5, plankL: 4, dir: 'x' } };
  const blank = () => ({ meta: { id: 'my-house', name: 'My house', subtitle: '' }, heights: { ...DEF.heights }, wallThickness: { ...DEF.wallThickness },
    floor: { ...DEF.floor }, walls: [], rooms: [], splits: [], keep: {}, underlay: null });
  let S = blank();
  let tool = 'select', dimStart = null, wallMode = 'ext', wallAngle = false, lastMods = {}, sel = null, drag = null, draw = null, ghost = null, lenBuf = '', lastP = [0, 0], spaceDown = false;
  let view = { x: -6, y: -6, w: 72 }, underURL = null, underImg = null, stepCur = 0, welcomeOff = false;

  const byUid = u => S.walls.find(w => w.uid === u) || S.rooms.find(r => r.uid === u) || S.splits.find(s => s.uid === u) || (S.keep.fixtures || []).find(f => f.uid === u) || planItems().find(x => x.uid === u);
  const planItems = () => { const P = S.keep.plan; return P ? [...(P.labels || []), ...(P.dims || [])] : []; };
  const planOf = () => (S.keep.plan ||= {});
  const findOpening = u => { for (const w of S.walls) { const o = w.openings.find(x => x.uid === u); if (o) return { w, o }; } return null; };
  const isL = w => w.axis === 'l';
  const isSlant = w => isL(w) && Math.abs(w.p[2] - w.p[0]) > 1e-4 && Math.abs(w.p[3] - w.p[1]) > 1e-4;       // an angled wall that is not square to the plan
  const lineLen = w => Math.hypot(w.p[2] - w.p[0], w.p[3] - w.p[1]);
  const lineU = w => { const L = lineLen(w) || 1; return [(w.p[2] - w.p[0]) / L, (w.p[3] - w.p[1]) / L]; };
  const lineN = w => { const u = lineU(w); return [-u[1], u[0]]; };                       // the right-hand side of the way the line runs
  const setLine = (w, q) => { w.p = q.map(r4); w.a = 0; w.b = r4(lineLen(w)); w.c = 0; };
  const toLocal = (w, [x, y]) => { const u = lineU(w), n = lineN(w), dx = x - w.p[0], dy = y - w.p[1]; return [dx * u[0] + dy * u[1], dx * n[0] + dy * n[1]]; };
  const fromLocal = (w, t, o = 0) => { const u = lineU(w), n = lineN(w); return [w.p[0] + u[0] * t + n[0] * o, w.p[1] + u[1] * t + n[1] * o]; };
  const lineTf = w => `translate(${+w.p[0].toFixed(4)} ${+w.p[1].toFixed(4)}) rotate(${+(Math.atan2(w.p[3] - w.p[1], w.p[2] - w.p[0]) * 180 / Math.PI).toFixed(4)})`;
  // an angled wall as a level one in its own frame (x along the wall, y to its right), so the drawing code for straight walls serves both
  const levelOf = w => ({ ...w, axis: 'h', c: 0, a: 0, b: w.b, openings: w.openings.map(o => ({ ...o, swing: o.swing === 'l' ? 'n' : o.swing === 'r' ? 's' : o.swing })) });
  const rectOf = w => {
    if (isL(w)) { const h = w.t / 2, cs = [[0, -h], [w.b, -h], [w.b, h], [0, h]].map(([t, o]) => fromLocal(w, t, o)), xs = cs.map(c => c[0]), ys = cs.map(c => c[1]);
      return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; }
    return w.axis === 'h' ? { x0: w.a, x1: w.b, y0: w.c - w.t / 2, y1: w.c + w.t / 2 } : { x0: w.c - w.t / 2, x1: w.c + w.t / 2, y0: w.a, y1: w.b };
  };
  const ends = w => isL(w) ? [[w.p[0], w.p[1]], [w.p[2], w.p[3]]] : w.axis === 'h' ? [[w.a, w.c], [w.b, w.c]] : [[w.c, w.a], [w.c, w.b]];
  // along / across take a wall (or, for straight ones, just its axis)
  const along = (w, p) => { const a = w.axis || w; return a === 'l' ? toLocal(w, p)[0] : a === 'h' ? p[0] : p[1]; };
  const across = (w, p) => { const a = w.axis || w; return a === 'l' ? toLocal(w, p)[1] : a === 'h' ? p[1] : p[0]; };
  const live = () => S.walls.filter(w => w.status !== 'removed');
  // is the point inside the wall (angled walls run on half a thickness at each end, so corners leave no crack)
  const inWallBox = (w, x, y) => {
    if (isL(w)) { const [t, o] = toLocal(w, [x, y]); return t > -w.t / 2 && t < w.b + w.t / 2 && Math.abs(o) < w.t / 2; }
    const r = rectOf(w); return x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1;
  };
  const inPoly = (x, y, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const polyArea = poly => Math.abs(poly.reduce((t, q, i) => { const n = poly[(i + 1) % poly.length]; return t + q[0] * n[1] - n[0] * q[1]; }, 0)) / 2;
  const roomArea = r => r.rects.reduce((t, q) => t + (q[2] - q[0]) * (q[3] - q[1]), 0) + (r.polys || []).reduce((t, q) => t + polyArea(q), 0);

  // ------------------------------------------------------------------ house file <-> editor model
  function fromHouse(src) {
    const s = blank();
    s.meta = { id: src.id || 'my-house', name: src.name || 'My house', subtitle: src.subtitle || '' };
    s.heights = Object.assign({}, DEF.heights, src.heights || {});
    s.wallThickness = Object.assign({}, DEF.wallThickness, src.wallThickness || {});
    s.floor = Object.assign({}, DEF.floor, src.floor || {});
    s.walls = (src.walls || []).map(w => {
      if (w.line) {                                                       // an angled (or any-direction) wall
        const { line, ext, status, openings, t, ...extra } = w, o = { uid: uid(), axis: 'l', ext: !!ext, t: t || (ext ? s.wallThickness.exterior : s.wallThickness.interior), status: status || 'keep', extra,
          openings: (openings || []).map(q => ({ uid: uid(), ...q })) };
        setLine(o, line); return o;
      }
      const { x0, y0, x1, y1, ext, status, openings, t, ...extra } = w, h = (x1 - x0) >= (y1 - y0);
      return { uid: uid(), axis: h ? 'h' : 'v', c: h ? (y0 + y1) / 2 : (x0 + x1) / 2, t: h ? y1 - y0 : x1 - x0, a: h ? x0 : y0, b: h ? x1 : y1,
        ext: !!ext, status: status || 'keep', extra, openings: (openings || []).map(o => ({ uid: uid(), ...o })) };
    });
    s.rooms = (src.rooms || []).map(r => { const { id, name, short, rects, polys, ...extra } = r;
      return { uid: uid(), id, name: name || id, short: short || '', rects: (rects || []).map(q => q.slice()), ...(polys ? { polys: polys.map(pl => pl.map(q => q.slice())) } : {}), extra }; });
    const ed = src.editor || {};
    s.splits = (ed.splits || []).map(p => ({ uid: uid(), ...p }));
    s.underlay = ed.underlay ? { ...ed.underlay } : null;
    const known = new Set(['format', 'version', 'id', 'name', 'subtitle', 'units', 'W', 'D', 'wallThickness', 'heights', 'floor', 'walls', 'rooms', 'editor']);
    s.keep = Object.fromEntries(Object.entries(src).filter(([k]) => !known.has(k)).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
    (s.keep.fixtures || []).forEach(f => { if (window.HouseFixtures.editable(f)) f.uid = uid(); });   // editor-only identity, stripped when saving
    if (s.keep.plan) { (s.keep.plan.labels || []).forEach(x => { x.uid = uid(); }); (s.keep.plan.dims || []).forEach(x => { x.uid = uid(); }); }
    return s;
  }

  // shift every x/y-like field of fixtures, plan extras, start, ... by (dx, dy)
  const XK = new Set(['x', 'x0', 'x1', 'x2', 'cx']), YK = new Set(['y', 'y0', 'y1', 'y2', 'cy']);
  function shiftDeep(v, dx, dy, key) {
    if (Array.isArray(v)) {
      if ((key === 'floorRects' || key === 'rects') && v.every(q => Array.isArray(q))) return v.map(q => [r4(q[0] + dx), r4(q[1] + dy), r4(q[2] + dx), r4(q[3] + dy)]);
      return v.map(x => shiftDeep(x, dx, dy));
    }
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = typeof x === 'number' ? (XK.has(k) ? r4(x + dx) : YK.has(k) ? r4(x + dy) : x) : shiftDeep(x, dx, dy, k);
      return o;
    }
    return v;
  }

  function toHouse() {
    if (!S.walls.length) return null;
    const rs = S.walls.map(rectOf);
    const dx = -Math.min(...rs.map(r => r.x0)), dy = -Math.min(...rs.map(r => r.y0));
    const walls = S.walls.map(w => {
      const r = rectOf(w), o = isL(w) ? { line: [r4(w.p[0] + dx), r4(w.p[1] + dy), r4(w.p[2] + dx), r4(w.p[3] + dy)] } : { x0: r4(r.x0 + dx), y0: r4(r.y0 + dy), x1: r4(r.x1 + dx), y1: r4(r.y1 + dy) };
      if (isL(w) && Math.abs(w.t - (w.ext ? S.wallThickness.exterior : S.wallThickness.interior)) > 1e-6) o.t = w.t;
      if (w.ext) o.ext = 1;
      Object.assign(o, w.extra);
      if (w.status && w.status !== 'keep') o.status = w.status;
      const d = isL(w) ? 0 : w.axis === 'h' ? dx : dy;
      if (w.openings.length) o.openings = w.openings.slice().sort((p, q) => p.a - q.a).map(op => { const { uid: _, ...rest } = op; return { ...rest, a: r4(op.a + d), b: r4(op.b + d) }; });
      return o;
    });
    const W = Math.max(...rs.map(r => r.x1)) + dx, D = Math.max(...rs.map(r => r.y1)) + dy;
    const rooms = S.rooms.map(r => ({ id: r.id, name: r.name, ...(r.short ? { short: r.short } : {}), ...(r.rects.length ? { rects: r.rects.map(q => [r4(q[0] + dx), r4(q[1] + dy), r4(q[2] + dx), r4(q[3] + dy)]) } : {}),
      ...(r.polys && r.polys.length ? { polys: r.polys.map(pl => pl.map(q => [r4(q[0] + dx), r4(q[1] + dy)])) } : {}), ...r.extra }));
    const keep = shiftDeep(S.keep, dx, dy);
    if (keep.fixtures) keep.fixtures = keep.fixtures.map(({ uid: _u, ...rest }) => rest);
    if (keep.plan) { const pl = keep.plan; for (const k of ['labels', 'dims']) if (pl[k]) pl[k] = pl[k].map(({ uid: _u, ...rest }) => rest); }
    const ids = new Set(rooms.map(r => r.id));
    if (keep.items) keep.items = keep.items.map(it => (!it.room || it.room === 'house' || ids.has(it.room) ? it : { ...it, room: 'house' }));
    if (keep.roomOrder) keep.roomOrder = keep.roomOrder.filter(id => ids.has(id));
    if (keep.renderRooms) keep.renderRooms = keep.renderRooms.filter(id => ids.has(id));
    // floor: the inside of a plain rectangle by default; any other outline gets the rooms' own shapes
    if (!keep.floorRects && !S.walls.some(isL) && S.walls.filter(w => w.ext && w.status !== 'removed').length !== 4 && rooms.length) keep.floorRects = rooms.flatMap(r => r.rects || []);
    const editor = {};
    if (S.underlay) editor.underlay = { ...S.underlay, ox: r4(S.underlay.ox + dx), oy: r4(S.underlay.oy + dy) };
    if (S.splits.length) editor.splits = S.splits.map(p => { const { uid: _, ...rest } = p; const d = p.axis === 'h' ? [dx, dy] : [dy, dx]; return { ...rest, c: r4(p.c + d[1]), a: r4(p.a + d[0]), b: r4(p.b + d[0]) }; });
    return Object.assign({ format: 'house-painter/house', version: 1, id: S.meta.id, name: S.meta.name }, S.meta.subtitle ? { subtitle: S.meta.subtitle } : {},
      { units: 'ft', W: r4(W), D: r4(D), wallThickness: S.wallThickness, heights: S.heights, floor: S.floor, walls, rooms }, keep,
      Object.keys(editor).length ? { editor } : {});
  }

  // one wall / room / fixture per line: readable, and small diffs in git
  function pretty(obj) {
    const line = v => JSON.stringify(v);
    const block = (arr, ind) => '[\n' + arr.map(v => ind + line(v)).join(',\n') + '\n' + ind.slice(2) + ']';
    const keys = Object.keys(obj);
    return '{\n' + keys.map((k, i) => {
      const v = obj[k];
      let s;
      if (['walls', 'rooms', 'items', 'fixtures'].includes(k) && Array.isArray(v) && v.length) s = block(v, '    ');
      else if ((k === 'plan' || k === 'editor') && v && typeof v === 'object') s = '{\n' + Object.keys(v).map(pk => `    "${pk}": ` + (Array.isArray(v[pk]) && v[pk].length ? block(v[pk], '      ') : line(v[pk]))).join(',\n') + '\n  }';
      else s = line(v);
      return `  "${k}": ${s}${i < keys.length - 1 ? ',' : ''}`;
    }).join('\n') + '\n}\n';
  }

  // ------------------------------------------------------------------ undo + autosave
  const undoS = [], redoS = [];
  const snap = () => JSON.stringify({ meta: S.meta, heights: S.heights, wallThickness: S.wallThickness, floor: S.floor, walls: S.walls, rooms: S.rooms, splits: S.splits, keep: S.keep, underlay: S.underlay });
  function checkpoint(before) { undoS.push(before || snap()); if (undoS.length > 150) undoS.shift(); redoS.length = 0; }
  function restoreSnap(str) {
    const o = JSON.parse(str), prevKey = S.underlay && S.underlay.key;
    Object.assign(S, o); if (sel && !byUid(sel.uid) && !findOpening(sel.uid)) sel = null;
    if ((S.underlay && S.underlay.key) !== prevKey) loadUnderlayImage();
    changed();
  }
  function undo() { if (!undoS.length) return; redoS.push(snap()); restoreSnap(undoS.pop()); }
  function redo() { if (!redoS.length) return; undoS.push(snap()); restoreSnap(redoS.pop()); }
  let saveT = 0;
  function autosave() { clearTimeout(saveT); saveT = setTimeout(() => lsSet(AUTOSAVE, snap()), 250); }

  // underlay images live in IndexedDB (too big for localStorage), keyed by the underlay's own key
  const idb = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((ok, bad) => { const r = indexedDB.open('house-painter-editor', 1); r.onupgradeneeded = () => r.result.createObjectStore('images'); r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); }));
    const tx = async (mode, fn) => { const db = await open(); return new Promise((ok, bad) => { const t = db.transaction('images', mode), st = t.objectStore('images'), req = fn(st); t.oncomplete = () => ok(req && req.result); t.onerror = () => bad(t.error); }); };
    return { put: (k, v) => tx('readwrite', st => st.put(v, k)).catch(() => null), get: k => tx('readonly', st => st.get(k)).catch(() => null) };
  })();

  // ------------------------------------------------------------------ view
  const vh = () => view.w * (svg.clientHeight || 1) / (svg.clientWidth || 1);
  const pxFt = () => view.w / (svg.clientWidth || 1);
  function applyView() {
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${vh()}`);
    const k = pxFt(), major = view.w > 220 ? 10 : 5;
    $('#gridMinorPath').setAttribute('stroke-width', k); $('#gridMajorPath').setAttribute('stroke-width', k);
    $('#gridA').style.display = view.w > 160 ? 'none' : '';
    const pm = $('#gridMajor'); pm.setAttribute('width', major); pm.setAttribute('height', major); $('#gridMajorPath').setAttribute('d', `M${major} 0H0V${major}`);
  }
  function toFt(e) {
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse()); return [p.x, p.y];
  }
  function zoomAt(f, cx, cy) {
    const nw = Math.max(4, Math.min(600, view.w * f)), k = nw / view.w;
    view.x = cx - (cx - view.x) * k; view.y = cy - (cy - view.y) * k; view.w = nw; applyView(); render();
  }
  function fit() {
    let b = null;
    const add = (x0, y0, x1, y1) => { b = b ? [Math.min(b[0], x0), Math.min(b[1], y0), Math.max(b[2], x1), Math.max(b[3], y1)] : [x0, y0, x1, y1]; };
    S.walls.forEach(w => { const r = rectOf(w); add(r.x0, r.y0, r.x1, r.y1); });
    if (!b && S.underlay) { const u = S.underlay, c = underCorners(); add(Math.min(...c.map(p => p[0])), Math.min(...c.map(p => p[1])), Math.max(...c.map(p => p[0])), Math.max(...c.map(p => p[1]))); void u; }
    if (!b) b = [0, 0, 60, 30];
    const pad = 4, w = b[2] - b[0] + 2 * pad, h = b[3] - b[1] + 2 * pad, asp = (svg.clientHeight || 1) / (svg.clientWidth || 1);
    view.w = Math.max(w, h / asp); view.x = (b[0] + b[2]) / 2 - view.w / 2; view.y = (b[1] + b[3]) / 2 - view.w * asp / 2;
    applyView(); render();
  }
  function underCorners() {
    const u = S.underlay, cs = Math.cos(u.rot * Math.PI / 180), sn = Math.sin(u.rot * Math.PI / 180);
    return [[0, 0], [u.w, 0], [u.w, u.h], [0, u.h]].map(([px, py]) => [u.ox + (px * cs - py * sn) * u.s, u.oy + (px * sn + py * cs) * u.s]);
  }

  // ------------------------------------------------------------------ geometry helpers
  function roomAt(x, y) {                                       // first match, walls excluded (same rule as house-core)
    for (const w of live()) if (inWallBox(w, x, y)) return null;
    for (const r of S.rooms) {
      for (const [x0, y0, x1, y1] of r.rects) if (x >= x0 && x < x1 && y >= y0 && y < y1) return r;
      for (const pl of r.polys || []) if (inPoly(x, y, pl)) return r;
    }
    return null;
  }
  function wallNear(p, extra = 0, skip) {
    const tol = SNAP_PX * pxFt() + extra; let best = null;
    for (const w of live()) {
      if (w === skip) continue;
      const t = along(w, p), d = Math.abs(across(w, p) - w.c);
      if (t < w.a || t > w.b || d > w.t / 2 + tol) continue;
      if (!best || d < best.d) best = { w, t, d, side: across(w, p) > w.c ? 1 : -1 };
    }
    return best;
  }
  // snap one coordinate: to the nearest candidate within reach, else to the 1" grid
  function snapC(v, cands, free) {
    if (free) return v;
    const tol = SNAP_PX * pxFt(); let best = null, bd = tol;
    for (const c of cands) { const d = Math.abs(c - v); if (d < bd) { bd = d; best = c; } }
    return best !== null ? best : Math.round(v / GRID) * GRID;
  }
  const allEnds = (skip) => S.walls.filter(w => w !== skip).flatMap(ends);
  const coordCands = (axisOfCoord, skip) => {                   // x values (axisOfCoord 'x') or y values worth snapping to
    const out = [];
    for (const w of S.walls) {
      if (w === skip) continue;
      if (!isL(w) && (w.axis === 'v') === (axisOfCoord === 'x')) out.push(w.c);
      for (const p of ends(w)) out.push(axisOfCoord === 'x' ? p[0] : p[1]);
    }
    for (const s of S.splits) if ((s.axis === 'v') === (axisOfCoord === 'x')) out.push(s.c);
    return out;
  };
  function snapPoint(p, free, skip) {
    if (free) return { p, kind: null };
    const tol = SNAP_PX * pxFt(); let best = null, bd = tol;
    for (const q of allEnds(skip)) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = q; } }
    if (best) return { p: best.slice(), kind: 'end' };
    const near = wallNear(p, -SNAP_PX * pxFt() + 0.01, skip);
    if (near && Math.abs(across(near.w, p) - near.w.c) < near.w.t / 2 + tol) {
      if (isL(near.w)) return { p: fromLocal(near.w, Math.round(near.t / GRID) * GRID).map(r4), kind: 'on' };
      const t = snapC(near.t, coordCands(near.w.axis === 'h' ? 'x' : 'y', near.w));
      return { p: near.w.axis === 'h' ? [t, near.w.c] : [near.w.c, t], kind: 'on' };
    }
    return { p: [snapC(p[0], coordCands('x')), snapC(p[1], coordCands('y'))], kind: null };
  }

  // ------------------------------------------------------------------ rendering
  const N = v => +v.toFixed(4);
  const roomHue = i => (i * 137.5 + 200) % 360;
  const polyBox = pl => [Math.min(...pl.map(q => q[0])), Math.min(...pl.map(q => q[1])), Math.max(...pl.map(q => q[0])), Math.max(...pl.map(q => q[1]))];
  function render() {
    const k = pxFt();
    // underlay
    const u = S.underlay;
    $('#lUnder').innerHTML = u && underURL ? `<image href="${underURL}" x="0" y="0" width="${u.w}" height="${u.h}" preserveAspectRatio="none" opacity="${u.opacity}"
      transform="translate(${N(u.ox)} ${N(u.oy)}) rotate(${u.rot}) scale(${u.s})" style="pointer-events:none"/>` : '';
    // rooms
    let h = '';
    S.rooms.forEach((r, i) => {
      const on = sel && sel.uid === r.uid;
      const fill = `hsl(${roomHue(i)} 60% 55% / ${on ? 0.32 : 0.17})`;
      h += `<g class="room" data-kind="room" data-uid="${r.uid}">` + ((r.polys && r.polys.length) ? r.rects : (shapes[r.uid] || r.rects)).map(q => `<rect x="${N(q[0])}" y="${N(q[1])}" width="${N(q[2] - q[0])}" height="${N(q[3] - q[1])}" fill="${fill}"/>`).join('')
        + (r.polys || []).map(pl => `<polygon points="${pl.map(q => N(q[0]) + ',' + N(q[1])).join(' ')}" fill="${fill}"/>`).join('') + '</g>';
    });
    S.rooms.forEach(r => {
      const rr = (r.polys && r.polys.length) ? [polyBox(r.polys.reduce((m, pl) => (polyArea(pl) > polyArea(m) ? pl : m)))].concat(r.rects) : (shapes[r.uid] || r.rects);
      const big = rr.reduce((m, q) => ((q[2] - q[0]) * (q[3] - q[1]) > (m[2] - m[0]) * (m[3] - m[1]) ? q : m), rr[0]);
      if (!big) return;
      const cx = (big[0] + big[2]) / 2, cy = (big[1] + big[3]) / 2, fs = 12 * k;
      // a label only when it fits inside the room at this zoom (about 6.6 px per letter); zoom in to see the small ones
      const roomW = (big[2] - big[0]) / k, roomH = (big[3] - big[1]) / k;
      if (roomW < r.name.length * 6.6 + 10 || roomH < 18) return;
      h += `<text class="roomlabel" x="${N(cx)}" y="${N(cy)}" font-size="${N(fs)}" stroke-width="${N(3 * k)}">${esc(r.name)}</text>`;
      if (roomH >= 34 && roomW >= r.id.length * 6.2 + 10) h += `<text class="roomlabel sub" x="${N(cx)}" y="${N(cy + fs * 1.15)}" font-size="${N(fs * 0.85)}" stroke-width="${N(3 * k)}">${esc(r.id)}</text>`;
    });
    $('#lRooms').innerHTML = h;
    // fixtures: wall cabinets and shelves are dashed outlines underneath, everything at counter or floor level sits on top
    h = '';
    const all = (S.keep.fixtures || []).filter(f => FX.editable(f));
    for (const f of all.filter(g => FX.high(g)).concat(all.filter(g => !FX.high(g)))) h += fxSVG(f, k, sel && sel.uid === f.uid);
    $('#lFix').innerHTML = h;
    // walls + openings
    h = ''; let ho = '';
    for (const W of S.walls) {
      const L = isL(W), w = L ? levelOf(W) : W, r = rectOf(w), pad = 4 * k;                  // an angled wall is drawn level, inside a rotated group
      const cls = 'wall' + (w.ext ? ' ext' : '') + (w.status === 'removed' ? ' removed' : '') + (w.status === 'new' ? ' new' : '');
      h += `<g class="${cls}" data-kind="wall" data-uid="${w.uid}"${L ? ` transform="${lineTf(W)}"` : ''}><rect class="hit" x="${N(r.x0 - pad)}" y="${N(r.y0 - pad)}" width="${N(r.x1 - r.x0 + 2 * pad)}" height="${N(r.y1 - r.y0 + 2 * pad)}"/>`;
      const ops = w.openings.filter(o => o.type !== 'panel').sort((p, q) => p.a - q.a);
      let cur = w.a;
      const piece = (a, b) => { if (b - a < 0.001) return; const q = w.axis === 'h' ? [a, r.y0, b - a, r.y1 - r.y0] : [r.x0, a, r.x1 - r.x0, b - a];
        h += `<rect class="body" x="${N(q[0])}" y="${N(q[1])}" width="${N(q[2])}" height="${N(q[3])}" stroke-width="1.2"/>`; };
      for (const o of ops) { piece(cur, Math.max(cur, o.a)); cur = Math.max(cur, o.b); }
      piece(cur, w.b);
      h += '</g>';
      for (const o of w.openings) ho += L ? `<g transform="${lineTf(W)}">${openingSVG(w, o, k)}</g>` : openingSVG(w, o, k);
    }
    $('#lWalls').innerHTML = h; $('#lOpen').innerHTML = ho;
    // splits
    $('#lSplits').innerHTML = S.splits.map(s => { const [p, q] = s.axis === 'h' ? [[s.a, s.c], [s.b, s.c]] : [[s.c, s.a], [s.c, s.b]];
      return `<g data-kind="split" data-uid="${s.uid}"><line x1="${N(p[0])}" y1="${N(p[1])}" x2="${N(q[0])}" y2="${N(q[1])}" stroke="transparent" stroke-width="12" class="nse"/>
        <line class="splitline" x1="${N(p[0])}" y1="${N(p[1])}" x2="${N(q[0])}" y2="${N(q[1])}" stroke-width="1.5"/></g>`; }).join('');
    renderPlan(k);
    renderSel(); renderGhost();
    renderTrace();
    svg.setAttribute('class', 't-' + tool + (drag && drag.type === 'pan' ? ' panning' : '') + (S.underlay && underURL ? ' traced' : ''));
  }
  // ------------------------------------------------------------------ floor plan labels, dimensions and the walkthrough start
  const YAW = { N: 0, NE: -Math.PI / 4, E: -Math.PI / 2, SE: -3 * Math.PI / 4, S: Math.PI, SW: 3 * Math.PI / 4, W: Math.PI / 2, NW: Math.PI / 4 };
  const yawName = y => { let best = 'N', bd = 9; for (const [k, v] of Object.entries(YAW)) { const d = Math.abs(Math.atan2(Math.sin(y - v), Math.cos(y - v))); if (d < bd) { bd = d; best = k; } } return best; };
  const startDir = y => [-Math.sin(y), -Math.cos(y)];
  function dimEnds(d) { return d.x1 !== undefined ? [[d.x1, d.y], [d.x2, d.y]] : [[d.x, d.y1], [d.x, d.y2]]; }
  function renderPlan(k) {
    const P = S.keep.plan || {}; let h = '';
    for (const d of P.dims || []) {
      const [a, b] = dimEnds(d), len = Math.hypot(b[0] - a[0], b[1] - a[1]), tk = 5 * k, vert = d.x !== undefined, mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const tick = q => vert ? `<line x1="${N(q[0] - tk)}" y1="${N(q[1])}" x2="${N(q[0] + tk)}" y2="${N(q[1])}"/>` : `<line x1="${N(q[0])}" y1="${N(q[1] - tk)}" x2="${N(q[0])}" y2="${N(q[1] + tk)}"/>`;
      h += `<g class="pdim${sel && sel.uid === d.uid ? ' on' : ''}" data-kind="plan" data-uid="${d.uid}"><line class="hit" x1="${N(a[0])}" y1="${N(a[1])}" x2="${N(b[0])}" y2="${N(b[1])}" stroke="transparent" stroke-width="12"/>`
        + `<line x1="${N(a[0])}" y1="${N(a[1])}" x2="${N(b[0])}" y2="${N(b[1])}"/>${tick(a)}${tick(b)}`
        + `<text x="${N(mid[0])}" y="${N(mid[1] - 5 * k)}" font-size="${N(10 * k)}" ${vert ? `transform="rotate(-90 ${N(mid[0])} ${N(mid[1])})" dy="${N(-5 * k)}" y="${N(mid[1])}"` : ''}>${esc(d.label || fmt(len))}</text></g>`;
    }
    for (const l of P.labels || []) {                                      // shown while the Label tool is in use (or one is selected), so they don't pile onto the room names
      if (tool !== 'label' && !(sel && sel.uid === l.uid)) continue;
      const fs = (l.size || 11) * k * 1.1, on = sel && sel.uid === l.uid;
      h += `<g class="plabel${on ? ' on' : ''}" data-kind="plan" data-uid="${l.uid}"><text x="${N(l.x)}" y="${N(l.y)}" font-size="${N(fs)}" font-weight="600" stroke-width="${N(3 * k)}">${esc(l.t || '')}</text>`
        + (l.t2 ? `<text x="${N(l.x)}" y="${N(l.y + fs * 1.15)}" font-size="${N(fs)}" font-weight="600" stroke-width="${N(3 * k)}">${esc(l.t2)}</text>` : '')
        + (l.sub ? `<text x="${N(l.x)}" y="${N(l.y + fs * (l.t2 ? 2.3 : 1.15))}" font-size="${N(fs * 0.8)}" stroke-width="${N(3 * k)}">${esc(l.sub)}</text>` : '') + '</g>';
    }
    const st = S.keep.start;
    if (st && typeof st.x === 'number') {
      const d = startDir(st.yaw || 0), on = sel && sel.kind === 'start';
      h += `<g class="pstart${on ? ' on' : ''}" data-kind="start" data-uid="start"><circle cx="${N(st.x)}" cy="${N(st.y)}" r="${N(8 * k)}"/><line x1="${N(st.x)}" y1="${N(st.y)}" x2="${N(st.x + d[0] * 26 * k)}" y2="${N(st.y + d[1] * 26 * k)}" stroke-width="${N(3 * k)}"/>`
        + `<circle cx="${N(st.x + d[0] * 26 * k)}" cy="${N(st.y + d[1] * 26 * k)}" r="${N(4 * k)}"/><text x="${N(st.x)}" y="${N(st.y + 3.5 * k)}" font-size="${N(10 * k)}" text-anchor="middle">\u25b6</text></g>`;
    }
    $('#lPlan').innerHTML = h;
  }
  // ------------------------------------------------------------------ fixtures: plan symbols
  const FX = window.HouseFixtures;
  const fxs = () => (S.keep.fixtures ||= []);
  const fxBy = u => fxs().find(f => f.uid === u);
  const CW = { n: 'e', e: 's', s: 'w', w: 'n' };
  function fxShape(r, f, k, extra) {
    const rr = `x="${N(r[0])}" y="${N(r[1])}" width="${N(r[2] - r[0])}" height="${N(r[3] - r[1])}"`;
    if (f && (f.k === 'heater' || f.k === 'oval')) return `<ellipse class="body ${extra || ''}" cx="${N((r[0] + r[2]) / 2)}" cy="${N((r[1] + r[3]) / 2)}" rx="${N((r[2] - r[0]) / 2)}" ry="${N((r[3] - r[1]) / 2)}"/>`;
    return `<rect class="body ${extra || ''}" ${rr} rx="${N(2 * k)}"/>`;
  }
  function fxFront(r, d) {                                                  // a heavy line along the front edge
    const L = { e: [r[2], r[1], r[2], r[3]], w: [r[0], r[1], r[0], r[3]], s: [r[0], r[3], r[2], r[3]], n: [r[0], r[1], r[2], r[1]] }[d];
    return L ? `<line class="front" x1="${N(L[0])}" y1="${N(L[1])}" x2="${N(L[2])}" y2="${N(L[3])}"/>` : '';
  }
  function fxSVG(f, k, on) {
    const r = FX.footprint(f); if (!r) return '';
    const fc = FX.facing(f), hi = FX.high(f), thin = f.k === 'splash';
    let h = `<g class="fxs${hi ? ' hi' : ''}${on ? ' on' : ''}${thin ? ' thin' : ''}" data-kind="fixture" data-uid="${f.uid}">${fxShape(r, f, k)}${fc && !thin ? fxFront(r, fc) : ''}`;
    const w = r[2] - r[0], d = r[3] - r[1];
    if (!thin && Math.min(w, d) / k > 22 && w / k > 44) h += `<text class="fxlabel" x="${N((r[0] + r[2]) / 2)}" y="${N((r[1] + r[3]) / 2 + 3 * k)}" font-size="${N(9 * k)}">${esc(FX.describe(f))}</text>`;
    return h + '</g>';
  }
  function openingSVG(w, o, k) {
    const r = rectOf(w), hz = w.axis === 'h', th = hz ? r.y1 - r.y0 : r.x1 - r.x0, pad = 4 * k;
    const box = (a, b, x0, t) => hz ? [a, x0, b - a, t] : [x0, a, t, b - a];
    const lo = hz ? r.y0 : r.x0, mid = w.c;
    const R = q => `x="${N(q[0])}" y="${N(q[1])}" width="${N(q[2])}" height="${N(q[3])}"`;
    let s = `<g class="opening" data-kind="opening" data-uid="${o.uid}"><rect class="hit" ${R(box(o.a, o.b, lo - pad, th + 2 * pad))}/>`;
    const sw = 1.2;
    if (o.type === 'window') {
      s += `<rect class="win" ${R(box(o.a, o.b, lo, th))} stroke-width="${sw}"/>`;
      const P = t => hz ? [t, mid] : [mid, t];
      const [p, q] = [P(o.a), P(o.b)]; s += `<line class="shape" x1="${N(p[0])}" y1="${N(p[1])}" x2="${N(q[0])}" y2="${N(q[1])}" stroke-width="${sw}"/>`;
    } else if (o.type === 'panel') {
      s += `<rect class="panel" ${R(box(o.a, o.b, lo, th))} stroke-width="${sw}"/>`;
    } else {
      s += `<rect class="gap" ${R(box(o.a, o.b, lo - 0.01, th + 0.02))}/>`;
      const jt = (t) => { const [p, q] = hz ? [[t, r.y0], [t, r.y1]] : [[r.x0, t], [r.x1, t]]; return `<line class="shape" x1="${N(p[0])}" y1="${N(p[1])}" x2="${N(q[0])}" y2="${N(q[1])}" stroke-width="${sw}"/>`; };
      s += jt(o.a) + jt(o.b);
      if (o.type === 'door') {
        const wd = o.b - o.a, hv = o.hinge === 'b' ? o.b : o.a, ov = o.hinge === 'b' ? o.a : o.b;
        const dir = hz ? (o.swing === 's' ? 1 : -1) : (o.swing === 'e' ? 1 : -1);
        const H = hz ? [hv, mid] : [mid, hv], O = hz ? [ov, mid] : [mid, ov], T = hz ? [hv, mid + dir * wd] : [mid + dir * wd, hv];
        const sweep = ((T[0] - H[0]) * (O[1] - H[1]) - (T[1] - H[1]) * (O[0] - H[0])) > 0 ? 1 : 0;
        s += `<path class="arc" d="M${N(T[0])} ${N(T[1])} A${N(wd)} ${N(wd)} 0 0 ${sweep} ${N(O[0])} ${N(O[1])}" stroke-width="1"/>`;
        s += `<line class="leaf" x1="${N(H[0])}" y1="${N(H[1])}" x2="${N(T[0])}" y2="${N(T[1])}" stroke-width="2.2"/>`;
      }
    }
    return s + '</g>';
  }
  function dimText(x, y, text, k, rot) {
    return `<text class="dim" x="${N(x)}" y="${N(y)}" font-size="${N(11 * k)}" stroke-width="${N(3 * k)}"${rot ? ` transform="rotate(-90 ${N(x)} ${N(y)})"` : ''}>${esc(text)}</text>`;
  }
  function handle(x, y, k, attrs) { return `<circle class="handle" cx="${N(x)}" cy="${N(y)}" r="${N(HANDLE_PX * k)}" stroke-width="1.5" data-kind="handle" ${attrs}/>`; }
  function renderSel() {
    const k = pxFt(); let h = '';
    if (sel) {
      const it = byUid(sel.uid), op = !it && findOpening(sel.uid);
      if (sel.kind === 'plan' && it) { /* drawn as part of its own group, outlined by CSS */ }
      if (sel.kind === 'wall' && it && isL(it)) {
        const V = levelOf(it), r = rectOf(V), [p, q] = ends(it), n = lineN(it), m = fromLocal(it, it.b / 2, -(it.t / 2 + 12 * k));
        h += `<rect class="sel-outline" transform="${lineTf(it)}" x="${N(r.x0)}" y="${N(r.y0)}" width="${N(r.x1 - r.x0)}" height="${N(r.y1 - r.y0)}" stroke-width="2"/>`;
        h += dimText(m[0], m[1], fmt(it.b), k) + handle(p[0], p[1], k, `data-uid="${it.uid}" data-end="a" data-what="wall"`) + handle(q[0], q[1], k, `data-uid="${it.uid}" data-end="b" data-what="wall"`);
        void n;
      } else if (sel.kind === 'wall' && it) {
        const r = rectOf(it);
        h += `<rect class="sel-outline" x="${N(r.x0)}" y="${N(r.y0)}" width="${N(r.x1 - r.x0)}" height="${N(r.y1 - r.y0)}" stroke-width="2"/>`;
        const [p, q] = ends(it), off = 14 * k;
        h += it.axis === 'h' ? dimText((it.a + it.b) / 2, r.y0 - off * 0.6, fmt(it.b - it.a), k) : dimText(r.x0 - off * 0.6, (it.a + it.b) / 2, fmt(it.b - it.a), k, true);
        h += handle(p[0], p[1], k, `data-uid="${it.uid}" data-end="a" data-what="wall"`) + handle(q[0], q[1], k, `data-uid="${it.uid}" data-end="b" data-what="wall"`);
      } else if (sel.kind === 'opening' && op && isL(op.w)) {
        const { w, o } = op, V = levelOf(w), r = rectOf(V), m = fromLocal(w, (o.a + o.b) / 2, -(w.t / 2 + 12 * k));
        h += `<rect class="sel-outline" transform="${lineTf(w)}" x="${N(o.a)}" y="${N(r.y0)}" width="${N(o.b - o.a)}" height="${N(r.y1 - r.y0)}" stroke-width="2"/>`;
        h += dimText(m[0], m[1], fmt(o.b - o.a), k);
        h += handle(...fromLocal(w, o.a), k, `data-uid="${o.uid}" data-end="a" data-what="opening"`) + handle(...fromLocal(w, o.b), k, `data-uid="${o.uid}" data-end="b" data-what="opening"`);
      } else if (sel.kind === 'opening' && op) {
        const { w, o } = op, r = rectOf(w), hz = w.axis === 'h';
        const q = hz ? [o.a, r.y0, o.b - o.a, r.y1 - r.y0] : [r.x0, o.a, r.x1 - r.x0, o.b - o.a];
        h += `<rect class="sel-outline" x="${N(q[0])}" y="${N(q[1])}" width="${N(q[2])}" height="${N(q[3])}" stroke-width="2"/>`;
        const P = t => hz ? [t, w.c] : [w.c, t], off = 14 * k;
        h += hz ? dimText((o.a + o.b) / 2, r.y0 - off * 0.6, fmt(o.b - o.a), k) : dimText(r.x0 - off * 0.6, (o.a + o.b) / 2, fmt(o.b - o.a), k, true);
        h += handle(...P(o.a), k, `data-uid="${o.uid}" data-end="a" data-what="opening"`) + handle(...P(o.b), k, `data-uid="${o.uid}" data-end="b" data-what="opening"`);
      } else if (sel.kind === 'room' && it) {
        h += it.rects.map(q => `<rect class="sel-outline" x="${N(q[0])}" y="${N(q[1])}" width="${N(q[2] - q[0])}" height="${N(q[3] - q[1])}" stroke-width="2"/>`).join('')
          + (it.polys || []).map(pl => `<polygon class="sel-outline" points="${pl.map(q => N(q[0]) + ',' + N(q[1])).join(' ')}" stroke-width="2"/>`).join('');
      } else if (sel.kind === 'start' && S.keep.start) {
        const st = S.keep.start, d = startDir(st.yaw || 0);
        h += handle(st.x + d[0] * 26 * k, st.y + d[1] * 26 * k, k, 'data-what="start" data-end="yaw"');
      } else if (sel.kind === 'fixture' && it && SIZE_KEYS.includes(it.k)) {
        const r = FX.footprint(it), mx = (r[0] + r[2]) / 2, my = (r[1] + r[3]) / 2;
        h += handle(r[0], my, k, `data-uid="${it.uid}" data-what="fxedge" data-end="w"`) + handle(r[2], my, k, `data-uid="${it.uid}" data-what="fxedge" data-end="e"`)
          + handle(mx, r[1], k, `data-uid="${it.uid}" data-what="fxedge" data-end="n"`) + handle(mx, r[3], k, `data-uid="${it.uid}" data-what="fxedge" data-end="s"`);
      } else if (sel.kind === 'split' && it) {
        const [p, q] = it.axis === 'h' ? [[it.a, it.c], [it.b, it.c]] : [[it.c, it.a], [it.c, it.b]];
        h += `<line class="sel-outline" x1="${N(p[0])}" y1="${N(p[1])}" x2="${N(q[0])}" y2="${N(q[1])}" stroke-width="3"/>`;
      }
    }
    $('#lSel').innerHTML = h;
  }
  function renderGhost() {
    const k = pxFt(); let h = '';
    const g = ghost;
    if (g && g.snap) h += `<circle class="snapmark" cx="${N(g.snap[0])}" cy="${N(g.snap[1])}" r="${N(7 * k)}" stroke-width="1.5"/>`;
    if (g && g.kind === 'wall' && g.axis === 'l') {
      const t = g.t, m = fromLocal(g, g.b / 2, -(t / 2 + 12 * k));
      h += `<rect class="ghost" transform="${lineTf(g)}" x="0" y="${N(-t / 2)}" width="${N(g.b)}" height="${N(t)}" stroke-width="1.2"/>`;
      const deg = (-Math.atan2(g.p[3] - g.p[1], g.p[2] - g.p[0]) * 180 / Math.PI + 360) % 360;
      h += dimText(m[0], m[1], (lenBuf ? lenBuf + '\u2009\u23ce' : fmt(g.b)) + '  ' + Math.round(deg * 10) / 10 + '\u00b0', k);
    } else if (g && g.kind === 'wall') {
      const t = g.t, r = g.axis === 'h' ? [g.a, g.c - t / 2, g.b - g.a, t] : [g.c - t / 2, g.a, t, g.b - g.a];
      h += `<rect class="ghost" x="${N(r[0])}" y="${N(r[1])}" width="${N(r[2])}" height="${N(r[3])}" stroke-width="1.2"/>`;
      const label = (lenBuf ? lenBuf + '\u2009\u23ce' : fmt(g.b - g.a));
      h += g.axis === 'h' ? dimText((g.a + g.b) / 2, g.c - t / 2 - 10 * k, label, k) : dimText(g.c - t / 2 - 10 * k, (g.a + g.b) / 2, label, k, true);
    } else if (g && g.kind === 'split') {
      const [p, q] = g.axis === 'h' ? [[g.a, g.c], [g.b, g.c]] : [[g.c, g.a], [g.c, g.b]];
      h += `<line class="splitline" x1="${N(p[0])}" y1="${N(p[1])}" x2="${N(q[0])}" y2="${N(q[1])}" stroke-width="1.5"/>`;
    } else if (g && g.kind === 'opening' && isL(g.w)) {
      const w = g.w, pad = 2 * k, m = fromLocal(w, (g.a + g.b) / 2, -(w.t / 2 + 10 * k));
      h += `<rect class="ghost${g.bad ? ' bad' : ''}" transform="${lineTf(w)}" x="${N(g.a)}" y="${N(-w.t / 2 - pad)}" width="${N(g.b - g.a)}" height="${N(w.t + 2 * pad)}" stroke-width="1.2"/>`;
      h += dimText(m[0], m[1], fmt(g.b - g.a), k);
    } else if (g && g.kind === 'opening') {
      const w = g.w, r = rectOf(w), hz = w.axis === 'h', pad = 2 * k;
      const q = hz ? [g.a, r.y0 - pad, g.b - g.a, r.y1 - r.y0 + 2 * pad] : [r.x0 - pad, g.a, r.x1 - r.x0 + 2 * pad, g.b - g.a];
      h += `<rect class="ghost${g.bad ? ' bad' : ''}" x="${N(q[0])}" y="${N(q[1])}" width="${N(q[2])}" height="${N(q[3])}" stroke-width="1.2"/>`;
      h += hz ? dimText((g.a + g.b) / 2, r.y0 - 10 * k, fmt(g.b - g.a), k) : dimText(r.x0 - 10 * k, (g.a + g.b) / 2, fmt(g.b - g.a), k, true);
    } else if (g && g.kind === 'fixture') {
      h += fxShape(g.rect, g.f, k, 'ghostfx' + (g.bad ? ' bad' : '')) + (g.front ? fxFront(g.rect, g.front).replace('class="front"', 'class="front ghostfx"') : '');
      const w = g.rect[2] - g.rect[0], d = g.rect[3] - g.rect[1];
      h += dimText((g.rect[0] + g.rect[2]) / 2, g.rect[1] - 8 * k, fmt(FX.width(g.f)) + ' \u00d7 ' + fmt(FX.depth(g.f)), k);
      void w; void d;
    } else if (g && g.kind === 'dim') {
      h += `<line class="guide" x1="${N(g.a[0])}" y1="${N(g.a[1])}" x2="${N(g.b[0])}" y2="${N(g.b[1])}" stroke-width="1.5"/>` + dimText((g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2 - 8 * k, fmt(Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1])), k);
    } else if (g && g.kind === 'scale') {
      for (const p of g.pts) h += `<circle class="scalept" cx="${N(p[0])}" cy="${N(p[1])}" r="${N(4 * k)}"/>`;
      if (g.pts.length && g.cur) h += `<line class="guide" x1="${N(g.pts[0][0])}" y1="${N(g.pts[0][1])}" x2="${N(g.cur[0])}" y2="${N(g.cur[1])}" stroke-width="1.5"/>`;
    }
    $('#lGhost').innerHTML = h;
  }

  // ------------------------------------------------------------------ tools
  const HINTS = {
    select: 'Click to select. Drag a wall to move it, or drag its ends. <kbd>Del</kbd> deletes. Drag empty space to pan, scroll to zoom.',
    wall: 'Click corner to corner. Type a length (like <kbd>12\'6</kbd>) and press <kbd>Enter</kbd> for an exact wall. <kbd>Esc</kbd> or right-click ends the run. Hold <kbd>Alt</kbd> to turn off snapping. Switch on <b>Angled</b> (or hold <kbd>Shift</kbd>) for walls at any angle: they snap to every 15\u00b0, to the ends of other walls, and to where they cross one.',
    door: 'Click on a wall to put a door there. The side you click is the side it swings into.',
    window: 'Click on a wall to put a window there.',
    cased: 'Click on a wall for a doorway with no door.',
    room: 'Click inside a closed space to make it a room. Doorways count as closed.',
    split: 'Draw a line across an open space to split it into rooms (kitchen | dining). Then use Room on each side.',
    fixture: 'Pick something from the list on the right, then click where it goes. Against a wall it backs onto the wall on its own. <kbd>T</kbd> turns it when it is free-standing. <kbd>Esc</kbd> stops.',
    trace: 'Suggested walls are orange. Click one to leave it out, then press Add. Nothing you drew is touched until you do.',
    label: 'Click to put a room name on the floor plan. Drag a label to move it; edit its text on the right.',
    dim: 'Click two points to measure between them. A level or plumb pair of points makes a dimension line on the floor plan.',
    start: 'Click where the walkthrough should start. Drag the dot on the arrow to turn it.',
    scale: 'Click two points a known distance apart on the blueprint.',
    move: 'Drag the blueprint to line it up. Press <kbd>Esc</kbd> when it\'s in place.'
  };
  function setTool(t) {
    if (t === 'scale' && !S.underlay) { toast('Upload a blueprint first.'); return; }
    if (t === 'trace') {
      if (!S.underlay) { toast('Upload a blueprint first: the editor traces the picture.'); return; }
      if (!S.underlay.calibrated) { toast('Set the scale first, so the editor knows how big the walls are.'); t = 'scale'; }
      else if (!underImg) { toast('The blueprint image is not loaded in this browser: upload it again (its scale is kept).'); return; }
    }
    if (tool === 'trace' && t !== 'trace') TR.res = null;
    endDraw(); tool = t; ghost = null;
    $$('[data-tool]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === t));
    $('#wallMode').hidden = t !== 'wall';
    $('#wallMode').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.done ? false : b.dataset.angle ? wallAngle : b.dataset.mode === wallMode));
    $('#hint').innerHTML = HINTS[t] || ''; $('#hint').hidden = !HINTS[t];
    if (t === 'scale') ghost = { kind: 'scale', pts: [] };
    render(); renderSide();
  }

  // ------------------------------------------------------------------ assisted tracing (tracer.js does the finding)
  const TR = { opts: { style: 'solid', minLen: 2.5, sensitivity: 0.8, openings: true }, res: null, off: new Set(), busy: false, ms: 0 };
  // the blueprint as a grey picture with its axes level: scaled, shifted and rotated into plan feet, so one pixel is 1/ppf ft
  function rasterUnderlay(maxSide) {
    const u = S.underlay, c = underCorners();
    const minx = Math.min(...c.map(p => p[0])), maxx = Math.max(...c.map(p => p[0])), miny = Math.min(...c.map(p => p[1])), maxy = Math.max(...c.map(p => p[1]));
    const ppf = Math.min(14, (maxSide || 2600) / Math.max(maxx - minx, maxy - miny)), W = Math.ceil((maxx - minx) * ppf), H = Math.ceil((maxy - miny) * ppf);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(ppf, 0, 0, ppf, -minx * ppf, -miny * ppf); ctx.translate(u.ox, u.oy); ctx.rotate(u.rot * Math.PI / 180); ctx.scale(u.s, u.s);
    ctx.drawImage(underImg, 0, 0);
    return { gray: toGray(ctx.getImageData(0, 0, W, H).data, W * H), W, H, ppf, minx, miny };
  }
  function toGray(d, n) { const g = new Uint8ClampedArray(n); for (let i = 0; i < n; i++) g[i] = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]; return g; }
  // turn the picture about its own middle (so it doesn't swing off elsewhere)
  function setRotAboutCentre(u, rot) {
    const cx = u.w / 2 * u.s, cy = u.h / 2 * u.s, rd = Math.PI / 180;
    const wx = u.ox + Math.cos(u.rot * rd) * cx - Math.sin(u.rot * rd) * cy, wy = u.oy + Math.sin(u.rot * rd) * cx + Math.cos(u.rot * rd) * cy;
    u.ox = wx - (Math.cos(rot * rd) * cx - Math.sin(rot * rd) * cy); u.oy = wy - (Math.sin(rot * rd) * cx + Math.cos(rot * rd) * cy); u.rot = rot;
  }
  function straighten() {
    if (!S.underlay || !underImg) { toast('The blueprint image is not loaded.'); return; }
    const k = Math.min(1, 1400 / Math.max(underImg.naturalWidth, underImg.naturalHeight)), W = Math.round(underImg.naturalWidth * k), H = Math.round(underImg.naturalHeight * k);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(underImg, 0, 0, W, H);
    const r = HouseTracer.estimateSkew(toGray(ctx.getImageData(0, 0, W, H).data, W * H), W, H);
    if (r.confidence < 0.1) { toast('Could not find a clear tilt in this picture. Use the Rotate slider by hand.'); return; }
    if (Math.abs(r.angle) < 0.15) { toast('The picture is already level.'); return; }
    checkpoint(); setRotAboutCentre(S.underlay, Math.max(-30, Math.min(30, -r.angle)));
    changed(); toast('The picture was tilted ' + Math.abs(r.angle).toFixed(1) + '\u00b0 ' + (r.angle > 0 ? 'clockwise' : 'anticlockwise') + ': levelled.');
  }
  function runTrace() {
    if (!underImg || TR.busy) return;
    TR.busy = true; TR.res = null; renderSide(); toast('Finding walls\u2026');
    setTimeout(() => {
      try {
        const t0 = performance.now(), r = rasterUnderlay(), out = HouseTracer.detect(r.gray, r.W, r.H, r.ppf, TR.opts);
        TR.res = out.walls.map(w => { const ox = w.axis === 'h' ? r.minx : r.miny, oc = w.axis === 'h' ? r.miny : r.minx;
          return { ...w, a: w.a + ox, b: w.b + ox, c: w.c + oc, openings: w.openings.map(o => ({ ...o, a: o.a + ox, b: o.b + ox })) }; });
        TR.off.clear(); TR.ms = performance.now() - t0;
        if (!TR.res.length) toast('No walls found. Try another wall style or a lower "Shortest wall".');
        else toast(TR.res.length + ' walls suggested. Click any that are wrong to leave them out.');
      } catch (err) { toast('Tracing failed: ' + (err.message || err)); TR.res = null; }
      TR.busy = false; render(); renderSide();
    }, 40);
  }
  function applyTrace() {
    const todo = (TR.res || []).filter((w, i) => !TR.off.has(i));
    if (!todo.length) { toast('Nothing selected to add.'); return; }
    checkpoint();
    const first = !S.walls.length; let added = 0, skipped = 0, ops = 0;
    for (const w of todo) {
      if (S.walls.some(e => e.axis === w.axis && Math.abs(e.c - w.c) < 0.35 && Math.min(e.b, w.b) - Math.max(e.a, w.a) > 0.5 * (w.b - w.a))) { skipped++; continue; }   // already drawn
      const openings = w.openings.map(o => {
        const op = { uid: uid(), a: r4(o.a), b: r4(o.b), type: o.type };
        if (o.type === 'door') { op.hinge = 'a'; op.swing = w.axis === 'h' ? 's' : 'e'; }
        if (o.type === 'window') op.panes = Math.max(1, Math.min(4, Math.round((o.b - o.a) / 2.5)));
        return op;
      });
      ops += openings.length;
      S.walls.push({ uid: uid(), axis: w.axis, c: r4(w.c), a: r4(w.a), b: r4(w.b), t: r4(w.t), ext: !!w.ext, status: 'keep', extra: {}, openings }); added++;
    }
    if (first) {                                                   // the house's own typical wall thickness, for walls drawn later
      const med = ext => { const v = todo.filter(w => !!w.ext === ext).map(w => w.t).sort((p, q) => p - q); return v.length ? v[v.length >> 1] : null; };
      const e = med(true), i = med(false); if (e) S.wallThickness.exterior = r4(e); if (i) S.wallThickness.interior = r4(i);
    }
    TR.res = null; tool = 'select'; setTool('select'); changed(); if (first) fit();
    toast('Added ' + added + ' walls' + (ops ? ' and ' + ops + ' doors and windows' : '') + (skipped ? ' (' + skipped + ' were already drawn)' : '') + '. Check the corners and the door and window types, then press Find all rooms.');
  }
  function renderTrace() {
    const k = pxFt();
    $('#lTrace').innerHTML = !(TR.res && tool === 'trace') ? '' : TR.res.map((w, i) => {
      const off = TR.off.has(i), r = w.axis === 'h' ? [w.a, w.c - w.t / 2, w.b - w.a, w.t] : [w.c - w.t / 2, w.a, w.t, w.b - w.a];
      let h = `<g class="sugg${off ? ' off' : ''}" data-kind="sugg" data-i="${i}"><rect class="sbody" x="${N(r[0])}" y="${N(r[1])}" width="${N(r[2])}" height="${N(r[3])}"/><rect class="shit" x="${N(r[0] - 4 * k)}" y="${N(r[1] - 4 * k)}" width="${N(r[2] + 8 * k)}" height="${N(r[3] + 8 * k)}"/>`;
      if (!off) for (const o of w.openings) {
        const q = w.axis === 'h' ? [o.a, w.c - w.t / 2 - 2 * k, o.b - o.a, w.t + 4 * k] : [w.c - w.t / 2 - 2 * k, o.a, w.t + 4 * k, o.b - o.a];
        h += `<rect class="sgap ${o.type}" x="${N(q[0])}" y="${N(q[1])}" width="${N(q[2])}" height="${N(q[3])}"/>`;
      }
      return h + '</g>';
    }).join('');
  }
  function traceDown(e) {
    const t = e.target.closest('[data-kind="sugg"]');
    if (t) { const i = +t.dataset.i; if (TR.off.has(i)) TR.off.delete(i); else TR.off.add(i); render(); renderSide(); return; }
    startPan(e);
  }
  function traceField(f, v) {
    if (f === 'tr_style') TR.opts.style = v;
    if (f === 'tr_minlen') { const n = parseLen(v); if (n >= 1.5 && n <= 12) TR.opts.minLen = n; }
    if (f === 'tr_sens') TR.opts.sensitivity = +v;
    if (f === 'tr_open') TR.opts.openings = v === '1';
    TR.res = null; render(); renderSide();
  }

  // ------------------------------------------------------------------ find every closed space and make it a room
  function newRoomFrom(res) {
    const name = 'Room ' + (S.rooms.length + 1);
    const r = { uid: uid(), id: uniqueId(slug(name), new Set(S.rooms.map(x => x.id))), name, short: shortFor(name, new Set(S.rooms.map(x => x.short))), rects: res.rects, ...(res.polys ? { polys: res.polys } : {}), extra: {}, fresh: true };
    S.rooms.push(r); return r;
  }
  function findRooms() {
    const ws = live().map(rectOf); if (!ws.length) { toast('Draw the walls first.'); return; }
    const x0 = Math.min(...ws.map(r => r.x0)), x1 = Math.max(...ws.map(r => r.x1)), y0 = Math.min(...ws.map(r => r.y0)), y1 = Math.max(...ws.map(r => r.y1));
    const before = snap(); let made = 0, leaky = 0;
    const grid = gridFor();
    for (let y = y0 + 0.75; y < y1; y += 1) for (let x = x0 + 0.75; x < x1; x += 1) {
      if (roomAt(x, y)) continue;
      const res = fillRoom([x, y], grid);
      if (res.error) { if (/leaks/.test(res.error)) leaky++; continue; }
      if (res.area < 10) continue;                                     // a gap between walls, not a room
      newRoomFrom(res); made++;
    }
    if (!made) { toast(leaky ? 'The open spaces leak outside: check for gaps between walls (a door or window is fine).' : 'No new closed spaces to turn into rooms.'); return; }
    checkpoint(before); changed();
    toast('Made ' + made + ' room' + (made === 1 ? '' : 's') + '. Click each in the list on the left to name it.' + (leaky ? ' Some spaces leak outside and were skipped.' : ''));
  }
  function endDraw() { draw = null; dimStart = null; lenBuf = ''; if (ghost && (ghost.kind === 'wall' || ghost.kind === 'split' || ghost.kind === 'dim')) ghost = null; }

  // wall + split drawing: click, click, click...
  const angled = e => tool === 'wall' && wallAngle !== !!(e && e.shiftKey);              // the Angled button, turned over while Shift is held
  const ANG = Math.PI / 12;
  // where a ray from s at this angle crosses another wall's centre line near the cursor
  function rayHit(s, ang, p) {
    const d = [Math.cos(ang), Math.sin(ang)], tol = SNAP_PX * pxFt() * 2; let best = null, bd = tol;
    for (const w of live()) {
      const [q0, q1] = ends(w), v = [q1[0] - q0[0], q1[1] - q0[1]], den = d[0] * v[1] - d[1] * v[0];
      if (Math.abs(den) < 1e-6) continue;
      const t = ((q0[0] - s[0]) * v[1] - (q0[1] - s[1]) * v[0]) / den, u = ((q0[0] - s[0]) * d[1] - (q0[1] - s[1]) * d[0]) / den;
      if (t < 0.25 || u < -1e-6 || u > 1 + 1e-6) continue;
      const hit = [s[0] + d[0] * t, s[1] + d[1] * t], dist = Math.hypot(hit[0] - p[0], hit[1] - p[1]);
      if (dist < bd) { bd = dist; best = hit; }
    }
    return best;
  }
  function angledTarget(p, e) {
    const s = draw.start, alt = e && e.altKey, typed = parseLen(lenBuf), hasLen = lenBuf && isFinite(typed) && typed > 0;
    const sp = alt ? null : snapPoint(p, false), dx = p[0] - s[0], dy = p[1] - s[1];
    let end, ang = Math.atan2(dy, dx);
    if (!hasLen && sp && sp.kind === 'end') end = sp.p.slice();
    else {
      if (!alt) ang = Math.round(ang / ANG) * ANG;
      const len = hasLen ? typed : alt ? Math.hypot(dx, dy) : Math.round(Math.hypot(dx, dy) / GRID) * GRID;
      end = [s[0] + Math.cos(ang) * len, s[1] + Math.sin(ang) * len];
      if (!hasLen && !alt) { const hit = rayHit(s, ang, p); if (hit) end = hit; }
    }
    end = end.map(r4);
    const nearEnd = allEnds().find(q => Math.hypot(q[0] - end[0], q[1] - end[1]) < 1e-6);
    return { axis: 'l', p: [s[0], s[1], end[0], end[1]], a: 0, b: r4(Math.hypot(end[0] - s[0], end[1] - s[1])), c: 0, end, snap: nearEnd || null };
  }
  function drawTarget(p, e) {
    if (angled(e)) return angledTarget(p, e);
    const s = draw.start, dx = p[0] - s[0], dy = p[1] - s[1], axis = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
    let endAlong;
    const typed = parseLen(lenBuf);
    if (lenBuf && isFinite(typed) && typed > 0) endAlong = along(axis, s) + Math.sign(axis === 'h' ? dx || 1 : dy || 1) * typed;
    else endAlong = snapC(along(axis, p), coordCands(axis === 'h' ? 'x' : 'y'), e && e.altKey);
    const c = across(axis, s), end = axis === 'h' ? [endAlong, c] : [c, endAlong];
    const nearEnd = allEnds().find(q => Math.hypot(q[0] - end[0], q[1] - end[1]) < 1e-6);
    return { axis, c, a: Math.min(along(axis, s), endAlong), b: Math.max(along(axis, s), endAlong), end, snap: nearEnd || null };
  }
  function drawClick(p, e) {
    if (!draw) {
      const sp = snapPoint(p, e.altKey);
      const p0 = sp.p.map(r4); draw = { start: p0, first: p0, n: 0 }; ghost = null; renderGhost(); return;
    }
    const g = drawTarget(p, e); lenBuf = '';
    if (g.b - g.a < 0.25) return;
    checkpoint();
    if (tool === 'split') {
      S.splits.push({ uid: uid(), axis: g.axis, c: r4(g.c), a: r4(g.a), b: r4(g.b) });
      draw = null; ghost = null; changed(); return;
    }
    const same = g.axis === 'l'
      ? S.walls.some(w => isL(w) && ((Math.hypot(w.p[0] - g.p[0], w.p[1] - g.p[1]) < 0.01 && Math.hypot(w.p[2] - g.p[2], w.p[3] - g.p[3]) < 0.01) || (Math.hypot(w.p[0] - g.p[2], w.p[1] - g.p[3]) < 0.01 && Math.hypot(w.p[2] - g.p[0], w.p[3] - g.p[1]) < 0.01)))
      : S.walls.some(w => w.axis === g.axis && Math.abs(w.c - g.c) < 0.05 && Math.min(w.b, g.b) - Math.max(w.a, g.a) > 0.1);
    if (same) { undoS.pop(); toast('There is already a wall there.'); draw.start = g.end.map(r4); return; }
    const ext = wallMode === 'ext', th = ext ? S.wallThickness.exterior : S.wallThickness.interior;
    if (g.axis === 'l' && Math.abs(g.p[3] - g.p[1]) > 1e-4 && Math.abs(g.p[2] - g.p[0]) > 1e-4) {
      const nw = { uid: uid(), axis: 'l', t: th, ext, status: 'keep', extra: {}, openings: [] }; setLine(nw, g.p); S.walls.push(nw);
    } else {                                                            // a level or plumb line is an ordinary wall
      const lv = g.axis === 'l' ? (Math.abs(g.p[3] - g.p[1]) <= 1e-4 ? { axis: 'h', c: g.p[1], a: Math.min(g.p[0], g.p[2]), b: Math.max(g.p[0], g.p[2]) } : { axis: 'v', c: g.p[0], a: Math.min(g.p[1], g.p[3]), b: Math.max(g.p[1], g.p[3]) }) : g;
      S.walls.push({ uid: uid(), axis: lv.axis, c: r4(lv.c), a: r4(lv.a), b: r4(lv.b), t: th, ext, status: 'keep', extra: {}, openings: [] });
    }
    draw.n++;
    if (ext && draw.n >= 3 && Math.hypot(g.end[0] - draw.first[0], g.end[1] - draw.first[1]) < 0.01) {
      draw = null; ghost = null; wallMode = 'int'; setTool('wall');
      toast('Outside walls closed. Now draw the inside walls along their centre lines.');
    } else draw.start = g.end.map(r4);
    changed();
  }

  // labels, dimensions and the walkthrough start
  function labelClick(p) {
    checkpoint();
    const q = v => r4(Math.round(v / GRID) * GRID), l = { uid: uid(), x: q(p[0]), y: q(p[1]), t: 'LABEL' };
    (planOf().labels ||= []).push(l); sel = { kind: 'plan', uid: l.uid }; changed();
    setTimeout(() => { const f = $('#insp [data-f="pl_t"]'); if (f) { f.focus(); f.select(); } }, 30);
  }
  function dimTo(p, e) {                                                // level or plumb from the first point, whichever the cursor is nearer to
    const a = dimStart, sp = snapPoint(p, e && e.altKey).p;
    return Math.abs(sp[0] - a[0]) >= Math.abs(sp[1] - a[1]) ? [sp[0], a[1]] : [a[0], sp[1]];
  }
  function dimClick(p, e) {
    if (!dimStart) { dimStart = snapPoint(p, e.altKey).p.map(r4); return; }
    const b = dimTo(p, e), a = dimStart; dimStart = null; ghost = null;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.25) { renderGhost(); return; }
    checkpoint();
    const d = b[1] === a[1] ? { uid: uid(), x1: r4(Math.min(a[0], b[0])), x2: r4(Math.max(a[0], b[0])), y: r4(a[1]) } : { uid: uid(), y1: r4(Math.min(a[1], b[1])), y2: r4(Math.max(a[1], b[1])), x: r4(a[0]) };
    (planOf().dims ||= []).push(d); sel = { kind: 'plan', uid: d.uid }; changed();
  }
  function startClick(p) {
    checkpoint();
    const sp = snapPoint(p, true).p, was = S.keep.start;
    S.keep.start = { x: r4(Math.round(sp[0] / GRID) * GRID), y: r4(Math.round(sp[1] / GRID) * GRID), yaw: was && typeof was.yaw === 'number' ? was.yaw : 0, ...(was && was.z !== undefined ? { z: was.z } : {}) };
    sel = { kind: 'start', uid: 'start' }; changed();
  }

  // doors, windows, openings
  const DEFAULT_W = { door: 3, window: 3, cased: 4 };
  function openingGhost(p) {
    const near = wallNear(p); if (!near) return null;
    const w = near.w, len = w.b - w.a;
    let wd = Math.min(DEFAULT_W[tool], len - 0.2); if (wd < 1) return null;
    let mid = Math.round(near.t / GRID) * GRID;
    let a = Math.max(w.a + 0.1, Math.min(w.b - 0.1 - wd, mid - wd / 2)), b = a + wd;
    const bad = w.openings.some(o => o.a < b - 1e-6 && o.b > a + 1e-6);
    return { kind: 'opening', w, a: r4(a), b: r4(b), side: near.side, bad };
  }
  function openingClick(p) {
    const g = openingGhost(p);
    if (!g) return;
    if (g.bad) { toast('That overlaps another door or window on this wall.'); return; }
    checkpoint();
    const o = { uid: uid(), a: g.a, b: g.b, type: tool };
    if (tool === 'door') {
      // inside doors swing to the side you clicked; outside doors swing into the house
      let side = g.side;
      if (g.w.ext) {
        const rs = live().map(rectOf);
        if (isL(g.w)) { const cx = (Math.min(...rs.map(r => r.x0)) + Math.max(...rs.map(r => r.x1))) / 2, cy = (Math.min(...rs.map(r => r.y0)) + Math.max(...rs.map(r => r.y1))) / 2, [t, off] = toLocal(g.w, [cx, cy]); void t; side = off > 0 ? 1 : -1; }
        else { const mid = g.w.axis === 'h' ? (Math.min(...rs.map(r => r.y0)) + Math.max(...rs.map(r => r.y1))) / 2 : (Math.min(...rs.map(r => r.x0)) + Math.max(...rs.map(r => r.x1))) / 2; side = mid > g.w.c ? 1 : -1; }
      }
      o.hinge = 'a'; o.swing = isL(g.w) ? (side > 0 ? 'r' : 'l') : g.w.axis === 'h' ? (side > 0 ? 's' : 'n') : (side > 0 ? 'e' : 'w');
    }
    if (tool === 'window') o.panes = 1;
    g.w.openings.push(o);
    sel = { kind: 'opening', uid: o.uid }; changed();
  }

  // rooms: flood fill on a 3" grid, bounded by walls (doorways count as closed), split lines and existing rooms
  const WALL = 1, SPLIT = 2, ROOM = 3, IN = 4, LEAK = 5;
  const LEAKS = 'This space isn\'t closed: it leaks outside the house. Check for a gap between walls.';
  // the plan as a grid of cells: wall, split line, already a room, or free. A finer grid when some wall is angled.
  function gridFor() {
    const lw = live(), ws = lw.map(rectOf);
    if (!ws.length) return null;
    const G = lw.some(isSlant) ? 0.1 : 0.25, x0 = Math.floor(Math.min(...ws.map(r => r.x0)) / G) * G - G, y0 = Math.floor(Math.min(...ws.map(r => r.y0)) / G) * G - G;
    const nx = Math.ceil((Math.max(...ws.map(r => r.x1)) - x0) / G) + 2, ny = Math.ceil((Math.max(...ws.map(r => r.y1)) - y0) / G) + 2;
    const base = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const cx = x0 + (i + 0.5) * G, cy = y0 + (j + 0.5) * G;
      if (lw.some(w => inWallBox(w, cx, cy))) base[j * nx + i] = WALL;
      else if (S.splits.some(s => (s.axis === 'h' ? Math.abs(cy - s.c) < G / 2 && cx > s.a && cx < s.b : Math.abs(cx - s.c) < G / 2 && cy > s.a && cy < s.b))) base[j * nx + i] = SPLIT;
      else if (roomAt(cx, cy)) base[j * nx + i] = ROOM;
    }
    return { G, x0, y0, nx, ny, base, slant: lw.some(isSlant) };
  }
  // the outline of a set of cells: the longest loop of cell edges, straightened
  function traceOutline(inside, nx, ny, G, x0, y0) {
    const out = new Map(), key = (i, j) => j * (nx + 1) + i, add = (a, b, c, d) => { const k = key(a, b); (out.get(k) || out.set(k, []).get(k)).push([c, d]); };
    const on = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && inside[j * nx + i];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (!on(i, j)) continue;
      if (!on(i, j - 1)) add(i, j, i + 1, j);
      if (!on(i + 1, j)) add(i + 1, j, i + 1, j + 1);
      if (!on(i, j + 1)) add(i + 1, j + 1, i, j + 1);
      if (!on(i - 1, j)) add(i, j + 1, i, j);
    }
    let best = null, bestA = 0;
    for (const [k0, list0] of out) {
      while (list0.length) {
        const si = k0 % (nx + 1), sj = Math.floor(k0 / (nx + 1)), pts = [[si, sj]]; let [ci, cj] = list0.pop();
        for (let guard = 0; guard < 4e5 && !(ci === si && cj === sj); guard++) {
          pts.push([ci, cj]);
          const l = out.get(key(ci, cj)); if (!l || !l.length) break;
          [ci, cj] = l.pop();
        }
        const A = Math.abs(pts.reduce((t, q, n) => { const m = pts[(n + 1) % pts.length]; return t + q[0] * m[1] - m[0] * q[1]; }, 0)) / 2;
        if (A > bestA) { bestA = A; best = pts; }
      }
    }
    if (!best) return null;
    // keep only the corners, then drop wobble smaller than a fifth of a cell... and a little more along slopes
    let pts = best.map(([i, j]) => [x0 + i * G, y0 + j * G]);
    pts = pts.filter((q, n) => { const a = pts[(n + pts.length - 1) % pts.length], b = pts[(n + 1) % pts.length]; return Math.abs((q[0] - a[0]) * (b[1] - q[1]) - (q[1] - a[1]) * (b[0] - q[0])) > 1e-9; });
    const tol = G * 0.95, dist = (q, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return Math.abs((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) / L; };
    const dp = chain => {
      if (chain.length < 3) return chain;
      let mi = 0, md = -1; for (let i = 1; i < chain.length - 1; i++) { const d = dist(chain[i], chain[0], chain[chain.length - 1]); if (d > md) { md = d; mi = i; } }
      if (md <= tol) return [chain[0], chain[chain.length - 1]];
      return dp(chain.slice(0, mi + 1)).slice(0, -1).concat(dp(chain.slice(mi)));
    };
    let far = 0, fd = -1; pts.forEach((q, i) => { const d = Math.hypot(q[0] - pts[0][0], q[1] - pts[0][1]); if (d > fd) { fd = d; far = i; } });
    const first = pts.slice(0, far + 1), second = pts.slice(far).concat([pts[0]]);
    let simp = dp(first).slice(0, -1).concat(dp(second).slice(0, -1));
    for (let again = 0; again < 3 && simp.length > 3; again++) {          // corners a cell or two apart are one corner; a point on a straight run goes
      const next = [];
      for (let i = 0; i < simp.length; i++) {
        const q = simp[i], a = next.length ? next[next.length - 1] : null;
        if (a && Math.hypot(q[0] - a[0], q[1] - a[1]) < G * 1.6) next[next.length - 1] = [(a[0] + q[0]) / 2, (a[1] + q[1]) / 2]; else next.push(q);
      }
      simp = next.filter((q, n) => { const a = next[(n + next.length - 1) % next.length], b = next[(n + 1) % next.length]; return Math.abs((q[0] - a[0]) * (b[1] - q[1]) - (q[1] - a[1]) * (b[0] - q[0])) > G * 0.4; });
    }
    return simp.length >= 3 ? simp.map(q => [r4(q[0]), r4(q[1])]) : null;
  }
  function fillRoom(p, grid = gridFor()) {
    if (!grid) return { error: 'Draw the walls first.' };
    const { G, x0, y0, nx, ny } = grid, cell = grid.base.slice();
    const si = Math.floor((p[0] - x0) / G), sj = Math.floor((p[1] - y0) / G);
    if (si < 0 || sj < 0 || si >= nx || sj >= ny) return { error: 'Click inside the house.' };
    if (cell[sj * nx + si] === WALL) return { error: 'That\'s a wall. Click inside the room.' };
    if (cell[sj * nx + si] === SPLIT) return { error: 'That\'s on a split line. Click a little to one side.' };
    if (cell[sj * nx + si] === ROOM) return { error: 'That space is already a room.' };
    if (cell[sj * nx + si] === LEAK) return { error: LEAKS };
    const stack = [sj * nx + si]; cell[stack[0]] = IN; let n = 0;
    while (stack.length) {
      const c = stack.pop(), i = c % nx, j = (c - i) / nx; n++;
      if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) {
        for (let k = 0; k < cell.length; k++) if (cell[k] === IN) grid.base[k] = LEAK;          // the whole outside is one space: remember it, so it is not flooded again
        return { error: LEAKS };
      }
      for (const m of [c + 1, c - 1, c + nx, c - nx]) if (!cell[m]) { cell[m] = IN; stack.push(m); }
    }
    let slantEdge = false;
    if (grid.slant) {                                                  // does the space touch an angled wall? Then it needs an outline, not rectangles
      const lw = live().filter(isSlant), near = new Uint8Array(nx * ny);
      for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
        const v = cell[j * nx + i];
        if (v === IN) near[j * nx + i] = 1;
        else if (v === WALL || v === SPLIT) {
          let hit = false;
          for (let dj = -1; dj <= 1 && !hit; dj++) for (let di = -1; di <= 1; di++) if (cell[(j + dj) * nx + i + di] === IN) { hit = true; break; }
          if (hit) { near[j * nx + i] = 1; if (!slantEdge && v === WALL) { const cx = x0 + (i + 0.5) * G, cy = y0 + (j + 0.5) * G; if (lw.some(w => inWallBox(w, cx, cy))) slantEdge = true; } }
        }
      }
      if (slantEdge) {
        const poly = traceOutline(near, nx, ny, G, x0, y0);
        if (!poly) return { error: 'Could not outline that space.' };
        return { rects: [], polys: [poly], area: n * G * G };
      }
    }
    // rows of cells -> rectangles, merging identical runs on consecutive rows
    const rects = [];
    for (let j = 0; j < ny; j++) {
      let i = 0;
      while (i < nx) {
        if (cell[j * nx + i] !== IN) { i++; continue; }
        const s = i; while (i < nx && cell[j * nx + i] === IN) i++;
        const r = [x0 + s * G, y0 + j * G, x0 + i * G, y0 + (j + 1) * G];
        const prev = rects.find(t => Math.abs(t[0] - r[0]) < 1e-9 && Math.abs(t[2] - r[2]) < 1e-9 && Math.abs(t[3] - r[1]) < 1e-9);
        if (prev) prev[3] = r[3]; else rects.push(r);
      }
    }
    // grow edges that face a wall by half a cell (the cell centres stop up to 1.5" short of the wall face), and land
    // edges on split lines exactly, so the room meets its walls and its open-plan neighbour with no gap
    const at = (x, y) => { const i = Math.floor((x - x0) / G), j = Math.floor((y - y0) / G); return i < 0 || j < 0 || i >= nx || j >= ny ? WALL : cell[j * nx + i]; };
    for (const r of rects) {
      const side = (k) => {                                     // what lies just outside edge k (0 left, 1 top, 2 right, 3 bottom)
        const pts = [];
        for (let t = (k % 2 ? r[0] : r[1]) + G / 2; t < (k % 2 ? r[2] : r[3]); t += G) pts.push(k === 0 ? [r[0] - G / 2, t] : k === 2 ? [r[2] + G / 2, t] : k === 1 ? [t, r[1] - G / 2] : [t, r[3] + G / 2]);
        return pts.map(([x, y]) => at(x, y));
      };
      const o = [...r];
      [0, 1, 2, 3].forEach(k => {
        const s = side(k);
        if (s.every(v => v === WALL || v === IN)) { if (k === 0) o[0] -= G / 2; if (k === 1) o[1] -= G / 2; if (k === 2) o[2] += G / 2; if (k === 3) o[3] += G / 2; }
      });
      for (const sp of S.splits) {
        if (sp.axis === 'v') { if (Math.abs(o[0] - sp.c) <= G) o[0] = sp.c; if (Math.abs(o[2] - sp.c) <= G) o[2] = sp.c; }
        else { if (Math.abs(o[1] - sp.c) <= G) o[1] = sp.c; if (Math.abs(o[3] - sp.c) <= G) o[3] = sp.c; }
      }
      r.splice(0, 4, ...o.map(r4));
    }
    return { rects, area: n * G * G };
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'room'; }
  function uniqueId(base, taken) { let id = base, i = 2; while (taken.has(id)) id = base + '_' + i++; return id; }
  function shortFor(name, taken) {
    const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
    let base = words.length > 1 ? words.map(w => /^\d+$/.test(w) ? w : w[0]).join('') : (words[0] || 'RM').slice(0, 3);
    base = base.slice(0, 5); let s = base, i = 2; while (taken.has(s)) s = base + i++;
    return s;
  }
  function roomClick(p) {
    const hit = roomAt(p[0], p[1]);
    if (hit) { sel = { kind: 'room', uid: hit.uid }; render(); renderSide(); return; }
    const res = fillRoom(p);
    if (res.error) { toast(res.error); return; }
    checkpoint();
    const name = 'Room ' + (S.rooms.length + 1);
    const r = { uid: uid(), id: uniqueId(slug(name), new Set(S.rooms.map(x => x.id))), name, short: shortFor(name, new Set(S.rooms.map(x => x.short))), rects: res.rects, ...(res.polys ? { polys: res.polys } : {}), extra: {}, fresh: true };
    S.rooms.push(r);
    sel = { kind: 'room', uid: r.uid }; changed();
    setTimeout(() => { const f = $('#insp [data-f="name"]'); if (f) { f.focus(); f.select(); } }, 30);
  }

  // scale: two points on the blueprint, then the real distance between them
  function scaleClick(p) {
    ghost.pts.push(p);
    if (ghost.pts.length < 2) { renderGhost(); return; }
    const [a, b] = ghost.pts, d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d < 1e-6) { ghost.pts = []; return; }
    askScale(a, d);
  }
  function askScale(anchor, measured) {
    dialog(`<form class="box"><h3>How far apart are those points?</h3>
      <p class="note">On the blueprint they're ${esc(fmt(measured))} at the current scale. Type the real distance, like <code>56'</code> or <code>26'8"</code>.</p>
      <label class="field">Real distance<input id="dlgLen" autocomplete="off" placeholder="e.g. 56'"></label>
      <div class="row-btns"><button type="button" class="btn" id="dlgCancel">Cancel</button><button class="btn primary">Set scale</button></div></form>`);
    const inp = $('#dlgLen'); inp.focus();
    $('#dlgCancel').onclick = () => { closeDialog(); ghost = { kind: 'scale', pts: [] }; renderGhost(); };
    $('#dialog form').onsubmit = e => {
      e.preventDefault();
      const L = parseLen(inp.value); if (!(L > 0)) { inp.classList.add('bad'); return; }
      closeDialog(); checkpoint();
      const u = S.underlay, k = L / measured;
      u.ox = anchor[0] + (u.ox - anchor[0]) * k; u.oy = anchor[1] + (u.oy - anchor[1]) * k; u.s *= k; u.calibrated = true;
      ghost = null; setTool('select'); changed(); fit();
      toast(`Scale set: 1 ft is ${(1 / u.s).toFixed(1)} px on the blueprint. Next, trace the outside walls.`);
    };
  }

  // ------------------------------------------------------------------ pointer input
  let downAt = null;
  svg.addEventListener('contextmenu', e => { e.preventDefault(); if (draw) { endDraw(); render(); } });
  svg.addEventListener('pointerdown', e => {
    const p = toFt(e); downAt = p; lastP = p;
    if (e.button === 1 || (e.button === 0 && spaceDown)) { startPan(e); return; }
    if (e.button !== 0) return;
    if (e.pointerType === 'touch') {                                       // a finger: select and pan act at once; the tools wait for the lift, so a second finger can pinch instead
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (touches.size > 1) { cancelForPinch(); return; }
      if (tool !== 'select' && tool !== 'trace' && tool !== 'move') { tap = { id: e.pointerId, x: e.clientX, y: e.clientY }; lastP = p; svg.setPointerCapture(e.pointerId); pointerHover(e, p); return; }
    }
    toolDown(e, p);
  });
  function toolDown(e, p) {
    if (tool === 'select') return selectDown(e, p);
    if (tool === 'trace') return traceDown(e);
    if (tool === 'wall' || tool === 'split') return drawClick(p, e);
    if (tool === 'door' || tool === 'window' || tool === 'cased') return openingClick(p);
    if (tool === 'fixture') return fixtureClick(p, e);
    if (tool === 'room') return roomClick(p);
    if (tool === 'scale') return scaleClick(snapPoint(p, true).p);
    if (tool === 'label') return labelClick(p);
    if (tool === 'dim') return dimClick(p, e);
    if (tool === 'start') return startClick(p);
    if (tool === 'move' && S.underlay) { drag = { type: 'under', start: p, ox: S.underlay.ox, oy: S.underlay.oy, before: snap() }; svg.setPointerCapture(e.pointerId); }
  }
  // ---- touch: one finger draws or drags, two fingers pinch and pan
  const touches = new Map(); let tap = null, pinch = null;
  function cancelForPinch() {
    tap = null;
    if (drag && drag.before && drag.moved) restoreSnap(drag.before);
    drag = null; svg.classList.remove('panning'); ghost = null;
    const [a, b] = [...touches.values()];
    pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
    render();
  }
  function pinchMove() {
    const [a, b] = [...touches.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const ft = toFt({ clientX: c[0], clientY: c[1] });
    if (pinch.d > 0) zoomAt(pinch.d / d, ft[0], ft[1]);
    const k = pxFt(); view.x -= (c[0] - pinch.c[0]) * k; view.y -= (c[1] - pinch.c[1]) * k; applyView();
    pinch = { d, c };
  }
  function touchEnd(e) {
    if (e.pointerType !== 'touch') return false;
    touches.delete(e.pointerId);
    if (pinch) { if (touches.size === 0) pinch = null; return true; }
    if (tap && tap.id === e.pointerId) {
      const t = tap; tap = null;
      if (e.type === 'pointerup') toolDown({ altKey: false, shiftKey: false, target: e.target, pointerId: e.pointerId }, toFt(e));
      void t; return true;
    }
    return false;
  }
  // the walls whose ends rest on this one (or, for an angled wall, on its two ends): they follow when it moves
  function attachedEnds(w) {
    const out = [], tol = 0.06;
    for (const o of S.walls) {
      if (o === w || o.status === 'removed') continue;
      ends(o).forEach((q, i) => {
        if (isL(w)) {
          const hit = [[w.p[0], w.p[1]], [w.p[2], w.p[3]]].some(e => Math.hypot(e[0] - q[0], e[1] - q[1]) < tol);
          if (hit) out.push({ o, i, q: q.slice(), p0: isL(o) ? o.p.slice() : null });
        } else if (o.axis !== w.axis || isL(o)) {
          const t = along(w, q), c = across(w, q);
          if (Math.abs(c - w.c) < tol && t > w.a - tol && t < w.b + tol) out.push({ o, i, q: q.slice(), p0: isL(o) ? o.p.slice() : null });
        }
      });
    }
    return out;
  }
  function followAttached(w, d, dx, dy) {                                // dx, dy: how far the dragged wall has moved
    for (const a of d.att || []) {
      const o = a.o;
      if (isL(o)) { const q = a.p0.slice(); q[a.i * 2] += dx; q[a.i * 2 + 1] += dy; if (Math.hypot(q[2] - q[0], q[3] - q[1]) >= 0.25) { const len0 = o.b; setLine(o, q); if (a.i === 0) o.openings.forEach(op => { op.a = r4(op.a + o.b - len0); op.b = r4(op.b + o.b - len0); }); } }
      else {
        const v = o.axis === 'h' ? a.q[0] + dx : a.q[1] + dy, key = a.i === 0 ? 'a' : 'b';
        if ((key === 'a' ? o.b - v : v - o.a) >= 0.25) o[key] = r4(v);
      }
    }
  }
  function startPan(e) { drag = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; svg.setPointerCapture(e.pointerId); svg.classList.add('panning'); }
  function selectDown(e, p) {
    const t = e.target.closest('[data-kind]');
    if (!t) { if (sel) { sel = null; render(); renderSide(); } return startPan(e); }
    const kind = t.dataset.kind, u = t.dataset.uid, before = snap();
    if (kind === 'handle') {
      const w0 = t.dataset.what === 'wall' ? byUid(u) : null;
      drag = { type: 'end', what: t.dataset.what, uid: u, end: t.dataset.end, before, rect0: t.dataset.what === 'fxedge' ? FX.footprint(fxBy(u)) : null, len0: w0 && isL(w0) ? w0.b : 0, ops0: w0 && isL(w0) ? w0.openings.map(o => [o.a, o.b]) : null };
    } else if (kind === 'wall') {
      const w = byUid(u); sel = { kind: 'wall', uid: u };
      drag = { type: 'wall', uid: u, start: p, c0: w.c, p0: isL(w) ? w.p.slice() : null, att: attachedEnds(w), before };
    } else if (kind === 'opening') {
      const { w, o } = findOpening(u); sel = { kind: 'opening', uid: u };
      drag = { type: 'opening', uid: u, start: along(w, p), a0: o.a, b0: o.b, before };
    } else if (kind === 'fixture') {
      const g = fxBy(u); sel = { kind: 'fixture', uid: u };
      drag = { type: 'fixture', uid: u, start: p, rect0: FX.footprint(g), before };
    } else if (kind === 'plan') {
      const it = byUid(u); sel = { kind: 'plan', uid: u };
      drag = { type: 'plan', uid: u, start: p, orig: JSON.parse(JSON.stringify(it)), before };
    } else if (kind === 'start') {
      sel = { kind: 'start', uid: 'start' }; drag = { type: 'startmove', start: p, orig: { ...S.keep.start }, before };
    } else if (kind === 'room' || kind === 'split') {
      sel = { kind, uid: u };
      drag = { type: 'pan-later', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    }
    svg.setPointerCapture(e.pointerId);
    render(); renderSide();
  }
  svg.addEventListener('pointermove', e => {
    const p = toFt(e); lastP = p; lastMods = { altKey: e.altKey, shiftKey: e.shiftKey };
    if (e.pointerType === 'touch') { if (touches.has(e.pointerId)) touches.set(e.pointerId, [e.clientX, e.clientY]); if (pinch && touches.size > 1) return pinchMove(); }
    $('#cursor').textContent = `${fmt(p[0])}, ${fmt(p[1])}`;
    if (drag) return dragMove(e, p);
    pointerHover(e, p);
  });
  function pointerHover(e, p) {
    if (tool === 'dim' && dimStart) { ghost = { kind: 'dim', a: dimStart, b: dimTo(p, e) }; renderGhost(); return; }
    if (tool === 'wall' || tool === 'split') {
      if (draw) { ghost = Object.assign({ kind: tool, t: tool === 'wall' ? (wallMode === 'ext' ? S.wallThickness.exterior : S.wallThickness.interior) : 0 }, drawTarget(p, e)); }
      else { const sp = snapPoint(p, e.altKey); ghost = { kind: 'point', snap: sp.kind ? sp.p : null }; }
      renderGhost();
    } else if (tool === 'door' || tool === 'window' || tool === 'cased') { ghost = openingGhost(p); renderGhost(); }
    else if (tool === 'fixture') { ghost = fixtureGhost(p, e); renderGhost(); }
    else if (tool === 'scale' && ghost) { ghost.cur = p; renderGhost(); }
  }
  function dragMove(e, p) {
    const d = drag;
    if (d.type === 'pan' || d.type === 'pan-later') {
      if (d.type === 'pan-later') { if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return; d.type = 'pan'; svg.classList.add('panning'); }
      const k = pxFt(); view.x = d.vx - (e.clientX - d.sx) * k; view.y = d.vy - (e.clientY - d.sy) * k; applyView(); return;
    }
    d.moved = true;
    if (d.type === 'under') { S.underlay.ox = d.ox + p[0] - d.start[0]; S.underlay.oy = d.oy + p[1] - d.start[1]; render(); return; }
    if (d.type === 'plan') {
      const it = byUid(d.uid), dx = p[0] - d.start[0], dy = p[1] - d.start[1], o = d.orig;
      if (!e.altKey) { /* snapping is to the inch, below */ }
      const q = v => r4(Math.round(v / GRID) * GRID);
      if (it.x1 !== undefined) { it.x1 = q(o.x1 + dx); it.x2 = q(o.x2 + dx); it.y = q(o.y + dy); }
      else if (it.y1 !== undefined) { it.y1 = q(o.y1 + dy); it.y2 = q(o.y2 + dy); it.x = q(o.x + dx); }
      else { it.x = q(o.x + dx); it.y = q(o.y + dy); }
      render(); renderSide(); return;
    }
    if (d.type === 'startmove') { const st = S.keep.start; st.x = r4(d.orig.x + p[0] - d.start[0]); st.y = r4(d.orig.y + p[1] - d.start[1]); render(); renderSide(); return; }
    if (d.type === 'end' && d.what === 'start') {
      const st = S.keep.start; let yaw = Math.atan2(-(p[0] - st.x), -(p[1] - st.y));
      if (!e.altKey) yaw = Math.round(yaw / (Math.PI / 12)) * (Math.PI / 12);
      st.yaw = r4(yaw); render(); renderSide(); return;
    }
    if (d.type === 'end' && d.what === 'fxedge') {
      const g = fxBy(d.uid), r = d.rect0.slice(), side = d.end, axis = side === 'w' || side === 'e' ? 'x' : 'y';
      const v = snapC(axis === 'x' ? p[0] : p[1], fxEdges(axis, d.uid), e.altKey), i = { w: 0, n: 1, e: 2, s: 3 }[side];
      r[i] = v;
      if (r[2] - r[0] < 0.25 || r[3] - r[1] < 0.25) return;
      FX.place(g, r); render(); renderSide(); return;
    }
    if (d.type === 'wall' && d.p0) {                                       // an angled wall moves as it is
      const w = byUid(d.uid); let dx = p[0] - d.start[0], dy = p[1] - d.start[1];
      if (!e.altKey) {
        dx = Math.round(dx / GRID) * GRID; dy = Math.round(dy / GRID) * GRID;
        for (const i of [0, 2]) { const sp = snapPoint([d.p0[i] + dx, d.p0[i + 1] + dy], false, w); if (sp.kind === 'end') { dx = sp.p[0] - d.p0[i]; dy = sp.p[1] - d.p0[i + 1]; break; } }
      }
      setLine(w, [d.p0[0] + dx, d.p0[1] + dy, d.p0[2] + dx, d.p0[3] + dy]); followAttached(w, d, dx, dy); render(); return;
    }
    if (d.type === 'wall') {
      const w = byUid(d.uid), v = d.c0 + across(w.axis, p) - across(w.axis, d.start);
      w.c = r4(snapC(v, coordCands(w.axis === 'h' ? 'y' : 'x', w), e.altKey));
      const dc = w.c - d.c0; followAttached(w, d, w.axis === 'v' ? dc : 0, w.axis === 'h' ? dc : 0); render(); return;
    }
    if (d.type === 'end' && d.what === 'wall' && isL(byUid(d.uid))) {      // one end of an angled wall: to another wall's end, else every 15 degrees
      const w = byUid(d.uid), fixed = d.end === 'a' ? [w.p[2], w.p[3]] : [w.p[0], w.p[1]];
      const sp = e.altKey ? { p, kind: null } : snapPoint(p, false, w);
      let np = sp.kind === 'end' ? sp.p.slice() : p.slice();
      if (!sp.kind && !e.altKey) {
        const dx = p[0] - fixed[0], dy = p[1] - fixed[1], ang = Math.round(Math.atan2(dy, dx) / ANG) * ANG, len = Math.round(Math.hypot(dx, dy) / GRID) * GRID;
        np = [fixed[0] + Math.cos(ang) * len, fixed[1] + Math.sin(ang) * len];
        const hit = rayHit(fixed, ang, p); if (hit) np = hit;
      }
      if (Math.hypot(np[0] - fixed[0], np[1] - fixed[1]) < 0.25) return;
      setLine(w, d.end === 'a' ? [np[0], np[1], fixed[0], fixed[1]] : [fixed[0], fixed[1], np[0], np[1]]);
      if (d.end === 'a') w.openings.forEach((o, i) => { o.a = r4(d.ops0[i][0] + w.b - d.len0); o.b = r4(d.ops0[i][1] + w.b - d.len0); });   // openings stay put relative to the far end
      render(); return;
    }
    if (d.type === 'end' && d.what === 'wall') {
      const w = byUid(d.uid);
      let v = snapC(along(w.axis, p), coordCands(w.axis === 'h' ? 'x' : 'y', w), e.altKey);
      if (d.end === 'a') w.a = r4(Math.min(v, w.b - 0.25)); else w.b = r4(Math.max(v, w.a + 0.25));
      render(); return;
    }
    if (d.type === 'end' && d.what === 'opening') {
      const { w, o } = findOpening(d.uid);
      let v = snapC(along(w, p), [], e.altKey);
      const others = w.openings.filter(x => x !== o);
      if (d.end === 'a') { const lim = Math.max(w.a, ...others.filter(x => x.b <= o.a + 1e-6).map(x => x.b)); o.a = r4(Math.max(lim, Math.min(v, o.b - 1))); }
      else { const lim = Math.min(w.b, ...others.filter(x => x.a >= o.b - 1e-6).map(x => x.a)); o.b = r4(Math.min(lim, Math.max(v, o.a + 1))); }
      render(); renderSide(); return;
    }
    if (d.type === 'fixture') {
      const g = fxBy(d.uid), dx = p[0] - d.start[0], dy = p[1] - d.start[1], r0 = d.rect0;
      const w = r0[2] - r0[0], h = r0[3] - r0[1], free = e.altKey;
      const x0 = snapSpan(r0[0] + dx, w, fxEdges('x', d.uid), free), y0 = snapSpan(r0[1] + dy, h, fxEdges('y', d.uid), free);
      FX.place(g, [x0, y0, x0 + w, y0 + h]); render(); renderSide(); return;
    }
    if (d.type === 'opening') {
      const { w, o } = findOpening(d.uid), wd = d.b0 - d.a0;
      let a = snapC(d.a0 + along(w, p) - d.start, [], e.altKey);
      a = Math.max(w.a, Math.min(w.b - wd, a));
      if (!w.openings.some(x => x !== o && x.a < a + wd - 1e-6 && x.b > a + 1e-6)) { o.a = r4(a); o.b = r4(a + wd); }
      render(); renderSide();
    }
  }
  svg.addEventListener('pointercancel', e => { touchEnd(e); if (drag) { drag = null; svg.classList.remove('panning'); } });
  svg.addEventListener('pointerup', e => {
    if (touchEnd(e)) return;
    const d = drag; drag = null; svg.classList.remove('panning');
    if (d && d.moved && d.before) {
      if (d.type === 'end' && d.what === 'wall') { const w = byUid(d.uid); w.openings.forEach(o => { o.a = Math.max(o.a, w.a); o.b = Math.min(o.b, w.b); }); w.openings = w.openings.filter(o => o.b - o.a >= 0.5); }
      checkpoint(d.before); changed();
    }
  });
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const p = toFt(e); zoomAt(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), p[0], p[1]);
  }, { passive: false });
  svg.addEventListener('dblclick', () => { if (draw) { endDraw(); render(); } });
  $('#zIn').onclick = () => zoomAt(1 / 1.3, view.x + view.w / 2, view.y + vh() / 2);
  $('#zOut').onclick = () => zoomAt(1.3, view.x + view.w / 2, view.y + vh() / 2);
  $('#zFit').onclick = fit;

  // ------------------------------------------------------------------ keyboard
  const KEYTOOL = { v: 'select', w: 'wall', d: 'door', n: 'window', o: 'cased', r: 'room', l: 'split', f: 'fixture', a: 'trace', b: 'label', m: 'dim', g: 'start' };
  document.addEventListener('keydown', e => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || !$('#dialog').hidden;
    if ((e.ctrlKey || e.metaKey) && !typing) {
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if (k === 'y') { e.preventDefault(); redo(); }
      if (k === 's') { e.preventDefault(); saveFile(); }
      return;
    }
    if (typing) { if (e.key === 'Escape' && !$('#dialog').hidden) closeDialog(); return; }
    if (draw && (tool === 'wall' || tool === 'split')) {             // typed lengths while drawing
      if (/^[0-9.'"\- ]$/.test(e.key)) { lenBuf += e.key; e.preventDefault(); ghost = Object.assign(ghost || {}, { kind: tool, t: ghost?.t || 0 }, drawTarget(lastP, lastMods)); renderGhost(); return; }
      if (e.key === 'Backspace' && lenBuf) { lenBuf = lenBuf.slice(0, -1); e.preventDefault(); ghost = Object.assign(ghost || {}, drawTarget(lastP, lastMods)); renderGhost(); return; }
      if (e.key === 'Enter' && lenBuf) { e.preventDefault(); drawClick(lastP, lastMods); return; }
    }
    if (e.key === ' ') { spaceDown = true; e.preventDefault(); return; }
    if (e.key === 'Escape') {
      if (dimStart) { dimStart = null; ghost = null; render(); return; }
      if (draw) { endDraw(); render(); } else if (tool !== 'select') setTool('select'); else if (sel) { sel = null; render(); renderSide(); }
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); deleteSel(); return; }
    if (e.key === 'h') { fit(); return; }
    if (e.key.toLowerCase() === 't') {
      if (tool === 'fixture') { fxFace = CW[fxFace]; ghost = fixtureGhost(lastP, {}); renderGhost(); renderSide(); return; }
      if (sel && sel.kind === 'fixture') { turnSelected(); return; }
    }
    if (e.key === '+' || e.key === '=') { zoomAt(1 / 1.3, view.x + view.w / 2, view.y + vh() / 2); return; }
    if (e.key === '-') { zoomAt(1.3, view.x + view.w / 2, view.y + vh() / 2); return; }
    const t = KEYTOOL[e.key.toLowerCase()]; if (t && !e.altKey) setTool(t);
  });
  document.addEventListener('keyup', e => { if (e.key === ' ') spaceDown = false; });
  $$('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  $('#wallMode').addEventListener('click', e => { const b = e.target.closest('[data-mode],[data-angle],[data-done]'); if (!b) return; if (b.dataset.done) { endDraw(); render(); return; } if (b.dataset.angle) wallAngle = !wallAngle; else wallMode = b.dataset.mode; endDraw(); setTool('wall'); });

  // ------------------------------------------------------------------ fixtures: placing and moving
  const SIZE_KEYS = ['box', 'upper', 'range', 'tub', 'ftub', 'shower', 'front', 'shelf', 'pumps', 'sink2', 'steps', 'deck'];
  let fxItem = 'base', fxFace = 's';
  const catOf = id => FX.CATALOG.find(c => c.id === id);
  const hasFront = c => !['tub', 'shelf', 'heater', 'ftub'].includes(c.make().k);
  // the wall face nearest the cursor, if one is close: { w, side, face, front }
  function wallFace(p, reach) {
    let best = null;
    for (const w of live()) {
      if (isL(w)) continue;
      const t = along(w.axis, p); if (t < w.a - 0.3 || t > w.b + 0.3) continue;
      const a = across(w.axis, p) - w.c, side = a >= 0 ? 1 : -1, dist = Math.abs(Math.abs(a) - w.t / 2);
      if (dist > reach || (best && dist >= best.dist)) continue;
      best = { w, side, dist, face: w.c + side * w.t / 2, front: w.axis === 'h' ? (side > 0 ? 's' : 'n') : (side > 0 ? 'e' : 'w') };
    }
    return best;
  }
  // edge coordinates worth snapping to: other fixtures, and every wall's faces and ends
  function fxEdges(axis, skip) {
    const out = [];
    for (const g of fxs()) { if (g.uid === skip || !FX.editable(g)) continue; const r = FX.footprint(g); out.push(...(axis === 'x' ? [r[0], r[2]] : [r[1], r[3]])); }
    for (const w of live()) { if (isL(w)) continue; const r = rectOf(w); out.push(...(axis === 'x' ? [r.x0, r.x1] : [r.y0, r.y1])); }
    return out;
  }
  function snapSpan(start, len, cands, free) {                           // snap either end of a span to a candidate, else the 1" grid
    if (free) return start;
    const tol = SNAP_PX * pxFt(); let best = start, bd = tol, hit = false;
    for (const c of cands) for (const s of [c, c - len]) { const d = Math.abs(s - start); if (d < bd) { bd = d; best = s; hit = true; } }
    return hit ? best : Math.round(start / GRID) * GRID;
  }
  const rectFor = (front, face, ac, W, D) => front === 's' ? [ac - W / 2, face, ac + W / 2, face + D] : front === 'n' ? [ac - W / 2, face - D, ac + W / 2, face]
    : front === 'e' ? [face, ac - W / 2, face + D, ac + W / 2] : [face - D, ac - W / 2, face, ac + W / 2];
  const rectsHit = (a, b) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 0.02 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 0.02;
  const fxOverlap = (f, skip) => { const r = FX.footprint(f); return fxs().some(g => g.uid !== skip && FX.editable(g) && FX.layer(g) === FX.layer(f) && rectsHit(r, FX.footprint(g))); };
  function fixtureGhost(p, e) {
    const cat = catOf(fxItem); if (!cat) return null;
    const [W, D] = cat.size, free = !!(e && e.altKey), face = hasFront(cat);
    const wf = !cat.free && !free ? wallFace(p, 2.4) : null;
    let front, rect;
    if (wf) {
      const axis = wf.w.axis === 'h' ? 'x' : 'y', ac = along(wf.w.axis, p);
      const start = snapSpan(ac - W / 2, W, fxEdges(axis), free);
      front = wf.front;
      rect = rectFor(front, wf.face, start + W / 2, W, D);
    } else {
      front = fxFace;
      const [w, h] = front === 'n' || front === 's' ? [W, D] : [D, W];
      const x0 = snapSpan(p[0] - w / 2, w, fxEdges('x'), free), y0 = snapSpan(p[1] - h / 2, h, fxEdges('y'), free);
      rect = [x0, y0, x0 + w, y0 + h];
    }
    const f = FX.create(cat.id, front, rect), r = FX.footprint(f);
    return { kind: 'fixture', f, rect: r, front: face ? front : null, bad: fxOverlap(f), cat };
  }
  // the paint group a new cabinet joins: the house's existing group of that kind in the same room, else a new one
  const RESERVED_KEYS = new Set(['trim', 'doors', 'extdoors', 'exttrim', 'wall', 'ceiling', 'siding', 'house']);
  function uniqueKey(base) { const taken = new Set((S.keep.items || []).map(i => i.key)); let k = base, i = 2; while (taken.has(k) || RESERVED_KEYS.has(k)) k = base + '_' + i++; return k; }
  function roomIdAt(r) { const rm = roomAt((r[0] + r[2]) / 2, (r[1] + r[3]) / 2); return rm ? rm.id : 'house'; }
  function attachItem(f, cat) {
    const items = (S.keep.items ||= []), room = roomIdAt(FX.footprint(f)), [key, name, def] = cat.item;
    let it = items.find(i => i.name === name && (i.room || 'house') === room && i.kind === 'cabinet');
    if (!it) { it = { key: uniqueKey(key), name, room, kind: 'cabinet', default: def }; items.push(it); }
    f.paint = it.key;
  }
  function fixtureClick(p, e) {
    const g = fixtureGhost(p, e); if (!g) return;
    if (g.bad) { toast('That overlaps another fixture. Move it, or turn it with T.'); return; }
    checkpoint();
    const f = g.f; f.uid = uid();
    if (g.cat.item) attachItem(f, g.cat);
    fxs().push(f); sel = { kind: 'fixture', uid: f.uid }; changed();
  }
  function turnSelected() {
    const f = fxBy(sel.uid); if (!f) return;
    checkpoint(); FX.spin(f); changed();
  }
  function duplicateSelected() {
    const f = fxBy(sel.uid); if (!f) return;
    checkpoint();
    const c = JSON.parse(JSON.stringify(f)); c.uid = uid();
    const r = FX.footprint(f), d = FX.facing(f), w = r[2] - r[0], h = r[3] - r[1];
    const [ox, oy] = d && (d === 'n' || d === 's') ? [w, 0] : d ? [0, h] : [0.5, 0.5];
    FX.place(c, [r[0] + ox, r[1] + oy, r[2] + ox, r[3] + oy]);
    fxs().push(c); sel = { kind: 'fixture', uid: c.uid }; changed();
  }

  function deleteSel() {
    if (!sel) return;
    checkpoint();
    if (sel.kind === 'wall') S.walls = S.walls.filter(w => w.uid !== sel.uid);
    if (sel.kind === 'room') S.rooms = S.rooms.filter(r => r.uid !== sel.uid);
    if (sel.kind === 'split') S.splits = S.splits.filter(s => s.uid !== sel.uid);
    if (sel.kind === 'plan' && S.keep.plan) { const P = S.keep.plan; P.labels = (P.labels || []).filter(x => x.uid !== sel.uid); P.dims = (P.dims || []).filter(x => x.uid !== sel.uid); }
    if (sel.kind === 'start') delete S.keep.start;
    if (sel.kind === 'fixture') S.keep.fixtures = fxs().filter(f => f.uid !== sel.uid);
    if (sel.kind === 'opening') { const f = findOpening(sel.uid); if (f) f.w.openings = f.w.openings.filter(o => o !== f.o); }
    sel = null; changed();
  }

  // ------------------------------------------------------------------ side panels
  const STEPS = [
    { t: 'Blueprint', hint: 'Upload a photo, scan or PDF of the floor plan. Optional: you can draw from measurements instead.', done: () => !!S.underlay, go: () => $('#underFile').click() },
    { t: 'Scale', hint: 'Click two points a known distance apart on the blueprint (an overall dimension works best), then type the distance.', done: () => !!(S.underlay && S.underlay.calibrated) || (!S.underlay && S.walls.length > 0), go: () => setTool('scale') },
    { t: 'Suggest walls', hint: 'Optional: let the editor find the walls in your blueprint. Straighten a skewed picture first, then keep the suggestions that are right.', done: () => S.walls.length > 0, go: () => { if (S.underlay && S.underlay.calibrated) setTool('trace'); else if (S.underlay) setTool('scale'); else toast('Upload a blueprint first.'); } },
    { t: 'Outside walls', hint: 'Click corner to corner around the outside and close the loop. Type a length and press Enter for exact walls.', done: () => S.walls.filter(w => w.ext).length >= 3, go: () => { wallMode = 'ext'; setTool('wall'); } },
    { t: 'Inside walls', hint: 'Draw each inside wall along its centre line. Ends snap to the walls they meet.', done: () => S.walls.some(w => !w.ext), go: () => { wallMode = 'int'; setTool('wall'); } },
    { t: 'Doors & windows', hint: 'Pick Door, Window or Opening and click on a wall. Drag the ends to size it; flip the swing in the panel on the right.', done: () => S.walls.some(w => w.openings.length), go: () => setTool('door') },
    { t: 'Rooms', hint: 'Click inside each space and name it. Split open-plan spaces first with the Split tool.', done: () => S.rooms.length > 0, go: () => setTool('room') },
    { t: 'Fixtures', hint: 'Optional: cabinets, appliances and bath fixtures. They back onto the wall you click near, and every door and drawer can be painted on its own.', done: () => fxs().some(f => FX.editable(f)), go: () => setTool('fixture') },
    { t: 'Heights', hint: 'Ceiling, door and window heights for the whole house. Single doors and windows can override them.', done: () => S.rooms.length > 0, go: () => { sel = null; render(); renderSide(); $('#insp [data-f="ceiling"]')?.focus(); } },
    { t: 'Paint it', hint: 'Open the house in the Paint Studio, or save house.json to keep it.', done: () => false, go: () => openInStudio() }
  ];
  function renderSide() {
    // the current step: the first unfinished one after the furthest finished one (the blueprint is optional)
    let lastDone = -1; STEPS.forEach((s, i) => { if (s.done()) lastDone = i; });
    const after = STEPS.findIndex((s, i) => i > lastDone && !s.done());
    stepCur = after >= 0 ? after : Math.max(0, STEPS.findIndex(s => !s.done()));
    $('#steps').innerHTML = STEPS.map((s, i) => `<li><button class="step${s.done() ? ' done' : ''}${i === stepCur ? ' cur' : ''}" data-step="${i}"><b>${s.t}</b><span>${s.hint}</span></button></li>`).join('');
    // blueprint box
    const u = S.underlay;
    $('#underBox').innerHTML = !u ? `<p class="note" style="margin:0">No blueprint yet. A phone photo of the plan is fine; straighten it with Rotate if it's skewed.</p>
        <div class="actions"><button class="btn" data-u="upload">Upload image or PDF</button></div>` :
      `<div class="name" title="${esc(u.name)}">${esc(u.name)}</div>
       <div class="row2"><span>Opacity</span><input type="range" min="0.1" max="1" step="0.05" value="${u.opacity}" data-u="opacity" aria-label="Blueprint opacity"></div>
       <div class="row2"><span>Rotate</span><input type="range" min="-30" max="30" step="0.1" value="${u.rot}" data-u="rot" aria-label="Rotate blueprint"></div>
       <div class="note" style="margin:0">${u.calibrated ? `Scale set \u00b7 ${(1 / u.s).toFixed(1)} px per foot` : '<b>Scale not set yet.</b>'} \u00b7 rotated ${(+u.rot).toFixed(1)}\u00b0</div>
       <div class="actions"><button class="btn" data-u="straighten" title="Measure how tilted the picture is and level it">Straighten</button><button class="btn primary" data-u="trace" title="Let the editor suggest the walls it can see">Suggest walls\u2026</button></div>
       <div class="actions"><button class="btn" data-u="scale">${u.calibrated ? 'Re-scale' : 'Set scale'}</button><button class="btn" data-u="move" aria-pressed="${tool === 'move'}">Move</button>
         <button class="btn" data-u="upload">Replace</button><button class="btn danger" data-u="remove">Remove</button></div>`;
    // rooms
    $('#findRoomsBtn').hidden = !live().length;
    $('#roomList').innerHTML = S.rooms.length ? S.rooms.map((r, i) => `<button class="roomrow${sel && sel.uid === r.uid ? ' on' : ''}" data-room="${r.uid}" style="--c:hsl(${roomHue(i)} 60% 55%)"><i></i><span>${esc(r.name)}</span><small>${esc(r.short || r.id)}</small></button>`).join('')
      : '<p class="empty">No rooms yet. Use the Room tool and click inside each space.</p>';
    const fl = fxs().filter(f => FX.editable(f));
    $('#fxList').innerHTML = fl.length ? fl.map(f => { const r = FX.footprint(f), rm = roomAt((r[0] + r[2]) / 2, (r[1] + r[3]) / 2);
      return `<button class="roomrow${sel && sel.uid === f.uid ? ' on' : ''}" data-fx="${f.uid}"><i style="background:var(--muted)"></i><span>${esc(FX.describe(f))}</span><small>${esc(rm ? rm.name : '')}</small></button>`; }).join('')
      : '<p class="empty">Nothing placed yet. Use the Fixture tool to add cabinets, appliances and bath fixtures.</p>';
    const prev = lsGet(BACKUP);
    if (prev) { let nm = ''; try { nm = JSON.parse(prev).meta.name; } catch { } $('#restoreBox').hidden = false; $('#restoreBox').innerHTML = `Your previous drawing (${esc(nm || 'unnamed')}) is backed up. <button class="linkish" id="restorePrev">Restore it</button>`; }
    else $('#restoreBox').hidden = true;
    $('#houseName').textContent = S.meta.name;
    document.title = S.meta.name + ' \u00b7 Plan Editor';
    $('#welcome').hidden = welcomeOff || !!(S.walls.length || S.underlay);
    $('#undoBtn').disabled = !undoS.length; $('#redoBtn').disabled = !redoS.length;
    renderInspector(); renderStatus();
  }
  $('#steps').addEventListener('click', e => { const b = e.target.closest('[data-step]'); if (b) STEPS[+b.dataset.step].go(); });
  $('#findRoomsBtn').addEventListener('click', findRooms);
  $('#fxList').addEventListener('click', e => { const b = e.target.closest('[data-fx]'); if (b) { setTool('select'); sel = { kind: 'fixture', uid: b.dataset.fx }; render(); renderSide(); } });
  $('#roomList').addEventListener('click', e => { const b = e.target.closest('[data-room]'); if (b) { sel = { kind: 'room', uid: b.dataset.room }; render(); renderSide(); } });
  $('#restoreBox').addEventListener('click', e => {
    if (e.target.id !== 'restorePrev') return;
    const prev = lsGet(BACKUP), cur = snap(); lsSet(BACKUP, cur);
    checkpoint(); restoreSnap(prev); loadUnderlayImage(); fit();
  });
  $('#underBox').addEventListener('input', e => {
    const f = e.target.dataset.u; if (!f || !S.underlay) return;
    if (f === 'rot') setRotAboutCentre(S.underlay, +e.target.value); else S.underlay[f] = +e.target.value; render();
    if (f === 'rot') $('#underBox .note').textContent = ($('#underBox .note').textContent || '').replace(/rotated .*$/, `rotated ${(+e.target.value).toFixed(1)}\u00b0`);
  });
  $('#underBox').addEventListener('change', e => { if (e.target.dataset.u) { autosave(); renderSide(); } });
  $('#underBox').addEventListener('pointerdown', e => { if (e.target.type === 'range') checkpoint(); });
  $('#underBox').addEventListener('click', e => {
    const a = e.target.closest('button[data-u]')?.dataset.u; if (!a) return;
    if (a === 'upload') $('#underFile').click();
    if (a === 'scale') setTool('scale');
    if (a === 'move') setTool(tool === 'move' ? 'select' : 'move');
    if (a === 'remove') { checkpoint(); S.underlay = null; underURL = null; underImg = null; changed(); }
    if (a === 'straighten') straighten();
    if (a === 'trace') setTool('trace');
  });

  // inspector: whatever is selected, else the house settings
  function field(label, f, value, opts = {}) {
    const id = 'f_' + f;
    if (opts.select) return `<label class="field">${label}<select id="${id}" data-f="${f}">${opts.select.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    return `<label class="field">${label}<input id="${id}" data-f="${f}" data-len="${opts.len ? 1 : ''}" value="${esc(opts.len ? (value == null || value === '' ? '' : fmt(value)) : (value ?? ''))}" placeholder="${esc(opts.ph || '')}" autocomplete="off"${opts.type ? ` type="${opts.type}"` : ''}></label>`;
  }
  function renderInspector() {
    const box = $('#insp'), it = sel && byUid(sel.uid), op = sel && sel.kind === 'opening' && findOpening(sel.uid);
    let h = '', title = 'House';
    if (tool === 'trace') {
      title = 'Suggest walls';
      const r = TR.res, kept = r ? r.filter((w, i) => !TR.off.has(i)) : [];
      h += `<p class="note">The editor looks for long, straight, solid bars in the picture, which is what walls are. Dimension lines, text, door swings and fixtures are left alone. Nothing you have drawn changes until you press Add.</p>
        ${field('How the walls are drawn', 'tr_style', TR.opts.style, { select: [['solid', 'Solid, filled in'], ['outlined', 'Outlined: two thin lines'], ['thin', 'Thin: one line (least reliable)']] })}
        ${field('Shortest wall', 'tr_minlen', TR.opts.minLen, { len: 1 })}
        <label class="field">Sensitivity<input type="range" min="0.6" max="0.95" step="0.01" value="${TR.opts.sensitivity}" data-f="tr_sens" aria-label="Sensitivity"></label>
        <p class="note" style="margin-top:-6px">Raise it for a faint photo, lower it when too much is picked up.</p>
        ${field('Doors and windows', 'tr_open', TR.opts.openings ? '1' : '0', { select: [['1', 'Suggest them from the gaps in walls'], ['0', 'Walls only']] })}
        <div class="actions"><button class="btn primary" data-act="trace-run"${TR.busy ? ' disabled' : ''}>${r ? 'Find again' : 'Find walls'}</button></div>`;
      if (r) h += `<h3 style="font-size:14px">${kept.length} of ${r.length} walls kept</h3>
        <p class="note">${r.filter(w => w.ext).length} outside, ${r.filter(w => !w.ext).length} inside, ${r.reduce((t, w) => t + w.openings.length, 0)} gaps (as doors and windows). Found in ${(TR.ms / 1000).toFixed(1)} s. Click an orange wall to leave it out, click it again to bring it back. Door and window types are guesses: you can change each one afterwards.</p>
        <div class="actions"><button class="btn primary" data-act="trace-add"${kept.length ? '' : ' disabled'}>Add ${kept.length} walls</button><button class="btn" data-act="trace-cancel">Cancel</button></div>`;
      $('#inspTitle').textContent = title; box.innerHTML = h; return;
    }
    if (tool === 'fixture') {
      title = 'Fixtures';
      const groups = [...new Set(FX.CATALOG.map(c => c.group))];
      h += groups.map(g => `<div class="lib"><h4>${g}</h4><div class="libgrid">${FX.CATALOG.filter(c => c.group === g).map(c =>
        `<button data-lib="${c.id}" aria-pressed="${c.id === fxItem}">${esc(c.name)}<small>${fmt(c.size[0])} \u00d7 ${fmt(c.size[1])}</small></button>`).join('')}</div></div>`).join('');
      h += `<div class="field">Faces, when it isn't against a wall<div class="seg" role="group" aria-label="Facing">${['n', 'e', 's', 'w'].map(d =>
        `<button data-face="${d}" aria-pressed="${d === fxFace}">${{ n: 'North', e: 'East', s: 'South', w: 'West' }[d]}</button>`).join('')}</div></div>
        <p class="note">Next to a wall, a fixture backs onto it and faces into the room. Switch to Select to change one you have placed.</p>`;
      $('#inspTitle').textContent = title; box.innerHTML = h; return;
    }
    const fx = sel && sel.kind === 'fixture' && fxBy(sel.uid);
    if (fx) {
      const d = FX.facing(fx), sized = SIZE_KEYS.includes(fx.k), cab = (fx.k === 'box' && fx.paint) || fx.k === 'upper';
      const rm = roomAt(...(() => { const r = FX.footprint(fx); return [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2]; })());
      title = 'Fixture';
      h += `<h3>${esc(FX.describe(fx))}</h3><p class="sub">${rm ? 'In ' + esc(rm.name) : 'Outside any room'}</p>`;
      if (d) h += field('Front faces', 'fx_face', d, { select: [['n', 'North (up)'], ['e', 'East (right)'], ['s', 'South (down)'], ['w', 'West (left)']] });
      if (sized) h += `<div class="pair">${field(d ? 'Width (across the front)' : 'Width', 'fx_w', FX.width(fx), { len: 1 })}${field('Depth', 'fx_d', FX.depth(fx), { len: 1 })}</div>`;
      if (fx.k === 'upper') h += `<div class="pair">${field('Bottom at', 'fx_z0', fx.z0, { len: 1 })}${field('Top at', 'fx_z1', fx.z1, { len: 1 })}</div>`;
      if (fx.k === 'box' && fx.paint) {
        h += field('Height', 'fx_z1', fx.z1 ?? (fx.c === 'cabW' ? 2.8 : 3), { len: 1 });
        h += field('Counter', 'fx_counter', fx.counter === 'all' ? 'all' : fx.counter === false ? 'none' : 'auto', { select: [['auto', 'On top (when 4\' or lower)'], ['none', 'No counter'], ['all', 'Overhangs on every side']] });
        h += field('Set into the counter', 'fx_sink', fx.sink ? 'sink' : fx.basin ? 'basin' : '', { select: [['', 'Nothing'], ['sink', 'Double kitchen sink'], ['basin', 'Bath basin']] });
      }
      if (cab) {
        h += `<div class="pair">${field('Fronts', 'fx_style', fx.style || '', { select: [['', 'Automatic'], ['door-drawer', 'Drawer over each door'], ['doors', 'Doors only'], ['drawers', 'Stack of drawers']] })}
          ${field('How many', 'fx_doors', fx.doors || '', { select: [['', 'By width']].concat([1, 2, 3, 4, 5, 6].map(n => [n, String(n)])) })}</div>`;
        h += field('Paint group', 'fx_group', fx.paint, { select: (S.keep.items || []).filter(i => i.kind === 'cabinet').map(i => [i.key, i.name + (i.room && i.room !== 'house' ? ' \u00b7 ' + ((S.rooms.find(r => r.id === i.room) || {}).name || i.room) : '')]) });
        h += `<div class="actions"><button class="btn" data-act="newgroup">New paint group\u2026</button></div><p class="note">Fixtures in the same group are painted together in the Paint Studio, and each door can still be painted on its own.</p>`;
      }
      if (fx.k === 'front') h += field('Label', 'fx_label', fx.label || '', { ph: 'WASHER' });
      h += `<div class="actions"><button class="btn" data-act="turn">Turn <kbd style="font:11px var(--f-mono)">T</kbd></button><button class="btn" data-act="dup">Duplicate</button><button class="btn danger" data-act="delete">Delete</button></div>`;
      $('#inspTitle').textContent = title; box.innerHTML = h; return;
    }
    if (sel && sel.kind === 'wall' && it) {
      const w = it; title = (w.ext ? 'Outside' : 'Inside') + ' wall';
      const dir = w.axis === 'h' ? ['Left end x', 'Right end x', 'Centre line y'] : ['Top end y', 'Bottom end y', 'Centre line x'];
      const where = isL(w)
        ? `<div class="pair">${field('Start x', 'px0', w.p[0], { len: 1 })}${field('Start y', 'py0', w.p[1], { len: 1 })}</div>
          <div class="pair">${field('End x', 'px1', w.p[2], { len: 1 })}${field('End y', 'py1', w.p[3], { len: 1 })}</div>
          ${field('Angle (degrees: 0 = east, 90 = north)', 'ang', Math.round(((-Math.atan2(w.p[3] - w.p[1], w.p[2] - w.p[0]) * 180 / Math.PI) + 360) % 360 * 100) / 100)}`
        : `<div class="pair">${field(dir[0], 'a', w.a, { len: 1 })}${field(dir[1], 'b', w.b, { len: 1 })}</div>
          ${field(dir[2], 'c', w.c, { len: 1 })}`;
      h += `<h3>${fmt(w.b - w.a)} ${isL(w) ? 'angled' : w.axis === 'h' ? 'horizontal' : 'vertical'} wall</h3>
        ${field('Type', 'ext', w.ext ? '1' : '', { select: [['1', 'Outside wall (siding outside)'], ['', 'Inside wall']] })}
        <div class="pair">${field('Length', 'len', w.b - w.a, { len: 1 })}${field('Thickness', 't', w.t, { len: 1 })}</div>
        ${where}
        ${field('Status', 'status', w.status, { select: [['keep', 'Existing'], ['new', 'New (remodel)'], ['removed', 'Removed (shown on the Before plan only)']] })}
        ${w.openings.length ? `<div class="field">Openings<div class="chips">${w.openings.slice().sort((p, q) => p.a - q.a).map(o => `<button data-pick="${o.uid}">${o.type} ${fmt(o.b - o.a)}</button>`).join('')}</div></div>` : ''}
        <div class="actions"><button class="btn danger" data-act="delete">Delete wall</button></div>`;
    } else if (op) {
      const { w, o } = op; title = { door: 'Door', window: 'Window', cased: 'Opening', panel: 'Access panel' }[o.type];
      const hz = w.axis === 'h', ang = isL(w);
      h += `<h3>${fmt(o.b - o.a)} ${title.toLowerCase()}</h3><p class="sub">In a ${fmt(w.b - w.a)} ${w.ext ? 'outside' : 'inside'} wall</p>
        ${field('Type', 'type', o.type, { select: [['door', 'Door'], ['window', 'Window'], ['cased', 'Opening (no door)'], ['panel', 'Access panel']] })}
        <div class="pair">${field('Width', 'width', o.b - o.a, { len: 1 })}${field(ang ? 'From the start' : hz ? 'From left end' : 'From top end', 'from', o.a - w.a, { len: 1 })}</div>`;
      if (o.type === 'door') h += `<div class="pair">${field('Hinge', 'hinge', o.hinge || 'a', { select: ang ? [['a', 'Start side'], ['b', 'End side']] : hz ? [['a', 'Left side'], ['b', 'Right side']] : [['a', 'Top side'], ['b', 'Bottom side']] })}
          ${field('Swings into', 'swing', o.swing, { select: ang ? [['l', 'The left (looking from the start)'], ['r', 'The right (looking from the start)']] : hz ? [['n', 'The north side (up)'], ['s', 'The south side (down)']] : [['w', 'The west side (left)'], ['e', 'The east side (right)']] })}</div>
          ${field('Height', 'height', o.height, { len: 1, ph: fmt(S.heights.door) + ' (house default)' })}`;
      if (o.type === 'cased') h += field('Height', 'height', o.height, { len: 1, ph: fmt(S.heights.door) + ' (house default)' });
      if (o.type === 'window') h += `<div class="trio">${field('Sill', 'sill', o.sill, { len: 1, ph: fmt(S.heights.windowSill) })}${field('Head', 'head', o.head, { len: 1, ph: fmt(S.heights.windowHead) })}${field('Panes', 'panes', o.panes || 1, { select: [[1, '1'], [2, '2'], [3, '3'], [4, '4']] })}</div>
          <p class="note">Sill and head are heights above the floor. Leave blank for the house default.</p>`;
      h += `<div class="actions"><button class="btn" data-act="wall">Select its wall</button><button class="btn danger" data-act="delete">Delete</button></div>`;
    } else if (sel && sel.kind === 'room' && it) {
      const r = it; title = 'Room';
      const area = roomArea(r);
      h += `<h3>${esc(r.name)}</h3><p class="sub">About ${Math.round(area)} sq ft (to the wall centre lines)</p>
        ${field('Name', 'name', r.name)}
        <div class="pair">${field('Wall ID prefix', 'short', r.short, { ph: r.id.toUpperCase() })}${field('Room id', 'id', r.id)}</div>
        <p class="note">Walls are named from the prefix: ${esc((r.short || r.id.toUpperCase()) + '-N')}, ${esc((r.short || r.id.toUpperCase()) + '-E')}\u2026 Changing it after you've painted renames those walls, and their saved colours won't show.</p>
        <div class="actions"><button class="btn danger" data-act="delete">Delete room</button></div>`;
    } else if (sel && sel.kind === 'plan' && it && it.t !== undefined) {
      title = 'Floor plan label';
      h += `<h3>${esc(it.t || 'Label')}</h3>${field('Text', 'pl_t', it.t)}${field('Second line', 'pl_t2', it.t2 || '', { ph: 'optional' })}${field('Small text underneath', 'pl_sub', it.sub || '', { ph: 'e.g. 12\'-0" \u00d7 14\'-0"' })}
        ${field('Size', 'pl_size', it.size || 11, { type: 'number' })}<div class="pair">${field('x', 'pl_x', it.x, { len: 1 })}${field('y', 'pl_y', it.y, { len: 1 })}</div>
        <p class="note">This is only for the floor plan page. Room names in the Paint Studio come from the rooms.</p>
        <div class="actions"><button class="btn danger" data-act="delete">Delete label</button></div>`;
    } else if (sel && sel.kind === 'plan' && it) {
      title = 'Dimension';
      const [a, b] = dimEnds(it);
      h += `<h3>${fmt(Math.hypot(b[0] - a[0], b[1] - a[1]))} dimension</h3>${field('Text (blank = the measured length)', 'pl_label', it.label || '')}
        <div class="actions"><button class="btn danger" data-act="delete">Delete dimension</button></div>`;
    } else if (sel && sel.kind === 'start' && S.keep.start) {
      const st = S.keep.start; title = 'Walkthrough start';
      h += `<h3>Walkthrough start</h3><div class="pair">${field('x', 'st_x', st.x, { len: 1 })}${field('y', 'st_y', st.y, { len: 1 })}</div>
        ${field('Facing', 'st_face', yawName(st.yaw || 0), { select: Object.keys(YAW).map(k => [k, { N: 'North (up the page)', NE: 'Northeast', E: 'East', SE: 'Southeast', S: 'South', SW: 'Southwest', W: 'West', NW: 'Northwest' }[k]]) })}
        <p class="note">Where the Paint Studio's walkthrough begins. Drag the dot on the arrow to turn it by 15\u00b0.</p>
        <div class="actions"><button class="btn danger" data-act="delete">Use the default start</button></div>`;
    } else if (sel && sel.kind === 'split' && it) {
      title = 'Split line';
      h += `<h3>${fmt(it.b - it.a)} split line</h3><p class="note">Divides an open space into two rooms without a wall. Make the rooms after drawing it.</p>
        <div class="actions"><button class="btn danger" data-act="delete">Delete split line</button></div>`;
    } else {
      const H = S.heights, T = S.wallThickness, F = S.floor;
      h += `${field('House name', 'h_name', S.meta.name)}
        <div class="pair">${field('Id (for files and links)', 'h_id', S.meta.id)}${field('Subtitle', 'h_sub', S.meta.subtitle, { ph: '3 BR \u00b7 2 BA' })}</div>
        <h3 style="font-size:14px">Heights</h3>
        <div class="pair">${field('Ceiling', 'ceiling', H.ceiling, { len: 1 })}${field('Doors', 'door', H.door, { len: 1 })}</div>
        <div class="pair">${field('Window tops', 'windowHead', H.windowHead, { len: 1 })}${field('Window sills', 'windowSill', H.windowSill, { len: 1 })}</div>
        <p class="note">Single doors and windows can override these in their own panel.</p>
        <h3 style="font-size:14px">New walls</h3>
        <div class="pair">${field('Outside thickness', 'exterior', T.exterior, { len: 1 })}${field('Inside thickness', 'interior', T.interior, { len: 1 })}</div>
        <h3 style="font-size:14px">Floor</h3>
        ${field('Flooring', 'fl_mode', floorMode(F), { select: FLOOR_OPTIONS.concat(floorMode(F) === 'photo' ? [['photo', 'My own photo']] : [['photo', 'My own photo\u2026']]) })}
        ${floorMode(F) === 'photo' ? '<div class="actions"><button class="btn" data-act="floorphoto">Choose another photo\u2026</button></div>' : ''}
        <div class="pair">${field('Name', 'fl_name', F.name)}${field('Colour (plain)', 'fl_color', F.color, { type: 'color' })}</div>
        <p class="note">Wood floors are drawn the way the cabinet veneers are. A photo should show one plank, or a close-up of the grain, with the grain running up the picture.</p>
        <h3 style="font-size:14px">Floor plan notes</h3>
        ${(S.keep.plan && S.keep.plan.notes || []).map((c, i) => `<div class="notecard"><div class="pair">${field('Title', 'nt_title_' + i, c.title)}<label class="field">Style<select data-f="nt_ord_${i}"><option value=""${c.ordered ? '' : ' selected'}>Bullets</option><option value="1"${c.ordered ? ' selected' : ''}>Numbered</option></select></label></div>
          <label class="field">One line per item<textarea data-f="nt_items_${i}" rows="4">${esc((c.items || []).join('\n'))}</textarea></label><div class="actions"><button class="btn danger" data-act="delnote" data-i="${i}">Delete this note</button></div></div>`).join('')}
        <div class="actions"><button class="btn" data-act="addnote">Add a note</button></div>
        <p class="note">Notes show beside the floor plan page. Use the Label tool for names on the plan itself, and Dimension for measurements.</p>`;
    }
    $('#inspTitle').textContent = title;
    box.innerHTML = h;
  }
  $('#insp').addEventListener('change', e => {
    const el = e.target, f = el.dataset.f; if (!f) return;
    if (f.startsWith('tr_')) { traceField(f, el.value); return; }
    let v = el.value;
    if (el.dataset.len) { if (v.trim() === '') v = null; else { v = parseLen(v); if (!isFinite(v)) { el.classList.add('bad'); return; } } }
    el.classList.remove('bad');
    const before = snap();
    if (applyField(f, v) === false) { el.classList.add('bad'); return; }
    checkpoint(before); changed();
  });
  // Enter / Esc in a field commits it and hands the keyboard back to the drawing (tool shortcuts work again)
  $('#insp').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === 'Escape') && e.target.matches('input')) { e.preventDefault(); e.target.blur(); } });
  $('#insp').addEventListener('click', e => {
    const pick = e.target.closest('[data-pick]'); if (pick) { sel = { kind: 'opening', uid: pick.dataset.pick }; render(); renderSide(); return; }
    const lib = e.target.closest('[data-lib]'); if (lib) { fxItem = lib.dataset.lib; ghost = fixtureGhost(lastP, {}); renderGhost(); renderSide(); return; }
    const face = e.target.closest('[data-face]'); if (face) { fxFace = face.dataset.face; ghost = fixtureGhost(lastP, {}); renderGhost(); renderSide(); return; }
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'trace-run') runTrace();
    if (a === 'trace-add') applyTrace();
    if (a === 'trace-cancel') { TR.res = null; setTool('select'); }
    if (a === 'floorphoto') $('#floorFile').click();
    if (a === 'turn') turnSelected();
    if (a === 'dup') duplicateSelected();
    if (a === 'newgroup') newGroup();
    if (a === 'delete') deleteSel();
    if (a === 'addnote') { checkpoint(); (planOf().notes ||= []).push({ title: 'Note', items: ['First item'] }); changed(); }
    if (a === 'delnote') { checkpoint(); S.keep.plan.notes.splice(+e.target.closest('[data-i]').dataset.i, 1); changed(); }
    if (a === 'wall') { const f = findOpening(sel.uid); if (f) { sel = { kind: 'wall', uid: f.w.uid }; render(); renderSide(); } }
  });
  // flooring: plain colour, the bundled Desert Sand photo, a wood species drawn like the cabinet veneers, or your own photo
  const FLOOR_WOODS = { whiteoak: ['White oak', '#CDAA7C', '#8C6A45'], redoak: ['Red oak', '#C48D63', '#86513A'], walnut: ['Walnut', '#8C5D3E', '#3A2215'], teak: ['Teak', '#B57E49', '#6A4220'],
    cherry: ['Cherry', '#A8603F', '#6A3322'], maple: ['Maple', '#E2C99E', '#BE9C70'], rosewood: ['Rosewood', '#743A26', '#29120B'], ebonized: ['Ebonized oak', '#3E3630', '#191513'] };
  const FLOOR_OPTIONS = [['plain', 'Plain colour'], ['tex:textures/desert_sand_plank.png', 'Desert Sand LVP (photo)']].concat(Object.entries(FLOOR_WOODS).map(([id, w]) => ['wood:' + id, w[0] + ' planks']));
  const floorAvg = w => '#' + [1, 3, 5].map(i => Math.round(parseInt(w[1].slice(i, i + 2), 16) * 0.62 + parseInt(w[2].slice(i, i + 2), 16) * 0.38).toString(16).padStart(2, '0')).join('').toUpperCase();
  const floorMode = F => F.wood ? 'wood:' + F.wood : F.texture ? (/^data:/.test(F.texture) ? 'photo' : 'tex:' + F.texture) : 'plain';
  $('#floorFile').addEventListener('change', async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('That image could not be read.')); i.src = url; });
      // portrait, at most 1200px on the long side, as a JPEG small enough to live inside the house file
      const rot = img.width > img.height, scale = Math.min(1, 1200 / Math.max(img.width, img.height));
      const w = Math.round((rot ? img.height : img.width) * scale), h = Math.round((rot ? img.width : img.height) * scale);
      const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d');
      if (rot) { ctx.translate(w, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(img, 0, 0, h, w); } else ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      checkpoint(); delete S.floor.wood; S.floor.texture = c.toDataURL('image/jpeg', 0.85); S.floor.name = 'My floor';
      changed(); toast('Floor photo set (' + Math.round(S.floor.texture.length / 1024) + ' KB, stored inside the house file).');
    } catch (err) { toast(err.message || 'Could not use that photo.'); }
  });
  function moveItems(from, to) { (S.keep.items || []).forEach(i => { if (i.room === from) i.room = to; }); }
  function newGroup() {
    const g = fxBy(sel.uid); if (!g) return;
    dialog(`<form class="box"><h3>New paint group</h3><p class="note">Fixtures in a group share a colour, like \u201cKitchen uppers\u201d. This one starts with the fixture you have selected.</p>
      <label class="field">Name<input id="dlgLen" autocomplete="off" placeholder="e.g. Pantry cabinets"></label>
      <div class="row-btns"><button type="button" class="btn" id="dlgCancel">Cancel</button><button class="btn primary">Create</button></div></form>`, true);
    $('#dlgLen').focus();
    $('#dialog form').onsubmit = e => {
      e.preventDefault(); const name = $('#dlgLen').value.trim(); if (!name) return;
      closeDialog(); checkpoint();
      const it = { key: uniqueKey(slug(name)), name, room: roomIdAt(FX.footprint(g)), kind: 'cabinet', default: ((S.keep.items || []).find(i => i.key === g.paint) || {}).default || '#E8E4DA' };
      (S.keep.items ||= []).push(it); g.paint = it.key; changed();
    };
  }
  function applyField(f, v) {
    const it = sel && byUid(sel.uid), op = sel && sel.kind === 'opening' && findOpening(sel.uid);
    if (sel && sel.kind === 'wall' && it) {
      const w = it;
      if (f === 'ext') { w.ext = !!v; return; }
      if (f === 'status') { w.status = v; return; }
      if (isL(w) && ['px0', 'py0', 'px1', 'py1', 'ang'].includes(f)) {
        if (v === null || v === '' || !isFinite(+v)) return false;
        const q = w.p.slice(), n = +v;
        if (f === 'ang') { const rad = -n * Math.PI / 180; q[2] = q[0] + Math.cos(rad) * w.b; q[3] = q[1] + Math.sin(rad) * w.b; }
        else q[{ px0: 0, py0: 1, px1: 2, py1: 3 }[f]] = n;
        if (Math.hypot(q[2] - q[0], q[3] - q[1]) < 0.5) return false;
        setLine(w, q); return;
      }
      if (v == null || v <= 0 && f !== 'a' && f !== 'b' && f !== 'c') return false;
      if (isL(w) && f === 'len') { const u = lineU(w); setLine(w, [w.p[0], w.p[1], w.p[0] + u[0] * v, w.p[1] + u[1] * v]); return; }
      if (f === 'len') { w.b = r4(w.a + v); return; }
      if (f === 't') { w.t = r4(v); return; }
      if (f === 'a') { if (v >= w.b) return false; w.a = r4(v); return; }
      if (f === 'b') { if (v <= w.a) return false; w.b = r4(v); return; }
      if (f === 'c') { w.c = r4(v); return; }
    }
    if (sel && sel.kind === 'plan' && it) {
      const map = { pl_t: 't', pl_t2: 't2', pl_sub: 'sub' };
      if (map[f]) { if (f === 'pl_t' && !v.trim()) return false; if (v.trim()) it[map[f]] = v; else delete it[map[f]]; return; }
      if (f === 'pl_size') { const n = +v; if (!(n >= 6 && n <= 40)) return false; it.size = n; return; }
      if (f === 'pl_x' || f === 'pl_y') { if (v == null) return false; it[f === 'pl_x' ? 'x' : 'y'] = r4(v); return; }
      if (f === 'pl_label') { if (v.trim()) it.label = v; else delete it.label; return; }
    }
    if (sel && sel.kind === 'start' && S.keep.start) {
      const st = S.keep.start;
      if (f === 'st_x' || f === 'st_y') { if (v == null) return false; st[f === 'st_x' ? 'x' : 'y'] = r4(v); return; }
      if (f === 'st_face') { st.yaw = YAW[v]; return; }
    }
    if (/^nt_/.test(f)) {
      const m = /^nt_(title|ord|items)_(\d+)$/.exec(f), c = m && S.keep.plan && S.keep.plan.notes[+m[2]]; if (!c) return false;
      if (m[1] === 'title') c.title = v; else if (m[1] === 'ord') { if (v) c.ordered = true; else delete c.ordered; } else c.items = v.split('\n').map(x => x.trim()).filter(Boolean);
      return;
    }
    if (op) {
      const { w, o } = op;
      if (f === 'type') { o.type = v; if (v === 'door') { o.hinge ||= 'a'; o.swing ||= isL(w) ? 'r' : w.axis === 'h' ? 's' : 'e'; } return; }
      if (f === 'hinge' || f === 'swing') { o[f] = v; return; }
      if (f === 'panes') { o.panes = +v; return; }
      if (f === 'width') { if (!(v >= 0.5)) return false; const b = o.a + v; if (b > w.b + 1e-6 || w.openings.some(x => x !== o && x.a < b - 1e-6 && x.b > o.a + 1e-6)) return false; o.b = r4(b); return; }
      if (f === 'from') { if (v == null) return false; const a = w.a + v, b = a + (o.b - o.a); if (a < w.a - 1e-6 || b > w.b + 1e-6 || w.openings.some(x => x !== o && x.a < b - 1e-6 && x.b > a + 1e-6)) return false; o.a = r4(a); o.b = r4(b); return; }
      if (f === 'height' || f === 'sill' || f === 'head') { if (v == null) delete o[f]; else if (v < 0 || v > S.heights.ceiling) return false; else o[f] = r4(v); return; }
    }
    if (sel && sel.kind === 'fixture' && it) {
      const g = it, r = FX.footprint(g);
      if (f === 'fx_face') { FX.turn(g, v); return; }
      if (f === 'fx_w' || f === 'fx_d') {
        if (!(v >= 0.25)) return false;
        FX.resize(g, f === 'fx_w' ? v : FX.width(g), f === 'fx_d' ? v : FX.depth(g)); return;
      }
      if (f === 'fx_z0' || f === 'fx_z1') { if (v == null || v <= 0 || v > S.heights.ceiling) return false; g[f.slice(3)] = r4(v); return; }
      if (f === 'fx_counter') { if (v === 'auto') delete g.counter; else g.counter = v === 'all' ? 'all' : false; return; }
      if (f === 'fx_sink') { delete g.sink; delete g.basin; if (v) g[v] = true; return; }
      if (f === 'fx_style') { if (v) g.style = v; else delete g.style; return; }
      if (f === 'fx_doors') { if (v) g.doors = +v; else delete g.doors; return; }
      if (f === 'fx_group') { g.paint = v; return; }
      if (f === 'fx_label') { if (v.trim()) g.label = v.trim().toUpperCase(); else delete g.label; return; }
      void r;
    }
    if (sel && sel.kind === 'room' && it) {
      if (f === 'name') { if (!v.trim()) return false; it.name = v.trim();
        if (it.fresh) { const others = S.rooms.filter(r => r !== it), was = it.id; it.id = uniqueId(slug(it.name), new Set(others.map(r => r.id))); it.short = shortFor(it.name, new Set(others.map(r => r.short))); moveItems(was, it.id); }
        return; }
      if (f === 'short') { const s = v.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); if (S.rooms.some(r => r !== it && r.short === s)) return false; it.short = s; delete it.fresh; return; }
      if (f === 'id') { const s = slug(v); if (S.rooms.some(r => r !== it && r.id === s) || s === 'exterior' || s === 'house') return false; moveItems(it.id, s); it.id = s; delete it.fresh; return; }
    }
    if (f === 'h_name') { if (!v.trim()) return false; const wasAuto = S.meta.id === slug(S.meta.name).replace(/_/g, '-') || S.meta.id === 'my-house'; S.meta.name = v.trim(); if (wasAuto) S.meta.id = slug(v).replace(/_/g, '-'); return; }
    if (f === 'h_id') { const s = slug(v).replace(/_/g, '-'); if (!s) return false; S.meta.id = s; return; }
    if (f === 'h_sub') { S.meta.subtitle = v; return; }
    if (['ceiling', 'door', 'windowHead', 'windowSill'].includes(f)) { if (!(v > 0)) return false; S.heights[f] = r4(v); return; }
    if (f === 'exterior' || f === 'interior') { if (!(v > 0)) return false; S.wallThickness[f] = r4(v); return; }
    if (f === 'fl_name') { S.floor.name = v; return; }
    if (f === 'fl_color') { S.floor.color = v.toUpperCase(); return; }
    if (f === 'fl_mode') {
      const F = S.floor;
      if (v === 'photo') { setTimeout(() => $('#floorFile').click(), 0); return; }
      delete F.texture; delete F.wood;
      if (v.startsWith('wood:')) { const id = v.slice(5), w = FLOOR_WOODS[id]; F.wood = id; F.name = w[0] + ' plank'; F.color = floorAvg(w); }
      else if (v.startsWith('tex:')) { F.texture = v.slice(4); F.name = 'Desert Sand'; F.color = '#B09672'; }
      else if (v === 'plain') { F.name = F.name || 'Plain floor'; }
      return;
    }
  }

  // status bar: counts, problems, cursor
  function problems() {
    const src = toHouse(), out = [];
    if (!src) return ['Draw some walls.'];
    if (!src.walls.some(w => w.ext)) out.push('No outside walls yet (siding and the walkthrough start need them).');
    if (!src.rooms.length) out.push('No rooms yet: use the Room tool and click inside each space.');
    else HouseCore.validate(src).forEach(p => out.push(p));
    return out;
  }
  function renderStatus() {
    const ops = S.walls.reduce((t, w) => t + w.openings.length, 0), pr = problems();
    const pl = (n, one, many) => n + ' ' + (n === 1 ? one : many);
    $('#status').innerHTML = `<span>${pl(S.walls.length, 'wall', 'walls')} \u00b7 ${pl(ops, 'door or window', 'doors & windows')} \u00b7 ${pl(S.rooms.length, 'room', 'rooms')} \u00b7 ${pl(fxs().filter(f => FX.editable(f)).length, 'fixture', 'fixtures')}</span>
      ${pr.length ? `<button class="problems" id="probBtn">${pr.length} to fix before painting</button>` : '<span class="okay">Ready to paint</span>'}
      <span class="spacer"></span><span>Snap: walls & 1" grid (hold Alt to turn off)</span><span id="cursor"></span>`;
    $('#probBtn')?.addEventListener('click', () => dialog(`<div class="box"><h3>Before it can be painted</h3><ul>${pr.map(p => `<li>${esc(p)}</li>`).join('')}</ul><div class="row-btns"><button class="btn primary" id="dlgCancel">OK</button></div></div>`, true));
  }

  // ------------------------------------------------------------------ change pipeline
  function changed() { updateShapes(); render(); renderSide(); autosave(); schedulePreview(); }
  // what each room really covers (first match wins, walls excluded), from house-core; drawn instead of the raw rectangles
  let shapes = {};
  function updateShapes() {
    shapes = {};
    try {
      const src = toHouse(); if (!src || !src.rooms.length) return;
      const rs = S.walls.map(rectOf), dx = -Math.min(...rs.map(r => r.x0)), dy = -Math.min(...rs.map(r => r.y0));
      const { ROOMS } = HouseCore.build(src);
      ROOMS.rooms.forEach((r, i) => { const u = S.rooms[i]; if (u && r.shape.length) shapes[u.uid] = r.shape.map(q => [q[0] - dx, q[1] - dy, q[2] - dx, q[3] - dy]); });
    } catch { shapes = {}; }
  }

  // ------------------------------------------------------------------ blueprint upload (image or PDF)
  function loadScript(src) { return new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('Could not load ' + src)); document.head.appendChild(s); }); }
  async function pdfToBlob(file) {
    if (!window.pdfjsLib) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    let pageNo = 1;
    if (pdf.numPages > 1) {
      const ans = await new Promise(ok => {
        dialog(`<form class="box"><h3>Which page has the floor plan?</h3><label class="field">Page (1\u2013${pdf.numPages})<input id="dlgLen" type="number" min="1" max="${pdf.numPages}" value="1"></label>
          <div class="row-btns"><button class="btn primary">Use this page</button></div></form>`);
        $('#dialog form').onsubmit = e => { e.preventDefault(); const n = Math.max(1, Math.min(pdf.numPages, Math.round(+$('#dlgLen').value || 1))); closeDialog(); ok(n); };
      });
      pageNo = ans;
    }
    const page = await pdf.getPage(pageNo), vp0 = page.getViewport({ scale: 1 }), scale = Math.min(4, 3200 / Math.max(vp0.width, vp0.height));
    const vp = page.getViewport({ scale }), c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return new Promise(ok => c.toBlob(ok, 'image/png'));
  }
  $('#underFile').addEventListener('change', async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try {
      toast('Loading ' + file.name + '\u2026');
      const blob = /pdf/i.test(file.type) || /\.pdf$/i.test(file.name) ? await pdfToBlob(file) : file;
      const url = URL.createObjectURL(blob);
      const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('That image could not be read.')); i.src = url; });
      checkpoint();
      const key = 'img-' + Date.now().toString(36);
      await idb.put(key, blob);
      const s = (S.walls.length ? 60 : view.w * 0.8) / img.naturalWidth;
      S.underlay = { key, name: file.name, w: img.naturalWidth, h: img.naturalHeight, s, ox: S.walls.length ? 0 : view.x + view.w * 0.1, oy: S.walls.length ? 0 : view.y + vh() * 0.1, rot: 0, opacity: 0.6, calibrated: false };
      if (underURL) URL.revokeObjectURL(underURL);
      underURL = url; underImg = img; changed(); fit();
      toast('Blueprint loaded. Next, set its scale: click two points a known distance apart.');
      setTool('scale');
    } catch (err) { toast(err.message || 'Could not load that file.'); }
  });
  async function loadUnderlayImage() {
    if (underURL) { URL.revokeObjectURL(underURL); underURL = null; }
    underImg = null;
    if (!S.underlay) return;
    const blob = await idb.get(S.underlay.key);
    if (blob) {
      underURL = URL.createObjectURL(blob); render();
      const i = new Image(); i.onload = () => { underImg = i; renderSide(); }; i.src = underURL;
    }
    else toast(`The blueprint image (${S.underlay.name}) isn't in this browser. Upload it again: its scale and position are kept.`);
  }

  // ------------------------------------------------------------------ files
  function saveFile() {
    const src = toHouse(); if (!src) { toast('Draw some walls first.'); return; }
    const text = pretty(src);
    PaintStore.saveFile('house.json', text).then(r => { if (r === 'saved') toast(`Saved house.json. Put it in houses/${src.id}/ to keep it with the project.`); })
      .catch(() => dialog(`<div class="box"><h3>Save house.json</h3><p class="note">Saving files isn't available here. Copy this into a file named house.json.</p><textarea style="width:100%;height:220px;font:11px var(--f-mono)" readonly>${esc(text)}</textarea><div class="row-btns"><button class="btn primary" id="dlgCancel">Close</button></div></div>`, true));
  }
  function openInStudio() {
    const pr = problems();
    if (pr.length) { dialog(`<div class="box"><h3>Almost there</h3><p class="note">Fix these first, then open it in the Paint Studio:</p><ul>${pr.map(p => `<li>${esc(p)}</li>`).join('')}</ul><div class="row-btns"><button class="btn primary" id="dlgCancel">OK</button></div></div>`, true); return; }
    const src = toHouse();
    try { HouseCore.build(src); } catch (e) { toast(e.message); return; }
    if (!lsSet(LOCAL_HOUSE, JSON.stringify(src))) { toast('This browser blocked saving the house (private window?). Save house.json instead.'); return; }
    location.href = 'paint.html?house=local';
  }
  function openText(text, label) {
    let src; try { src = JSON.parse(text); } catch { toast('That file is not valid JSON.'); return false; }
    if (src.format !== 'house-painter/house') { toast(`${label} isn't a house file.`); return false; }
    const pr = HouseCore.validate(src);
    if (pr.length) { dialog(`<div class="box"><h3>That house file has problems</h3><ul>${pr.map(p => `<li>${esc(p)}</li>`).join('')}</ul><div class="row-btns"><button class="btn primary" id="dlgCancel">OK</button></div></div>`, true); return false; }
    backupCurrent(src.id);
    checkpoint(); S = fromHouse(src); sel = null; changed(); fit(); loadUnderlayImage();
    return true;
  }
  function backupCurrent(newId) { if (S.walls.length && S.meta.id !== newId) lsSet(BACKUP, snap()); }
  $('#saveBtn').onclick = saveFile;
  $('#paintBtn').onclick = openInStudio;
  $('#openBtn').onclick = () => $('#openFile').click();
  $('#openFile').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (f) openText(await f.text(), f.name); });
  $('#newBtn').onclick = () => {
    if (!S.walls.length && !S.underlay) return;
    dialog(`<div class="box"><h3>Start a new house?</h3><p class="note">The current drawing is backed up in this browser, and you can restore it from the panel on the left.</p>
      <div class="row-btns"><button class="btn" id="dlgCancel">Cancel</button><button class="btn primary" id="dlgOk">New house</button></div></div>`, true);
    $('#dlgOk').onclick = () => { closeDialog(); lsSet(BACKUP, snap()); checkpoint(); S = blank(); sel = null; underURL = null; underImg = null; wallMode = 'ext'; changed(); fit(); setTool('select'); };
  };
  $('#undoBtn').onclick = undo; $('#redoBtn').onclick = redo;
  $('#wUpload').onclick = () => $('#underFile').click();
  $('#wOpen').onclick = () => $('#openFile').click();
  $('#wDraw').onclick = () => { welcomeOff = true; $('#welcome').hidden = true; wallMode = 'ext'; setTool('wall'); toast('Click to start the first outside wall, then type its length and press Enter.'); };

  // ------------------------------------------------------------------ dialogs + toast
  function dialog(html, closeBtn) { const d = $('#dialog'); d.innerHTML = html; d.hidden = false; if (closeBtn) $('#dlgCancel')?.addEventListener('click', closeDialog); }
  function closeDialog() { $('#dialog').hidden = true; $('#dialog').innerHTML = ''; }
  $('#dialog').addEventListener('click', e => { if (e.target.id === 'dialog') closeDialog(); });
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 4200); }

  // ------------------------------------------------------------------ 3D preview (house3d.js, the same build as the paint studio)
  const P3 = { on: false };
  function preview3d(on) {
    P3.on = on; $('#p3').hidden = !on; $('#stage').classList.toggle('split', on); $('#v3dBtn').setAttribute('aria-pressed', on);
    if (on && !P3.renderer) {
      const T = THREE, canvas = $('#c3');
      P3.renderer = new T.WebGLRenderer({ canvas, antialias: true });
      P3.renderer.outputEncoding = T.sRGBEncoding; P3.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      P3.scene = new T.Scene(); P3.camera = new T.PerspectiveCamera(40, 1, 0.1, 2000);
      P3.controls = new T.OrbitControls(P3.camera, canvas); P3.controls.enableDamping = true;
      P3.scene.add(new T.AmbientLight(0xffffff, 0.9));
      const head = new T.DirectionalLight(0xffffff, 0.15); P3.camera.add(head); P3.scene.add(P3.camera);
      const loop = () => { P3.raf = requestAnimationFrame(loop); if (!P3.on) return; P3.controls.update(); P3.renderer.render(P3.scene, P3.camera); };
      loop();
      new ResizeObserver(() => { const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return; P3.renderer.setSize(w, h, false); P3.camera.aspect = w / h; P3.camera.updateProjectionMatrix();
        if (!P3.sized && P3.B) { P3.sized = true; fit3d(); } }).observe(canvas);
    }
    setTimeout(() => { applyView(); render(); }, 0);
    if (on) rebuild3d(true);
  }
  let p3T = 0;
  function schedulePreview() { if (P3.on) { clearTimeout(p3T); p3T = setTimeout(() => rebuild3d(false), 300); } }
  function rebuild3d(refit) {
    const T = THREE, msg = $('#p3msg');
    P3.scene.background = new T.Color(getComputedStyle(document.documentElement).getPropertyValue('--stage').trim() || '#f3f2ee');
    const src = toHouse();
    if (!src) { msg.hidden = false; msg.textContent = 'Draw some walls to see them in 3D.'; return; }
    if (!src.rooms.length) src.rooms = [{ id: 'preview', name: 'House', rects: [[0, 0, src.W, src.D]] }];
    const ids = new Set(src.rooms.map(r => r.id));
    if (src.items) src.items = src.items.map(it => (ids.has(it.room) || it.room === 'house' ? it : { ...it, room: 'house' }));
    let built;
    try { built = HouseCore.build(src); } catch (e) { msg.hidden = false; msg.textContent = e.message; return; }
    if (P3.B) { P3.scene.remove(P3.B.root); P3.B.root.traverse(o => { o.geometry && o.geometry.dispose(); }); }
    const B = window.House3DBuild(built.HOUSE, built.ROOMS);
    B.ceilings.visible = false; P3.scene.add(B.root); P3.B = B;
    B.loadFloor(() => { });
    msg.hidden = !!S.rooms.length; msg.textContent = 'Walls only: add rooms to see paintable surfaces and ceilings.';
    P3.span = Math.max(built.HOUSE.W, built.HOUSE.D);
    if (refit || !P3.fitted) { P3.fitted = true; fit3d(); }
  }
  function fit3d() {                                            // dollhouse view that fits the house in the panel's width
    if (!P3.B) return;
    const T = THREE, c = P3.B.center, cam = P3.camera;
    const hfov = 2 * Math.atan(Math.tan(cam.fov * Math.PI / 360) * cam.aspect);
    const dist = Math.max(P3.span * 1.2, P3.span * 0.6 / Math.tan(hfov / 2));
    P3.controls.target.copy(c); cam.position.copy(c).addScaledVector(new T.Vector3(0.4, 0.85, 0.75).normalize(), dist);
  }
  $('#v3dBtn').onclick = () => preview3d(!P3.on);

  // ------------------------------------------------------------------ boot
  new ResizeObserver(() => { applyView(); render(); }).observe(svg);
  async function boot() {
    const want = new URLSearchParams(location.search).get('house');
    let loaded = false;
    if (want) {
      try {
        const text = want === 'local' ? lsGet(LOCAL_HOUSE) : await (await fetch(want, { cache: 'no-cache' })).text();
        if (text) { const src = JSON.parse(text); if (!HouseCore.validate(src).length) { const prev = lsGet(AUTOSAVE); if (prev) { try { if (JSON.parse(prev).meta.id !== src.id && JSON.parse(prev).walls.length) lsSet(BACKUP, prev); } catch { } } S = fromHouse(src); loaded = true; } }
      } catch { toast('Couldn\'t open ' + want); }
      try { history.replaceState(null, '', location.pathname); } catch { }
    }
    if (!loaded) { const a = lsGet(AUTOSAVE); if (a) { try { Object.assign(S, JSON.parse(a)); } catch { } } }
    // uids from saved state must not collide with new ones
    const used = JSON.stringify(S).match(/"uid":"u([0-9a-z]+)"/g) || [];
    used.forEach(m => { const n = parseInt(m.slice(8, -1), 36); if (n >= uidN) uidN = n + 1; });
    applyView(); fit(); setTool('select'); changed(); loadUnderlayImage();
  }
  window.__editor = { TR, runTrace, applyTrace, findRooms, straighten, P3, get S() { return S; }, toHouse, fromHouse, fillRoom, parseLen, fmt, setTool, view: () => view };   // debug handle
  boot();
})();
