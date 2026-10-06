/*
 * Paint Studio app: selection, colour picker, camera views, schemes, totals, share links, export for Blender.
 * Reads the house from window.HOUSE / window.ROOMS (house-loader.js) and keeps schemes through storage.js.
 * Scheme assignments: { <targetKey>: {b, c, n, h, s} }  b = brand ('sw' | 'behr' | 'wood' | 'custom'), c = code, n = name, h = hex, s = sheen
 */
(function () {
  const H = window.HOUSE, R = window.ROOMS, C = window.PAINT_COLORS, B = window.House3D, T = THREE;
  const SRC = window.HOUSE_SOURCE || { kind: 'default', id: H.id };
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------------ paint targets
  const TARGETS = {};
  R.surfaces.forEach(s => {
    const ext = s.room === 'exterior';
    TARGETS[s.id] = { key: s.id, room: ext ? 'house' : s.room, kind: ext ? 'siding' : (s.kind === 'end' ? 'end' : 'wall'), area: s.area, s,
      label: ext ? `Siding \u00b7 ${s.dir} side` : (s.kind === 'end' ? 'Wall end' : s.name.split(' \u00b7 ')[1]),
      full: ext ? `Exterior siding \u00b7 ${s.dir} side` : s.name };
  });
  R.rooms.forEach(r => { TARGETS['C:' + r.id] = { key: 'C:' + r.id, room: r.id, kind: 'ceiling', area: r.area, label: 'Ceiling', full: r.name + ' \u00b7 Ceiling' }; });
  // the house's own items (cabinet runs, special doors) plus the whole-house groups every house has
  const ITEMS = H.items.map(it => [it.key, it.name || it.key, it.room || 'house', it.kind === 'door' ? 'door' : 'cabinet']).concat([
    ['trim', 'Trim & baseboards', 'house', 'trim'], ['doors', 'Interior doors', 'house', 'door'], ['extdoors', 'Exterior doors', 'house', 'door'], ['exttrim', 'Exterior trim', 'house', 'trim']
  ]);
  ITEMS.forEach(([k, l, room, kind]) => { TARGETS[k] = { key: k, room, kind, area: 0, label: l,
    full: (room === 'house' ? 'Whole house' : R.byId[room].name) + ' \u00b7 ' + l }; });
  // individual cabinet doors and drawers (built by house3d.js); each falls back to its cabinet run's colour
  const PARTS_OF = {};
  for (const p of B.cabParts) {
    const g = TARGETS[p.group]; if (!g) continue;
    const label = (p.kind === 'door' ? 'Door ' : 'Drawer ') + p.n;
    TARGETS[p.key] = { key: p.key, room: g.room, kind: 'cabdoor', group: p.group, area: 0, label, full: g.full + ' \u00b7 ' + label };
    (PARTS_OF[p.group] ||= []).push(p.key);
  }
  const ROOM_ORDER = R.order;
  const SPAN = Math.max(H.W, H.D), K = SPAN / 56;            // camera distances were tuned on a 56' house; scale for others
  const DIR_ORDER = { North: 0, East: 1, South: 2, West: 3, 'Wall end': 4 };
  const roomWalls = id => Object.values(TARGETS).filter(t => t.room === id && (t.kind === 'wall' || t.kind === 'end'))
    .sort((a, b) => (DIR_ORDER[a.s.dir] - DIR_ORDER[b.s.dir]) || a.key.localeCompare(b.key, 'en', { numeric: true }));
  const defaultSheen = t => ({ ceiling: 'flat', trim: 'semigloss', door: 'semigloss', cabinet: 'satin', cabdoor: 'satin', siding: 'satin' }[t.kind] || 'eggshell');
  const SHEEN_LABEL = { flat: 'Flat', eggshell: 'Eggshell', satin: 'Satin', semigloss: 'Semi-gloss' };
  const BRAND_LABEL = { sw: 'Sherwin-Williams', behr: 'Behr', wood: 'Wood', custom: 'Custom' };

  // colour books \u2192 objects
  const BOOK = { sw: C.sw.map(([c, n, h]) => ({ b: 'sw', c, n, h })), behr: C.behr.map(([c, n, h]) => ({ b: 'behr', c, n, h })),
    wood: Object.entries(B.WOODS).map(([c, w]) => ({ b: 'wood', c, n: w.n, h: w.avg })) };
  const byCode = {}; for (const b of ['sw', 'behr']) BOOK[b].forEach(x => { byCode[b + '|' + x.c] = x; });
  BOOK.wood.forEach(x => { byCode['wood|' + x.c] = x; });
  const POPULAR = { sw: C.popular.sw.map(c => byCode['sw|' + c]), behr: C.popular.behr.map(c => byCode['behr|' + c]), wood: BOOK.wood };

  // ------------------------------------------------------------------ state
  let schemes = [];            // [{id, name, a, created, updated, by}]
  let curId = null, curName = 'Scheme A';
  let A = {};                  // working assignments of the current scheme
  let dirty = false, saving = Promise.resolve(), saveTimer = 0;
  let store = null, canWrite = true, held = false;           // held: a scheme opened from a link/file stays up until you pick another
  const sel = new Set();
  let brand = 'sw', query = '', undoStack = [];
  let view = { kind: 'doll' };

  // ------------------------------------------------------------------ 3D
  const stage = $('#stage'), canvas = $('#c');
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(40, 1, 0.1, 2000);
  const controls = new T.OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.12;
  scene.add(B.root);
  const hemi = new T.HemisphereLight(0xeef2fb, 0xd8d1c5, 0); scene.add(hemi);
  const amb = new T.AmbientLight(0xffffff, 0); scene.add(amb);
  const head = new T.DirectionalLight(0xffffff, 0);           // follows the camera: faces you look at get the same light
  camera.add(head); head.position.set(0, 0, 0); head.target.position.set(0, 0, -1); camera.add(head.target); scene.add(camera);
  const sun = new T.DirectionalLight(0xfff3e0, 0);
  sun.position.set(H.W / 2 + 34 * K, 70 * K, H.D / 2 + 46 * K); sun.target.position.copy(B.center);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004;
  Object.assign(sun.shadow.camera, { left: -45 * K, right: 45 * K, top: 45 * K, bottom: -45 * K, near: 1, far: 220 * K });
  scene.add(sun, sun.target);
  const fill = { intensity: 0, position: new T.Vector3() };   // (kept for view code; lighting modes do the work now)
  B.ceilings.visible = false;
  B.ceilings.children.forEach(m => { m.castShadow = false; });

  // ------------------------------------------------------------------ lighting modes
  // true colour: flat, neutral light, so every wall shows the chip colour. The others are previews of real light.
  const lamps = Object.values(B.roomInfo).map(ri => {
    const l = new T.PointLight(0xffbf80, 0, 17, 2);           // ~2700K bulb at each room's ceiling
    l.position.set(ri.cx, 7.4, ri.cy); scene.add(l); return l;
  });
  let envTex = null;
  try { const pm = new T.PMREMGenerator(renderer); envTex = pm.fromScene(new T.RoomEnvironment(), 0.04).texture; } catch (e) { envTex = null; }
  // exposures calibrated so a wall facing the camera reads close to its chip; shifts come from the light, not the setup
  const LIGHTS = {
    true:     { label: 'True colour', tone: T.NoToneMapping, exp: 1, env: 0, amb: 0.9, head: 0.12, hemi: 0, sun: 0, lamps: 0, note: 'Even, neutral light: every wall shows the chip colour exactly.' },
    day:      { label: 'Daylight', tone: T.ACESFilmicToneMapping, exp: 0.75, env: 0.75, amb: 0, head: 0, hemi: 0.2, sun: 2.1, lamps: 0, note: 'Sun through the windows. Walls facing away from the light read darker, as they will in the house.' },
    overcast: { label: 'Overcast', tone: T.ACESFilmicToneMapping, exp: 0.75, env: 0.7, amb: 0, head: 0, hemi: 0.35, sun: 0, lamps: 0, note: 'Soft, cool daylight with no direct sun.' },
    evening:  { label: 'Evening lamps', tone: T.ACESFilmicToneMapping, exp: 1.35, env: 0.12, amb: 0, head: 0, hemi: 0.04, sun: 0, lamps: 1.25, note: 'Warm 2700K ceiling lights, no daylight. Cool colours shift warmer.' }
  };
  let lightMode = 'true', exposure = 1;
  try { lightMode = localStorage.getItem('paintstudio.light') || 'true'; exposure = +localStorage.getItem('paintstudio.exposure') || 1; } catch { }
  if (!LIGHTS[lightMode]) lightMode = 'true';
  function setLighting(mode) {
    lightMode = mode; const L = LIGHTS[mode];
    try { localStorage.setItem('paintstudio.light', mode); } catch { }
    renderer.toneMapping = L.tone; renderer.toneMappingExposure = L.exp * (mode === 'true' ? 1 : exposure);
    scene.environment = L.env && envTex ? envTex : null;
    amb.intensity = L.amb; head.intensity = L.head; hemi.intensity = L.hemi;
    sun.intensity = L.sun; sun.castShadow = L.sun > 0;
    lamps.forEach(l => { l.intensity = L.lamps; });
    B.ceilings.children.forEach(m => { m.castShadow = mode === 'day'; });   // in a room, sun only comes in through the windows
    scene.traverse(o => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      ms.forEach(m => { if ('envMapIntensity' in m) m.envMapIntensity = L.env; m.needsUpdate = true; }); });
    document.querySelectorAll('[data-light]').forEach(b => b.setAttribute('aria-pressed', b.dataset.light === mode));
    $('#exposure').closest('.exp').hidden = mode === 'true';
    $('#lightNote').textContent = L.note;
    requestRender();
  }

  let raf = 0, tween = null, tweenDone = null;
  function stageColor() { scene.background = new T.Color(getComputedStyle(document.documentElement).getPropertyValue('--stage').trim() || '#dadcdf'); requestRender(); }
  stageColor();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', stageColor);
  new MutationObserver(stageColor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  function requestRender() { if (!raf) raf = requestAnimationFrame(frame); }
  function frame(t) {
    raf = 0;
    if (walk.on) {                                           // first person: no orbit controls, no tweening
      const moving = stepWalk(t);
      renderer.render(scene, camera);
      if (immersive && t - promptT > 90) { promptT = t; updatePrompt(); }
      if (moving) requestRender(); else walk.last = 0;
      return;
    }
    if (tween) {
      const k = Math.min(1, (t - tween.t0) / tween.ms), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.q0, tween.q1, e);
      if (k >= 1) { tween = null; tweenDone && tweenDone(); }
    }
    const moved = controls.update();
    renderer.render(scene, camera);
    if (moved || tween) requestRender();
  }
  function flyTo(pos, target, done) {
    tweenDone = done || null;
    if (reduceMotion) { camera.position.copy(pos); controls.target.copy(target); tween = null; done && done(); requestRender(); return; }
    tween = { p0: camera.position.clone(), p1: pos.clone(), q0: controls.target.clone(), q1: target.clone(), t0: performance.now(), ms: 650 };
    requestRender();
  }
  controls.addEventListener('change', requestRender);
  new ResizeObserver(() => {
    const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); requestRender();
    if (!sized) { sized = true; if (view.kind === 'doll') dollhouse(); else if (view.kind === 'top') topDown(); }   // fit to the real shape once known
  }).observe(stage);
  let sized = false;
  B.loadFloor(requestRender);

  // ------------------------------------------------------------------ views
  const C3 = B.center;
  function setOrbit(free) {
    controls.enableZoom = true; controls.enablePan = free; controls.rotateSpeed = free ? 0.8 : 0.45;
    controls.minDistance = free ? 8 : 0.05; controls.maxDistance = free ? 160 : 40; controls.maxPolarAngle = free ? 1.48 : Math.PI - 0.15; controls.minPolarAngle = 0;
  }
  function pressView(id) { ['vDoll', 'vTop', 'vOut', 'vWalk'].forEach(b => $('#' + b).setAttribute('aria-pressed', b === id)); }

  // field of view for the inside views (wall views and walking); the dollhouse keeps its own framing
  let insideFov = 75;
  try { insideFov = +localStorage.getItem('paintstudio.fov') || 75; } catch { }
  $('#fov').value = insideFov; $('#fovOut').textContent = insideFov + '\u00b0';
  $('#fov').addEventListener('input', e => {
    insideFov = +e.target.value; $('#fovOut').textContent = insideFov + '\u00b0';
    try { localStorage.setItem('paintstudio.fov', insideFov); } catch { }
    if (view.kind === 'wall' || view.kind === 'walk') { camera.fov = insideFov; camera.updateProjectionMatrix(); requestRender(); }
  });

  // ------------------------------------------------------------------ walk mode (first person, WASD + mouse look)
  const EYE = 5.3, RADIUS = 0.6;
  const walk = { on: false, yaw: 0, pitch: 0, x: 0, y: 0, keys: new Set(), last: 0, locked: false, drag: null };
  const OBST = [];                                           // plan rects [x0, y0, x1, y1] you can't walk through
  for (const w of H.walls) {
    if (w.status === 'removed') continue;
    const horiz = (w.x1 - w.x0) >= (w.y1 - w.y0), s = horiz ? w.x0 : w.y0, e = horiz ? w.x1 : w.y1;
    const gaps = w.ext ? [] : (w.openings || []).filter(o => o.type === 'door' || o.type === 'cased').sort((p, q) => p.a - q.a);
    const push = (a, b) => { if (b - a > 0.01) OBST.push(horiz ? [a, w.y0, b, w.y1] : [w.x0, a, w.x1, b]); };
    let cur = s; gaps.forEach(o => { push(cur, o.a); cur = o.b; }); push(cur, e);   // interior doorways are open; outside doors stay shut
  }
  for (const f of H.fixtures) {
    if (f.st === 'removed') continue;
    if (['box', 'range', 'front', 'pumps', 'tub', 'shower', 'heater', 'toilet'].includes(f.k)) { const r = window.HouseFixtures.footprint(f); if (r) OBST.push(r); }
  }
  const blocked = (x, y) => OBST.some(([x0, y0, x1, y1]) => x > x0 - RADIUS && x < x1 + RADIUS && y > y0 - RADIUS && y < y1 + RADIUS);
  function walkCam() { camera.position.set(walk.x, EYE, walk.y); camera.rotation.set(walk.pitch, walk.yaw, 0, 'YXZ'); }
  function stepWalk(t) {
    const dt = walk.last ? Math.min(0.05, (t - walk.last) / 1000) : 0; walk.last = t;
    const k = walk.keys, f = (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0), r = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
    if (f || r) {
      const sp = (k.has('shift') ? 11 : 5.5) * dt / Math.hypot(f, r), sn = Math.sin(walk.yaw), cs = Math.cos(walk.yaw);
      const dx = (-sn * f + cs * r) * sp, dy = (-cs * f - sn * r) * sp;      // forward is -Z in three.js = north in the plan
      if (!blocked(walk.x + dx, walk.y)) walk.x += dx;         // slide along walls: each axis on its own
      if (!blocked(walk.x, walk.y + dy)) walk.y += dy;
      if (immersive) updateRoomLabel();
    }
    walkCam();
    return !!(f || r);
  }
  function look(dx, dy, k = 0.0024) {
    walk.yaw -= dx * k; walk.pitch = Math.max(-1.45, Math.min(1.45, walk.pitch - dy * k));
    walkCam(); requestRender();
  }
  const touchUI = window.matchMedia('(hover: none)').matches;
  function walkMsg() {
    $('#walkMsg').textContent = walk.locked ? (immersive ? 'Point at a wall and click to paint it. Esc frees the mouse.' : 'Click a wall to select it. Esc frees the mouse.') :
      touchUI ? 'Drag to look around. Tap a wall to select it.' : 'Click the model to look around with the mouse.';
  }
  function enterWalk(roomId) {
    tween = null; walk.on = true; walk.keys.clear(); controls.enabled = false;
    view = { kind: 'walk', room: roomId || null };
    B.ceilings.visible = true; fill.intensity = 0;
    camera.fov = insideFov; camera.updateProjectionMatrix();
    let { x, y, yaw } = H.start;                              // just inside the front door, facing into the house
    if (roomId) {
      const ri = B.roomInfo[roomId]; x = ri.cx; y = ri.cy;
      for (let r = 0; blocked(x, y) && r < 6; r += 0.25)       // nudge off furniture if the centre is taken
        for (const [ox, oy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) if (!blocked(ri.cx + ox, ri.cy + oy)) { x = ri.cx + ox; y = ri.cy + oy; break; }
      const w0 = roomWalls(roomId).find(t => t.kind === 'wall');
      if (w0) { const [[a, b], [c, d]] = w0.s.seg; yaw = Math.atan2(-((a + c) / 2 - x), -((b + d) / 2 - y)); }
    }
    walk.x = x; walk.y = y; walk.yaw = yaw; walk.pitch = 0; walkCam();
    pressView('vWalk'); hud(); walkMsg();
    $('#crosshair').hidden = false; $('#walkHint').hidden = false; $('#pad').hidden = !touchUI; tip.hidden = true;
    requestRender();
  }
  function exitWalk() {
    if (!walk.on) return;
    walk.on = false; walk.keys.clear(); controls.enabled = true;
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    const dir = new T.Vector3(); camera.getWorldDirection(dir);
    controls.target.copy(camera.position).add(dir.multiplyScalar(2));        // orbit picks up from where you stood
    $('#crosshair').hidden = true; $('#walkHint').hidden = true; $('#pad').hidden = true;
  }
  $('#vWalk').onclick = () => enterWalk(view.room && view.room !== 'house' ? view.room : null);
  document.addEventListener('pointerlockchange', () => { walk.locked = document.pointerLockElement === canvas; if (walk.on) walkMsg(); });
  document.addEventListener('mousemove', e => { if (walk.on && walk.locked) look(e.movementX, e.movementY); });
  const KEYMAP = { w: 'w', a: 'a', s: 's', d: 'd', arrowup: 'w', arrowleft: 'a', arrowdown: 's', arrowright: 'd', shift: 'shift' };
  document.addEventListener('keydown', e => {
    if (!walk.on || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const k = KEYMAP[e.key.toLowerCase()]; if (!k) return;
    e.preventDefault(); if (!walk.keys.has(k)) { walk.keys.add(k); requestRender(); }
  });
  document.addEventListener('keyup', e => { const k = KEYMAP[e.key.toLowerCase()]; if (k) walk.keys.delete(k); });
  window.addEventListener('blur', () => walk.keys.clear());
  document.querySelectorAll('#pad [data-k]').forEach(b => {
    const on = e => { e.preventDefault(); walk.keys.add(b.dataset.k); requestRender(); }, off = () => walk.keys.delete(b.dataset.k);
    b.addEventListener('pointerdown', on); ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, off));
  });

  const hfov = () => 2 * Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect);   // horizontal field of view, radians
  function dollhouse() {
    exitWalk(); view = { kind: 'doll' }; B.ceilings.visible = false; fill.intensity = 0; camera.fov = 40; camera.updateProjectionMatrix(); setOrbit(true);
    const dir = new T.Vector3(22, 44, 40).normalize(), dist = Math.max(63 * K, SPAN * 0.55 / Math.tan(hfov() / 2), SPAN * 0.5 / Math.tan(camera.fov * Math.PI / 360));
    flyTo(C3.clone().addScaledVector(dir, dist), C3.clone()); pressView('vDoll'); hud();
  }
  function topDown() {
    exitWalk(); view = { kind: 'top' }; B.ceilings.visible = false; fill.intensity = 0; camera.fov = 40; camera.updateProjectionMatrix(); setOrbit(true);
    const h = Math.max(82 * K, H.W * 0.55 / Math.tan(hfov() / 2), H.D * 0.55 / Math.tan(camera.fov * Math.PI / 360));
    flyTo(new T.Vector3(C3.x, h, C3.z + 0.5), C3.clone()); pressView('vTop'); hud();
  }
  function outside() {
    exitWalk(); view = { kind: 'out' }; B.ceilings.visible = false; fill.intensity = 0; camera.fov = 40; camera.updateProjectionMatrix(); setOrbit(true);
    flyTo(new T.Vector3(C3.x - 26 * K, 9, C3.z + 52 * K), new T.Vector3(C3.x, 3, C3.z)); pressView('vOut'); hud();
  }
  function roomView(id, wallKey) {
    const walls = roomWalls(id).filter(t => t.kind === 'wall');
    if (!walls.length) return;
    const wt = TARGETS[wallKey] && TARGETS[wallKey].room === id ? TARGETS[wallKey] : walls[0];
    faceWall(wt.key);
  }
  // back the camera off the wall until it can see both ends and the middle without another wall in the way
  const sightRay = new T.Raycaster();
  function clearView(t, v) {
    const [[x0, y0], [x1, y1]] = t.s.seg, n = t.s.normal, len = Math.hypot(x1 - x0, y1 - y0);
    const ux = (x1 - x0) / (len || 1), uy = (y1 - y0) / (len || 1), inset = Math.min(0.4, len / 4);
    const pts = [[x0 + ux * inset, y0 + uy * inset], [(x0 + x1) / 2, (y0 + y1) / 2], [x1 - ux * inset, y1 - uy * inset]]
      .map(([x, y]) => new T.Vector3(x + n[0] * 0.05, 5.2, y + n[1] * 0.05));
    const blockers = B.root.children.filter(o => o !== B.ceilings);
    for (let d = v.dist; d >= 1.5; d -= 0.5) {
      const eye = new T.Vector3(v.target.x + n[0] * d, v.eye.y, v.target.z + n[1] * d);
      const ok = pts.every(p => {
        const dir = p.clone().sub(eye), L = dir.length(); sightRay.set(eye, dir.normalize()); sightRay.far = L;
        const hit = sightRay.intersectObjects(blockers, true).find(h => !h.object.material.transparent);
        return !hit || hit.distance > L - 1.5;                // things right at the wall (cabinets) are fine
      });
      if (ok) return { ...v, eye, dist: d };
    }
    return v;
  }
  function faceWall(key) {
    const t = TARGETS[key]; if (!t || !t.s) return;
    exitWalk();
    const ext = t.kind === 'siding', v = ext ? B.surfaceView(t.s) : clearView(t, B.surfaceView(t.s));
    view = { kind: ext ? 'out' : 'wall', room: t.room, key };
    B.ceilings.visible = !ext;
    camera.fov = ext ? 45 : insideFov; camera.updateProjectionMatrix(); setOrbit(false);
    controls.minDistance = 0.5; controls.maxDistance = ext ? 80 : v.dist + 4;
    if (!ext) { fill.position.copy(v.eye).setY(6.5); fill.intensity = 0.35; } else fill.intensity = 0;
    flyTo(v.eye, v.target); pressView(ext ? 'vOut' : ''); hud();
  }
  function stepWall(d) {
    if (view.kind !== 'wall') return;
    const walls = roomWalls(view.room).filter(t => t.kind === 'wall');
    const i = walls.findIndex(t => t.key === view.key);
    const nx = walls[(i + d + walls.length) % walls.length];
    faceWall(nx.key); selectKeys([nx.key], false);
  }
  function hud() {
    const on = view.kind === 'wall';
    $('#hud').hidden = !on;
    if (on) $('#where').textContent = TARGETS[view.key].full;
    $('#help').hidden = on || view.kind === 'walk';
  }
  $('#vDoll').onclick = dollhouse; $('#vTop').onclick = topDown; $('#vOut').onclick = outside;
  $('#prevWall').onclick = () => stepWall(-1); $('#nextWall').onclick = () => stepWall(1); $('#exitRoom').onclick = dollhouse;

  // ------------------------------------------------------------------ picking
  const ray = new T.Raycaster(), ndc = new T.Vector2();
  function hitKey(ev) {
    const r = canvas.getBoundingClientRect();
    return hitAt(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  }
  function hitAt(nx, ny) {
    ndc.set(nx, ny);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObject(B.root, true);
    for (const h of hits) {
      let o = h.object, visible = true;
      while (o) { if (!o.visible) { visible = false; break; } o = o.parent; }
      if (!visible || h.object.material.transparent) continue;
      const k = B.keyAt(h);
      return k && TARGETS[k] ? k : null;
    }
    return null;
  }
  let down = null;
  canvas.addEventListener('pointerdown', e => {
    down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY };
    if (walk.on && !walk.locked) canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {                // walk mode without a captured mouse: drag to look
    if (!walk.on || walk.locked || !down || picker) return;
    look(e.clientX - down.lx, e.clientY - down.ly, 0.005); down.lx = e.clientX; down.ly = e.clientY;
  });
  canvas.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
    down = null;
    if (walk.on) {
      if (picker) return;                                       // the paint panel has the mouse
      const add = e.shiftKey || e.ctrlKey || e.metaKey;
      const choose = k => { if (!k) return; if (immersive) openPicker(k); else selectKeys([k], add); };
      if (walk.locked) { choose(hitAt(0, 0)); return; }          // crosshair pick
      if (e.pointerType === 'mouse' && canvas.requestPointerLock) {
        try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => choose(hitKey(e))); } catch { choose(hitKey(e)); }
        return;
      }
      choose(hitKey(e));                                                                        // touch: tap a wall
      return;
    }
    const k = hitKey(e);
    if (k) selectKeys([k], e.shiftKey || e.ctrlKey || e.metaKey, true); else if (!(e.shiftKey || e.ctrlKey || e.metaKey)) selectKeys([], false);
  });
  canvas.addEventListener('dblclick', e => { if (walk.on) return; const k = hitKey(e); if (k && TARGETS[k].s) { faceWall(k); selectKeys([k], false); } });
  const tip = $('#tip'); let hoverT = 0;
  canvas.addEventListener('pointermove', e => {
    if (walk.on || e.pointerType !== 'mouse' || e.buttons) { tip.hidden = true; return; }
    const now = performance.now(); if (now - hoverT < 50) return; hoverT = now;
    const k = hitKey(e), r = stage.getBoundingClientRect();
    if (!k) { tip.hidden = true; canvas.style.cursor = ''; return; }
    const v = A[k];
    tip.textContent = TARGETS[k].full + (v ? ' \u2014 ' + v.n : '');
    tip.style.left = (e.clientX - r.left) + 'px'; tip.style.top = (e.clientY - r.top) + 'px'; tip.hidden = false; canvas.style.cursor = 'pointer';
  });
  canvas.addEventListener('pointerleave', () => { tip.hidden = true; });

  // ------------------------------------------------------------------ selection
  const SEL_GLOW = new T.Color(0x1d5bff);
  // selection flashes, then clears completely so it never tints the paint colour being judged
  let glowT = 0;
  function glow(flash = true) {
    const level = flash ? 0.3 : 0;
    for (const k in TARGETS) { const m = B.material(k); m.emissive.copy(sel.has(k) ? SEL_GLOW : new T.Color(0)); m.emissiveIntensity = sel.has(k) ? level : 0; }
    requestRender();
    clearTimeout(glowT);
    if (flash && sel.size) glowT = setTimeout(() => glow(false), reduceMotion ? 0 : 700);
  }
  function selectKeys(keys, additive, fromModel) {
    if (!additive) sel.clear();
    keys.forEach(k => (additive && sel.has(k) && keys.length === 1) ? sel.delete(k) : sel.add(k));
    glow(); renderRooms(); renderSel(); renderChips();
    if (fromModel && keys.length === 1) {
      const t = TARGETS[keys[0]], det = document.querySelector(`details.room[data-room="${t.room}"]`);
      if (det && !det.open) { det.dataset.silent = '1'; det.open = true; }
      document.querySelector(`.row[data-key="${CSS.escape(keys[0])}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  }

  // ------------------------------------------------------------------ painting
  const effective = k => A[k] || (TARGETS[k] && TARGETS[k].group ? A[TARGETS[k].group] : undefined);
  function hexOf(k) { return effective(k)?.h || B.defaultHex(k); }
  function applyMaterial(k) {
    const v = effective(k); B.setPaint(k, v?.h, v?.s || defaultSheen(TARGETS[k]), v?.b === 'wood' ? v.c : null);
    if (PARTS_OF[k]) PARTS_OF[k].forEach(applyMaterial);              // a run's doors follow it unless they have their own colour
  }
  function applyAll() { for (const k in TARGETS) applyMaterial(k); glow(false); }
  function paint(keys, colour, sheen) {
    if (!canWrite || !keys.length) return;
    const prev = {};
    keys.forEach(k => { prev[k] = A[k] ? { ...A[k] } : null;
      if (colour) A[k] = { b: colour.b, c: colour.c, n: colour.n, h: colour.h, s: sheen || A[k]?.s || defaultSheen(TARGETS[k]) };
      else if (sheen && A[k]) A[k] = { ...A[k], s: sheen };
      else if (!colour && !sheen) delete A[k];
      if (PARTS_OF[k] && (colour || !sheen)) PARTS_OF[k].forEach(p => { if (!(p in prev)) prev[p] = A[p] ? { ...A[p] } : null; delete A[p]; });
      applyMaterial(k); });
    undoStack.push(prev); if (undoStack.length > 80) undoStack.shift();
    afterEdit();
  }
  function undo() {
    const prev = undoStack.pop(); if (!prev) return;
    for (const k in prev) { if (prev[k]) A[k] = prev[k]; else delete A[k]; applyMaterial(k); }
    afterEdit();
  }
  function afterEdit() { dirty = true; glow(false); renderRooms(); renderSel(); renderChips(); renderTotals(); scheduleSave(); $('#undoBtn').disabled = !undoStack.length; }
  $('#undoBtn').onclick = undo; $('#undoBtn').disabled = true;
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); undo(); }
    if (e.key === 'Escape' && !$('#dialog').hidden) closeDialog();
  });

  // ------------------------------------------------------------------ rooms deck
  const openRooms = new Set();
  function rowHTML(t) {
    const v = A[t.key], ev = effective(t.key);
    const sub = v ? `${esc(v.n)}${v.b === 'wood' ? ' \u00b7 wood' : v.b !== 'custom' ? ' \u00b7 ' + esc(v.c) : ''}` : (t.kind === 'cabdoor' ? (ev ? 'Same as cabinets \u00b7 ' + esc(ev.n) : 'Same as cabinets') : 'Primer white');
    return `<button class="row${sel.has(t.key) ? ' on' : ''}" data-key="${esc(t.key)}" style="--c:${hexOf(t.key)}">
      <span class="dot"></span><span class="lbl">${esc(t.label)}<small>${sub}</small></span><span class="sf">${t.area ? Math.round(t.area) + ' sf' : ''}</span></button>`;
  }
  const openParts = new Set();
  function itemHTML(t) {
    const parts = PARTS_OF[t.key]; if (!parts) return rowHTML(t);
    const own = parts.filter(p => A[p]).length;
    return rowHTML(t) + `<details class="parts" data-group="${t.key}"${openParts.has(t.key) ? ' open' : ''}><summary>${parts.length} doors & drawers${own ? ` \u00b7 ${own} painted separately` : ''}</summary>${parts.map(p => rowHTML(TARGETS[p])).join('')}</details>`;
  }
  let quietToggles = 0;                                      // re-rendering open <details> fires toggle; don't move the camera for it
  function renderRooms() {
    quietToggles = performance.now() + 120;
    $('#roomList').innerHTML = ROOM_ORDER.map(id => {
      const r = R.byId[id], walls = roomWalls(id), items = Object.values(TARGETS).filter(t => t.room === id && (t.kind === 'cabinet' || t.kind === 'door'));
      const wallArea = walls.reduce((s, t) => s + t.area, 0);
      return `<details class="room" data-room="${id}"${openRooms.has(id) ? ' open' : ''}>
        <summary><span class="rname">${esc(r.name)}</span><span class="rarea">${Math.round(wallArea)} sf</span>
          <span class="rdots">${walls.filter(t => t.kind === 'wall').map(t => `<i style="--c:${hexOf(t.key)}"></i>`).join('')}</span></summary>
        <div class="rbody">
          <div class="ractions"><button class="btn" data-act="view" data-room="${id}">Look around</button><button class="btn" data-act="selwalls" data-room="${id}">Select all walls</button></div>
          ${walls.map(rowHTML).join('')}${rowHTML(TARGETS['C:' + id])}${items.map(itemHTML).join('')}
        </div></details>`;
    }).join('');
    $('#houseList').innerHTML = ['trim', 'doors', 'extdoors', 'exttrim'].map(k => rowHTML(TARGETS[k])).join('') +
      Object.values(TARGETS).filter(t => t.kind === 'siding').map(rowHTML).join('');
  }
  document.querySelector('.rooms').addEventListener('click', e => {
    const row = e.target.closest('.row'), act = e.target.closest('[data-act]');
    if (act) {
      e.preventDefault();
      const id = act.dataset.room;
      if (act.dataset.act === 'view') { if (walk.on) enterWalk(id); else roomView(id, view.room === id ? view.key : null); }
      if (act.dataset.act === 'selwalls') selectKeys(roomWalls(id).map(t => t.key), false);
      return;
    }
    if (!row) return;
    const k = row.dataset.key, t = TARGETS[k];
    selectKeys([k], e.shiftKey || e.ctrlKey || e.metaKey);
    if (walk.on) return;                                     // walking: the list just selects, you stay where you are
    if (t.s && !(e.shiftKey || e.ctrlKey || e.metaKey)) faceWall(k);
    else if (t.kind === 'ceiling') roomView(t.room);
  });
  document.querySelector('.rooms').addEventListener('toggle', e => {
    const d = e.target;
    if (d.matches && d.matches('details.parts')) { if (d.open) openParts.add(d.dataset.group); else openParts.delete(d.dataset.group); return; } if (!d.matches || !d.matches('details.room')) return;
    const id = d.dataset.room;
    if (d.open) { openRooms.add(id); if (d.dataset.silent || performance.now() < quietToggles) delete d.dataset.silent; else if (view.room !== id) (walk.on ? enterWalk(id) : roomView(id)); }
    else openRooms.delete(id);
  }, true);

  // ------------------------------------------------------------------ selection panel
  function renderSel() {
    const box = $('#selBox'), keys = [...sel];
    if (!keys.length) {
      box.innerHTML = `<p class="empty">Pick a wall in the model, or a room or item on the left. Shift-click to pick several at once, then choose a colour.</p>`;
      return;
    }
    const vals = keys.map(k => A[k]), first = vals[0], same = vals.every(v => (v?.h || null) === (first?.h || null) && (v?.c || null) === (first?.c || null));
    const sheens = new Set(keys.map(k => A[k]?.s || defaultSheen(TARGETS[k])));
    const sheen = sheens.size === 1 ? [...sheens][0] : null;
    const title = keys.length === 1 ? TARGETS[keys[0]].full : `${keys.length} surfaces`;
    const area = keys.reduce((s, k) => s + (TARGETS[k].area || 0), 0);
    const names = keys.length > 1 ? keys.slice(0, 4).map(k => TARGETS[k].full).join(', ') + (keys.length > 4 ? ` and ${keys.length - 4} more` : '') : '';
    const colourLine = !same ? 'Mixed colours' : first ? (first.b === 'wood' ? `${esc(first.n)} \u00b7 wood finish` : `${esc(first.n)} <code>${esc(first.b === 'custom' ? first.h : first.c)}</code> \u00b7 ${BRAND_LABEL[first.b]}`) : 'Primer white (not painted yet)';
    box.innerHTML = `
      <div class="sel-head"><div class="bigchip" style="--c:${same ? hexOf(keys[0]) : 'linear-gradient(135deg,' + keys.slice(0, 4).map(hexOf).join(',') + ')'}${same ? '' : ';background:var(--c)'}"></div>
        <div><div class="sel-title">${esc(title)}</div><div class="sel-sub">${colourLine}${area ? ` \u00b7 ${Math.round(area)} sq ft` : ''}</div>${names ? `<div class="sel-sub">${esc(names)}</div>` : ''}</div></div>
      <div class="seg" role="group" aria-label="Sheen">${Object.entries(SHEEN_LABEL).map(([k, l]) => `<button data-sheen="${k}" aria-pressed="${sheen === k}"${canWrite ? '' : ' disabled'}>${l}</button>`).join('')}</div>
      <div class="sel-actions">
        ${keys.length === 1 && TARGETS[keys[0]].kind === 'wall' && A[keys[0]] ? `<button class="btn" id="toRoom"${canWrite ? '' : ' disabled'}>Use on every wall in ${esc(R.byId[TARGETS[keys[0]].room].name)}</button>` : ''}
        ${keys.some(k => A[k]) ? `<button class="btn" id="clearSel"${canWrite ? '' : ' disabled'}>Reset to primer</button>` : ''}
      </div>`;
    box.querySelectorAll('[data-sheen]').forEach(b => b.onclick = () => paint(keys.filter(k => A[k]), null, b.dataset.sheen) || renderSel());
    box.querySelector('#toRoom')?.addEventListener('click', () => { const v = A[keys[0]]; paint(roomWalls(TARGETS[keys[0]].room).map(t => t.key), v, v.s); });
    box.querySelector('#clearSel')?.addEventListener('click', () => paint(keys, null, null));
  }

  // ------------------------------------------------------------------ colour picker
  function chipHTML(x) {
    const cur = sel.size && [...sel].every(k => A[k] && A[k].b === x.b && A[k].c === x.c);
    return `<button class="chip${cur ? ' cur' : ''}" data-b="${x.b}" data-c="${esc(x.c)}" style="--c:${x.h}${x.b === 'wood' ? `;--img:url(${B.woodSwatch(x.c)})` : ''}" title="${esc(x.n)} \u00b7 ${esc(x.c)} \u00b7 ${x.h}"${sel.size && canWrite ? '' : ' disabled'}>
      <span class="sw"></span><span class="meta"><span class="nm">${esc(x.n)}</span><span class="cd">${esc(x.c)}</span></span></button>`;
  }
  const hexRGB = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  function search(book, q) {
    q = q.trim().toLowerCase();
    if (/^#?[0-9a-f]{6}$/.test(q)) {                         // nearest colours to a hex
      const [r, g, b] = hexRGB(q[0] === '#' ? q : '#' + q);
      return book.map(x => { const [R2, G2, B2] = hexRGB(x.h); return [x, (r - R2) ** 2 * 2 + (g - G2) ** 2 * 4 + (b - B2) ** 2 * 3]; })
        .sort((p, q2) => p[1] - q2[1]).slice(0, 48).map(p => p[0]);
    }
    const qc = q.replace(/\s|-/g, '');
    const hits = book.filter(x => x.n.toLowerCase().includes(q) || x.c.toLowerCase().replace(/\s|-/g, '').includes(qc));
    hits.sort((a, b) => (b.n.toLowerCase().startsWith(q) - a.n.toLowerCase().startsWith(q)) || a.n.localeCompare(b.n));
    return hits.slice(0, 96);
  }
  function usedColours() {
    const m = new Map(); Object.values(A).forEach(v => m.set(v.b + '|' + v.c + '|' + v.h, v)); return [...m.values()];
  }
  function renderChips() {
    const area = $('#chipArea');
    if (brand === 'custom') {
      const v = sel.size ? A[[...sel][0]] : null;
      area.innerHTML = `<div class="custom"><input type="color" id="customHex" value="${v?.h || '#d9d4cb'}" aria-label="Pick a colour">
        <input type="text" id="customName" placeholder="Name it (e.g. store match)" value="${v?.b === 'custom' ? esc(v.n) : ''}">
        <button class="btn primary" id="customApply"${sel.size && canWrite ? '' : ' disabled'}>Apply</button></div>
        <p class="note">Use this for a colour matched at the store or a brand that isn't listed.</p>`;
      $('#customApply').onclick = () => { const h = $('#customHex').value.toUpperCase(), n = $('#customName').value.trim() || 'Custom ' + h;
        paint([...sel], { b: 'custom', c: h, n, h }); };
      return;
    }
    const used = usedColours();
    let html = '';
    if (query.trim()) {
      const res = search(BOOK[brand], query);
      html = res.length ? `<div class="chips">${res.map(chipHTML).join('')}</div>` : `<p class="empty">No ${BRAND_LABEL[brand]} colour matches \u201c${esc(query)}\u201d. Try part of the name, the number, or a hex like #D1CBC1.</p>`;
    } else {
      if (used.length) html += `<h2 style="margin:0 0 6px">In this scheme</h2><div class="chips">${used.map(chipHTML).join('')}</div>`;
      html += `<h2 style="margin:12px 0 6px">Popular ${BRAND_LABEL[brand]} colours</h2><div class="chips">${POPULAR[brand].map(chipHTML).join('')}</div>`;
    }
    if (!sel.size) html = `<p class="note" style="margin:0 0 8px">Select a surface first, then click a chip to paint it.</p>` + html;
    area.innerHTML = html;
  }
  $('#chipArea').addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c || c.disabled) return;
    const x = c.dataset.b === 'custom' ? usedColours().find(v => v.b === 'custom' && v.c === c.dataset.c) : byCode[c.dataset.b + '|' + c.dataset.c];
    if (x) paint([...sel], x);
  });
  document.querySelectorAll('[data-brand]').forEach(b => b.onclick = () => {
    brand = b.dataset.brand; document.querySelectorAll('[data-brand]').forEach(x => x.setAttribute('aria-pressed', x === b));
    $('#search').hidden = brand === 'custom'; renderChips();
  });
  let qT = 0; $('#search').addEventListener('input', e => { clearTimeout(qT); qT = setTimeout(() => { query = e.target.value; renderChips(); }, 120); });

  // ------------------------------------------------------------------ totals
  function renderTotals() {
    const groups = new Map();
    const woods = new Map();
    for (const k in A) {
      const v = A[k], t = TARGETS[k], id = v.b + '|' + v.c + '|' + v.h;
      if (v.b === 'wood') { if (!woods.has(v.n)) woods.set(v.n, new Set()); woods.get(v.n).add(t.kind === 'cabdoor' ? TARGETS[t.group].label + ' (some doors)' : t.label); continue; }
      if (!groups.has(id)) groups.set(id, { v, area: 0, items: new Set(), sheens: new Set() });
      const g = groups.get(id); g.sheens.add(v.s);
      if (t.area) g.area += t.area; else g.items.add(t.kind === 'cabdoor' ? TARGETS[t.group].label + ' (some doors)' : t.label);
    }
    const woodHTML = woods.size ? `<p class="note"><b>Wood finishes (not paint):</b> ${[...woods].map(([n, set]) => esc(n) + ' on ' + esc([...set].join(', '))).join('; ')}.</p>` : '';
    if (!groups.size) { $('#totals').innerHTML = woodHTML; if (woodHTML) return; $('#totals').innerHTML = `<p class="empty">Gallons per colour appear here as you paint: 2 coats at about 350 sq ft per gallon.</p>`; return; }
    const rows = [...groups.values()].sort((a, b) => b.area - a.area).map(g => {
      const gal = g.area ? Math.max(0.25, Math.ceil(g.area * 2 / 350 * 4) / 4) : 0;
      const qty = g.area ? `${gal.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')} gal` : '\u2014';
      return `<tr><td><span class="dot" style="--c:${g.v.h}"></span>${esc(g.v.n)}<br><small style="color:var(--muted)">${esc(g.v.b === 'custom' ? 'Custom ' + g.v.h : g.v.c)} \u00b7 ${[...g.sheens].map(s => SHEEN_LABEL[s]).join(', ')}${g.items.size ? ' \u00b7 ' + esc([...g.items].join(', ')) : ''}</small></td>
        <td class="num">${g.area ? Math.round(g.area) + ' sf' : ''}</td><td class="num">${qty}</td></tr>`;
    }).join('');
    $('#totals').innerHTML = `<table>${rows}</table><p class="note">Walls and ceilings only. Cabinets, doors and trim usually take a quart to a gallon each; measure before buying.</p>` + woodHTML;
  }

  // ------------------------------------------------------------------ schemes (kept by storage.js)
  function status(text, cls) { const s = $('#saveState'); s.textContent = text; s.className = 'status' + (cls ? ' ' + cls : ''); }
  const savedLabel = () => (store && store.kind === 'local' ? ['Saved on this device', 'warn'] : ['Saved', 'ok']);
  const onlyKnown = a => { const out = {}; for (const k in a || {}) if (TARGETS[k]) out[k] = JSON.parse(JSON.stringify(a[k])); return out; };
  function renderSchemes() {
    const opts = schemes.map(s => `<option value="${esc(s.id)}"${s.id === curId ? ' selected' : ''}>${esc(s.name)}</option>`);
    if (!curId) opts.unshift(`<option value="" selected>${esc(curName)} (not saved yet)</option>`);
    $('#schemeSel').innerHTML = opts.join('');
    $('#ihScheme').innerHTML = opts.join('');
    ['newScheme', 'dupScheme', 'renameScheme', 'delScheme'].forEach(id => { $('#' + id).disabled = !canWrite; });
    $('#delScheme').disabled = !canWrite || !curId;
  }
  function showScheme() { applyAll(); renderRooms(); renderSel(); renderChips(); renderTotals(); renderSchemes(); }
  function loadScheme(s) {
    held = false;
    curId = s ? s.id : null; curName = s ? s.name : nextName();
    A = onlyKnown(s && s.a); dirty = false; undoStack = []; $('#undoBtn').disabled = true;
    store && store.setCurrent(curId);
    showScheme(); lastEdited();
  }
  // a scheme from a share link or a file: shown unsaved; the first change saves it as a new scheme
  function openUnsaved(name, a, note) {
    held = true; curId = null; curName = name;
    A = onlyKnown(a); dirty = false; undoStack = []; $('#undoBtn').disabled = true;
    showScheme(); status(note);
  }
  function nextName() { const used = new Set(schemes.map(s => s.name)); for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!used.has('Scheme ' + ch)) return 'Scheme ' + ch; return 'Scheme ' + (schemes.length + 1); }
  async function lastEdited() {
    if (!store || dirty) return;
    const s = schemes.find(x => x.id === curId);
    const who = s ? await store.who(s) : null;
    if (dirty) return;
    if (!curId) { if (!held) status(store.kind === 'local' ? 'Saving on this device only' : 'Nothing saved yet', store.kind === 'local' ? 'warn' : ''); }
    else if (who) status(`Saved \u00b7 last change by ${who}`, 'ok');
    else status(...savedLabel());
  }
  function scheduleSave() {
    if (!store) return;
    status('Saving\u2026'); clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saving = saving.then(saveNow).catch(() => { }); }, 700);
  }
  async function saveNow() {
    if (!dirty || !store) return;
    try {
      const s = schemes.find(x => x.id === curId);
      const id = await store.save({ id: curId, name: curName, a: A, created: s && s.created });
      curId = id; held = false; store.setCurrent(id);
      dirty = false; status(...savedLabel()); renderSchemes();
    } catch (err) {
      if (err && err.code === 'invalid_argument') { canWrite = false; status('View only: your changes were not saved', 'warn'); renderSchemes(); renderSel(); renderChips(); }
      else if (err && err.code === 'quota_exceeded') status('Storage is full. Delete an old scheme to save.', 'warn');
      else { status('Could not save. Retrying\u2026', 'warn'); setTimeout(scheduleSave, 1500); }
    }
  }
  function onSchemes(list) {
    schemes = list.slice().sort((a, b) => String(a.created).localeCompare(String(b.created)));
    const cur = schemes.find(s => s.id === curId);
    if (!curId && !dirty && !held) {
      const want = store.current;
      const pickS = schemes.find(s => s.id === want) || schemes[0];
      if (pickS) return loadScheme(pickS);
    } else if (cur && !dirty && JSON.stringify(onlyKnown(cur.a)) !== JSON.stringify(A)) {
      A = onlyKnown(cur.a); curName = cur.name; applyAll(); renderRooms(); renderSel(); renderChips(); renderTotals();
    } else if (curId && !cur && !dirty) {                     // someone deleted the scheme we were on
      return loadScheme(schemes[0] || null);
    }
    if (cur) curName = cur.name;
    renderSchemes(); lastEdited();
  }

  $('#schemeSel').onchange = async e => {
    if (dirty) { clearTimeout(saveTimer); await (saving = saving.then(saveNow).catch(() => { })); }
    loadScheme(schemes.find(s => s.id === e.target.value) || null);
  };
  $('#newScheme').onclick = () => askName('New scheme', nextName(), async name => {
    if (dirty) { clearTimeout(saveTimer); await (saving = saving.then(saveNow).catch(() => { })); }
    loadScheme(null); curName = name; renderSchemes(); status('Paint something to save it');
  });
  $('#dupScheme').onclick = () => askName('Duplicate scheme', curName + ' copy', async name => {
    if (dirty) { clearTimeout(saveTimer); await (saving = saving.then(saveNow).catch(() => { })); }
    const a = JSON.parse(JSON.stringify(A)); curId = null; curName = name; A = a; dirty = true; renderSchemes(); scheduleSave();
  });
  $('#renameScheme').onclick = () => askName('Rename scheme', curName, name => { curName = name; dirty = true; renderSchemes(); scheduleSave(); });
  $('#delScheme').onclick = () => confirmBox(`Delete \u201c${curName}\u201d?`, store && store.kind === 'shared' ? 'This removes it for everyone who has this page. It cannot be undone.' : 'This removes it from this browser. It cannot be undone.', 'Delete scheme', async () => {
    const id = curId; if (!id) return;
    try { await store.remove(id); } catch { status('Could not delete', 'warn'); return; }
    curId = null; loadScheme(schemes.filter(s => s.id !== id)[0] || null);
  });

  // in-page dialogs (the viewer blocks prompt/confirm)
  function closeDialog() { $('#dialog').hidden = true; $('#dialog').innerHTML = ''; }
  function askName(title, value, done) {
    const d = $('#dialog');
    d.innerHTML = `<form class="box"><h3>${esc(title)}</h3><input id="dlgName" maxlength="60" value="${esc(value)}" aria-label="Scheme name">
      <div class="row-btns"><button type="button" class="btn" id="dlgCancel">Cancel</button><button class="btn primary">Save</button></div></form>`;
    d.hidden = false; const inp = $('#dlgName'); inp.focus(); inp.select();
    $('#dlgCancel').onclick = closeDialog;
    d.querySelector('form').onsubmit = e => { e.preventDefault(); const v = inp.value.trim(); if (!v) return; closeDialog(); done(v); };
  }
  function confirmBox(title, body, okLabel, done) {
    const d = $('#dialog');
    d.innerHTML = `<div class="box" role="alertdialog" aria-modal="true"><h3>${esc(title)}</h3><p style="margin:0;color:var(--muted)">${esc(body)}</p>
      <div class="row-btns"><button class="btn" id="dlgCancel">Cancel</button><button class="btn primary" id="dlgOk">${esc(okLabel)}</button></div></div>`;
    d.hidden = false; $('#dlgOk').focus();
    $('#dlgCancel').onclick = closeDialog; $('#dlgOk').onclick = () => { closeDialog(); done(); };
  }
  $('#dialog').addEventListener('click', e => { if (e.target.id === 'dialog') closeDialog(); });

  // ------------------------------------------------------------------ walkthrough: its own full-screen experience
  // Walk with WASD + mouse; point at a wall to see what it is; click to free the mouse and open the paint panel on the
  // right. While the panel is open the camera stays put, so the mouse is only for choosing colours.
  let immersive = false, picker = null, iBrand = 'sw', iQuery = '', promptT = 0;
  const appEl = document.querySelector('.app');
  $('#ihGo').innerHTML = ROOM_ORDER.map(id => `<option value="${id}">${esc(R.byId[id].name)}</option>`).join('');
  function updateRoomLabel() {
    const id = R.roomAt(walk.x, walk.y), r = id && R.byId[id];
    if (r) { $('#ihRoom').textContent = r.name; $('#ihGo').value = id; walk.room = id; }
  }
  function enterImmersive(roomId) {
    immersive = true; appEl.classList.add('immersive'); $('#ihud').hidden = false;
    enterWalk(roomId || null); updateRoomLabel(); renderSchemes(); walkMsg();
    try { history.replaceState(null, '', '#walk'); } catch { }
  }
  function exitImmersive() {
    closePicker(false); immersive = false; appEl.classList.remove('immersive'); $('#ihud').hidden = true; $('#ihPrompt').hidden = true;
    if (document.fullscreenElement) { try { document.exitFullscreen(); } catch { } }
    try { history.replaceState(null, '', location.pathname + location.search); } catch { }
    dollhouse();
  }
  $('#vWalk').onclick = () => enterImmersive(view.room && view.room !== 'house' ? view.room : null);
  $('#ihExit').onclick = exitImmersive;
  $('#ihGo').onchange = e => { closePicker(false); enterWalk(e.target.value); updateRoomLabel(); };
  $('#ihUndo').onclick = undo;
  $('#ihpUndo').onclick = () => { undo(); renderPicker(); };
  if (!document.documentElement.requestFullscreen) $('#ihFull').hidden = true;
  $('#ihFull').onclick = () => {
    if (document.fullscreenElement) { try { document.exitFullscreen(); } catch { } return; }
    try { const p = document.documentElement.requestFullscreen(); if (p && p.catch) p.catch(() => { $('#ihFull').hidden = true; }); } catch { $('#ihFull').hidden = true; }
  };
  $('#ihScheme').onchange = e => { $('#schemeSel').value = e.target.value; $('#schemeSel').onchange({ target: $('#schemeSel') }); };

  // what's under the crosshair
  function updatePrompt() {
    const box = $('#ihPrompt');
    if (!immersive || picker || !(walk.locked || touchUI)) { box.hidden = true; return; }
    const k = hitAt(0, 0);
    if (!k) { box.hidden = true; return; }
    const v = A[k];
    $('#ihPromptName').textContent = TARGETS[k].full;
    $('#ihPromptSub').textContent = (v ? v.n : 'Primer white') + (touchUI ? ' \u00b7 tap to paint' : ' \u00b7 click to paint');
    box.hidden = false;
  }

  // the paint panel
  function openPicker(key) {
    picker = { key }; selectKeys([key], false);
    if (document.pointerLockElement === canvas) { try { document.exitPointerLock(); } catch { } }
    walk.keys.clear(); $('#ihPrompt').hidden = true; $('#ihPicker').hidden = false; $('#walkHint').hidden = true;
    const t = TARGETS[key], isWall = t.kind === 'wall' || t.kind === 'end', isDoor = t.kind === 'cabdoor';
    $('#ihpRoom').checked = false; $('#ihpRoom').closest('label').hidden = !(isWall || isDoor);
    if (isWall) $('#ihpRoomLabel').textContent = 'Paint every wall in ' + R.byId[t.room].name;
    if (isDoor) $('#ihpRoomLabel').textContent = 'Paint the whole run (' + TARGETS[t.group].label.toLowerCase() + ')';
    iQuery = ''; $('#ihpSearch').value = '';
    renderPicker();
  }
  function closePicker(resume) {
    if (!picker) return;
    picker = null; $('#ihPicker').hidden = true; $('#walkHint').hidden = !walk.on;
    if (resume && !touchUI && canvas.requestPointerLock) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => { }); } catch { } }
    requestRender();
  }
  $('#ihpClose').onclick = () => closePicker(false);
  $('#ihpDone').onclick = () => closePicker(true);
  const pickerTargets = () => {
    const t = TARGETS[picker.key];
    if (!$('#ihpRoom').checked) return [picker.key];
    return t.kind === 'cabdoor' ? [t.group] : roomWalls(t.room).map(x => x.key);
  };
  function renderPicker() {
    if (!picker) return;
    const k = picker.key, t = TARGETS[k], v = A[k];
    $('#ihpChip').style.setProperty('--c', hexOf(k));
    $('#ihpTitle').textContent = t.full;
    $('#ihpSub').textContent = v ? `${v.n} \u00b7 ${v.b === 'custom' ? v.h : v.c} \u00b7 ${BRAND_LABEL[v.b]}` : 'Primer white (not painted yet)';
    const sheen = v?.s || defaultSheen(t);
    $('#ihpSheen').innerHTML = Object.entries(SHEEN_LABEL).map(([s, l]) => `<button data-s="${s}" aria-pressed="${s === sheen}"${canWrite ? '' : ' disabled'}>${l}</button>`).join('');
    let html = '';
    if (iQuery.trim()) {
      const res = search(BOOK[iBrand], iQuery);
      html = res.length ? `<div class="chips">${res.map(chipHTML).join('')}</div>` : `<p class="empty">No ${BRAND_LABEL[iBrand]} colour matches \u201c${esc(iQuery)}\u201d.</p>`;
    } else {
      const used = usedColours();
      if (used.length) html += `<h2>In this scheme</h2><div class="chips">${used.map(chipHTML).join('')}</div>`;
      html += `<h2>Popular ${BRAND_LABEL[iBrand]} colours</h2><div class="chips">${POPULAR[iBrand].map(chipHTML).join('')}</div>`;
    }
    $('#ihpChips').innerHTML = html;
  }
  $('#ihpChips').addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c || c.disabled || !picker) return;
    const x = c.dataset.b === 'custom' ? usedColours().find(v => v.b === 'custom' && v.c === c.dataset.c) : byCode[c.dataset.b + '|' + c.dataset.c];
    if (x) { paint(pickerTargets(), x); renderPicker(); }
  });
  $('#ihpSheen').addEventListener('click', e => {
    const b = e.target.closest('[data-s]'); if (!b || !picker) return;
    const keys = pickerTargets().filter(k => A[k]); if (keys.length) paint(keys, null, b.dataset.s);
    renderPicker();
  });
  document.querySelectorAll('[data-ibrand]').forEach(b => b.onclick = () => {
    iBrand = b.dataset.ibrand; document.querySelectorAll('[data-ibrand]').forEach(x => x.setAttribute('aria-pressed', x === b)); renderPicker();
  });
  let iqT = 0; $('#ihpSearch').addEventListener('input', e => { clearTimeout(iqT); iqT = setTimeout(() => { iQuery = e.target.value; renderPicker(); }, 120); });
  document.addEventListener('keydown', e => {
    if (!immersive || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.key === 'Escape' && picker) { closePicker(false); e.preventDefault(); }
    if (e.key.toLowerCase() === 'z' && !e.ctrlKey && !e.metaKey) { undo(); renderPicker(); }
  });

  // ------------------------------------------------------------------ boot
  document.querySelectorAll('[data-light]').forEach(b => b.onclick = () => setLighting(b.dataset.light));
  $('#exposure').value = exposure;
  $('#exposure').addEventListener('input', e => { exposure = +e.target.value; try { localStorage.setItem('paintstudio.exposure', exposure); } catch { }
    renderer.toneMappingExposure = LIGHTS[lightMode].exp * (lightMode === 'true' ? 1 : exposure); requestRender(); });

  const ftin = v => { const ft = Math.floor(v + 1e-6), inch = Math.round((v - ft) * 12); return inch === 12 ? `${ft + 1}'-0"` : `${ft}'` + (inch ? `-${inch}"` : ''); };
  function header() {
    document.title = H.name + ' \u00b7 Paint Studio';
    const sub = $('#houseName');
    sub.textContent = `${H.name} \u00b7 ${ftin(H.W)} \u00d7 ${ftin(H.D)}`;
    if (SRC.kind !== 'default') sub.insertAdjacentHTML('beforeend', ' \u00b7 <a href="?" style="color:inherit">example house</a>');
    // the plan editor opens the same house: by URL, or the copy kept in this browser
    $('#editBtn').href = 'editor.html?house=' + encodeURIComponent(SRC.kind === 'local' ? 'local' : (SRC.url || 'houses/' + H.id + '/house.json'));
  }

  async function boot() {
    header();
    setLighting(lightMode);
    applyAll(); renderRooms(); renderSel(); renderChips(); renderTotals(); renderSchemes();
    dollhouse();
    if (location.hash === '#walk') enterImmersive();
    try { store = await PaintStore.open(SRC); } catch { store = null; }
    if (!store) { status('Saving is unavailable here', 'warn'); return; }
    canWrite = store.canWrite;
    $('#shareBtn').hidden = store.kind === 'shared';           // shared pages already show everyone the same schemes
    if (!canWrite) status('View only', 'warn'); else if (store.kind === 'local') status('Saving on this device only', 'warn'); else status('Loading schemes\u2026');
    const shared = window.SHARED_SCHEME;                       // opened from a share link (house-loader.js unpacked it)
    if (shared) {
      openUnsaved((shared.name || 'Shared scheme') + ' (shared)', shared.a, 'Opened from a link \u00b7 paint anything to keep a copy');
      try { const u = new URL(location.href); u.hash = ''; if (SRC.kind === 'local') u.searchParams.set('house', 'local'); history.replaceState(null, '', u.toString()); } catch { }
    }
    renderSchemes(); renderSel(); renderChips();
    store.watch(onSchemes, err => {
      if (err && (err.code === 'revoked' || err.code === 'not_granted')) { canWrite = false; status('Saved schemes are unavailable here', 'warn'); }
      else status('Lost connection to saved schemes. Reload to reconnect.', 'warn');
    });
  }

  // ------------------------------------------------------------------ share link
  // The scheme travels in the link itself (#scheme=...). A house opened from a file travels with it.
  async function shareLink() {
    const payload = { v: 1, name: curName, a: A };
    if (SRC.kind === 'local') {
      payload.house = JSON.parse(JSON.stringify(SRC.src));
      const fl = payload.house.floor;                         // a floor photo would make the link enormous: the link carries a plain floor instead
      if (fl && /^data:/.test(fl.texture || '')) { delete fl.texture; toast('The link leaves out your floor photo to stay short.'); }
    }
    const u = new URL(location.href);
    if (SRC.kind === 'local') u.searchParams.delete('house');
    u.hash = 'scheme=' + await PaintStore.pack(payload);
    const link = u.toString();
    let copied = false;
    try { await navigator.clipboard.writeText(link); copied = true; } catch { copied = false; }
    if (copied) { toast('Link copied. Anyone who opens it sees this scheme' + (SRC.kind === 'local' ? ' and this house.' : '.')); return; }
    showText('Share link', 'Copy this link. Anyone who opens it sees this scheme.', link, 90);
  }
  $('#shareBtn').onclick = shareLink;

  // ------------------------------------------------------------------ open a file: a house, or a scheme to import
  $('#openBtn').onclick = () => $('#fileIn').click();
  $('#fileIn').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    let text, j;
    try { text = await f.text(); j = JSON.parse(text); } catch { toast('That file is not valid JSON.'); return; }
    if (j.format === HouseCore.FORMAT) {
      confirmBox(`Open \u201c${j.name || f.name}\u201d?`, 'The page switches to this house. Schemes are kept separately for each house, and the example house is one click away.', 'Open house', () => {
        try { HouseLoader.openHouseText(text); } catch (x) { showText('This house file has problems', 'Fix these and open it again.', x.message, 160); }
      });
      return;
    }
    const a = j.assignments || j.a;
    if (a && typeof a === 'object') {
      const other = j.house && j.house.id && j.house.id !== H.id;
      openUnsaved((j.scheme?.name || j.name || f.name.replace(/\.json$/i, '')) + ' (imported)', a, 'Imported \u00b7 paint anything to keep it');
      if (other) toast('This scheme was made for another house. Only surfaces with matching names were painted.');
      return;
    }
    toast('That file is neither a house nor a scheme.');
  });
  // ------------------------------------------------------------------ export for Blender
  // One self-contained JSON file: the built house, every surface's final colour / wood / sheen, and the exact camera
  // you are looking through. build_house.py --scheme <file> rebuilds the house from it and renders that view (and others).
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3500); }
  function exportPayload() {
    const plan = v => [+v.x.toFixed(3), +v.z.toFixed(3), +v.y.toFixed(3)];          // three.js (x, up, z) -> plan feet (x, y, z up)
    const dir = new T.Vector3(); camera.getWorldDirection(dir);
    const target = walk.on ? camera.position.clone().add(dir.multiplyScalar(4)) : controls.target.clone();
    const resolved = {};
    for (const k in TARGETS) {
      const t = TARGETS[k], v = effective(k);
      resolved[k] = { hex: v?.h || B.defaultHex(k), sheen: v?.s || defaultSheen(t), brand: v?.b || 'primer', code: v?.c || null, name: v?.n || 'Primer white',
        wood: v?.b === 'wood' ? v.c : null, kind: t.kind, room: t.room, label: t.full };
    }
    return {
      format: 'house-painter/scheme', version: 1, exportedAt: new Date().toISOString(),
      scheme: { id: curId, name: curName },
      view: { kind: view.kind, room: view.room || null, wall: view.key || null, lighting: lightMode, fov: +camera.fov.toFixed(1),
              camera: { position: plan(camera.position), target: plan(target), eyeHeight: walk.on ? EYE : null } },
      assignments: JSON.parse(JSON.stringify(A)),
      resolved,
      woods: B.WOODS,
      house: HouseCore.forBlender(H, R)
    };
  }
  async function exportForBlender() {
    const data = JSON.stringify(exportPayload(), null, 1);
    const slug = (curName || 'scheme').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scheme';
    const filename = `house-${slug}.json`;
    try {
      const r = await PaintStore.saveFile(filename, data);
      if (r === 'saved') toast(`Saved ${filename}. Render it with build_house.py --scheme ${filename}`);
    } catch { showText('Export for Blender', `Saving files isn't available here. Copy this text into a file named ${filename}.`, data, 200); }
  }
  function showText(title, note, text, rows) {                // fallback when the clipboard or downloads are blocked
    const d = $('#dialog');
    d.innerHTML = `<div class="box exportbox"><h3>${esc(title)}</h3><p style="margin:0;color:var(--muted)">${esc(note)}</p>
      <textarea id="exportText" readonly style="height:${rows}px"></textarea><div class="row-btns"><button class="btn" id="dlgCancel">Close</button><button class="btn primary" id="dlgCopy">Copy</button></div></div>`;
    $('#exportText').value = text; d.hidden = false;
    $('#dlgCancel').onclick = closeDialog;
    $('#dlgCopy').onclick = () => {
      const ta = $('#exportText');
      const done = () => { $('#dlgCopy').textContent = 'Copied'; };
      try { navigator.clipboard.writeText(text).then(done, () => { ta.select(); }); } catch { ta.select(); }
    };
  }
  $('#exportBtn').onclick = exportForBlender;
  $('#ihExport').onclick = () => { if (document.pointerLockElement === canvas) { try { document.exitPointerLock(); } catch { } } exportForBlender(); };

  window.__studio = { camera, controls, renderer, setLighting, LIGHTS, requestRender, walk, enterWalk, blocked, stepWalk, openPicker, enterImmersive, A: () => A, exportPayload };   // debug handle (camera checks)
  boot();
})();
