/*
 * Plan editor: trace a blueprint into a house file (docs/house-format.md).
 *
 * Editor model (feet, same axes as the house file):
 *   wall    { uid, axis: 'h'|'v', c (centre line), a, b (extent along the axis), t, ext, status, extra, openings[] }
 *   opening { uid, type, a, b, ...door/window fields }       (a, b absolute along the wall's axis, as in the file)
 *   room    { uid, id, name, short, rects, extra }           (first match wins, as in the file)
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
  const GRID = 1 / 12, SNAP_PX = 9, HANDLE_PX = 6, AUTOSAVE = 'housepainter.editor.v1', BACKUP = 'housepainter.editor.v1.prev';
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
  let tool = 'select', wallMode = 'ext', sel = null, drag = null, draw = null, ghost = null, lenBuf = '', lastP = [0, 0], spaceDown = false;
  let view = { x: -6, y: -6, w: 72 }, underURL = null, stepCur = 0, welcomeOff = false;

  const byUid = u => S.walls.find(w => w.uid === u) || S.rooms.find(r => r.uid === u) || S.splits.find(s => s.uid === u);
  const findOpening = u => { for (const w of S.walls) { const o = w.openings.find(x => x.uid === u); if (o) return { w, o }; } return null; };
  const rectOf = w => w.axis === 'h' ? { x0: w.a, x1: w.b, y0: w.c - w.t / 2, y1: w.c + w.t / 2 } : { x0: w.c - w.t / 2, x1: w.c + w.t / 2, y0: w.a, y1: w.b };
  const ends = w => w.axis === 'h' ? [[w.a, w.c], [w.b, w.c]] : [[w.c, w.a], [w.c, w.b]];
  const along = (axis, [x, y]) => axis === 'h' ? x : y;
  const across = (axis, [x, y]) => axis === 'h' ? y : x;
  const live = () => S.walls.filter(w => w.status !== 'removed');

  // ------------------------------------------------------------------ house file <-> editor model
  function fromHouse(src) {
    const s = blank();
    s.meta = { id: src.id || 'my-house', name: src.name || 'My house', subtitle: src.subtitle || '' };
    s.heights = Object.assign({}, DEF.heights, src.heights || {});
    s.wallThickness = Object.assign({}, DEF.wallThickness, src.wallThickness || {});
    s.floor = Object.assign({}, DEF.floor, src.floor || {});
    s.walls = (src.walls || []).map(w => {
      const { x0, y0, x1, y1, ext, status, openings, t, ...extra } = w, h = (x1 - x0) >= (y1 - y0);
      return { uid: uid(), axis: h ? 'h' : 'v', c: h ? (y0 + y1) / 2 : (x0 + x1) / 2, t: h ? y1 - y0 : x1 - x0, a: h ? x0 : y0, b: h ? x1 : y1,
        ext: !!ext, status: status || 'keep', extra, openings: (openings || []).map(o => ({ uid: uid(), ...o })) };
    });
    s.rooms = (src.rooms || []).map(r => { const { id, name, short, rects, ...extra } = r; return { uid: uid(), id, name: name || id, short: short || '', rects: rects.map(q => q.slice()), extra }; });
    const ed = src.editor || {};
    s.splits = (ed.splits || []).map(p => ({ uid: uid(), ...p }));
    s.underlay = ed.underlay ? { ...ed.underlay } : null;
    const known = new Set(['format', 'version', 'id', 'name', 'subtitle', 'units', 'W', 'D', 'wallThickness', 'heights', 'floor', 'walls', 'rooms', 'editor']);
    s.keep = Object.fromEntries(Object.entries(src).filter(([k]) => !known.has(k)).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
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
      const r = rectOf(w), o = { x0: r4(r.x0 + dx), y0: r4(r.y0 + dy), x1: r4(r.x1 + dx), y1: r4(r.y1 + dy) };
      if (w.ext) o.ext = 1;
      Object.assign(o, w.extra);
      if (w.status && w.status !== 'keep') o.status = w.status;
      const d = w.axis === 'h' ? dx : dy;
      if (w.openings.length) o.openings = w.openings.slice().sort((p, q) => p.a - q.a).map(op => { const { uid: _, ...rest } = op; return { ...rest, a: r4(op.a + d), b: r4(op.b + d) }; });
      return o;
    });
    const W = Math.max(...walls.map(w => w.x1)), D = Math.max(...walls.map(w => w.y1));
    const rooms = S.rooms.map(r => ({ id: r.id, name: r.name, ...(r.short ? { short: r.short } : {}), rects: r.rects.map(q => [r4(q[0] + dx), r4(q[1] + dy), r4(q[2] + dx), r4(q[3] + dy)]), ...r.extra }));
    const keep = shiftDeep(S.keep, dx, dy);
    const ids = new Set(rooms.map(r => r.id));
    if (keep.items) keep.items = keep.items.map(it => (!it.room || it.room === 'house' || ids.has(it.room) ? it : { ...it, room: 'house' }));
    if (keep.roomOrder) keep.roomOrder = keep.roomOrder.filter(id => ids.has(id));
    if (keep.renderRooms) keep.renderRooms = keep.renderRooms.filter(id => ids.has(id));
    // floor: the inside of a plain rectangle by default; any other outline gets the rooms' own shapes
    if (!keep.floorRects && S.walls.filter(w => w.ext && w.status !== 'removed').length !== 4 && rooms.length) keep.floorRects = rooms.flatMap(r => r.rects);
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
    for (const w of live()) { const r = rectOf(w); if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return null; }
    for (const r of S.rooms) for (const [x0, y0, x1, y1] of r.rects) if (x >= x0 && x < x1 && y >= y0 && y < y1) return r;
    return null;
  }
  function wallNear(p, extra = 0) {
    const tol = SNAP_PX * pxFt() + extra; let best = null;
    for (const w of live()) {
      const t = along(w.axis, p), d = Math.abs(across(w.axis, p) - w.c);
      if (t < w.a || t > w.b || d > w.t / 2 + tol) continue;
      if (!best || d < best.d) best = { w, t, d, side: across(w.axis, p) > w.c ? 1 : -1 };
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
      if ((w.axis === 'v') === (axisOfCoord === 'x')) out.push(w.c);
      for (const p of ends(w)) out.push(axisOfCoord === 'x' ? p[0] : p[1]);
    }
    for (const s of S.splits) if ((s.axis === 'v') === (axisOfCoord === 'x')) out.push(s.c);
    return out;
  };
  function snapPoint(p, free) {
    if (free) return { p, kind: null };
    const tol = SNAP_PX * pxFt(); let best = null, bd = tol;
    for (const q of allEnds()) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = q; } }
    if (best) return { p: best.slice(), kind: 'end' };
    const near = wallNear(p, -SNAP_PX * pxFt() + 0.01);
    if (near && Math.abs(across(near.w.axis, p) - near.w.c) < near.w.t / 2 + tol) {
      const t = snapC(near.t, coordCands(near.w.axis === 'h' ? 'x' : 'y', near.w));
      return { p: near.w.axis === 'h' ? [t, near.w.c] : [near.w.c, t], kind: 'on' };
    }
    return { p: [snapC(p[0], coordCands('x')), snapC(p[1], coordCands('y'))], kind: null };
  }

  // ------------------------------------------------------------------ rendering
  const N = v => +v.toFixed(4);
  const roomHue = i => (i * 137.5 + 200) % 360;
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
      h += `<g class="room" data-kind="room" data-uid="${r.uid}">` + (shapes[r.uid] || r.rects).map(q => `<rect x="${N(q[0])}" y="${N(q[1])}" width="${N(q[2] - q[0])}" height="${N(q[3] - q[1])}" fill="hsl(${roomHue(i)} 60% 55% / ${on ? 0.32 : 0.17})"/>`).join('') + '</g>';
    });
    S.rooms.forEach(r => {
      const rr = shapes[r.uid] || r.rects;
      const big = rr.reduce((m, q) => ((q[2] - q[0]) * (q[3] - q[1]) > (m[2] - m[0]) * (m[3] - m[1]) ? q : m), rr[0]);
      if (!big) return;
      const cx = (big[0] + big[2]) / 2, cy = (big[1] + big[3]) / 2, fs = 12 * k;
      h += `<text class="roomlabel" x="${N(cx)}" y="${N(cy)}" font-size="${N(fs)}" stroke-width="${N(3 * k)}">${esc(r.name)}</text>`;
      h += `<text class="roomlabel sub" x="${N(cx)}" y="${N(cy + fs * 1.15)}" font-size="${N(fs * 0.85)}" stroke-width="${N(3 * k)}">${esc(r.id)}</text>`;
    });
    $('#lRooms').innerHTML = h;
    // fixtures (shown for context; editing them comes later)
    h = '';
    for (const f of S.keep.fixtures || []) {
      if (f.st === 'removed') continue;
      if (f.w != null && f.h != null && f.x != null) h += `<rect class="fx" x="${N(f.x)}" y="${N(f.y)}" width="${N(f.w)}" height="${N(f.h)}" stroke-width="1"/>`;
      else if (f.cx != null && (f.r || f.rx)) h += `<ellipse class="fx" cx="${N(f.cx)}" cy="${N(f.cy)}" rx="${N(f.r || f.rx)}" ry="${N(f.r || f.ry)}" stroke-width="1"/>`;
      else if (f.k === 'toilet') h += `<circle class="fx" cx="${N(f.cx)}" cy="${N(f.cy)}" r="0.7" stroke-width="1"/>`;
    }
    $('#lFix').innerHTML = h;
    // walls + openings
    h = ''; let ho = '';
    for (const w of S.walls) {
      const r = rectOf(w), pad = 4 * k;
      const cls = 'wall' + (w.ext ? ' ext' : '') + (w.status === 'removed' ? ' removed' : '') + (w.status === 'new' ? ' new' : '');
      h += `<g class="${cls}" data-kind="wall" data-uid="${w.uid}"><rect class="hit" x="${N(r.x0 - pad)}" y="${N(r.y0 - pad)}" width="${N(r.x1 - r.x0 + 2 * pad)}" height="${N(r.y1 - r.y0 + 2 * pad)}"/>`;
      const ops = w.openings.filter(o => o.type !== 'panel').sort((p, q) => p.a - q.a);
      let cur = w.a;
      const piece = (a, b) => { if (b - a < 0.001) return; const q = w.axis === 'h' ? [a, r.y0, b - a, r.y1 - r.y0] : [r.x0, a, r.x1 - r.x0, b - a];
        h += `<rect class="body" x="${N(q[0])}" y="${N(q[1])}" width="${N(q[2])}" height="${N(q[3])}" stroke-width="1.2"/>`; };
      for (const o of ops) { piece(cur, Math.max(cur, o.a)); cur = Math.max(cur, o.b); }
      piece(cur, w.b);
      h += '</g>';
      for (const o of w.openings) ho += openingSVG(w, o, k);
    }
    $('#lWalls').innerHTML = h; $('#lOpen').innerHTML = ho;
    // splits
    $('#lSplits').innerHTML = S.splits.map(s => { const [p, q] = s.axis === 'h' ? [[s.a, s.c], [s.b, s.c]] : [[s.c, s.a], [s.c, s.b]];
      return `<g data-kind="split" data-uid="${s.uid}"><line x1="${N(p[0])}" y1="${N(p[1])}" x2="${N(q[0])}" y2="${N(q[1])}" stroke="transparent" stroke-width="12" class="nse"/>
        <line class="splitline" x1="${N(p[0])}" y1="${N(p[1])}" x2="${N(q[0])}" y2="${N(q[1])}" stroke-width="1.5"/></g>`; }).join('');
    renderSel(); renderGhost();
    svg.setAttribute('class', 't-' + tool + (drag && drag.type === 'pan' ? ' panning' : '') + (S.underlay && underURL ? ' traced' : ''));
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
      if (sel.kind === 'wall' && it) {
        const r = rectOf(it);
        h += `<rect class="sel-outline" x="${N(r.x0)}" y="${N(r.y0)}" width="${N(r.x1 - r.x0)}" height="${N(r.y1 - r.y0)}" stroke-width="2"/>`;
        const [p, q] = ends(it), off = 14 * k;
        h += it.axis === 'h' ? dimText((it.a + it.b) / 2, r.y0 - off * 0.6, fmt(it.b - it.a), k) : dimText(r.x0 - off * 0.6, (it.a + it.b) / 2, fmt(it.b - it.a), k, true);
        h += handle(p[0], p[1], k, `data-uid="${it.uid}" data-end="a" data-what="wall"`) + handle(q[0], q[1], k, `data-uid="${it.uid}" data-end="b" data-what="wall"`);
      } else if (sel.kind === 'opening' && op) {
        const { w, o } = op, r = rectOf(w), hz = w.axis === 'h';
        const q = hz ? [o.a, r.y0, o.b - o.a, r.y1 - r.y0] : [r.x0, o.a, r.x1 - r.x0, o.b - o.a];
        h += `<rect class="sel-outline" x="${N(q[0])}" y="${N(q[1])}" width="${N(q[2])}" height="${N(q[3])}" stroke-width="2"/>`;
        const P = t => hz ? [t, w.c] : [w.c, t], off = 14 * k;
        h += hz ? dimText((o.a + o.b) / 2, r.y0 - off * 0.6, fmt(o.b - o.a), k) : dimText(r.x0 - off * 0.6, (o.a + o.b) / 2, fmt(o.b - o.a), k, true);
        h += handle(...P(o.a), k, `data-uid="${o.uid}" data-end="a" data-what="opening"`) + handle(...P(o.b), k, `data-uid="${o.uid}" data-end="b" data-what="opening"`);
      } else if (sel.kind === 'room' && it) {
        h += it.rects.map(q => `<rect class="sel-outline" x="${N(q[0])}" y="${N(q[1])}" width="${N(q[2] - q[0])}" height="${N(q[3] - q[1])}" stroke-width="2"/>`).join('');
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
    if (g && g.kind === 'wall') {
      const t = g.t, r = g.axis === 'h' ? [g.a, g.c - t / 2, g.b - g.a, t] : [g.c - t / 2, g.a, t, g.b - g.a];
      h += `<rect class="ghost" x="${N(r[0])}" y="${N(r[1])}" width="${N(r[2])}" height="${N(r[3])}" stroke-width="1.2"/>`;
      const label = (lenBuf ? lenBuf + '\u2009\u23ce' : fmt(g.b - g.a));
      h += g.axis === 'h' ? dimText((g.a + g.b) / 2, g.c - t / 2 - 10 * k, label, k) : dimText(g.c - t / 2 - 10 * k, (g.a + g.b) / 2, label, k, true);
    } else if (g && g.kind === 'split') {
      const [p, q] = g.axis === 'h' ? [[g.a, g.c], [g.b, g.c]] : [[g.c, g.a], [g.c, g.b]];
      h += `<line class="splitline" x1="${N(p[0])}" y1="${N(p[1])}" x2="${N(q[0])}" y2="${N(q[1])}" stroke-width="1.5"/>`;
    } else if (g && g.kind === 'opening') {
      const w = g.w, r = rectOf(w), hz = w.axis === 'h', pad = 2 * k;
      const q = hz ? [g.a, r.y0 - pad, g.b - g.a, r.y1 - r.y0 + 2 * pad] : [r.x0 - pad, g.a, r.x1 - r.x0 + 2 * pad, g.b - g.a];
      h += `<rect class="ghost${g.bad ? ' bad' : ''}" x="${N(q[0])}" y="${N(q[1])}" width="${N(q[2])}" height="${N(q[3])}" stroke-width="1.2"/>`;
      h += hz ? dimText((g.a + g.b) / 2, r.y0 - 10 * k, fmt(g.b - g.a), k) : dimText(r.x0 - 10 * k, (g.a + g.b) / 2, fmt(g.b - g.a), k, true);
    } else if (g && g.kind === 'scale') {
      for (const p of g.pts) h += `<circle class="scalept" cx="${N(p[0])}" cy="${N(p[1])}" r="${N(4 * k)}"/>`;
      if (g.pts.length && g.cur) h += `<line class="guide" x1="${N(g.pts[0][0])}" y1="${N(g.pts[0][1])}" x2="${N(g.cur[0])}" y2="${N(g.cur[1])}" stroke-width="1.5"/>`;
    }
    $('#lGhost').innerHTML = h;
  }

  // ------------------------------------------------------------------ tools
  const HINTS = {
    select: 'Click to select. Drag a wall to move it, or drag its ends. <kbd>Del</kbd> deletes. Drag empty space to pan, scroll to zoom.',
    wall: 'Click corner to corner. Type a length (like <kbd>12\'6</kbd>) and press <kbd>Enter</kbd> for an exact wall. <kbd>Esc</kbd> or right-click ends the run. Hold <kbd>Alt</kbd> to turn off snapping.',
    door: 'Click on a wall to put a door there. The side you click is the side it swings into.',
    window: 'Click on a wall to put a window there.',
    cased: 'Click on a wall for a doorway with no door.',
    room: 'Click inside a closed space to make it a room. Doorways count as closed.',
    split: 'Draw a line across an open space to split it into rooms (kitchen | dining). Then use Room on each side.',
    scale: 'Click two points a known distance apart on the blueprint.',
    move: 'Drag the blueprint to line it up. Press <kbd>Esc</kbd> when it\'s in place.'
  };
  function setTool(t) {
    if (t === 'scale' && !S.underlay) { toast('Upload a blueprint first.'); return; }
    endDraw(); tool = t; ghost = null;
    $$('[data-tool]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === t));
    $('#wallMode').hidden = t !== 'wall';
    $('#wallMode').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === wallMode));
    $('#hint').innerHTML = HINTS[t] || ''; $('#hint').hidden = !HINTS[t];
    if (t === 'scale') ghost = { kind: 'scale', pts: [] };
    render(); renderSide();
  }
  function endDraw() { draw = null; lenBuf = ''; if (ghost && (ghost.kind === 'wall' || ghost.kind === 'split')) ghost = null; }

  // wall + split drawing: click, click, click...
  function drawTarget(p, e) {
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
    if (S.walls.some(w => w.axis === g.axis && Math.abs(w.c - g.c) < 0.05 && Math.min(w.b, g.b) - Math.max(w.a, g.a) > 0.1)) {
      undoS.pop(); toast('There is already a wall there.'); draw.start = g.end.map(r4); return;
    }
    const ext = wallMode === 'ext';
    S.walls.push({ uid: uid(), axis: g.axis, c: r4(g.c), a: r4(g.a), b: r4(g.b), t: ext ? S.wallThickness.exterior : S.wallThickness.interior, ext, status: 'keep', extra: {}, openings: [] });
    draw.n++;
    if (ext && draw.n >= 3 && Math.hypot(g.end[0] - draw.first[0], g.end[1] - draw.first[1]) < 0.01) {
      draw = null; ghost = null; wallMode = 'int'; setTool('wall');
      toast('Outside walls closed. Now draw the inside walls along their centre lines.');
    } else draw.start = g.end.map(r4);
    changed();
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
      if (g.w.ext) { const rs = live().map(rectOf), mid = g.w.axis === 'h' ? (Math.min(...rs.map(r => r.y0)) + Math.max(...rs.map(r => r.y1))) / 2 : (Math.min(...rs.map(r => r.x0)) + Math.max(...rs.map(r => r.x1))) / 2; side = mid > g.w.c ? 1 : -1; }
      o.hinge = 'a'; o.swing = g.w.axis === 'h' ? (side > 0 ? 's' : 'n') : (side > 0 ? 'e' : 'w');
    }
    if (tool === 'window') o.panes = 1;
    g.w.openings.push(o);
    sel = { kind: 'opening', uid: o.uid }; changed();
  }

  // rooms: flood fill on a 3" grid, bounded by walls (doorways count as closed), split lines and existing rooms
  function fillRoom(p) {
    const ws = live().map(rectOf);
    if (!ws.length) return { error: 'Draw the walls first.' };
    const G = 0.25, x0 = Math.floor(Math.min(...ws.map(r => r.x0)) / G) * G - G, y0 = Math.floor(Math.min(...ws.map(r => r.y0)) / G) * G - G;
    const nx = Math.ceil((Math.max(...ws.map(r => r.x1)) - x0) / G) + 2, ny = Math.ceil((Math.max(...ws.map(r => r.y1)) - y0) / G) + 2;
    const WALL = 1, SPLIT = 2, ROOM = 3, IN = 4;
    const cell = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const cx = x0 + (i + 0.5) * G, cy = y0 + (j + 0.5) * G;
      if (ws.some(r => cx > r.x0 && cx < r.x1 && cy > r.y0 && cy < r.y1)) cell[j * nx + i] = WALL;
      else if (S.splits.some(s => (s.axis === 'h' ? Math.abs(cy - s.c) < G / 2 && cx > s.a && cx < s.b : Math.abs(cx - s.c) < G / 2 && cy > s.a && cy < s.b))) cell[j * nx + i] = SPLIT;
      else if (roomAt(cx, cy)) cell[j * nx + i] = ROOM;
    }
    const si = Math.floor((p[0] - x0) / G), sj = Math.floor((p[1] - y0) / G);
    if (si < 0 || sj < 0 || si >= nx || sj >= ny) return { error: 'Click inside the house.' };
    if (cell[sj * nx + si] === WALL) return { error: 'That\'s a wall. Click inside the room.' };
    if (cell[sj * nx + si] === SPLIT) return { error: 'That\'s on a split line. Click a little to one side.' };
    if (cell[sj * nx + si] === ROOM) return { error: 'That space is already a room.' };
    const q = [[si, sj]]; cell[sj * nx + si] = IN; let n = 0;
    while (q.length) {
      const [i, j] = q.pop(); n++;
      if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) return { error: 'This space isn\'t closed: it leaks outside the house. Check for a gap between walls.' };
      for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) if (!cell[b * nx + a]) { cell[b * nx + a] = IN; q.push([a, b]); }
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
    const r = { uid: uid(), id: uniqueId(slug(name), new Set(S.rooms.map(x => x.id))), name, short: shortFor(name, new Set(S.rooms.map(x => x.short))), rects: res.rects, extra: {}, fresh: true };
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
    if (tool === 'select') return selectDown(e, p);
    if (tool === 'wall' || tool === 'split') return drawClick(p, e);
    if (tool === 'door' || tool === 'window' || tool === 'cased') return openingClick(p);
    if (tool === 'room') return roomClick(p);
    if (tool === 'scale') return scaleClick(snapPoint(p, true).p);
    if (tool === 'move' && S.underlay) { drag = { type: 'under', start: p, ox: S.underlay.ox, oy: S.underlay.oy, before: snap() }; svg.setPointerCapture(e.pointerId); }
  });
  function startPan(e) { drag = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; svg.setPointerCapture(e.pointerId); svg.classList.add('panning'); }
  function selectDown(e, p) {
    const t = e.target.closest('[data-kind]');
    if (!t) { if (sel) { sel = null; render(); renderSide(); } return startPan(e); }
    const kind = t.dataset.kind, u = t.dataset.uid, before = snap();
    if (kind === 'handle') {
      drag = { type: 'end', what: t.dataset.what, uid: u, end: t.dataset.end, before };
    } else if (kind === 'wall') {
      const w = byUid(u); sel = { kind: 'wall', uid: u };
      drag = { type: 'wall', uid: u, start: p, c0: w.c, before };
    } else if (kind === 'opening') {
      const { w, o } = findOpening(u); sel = { kind: 'opening', uid: u };
      drag = { type: 'opening', uid: u, start: along(w.axis, p), a0: o.a, b0: o.b, before };
    } else if (kind === 'room' || kind === 'split') {
      sel = { kind, uid: u };
      drag = { type: 'pan-later', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    }
    svg.setPointerCapture(e.pointerId);
    render(); renderSide();
  }
  svg.addEventListener('pointermove', e => {
    const p = toFt(e); lastP = p;
    $('#cursor').textContent = `${fmt(p[0])}, ${fmt(p[1])}`;
    if (drag) return dragMove(e, p);
    if (tool === 'wall' || tool === 'split') {
      if (draw) { ghost = Object.assign({ kind: tool, t: tool === 'wall' ? (wallMode === 'ext' ? S.wallThickness.exterior : S.wallThickness.interior) : 0 }, drawTarget(p, e)); }
      else { const sp = snapPoint(p, e.altKey); ghost = { kind: 'point', snap: sp.kind ? sp.p : null }; }
      renderGhost();
    } else if (tool === 'door' || tool === 'window' || tool === 'cased') { ghost = openingGhost(p); renderGhost(); }
    else if (tool === 'scale' && ghost) { ghost.cur = p; renderGhost(); }
  });
  function dragMove(e, p) {
    const d = drag;
    if (d.type === 'pan' || d.type === 'pan-later') {
      if (d.type === 'pan-later') { if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return; d.type = 'pan'; svg.classList.add('panning'); }
      const k = pxFt(); view.x = d.vx - (e.clientX - d.sx) * k; view.y = d.vy - (e.clientY - d.sy) * k; applyView(); return;
    }
    d.moved = true;
    if (d.type === 'under') { S.underlay.ox = d.ox + p[0] - d.start[0]; S.underlay.oy = d.oy + p[1] - d.start[1]; render(); return; }
    if (d.type === 'wall') {
      const w = byUid(d.uid), v = d.c0 + across(w.axis, p) - across(w.axis, d.start);
      w.c = r4(snapC(v, coordCands(w.axis === 'h' ? 'y' : 'x', w), e.altKey)); render(); return;
    }
    if (d.type === 'end' && d.what === 'wall') {
      const w = byUid(d.uid);
      let v = snapC(along(w.axis, p), coordCands(w.axis === 'h' ? 'x' : 'y', w), e.altKey);
      if (d.end === 'a') w.a = r4(Math.min(v, w.b - 0.25)); else w.b = r4(Math.max(v, w.a + 0.25));
      render(); return;
    }
    if (d.type === 'end' && d.what === 'opening') {
      const { w, o } = findOpening(d.uid);
      let v = snapC(along(w.axis, p), [], e.altKey);
      const others = w.openings.filter(x => x !== o);
      if (d.end === 'a') { const lim = Math.max(w.a, ...others.filter(x => x.b <= o.a + 1e-6).map(x => x.b)); o.a = r4(Math.max(lim, Math.min(v, o.b - 1))); }
      else { const lim = Math.min(w.b, ...others.filter(x => x.a >= o.b - 1e-6).map(x => x.a)); o.b = r4(Math.min(lim, Math.max(v, o.a + 1))); }
      render(); renderSide(); return;
    }
    if (d.type === 'opening') {
      const { w, o } = findOpening(d.uid), wd = d.b0 - d.a0;
      let a = snapC(d.a0 + along(w.axis, p) - d.start, [], e.altKey);
      a = Math.max(w.a, Math.min(w.b - wd, a));
      if (!w.openings.some(x => x !== o && x.a < a + wd - 1e-6 && x.b > a + 1e-6)) { o.a = r4(a); o.b = r4(a + wd); }
      render(); renderSide();
    }
  }
  svg.addEventListener('pointerup', e => {
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
  const KEYTOOL = { v: 'select', w: 'wall', d: 'door', n: 'window', o: 'cased', r: 'room', l: 'split' };
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
      if (/^[0-9.'"\- ]$/.test(e.key)) { lenBuf += e.key; e.preventDefault(); ghost = Object.assign(ghost || {}, { kind: tool, t: ghost?.t || 0 }, drawTarget(lastP)); renderGhost(); return; }
      if (e.key === 'Backspace' && lenBuf) { lenBuf = lenBuf.slice(0, -1); e.preventDefault(); ghost = Object.assign(ghost || {}, drawTarget(lastP)); renderGhost(); return; }
      if (e.key === 'Enter' && lenBuf) { e.preventDefault(); drawClick(lastP, {}); return; }
    }
    if (e.key === ' ') { spaceDown = true; e.preventDefault(); return; }
    if (e.key === 'Escape') {
      if (draw) { endDraw(); render(); } else if (tool !== 'select') setTool('select'); else if (sel) { sel = null; render(); renderSide(); }
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); deleteSel(); return; }
    if (e.key === 'f') { fit(); return; }
    if (e.key === '+' || e.key === '=') { zoomAt(1 / 1.3, view.x + view.w / 2, view.y + vh() / 2); return; }
    if (e.key === '-') { zoomAt(1.3, view.x + view.w / 2, view.y + vh() / 2); return; }
    const t = KEYTOOL[e.key.toLowerCase()]; if (t && !e.altKey) setTool(t);
  });
  document.addEventListener('keyup', e => { if (e.key === ' ') spaceDown = false; });
  $$('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  $('#wallMode').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (!b) return; wallMode = b.dataset.mode; endDraw(); setTool('wall'); });

  function deleteSel() {
    if (!sel) return;
    checkpoint();
    if (sel.kind === 'wall') S.walls = S.walls.filter(w => w.uid !== sel.uid);
    if (sel.kind === 'room') S.rooms = S.rooms.filter(r => r.uid !== sel.uid);
    if (sel.kind === 'split') S.splits = S.splits.filter(s => s.uid !== sel.uid);
    if (sel.kind === 'opening') { const f = findOpening(sel.uid); if (f) f.w.openings = f.w.openings.filter(o => o !== f.o); }
    sel = null; changed();
  }

  // ------------------------------------------------------------------ side panels
  const STEPS = [
    { t: 'Blueprint', hint: 'Upload a photo, scan or PDF of the floor plan. Optional: you can draw from measurements instead.', done: () => !!S.underlay, go: () => $('#underFile').click() },
    { t: 'Scale', hint: 'Click two points a known distance apart on the blueprint (an overall dimension works best), then type the distance.', done: () => !!(S.underlay && S.underlay.calibrated) || (!S.underlay && S.walls.length > 0), go: () => setTool('scale') },
    { t: 'Outside walls', hint: 'Click corner to corner around the outside and close the loop. Type a length and press Enter for exact walls.', done: () => S.walls.filter(w => w.ext).length >= 3, go: () => { wallMode = 'ext'; setTool('wall'); } },
    { t: 'Inside walls', hint: 'Draw each inside wall along its centre line. Ends snap to the walls they meet.', done: () => S.walls.some(w => !w.ext), go: () => { wallMode = 'int'; setTool('wall'); } },
    { t: 'Doors & windows', hint: 'Pick Door, Window or Opening and click on a wall. Drag the ends to size it; flip the swing in the panel on the right.', done: () => S.walls.some(w => w.openings.length), go: () => setTool('door') },
    { t: 'Rooms', hint: 'Click inside each space and name it. Split open-plan spaces first with the Split tool.', done: () => S.rooms.length > 0, go: () => setTool('room') },
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
       <div class="row2"><span>Rotate</span><input type="range" min="-15" max="15" step="0.1" value="${u.rot}" data-u="rot" aria-label="Rotate blueprint"></div>
       <div class="note" style="margin:0">${u.calibrated ? `Scale set \u00b7 ${(1 / u.s).toFixed(1)} px per foot` : '<b>Scale not set yet.</b>'} \u00b7 rotated ${(+u.rot).toFixed(1)}\u00b0</div>
       <div class="actions"><button class="btn" data-u="scale">${u.calibrated ? 'Re-scale' : 'Set scale'}</button><button class="btn" data-u="move" aria-pressed="${tool === 'move'}">Move</button>
         <button class="btn" data-u="upload">Replace</button><button class="btn danger" data-u="remove">Remove</button></div>`;
    // rooms
    $('#roomList').innerHTML = S.rooms.length ? S.rooms.map((r, i) => `<button class="roomrow${sel && sel.uid === r.uid ? ' on' : ''}" data-room="${r.uid}" style="--c:hsl(${roomHue(i)} 60% 55%)"><i></i><span>${esc(r.name)}</span><small>${esc(r.short || r.id)}</small></button>`).join('')
      : '<p class="empty">No rooms yet. Use the Room tool and click inside each space.</p>';
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
  $('#roomList').addEventListener('click', e => { const b = e.target.closest('[data-room]'); if (b) { sel = { kind: 'room', uid: b.dataset.room }; render(); renderSide(); } });
  $('#restoreBox').addEventListener('click', e => {
    if (e.target.id !== 'restorePrev') return;
    const prev = lsGet(BACKUP), cur = snap(); lsSet(BACKUP, cur);
    checkpoint(); restoreSnap(prev); loadUnderlayImage(); fit();
  });
  $('#underBox').addEventListener('input', e => {
    const f = e.target.dataset.u; if (!f || !S.underlay) return;
    S.underlay[f] = +e.target.value; render();
    if (f === 'rot') $('#underBox .note').textContent = ($('#underBox .note').textContent || '').replace(/rotated .*$/, `rotated ${(+e.target.value).toFixed(1)}\u00b0`);
  });
  $('#underBox').addEventListener('change', e => { if (e.target.dataset.u) { autosave(); renderSide(); } });
  $('#underBox').addEventListener('pointerdown', e => { if (e.target.type === 'range') checkpoint(); });
  $('#underBox').addEventListener('click', e => {
    const a = e.target.closest('button[data-u]')?.dataset.u; if (!a) return;
    if (a === 'upload') $('#underFile').click();
    if (a === 'scale') setTool('scale');
    if (a === 'move') setTool(tool === 'move' ? 'select' : 'move');
    if (a === 'remove') { checkpoint(); S.underlay = null; underURL = null; changed(); }
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
    if (sel && sel.kind === 'wall' && it) {
      const w = it; title = (w.ext ? 'Outside' : 'Inside') + ' wall';
      const dir = w.axis === 'h' ? ['Left end x', 'Right end x', 'Centre line y'] : ['Top end y', 'Bottom end y', 'Centre line x'];
      h += `<h3>${fmt(w.b - w.a)} ${w.axis === 'h' ? 'horizontal' : 'vertical'} wall</h3>
        ${field('Type', 'ext', w.ext ? '1' : '', { select: [['1', 'Outside wall (siding outside)'], ['', 'Inside wall']] })}
        <div class="pair">${field('Length', 'len', w.b - w.a, { len: 1 })}${field('Thickness', 't', w.t, { len: 1 })}</div>
        <div class="pair">${field(dir[0], 'a', w.a, { len: 1 })}${field(dir[1], 'b', w.b, { len: 1 })}</div>
        ${field(dir[2], 'c', w.c, { len: 1 })}
        ${field('Status', 'status', w.status, { select: [['keep', 'Existing'], ['new', 'New (remodel)'], ['removed', 'Removed (shown on the Before plan only)']] })}
        ${w.openings.length ? `<div class="field">Openings<div class="chips">${w.openings.slice().sort((p, q) => p.a - q.a).map(o => `<button data-pick="${o.uid}">${o.type} ${fmt(o.b - o.a)}</button>`).join('')}</div></div>` : ''}
        <div class="actions"><button class="btn danger" data-act="delete">Delete wall</button></div>`;
    } else if (op) {
      const { w, o } = op; title = { door: 'Door', window: 'Window', cased: 'Opening', panel: 'Access panel' }[o.type];
      const hz = w.axis === 'h';
      h += `<h3>${fmt(o.b - o.a)} ${title.toLowerCase()}</h3><p class="sub">In a ${fmt(w.b - w.a)} ${w.ext ? 'outside' : 'inside'} wall</p>
        ${field('Type', 'type', o.type, { select: [['door', 'Door'], ['window', 'Window'], ['cased', 'Opening (no door)'], ['panel', 'Access panel']] })}
        <div class="pair">${field('Width', 'width', o.b - o.a, { len: 1 })}${field(hz ? 'From left end' : 'From top end', 'from', o.a - w.a, { len: 1 })}</div>`;
      if (o.type === 'door') h += `<div class="pair">${field('Hinge', 'hinge', o.hinge || 'a', { select: hz ? [['a', 'Left side'], ['b', 'Right side']] : [['a', 'Top side'], ['b', 'Bottom side']] })}
          ${field('Swings into', 'swing', o.swing, { select: hz ? [['n', 'The north side (up)'], ['s', 'The south side (down)']] : [['w', 'The west side (left)'], ['e', 'The east side (right)']] })}</div>
          ${field('Height', 'height', o.height, { len: 1, ph: fmt(S.heights.door) + ' (house default)' })}`;
      if (o.type === 'cased') h += field('Height', 'height', o.height, { len: 1, ph: fmt(S.heights.door) + ' (house default)' });
      if (o.type === 'window') h += `<div class="trio">${field('Sill', 'sill', o.sill, { len: 1, ph: fmt(S.heights.windowSill) })}${field('Head', 'head', o.head, { len: 1, ph: fmt(S.heights.windowHead) })}${field('Panes', 'panes', o.panes || 1, { select: [[1, '1'], [2, '2'], [3, '3'], [4, '4']] })}</div>
          <p class="note">Sill and head are heights above the floor. Leave blank for the house default.</p>`;
      h += `<div class="actions"><button class="btn" data-act="wall">Select its wall</button><button class="btn danger" data-act="delete">Delete</button></div>`;
    } else if (sel && sel.kind === 'room' && it) {
      const r = it; title = 'Room';
      const area = r.rects.reduce((t, q) => t + (q[2] - q[0]) * (q[3] - q[1]), 0);
      h += `<h3>${esc(r.name)}</h3><p class="sub">About ${Math.round(area)} sq ft (to the wall centre lines)</p>
        ${field('Name', 'name', r.name)}
        <div class="pair">${field('Wall ID prefix', 'short', r.short, { ph: r.id.toUpperCase() })}${field('Room id', 'id', r.id)}</div>
        <p class="note">Walls are named from the prefix: ${esc((r.short || r.id.toUpperCase()) + '-N')}, ${esc((r.short || r.id.toUpperCase()) + '-E')}\u2026 Changing it after you've painted renames those walls, and their saved colours won't show.</p>
        <div class="actions"><button class="btn danger" data-act="delete">Delete room</button></div>`;
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
        <div class="pair">${field('Name', 'fl_name', F.name)}${field('Colour', 'fl_color', F.color, { type: 'color' })}</div>
        ${field('Plank photo', 'fl_tex', F.texture || '', { select: [['', 'None (plain colour)'], ['textures/desert_sand_plank.png', 'Desert Sand LVP']].concat(F.texture && F.texture !== 'textures/desert_sand_plank.png' ? [[F.texture, F.texture]] : []) })}`;
    }
    $('#inspTitle').textContent = title;
    box.innerHTML = h;
  }
  $('#insp').addEventListener('change', e => {
    const el = e.target, f = el.dataset.f; if (!f) return;
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
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'delete') deleteSel();
    if (a === 'wall') { const f = findOpening(sel.uid); if (f) { sel = { kind: 'wall', uid: f.w.uid }; render(); renderSide(); } }
  });
  function applyField(f, v) {
    const it = sel && byUid(sel.uid), op = sel && sel.kind === 'opening' && findOpening(sel.uid);
    if (sel && sel.kind === 'wall' && it) {
      const w = it;
      if (f === 'ext') { w.ext = !!v; return; }
      if (f === 'status') { w.status = v; return; }
      if (v == null || v <= 0 && f !== 'a' && f !== 'b' && f !== 'c') return false;
      if (f === 'len') { w.b = r4(w.a + v); return; }
      if (f === 't') { w.t = r4(v); return; }
      if (f === 'a') { if (v >= w.b) return false; w.a = r4(v); return; }
      if (f === 'b') { if (v <= w.a) return false; w.b = r4(v); return; }
      if (f === 'c') { w.c = r4(v); return; }
    }
    if (op) {
      const { w, o } = op;
      if (f === 'type') { o.type = v; if (v === 'door') { o.hinge ||= 'a'; o.swing ||= w.axis === 'h' ? 's' : 'e'; } return; }
      if (f === 'hinge' || f === 'swing') { o[f] = v; return; }
      if (f === 'panes') { o.panes = +v; return; }
      if (f === 'width') { if (!(v >= 0.5)) return false; const b = o.a + v; if (b > w.b + 1e-6 || w.openings.some(x => x !== o && x.a < b - 1e-6 && x.b > o.a + 1e-6)) return false; o.b = r4(b); return; }
      if (f === 'from') { if (v == null) return false; const a = w.a + v, b = a + (o.b - o.a); if (a < w.a - 1e-6 || b > w.b + 1e-6 || w.openings.some(x => x !== o && x.a < b - 1e-6 && x.b > a + 1e-6)) return false; o.a = r4(a); o.b = r4(b); return; }
      if (f === 'height' || f === 'sill' || f === 'head') { if (v == null) delete o[f]; else if (v < 0 || v > S.heights.ceiling) return false; else o[f] = r4(v); return; }
    }
    if (sel && sel.kind === 'room' && it) {
      if (f === 'name') { if (!v.trim()) return false; it.name = v.trim();
        if (it.fresh) { const others = S.rooms.filter(r => r !== it); it.id = uniqueId(slug(it.name), new Set(others.map(r => r.id))); it.short = shortFor(it.name, new Set(others.map(r => r.short))); }
        return; }
      if (f === 'short') { const s = v.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); if (S.rooms.some(r => r !== it && r.short === s)) return false; it.short = s; delete it.fresh; return; }
      if (f === 'id') { const s = slug(v); if (S.rooms.some(r => r !== it && r.id === s) || s === 'exterior' || s === 'house') return false; it.id = s; delete it.fresh; return; }
    }
    if (f === 'h_name') { if (!v.trim()) return false; const wasAuto = S.meta.id === slug(S.meta.name).replace(/_/g, '-') || S.meta.id === 'my-house'; S.meta.name = v.trim(); if (wasAuto) S.meta.id = slug(v).replace(/_/g, '-'); return; }
    if (f === 'h_id') { const s = slug(v).replace(/_/g, '-'); if (!s) return false; S.meta.id = s; return; }
    if (f === 'h_sub') { S.meta.subtitle = v; return; }
    if (['ceiling', 'door', 'windowHead', 'windowSill'].includes(f)) { if (!(v > 0)) return false; S.heights[f] = r4(v); return; }
    if (f === 'exterior' || f === 'interior') { if (!(v > 0)) return false; S.wallThickness[f] = r4(v); return; }
    if (f === 'fl_name') { S.floor.name = v; return; }
    if (f === 'fl_color') { S.floor.color = v.toUpperCase(); return; }
    if (f === 'fl_tex') { if (v) S.floor.texture = v; else delete S.floor.texture; return; }
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
    $('#status').innerHTML = `<span>${pl(S.walls.length, 'wall', 'walls')} \u00b7 ${pl(ops, 'door or window', 'doors & windows')} \u00b7 ${pl(S.rooms.length, 'room', 'rooms')}</span>
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
      underURL = url; changed(); fit();
      toast('Blueprint loaded. Next, set its scale: click two points a known distance apart.');
      setTool('scale');
    } catch (err) { toast(err.message || 'Could not load that file.'); }
  });
  async function loadUnderlayImage() {
    if (underURL) { URL.revokeObjectURL(underURL); underURL = null; }
    if (!S.underlay) return;
    const blob = await idb.get(S.underlay.key);
    if (blob) { underURL = URL.createObjectURL(blob); render(); }
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
    $('#dlgOk').onclick = () => { closeDialog(); lsSet(BACKUP, snap()); checkpoint(); S = blank(); sel = null; underURL = null; wallMode = 'ext'; changed(); fit(); setTool('select'); };
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
    if (built.HOUSE.floor.texture) B.loadFloorTexture(built.HOUSE.floor.texture, () => { });
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
  window.__editor = { P3, get S() { return S; }, toHouse, fromHouse, fillRoom, parseLen, fmt, setTool, view: () => view };   // debug handle
  boot();
})();
