/*
 * Browser 3D build of the house (Three.js r128), from window.HOUSE + window.ROOMS (house-core.js).
 * Mirrors build_house.py, with one difference that matters for painting: every wall is cut at the
 * paint-surface boundaries, so each face of each box carries the material of exactly one surface.
 *
 * Coordinates: plan feet (x east, y south, z up) \u2192 three.js (X = x, Y = z, Z = y). 1 unit = 1 ft.
 * window.House3DBuild(HOUSE, ROOMS) -> { root, ceilings, pickables, material(key), keyAt(hit), roomInfo, surfaceView, ... }
 * When the page already has window.HOUSE / window.ROOMS, window.House3D is built from them on load.
 */
(function () {
function build(H, R) {
  const T = THREE;
  const CEIL = R.ceilingHeight;                              // openings carry their own z0/z1 (house-core.js)
  const T_HALF = H.T / 2;
  const BASE_H = 0.375, BASE_T = 0.03, CASE_W = 0.29, CASE_T = 0.035, DOOR_T = 0.115, DOOR_OPEN = 68;
  const SHEEN = { flat: 0.96, matte: 0.92, eggshell: 0.82, satin: 0.64, semigloss: 0.42, gloss: 0.24 };

  const lin = hex => new T.Color(hex).convertSRGBToLinear();
  const std = (hex, rough = 0.6, metal = 0, extra = {}) => new T.MeshStandardMaterial(Object.assign({ color: lin(hex), roughness: rough, metalness: metal }, extra));

  // ---------------------------------------------------------------- paintable materials (one per key)
  const DEFAULTS = { wall: '#F1EFEA', ceiling: '#F5F4F0', trim: '#F6F6F3', exttrim: '#F4F4F0', doors: '#F3F3EF', extdoors: '#F3F3EF', siding: '#E9E8E2' };
  const ITEM = {};                                           // the house's paintable items (cabinet runs, special doors)
  for (const it of H.items) { ITEM[it.key] = it; DEFAULTS[it.key] = it.default || (it.kind === 'door' ? '#F3F3EF' : '#F1F0EC'); }
  const mats = {};
  const partGroup = key => { const m = /^(\w+):(door|drawer)\d+$/.exec(key); return m ? m[1] : null; };   // "kbase:door3" -> "kbase"
  function defaultHex(key) {
    if (DEFAULTS[key]) return DEFAULTS[key];
    if (partGroup(key)) return DEFAULTS[partGroup(key)] || DEFAULTS.wall;
    if (key.startsWith('C:')) return DEFAULTS.ceiling;
    if (key.startsWith('EXT-')) return DEFAULTS.siding;
    return DEFAULTS.wall;
  }
  function material(key) {
    if (!mats[key]) {
      const sheen = key.startsWith('C:') ? 'flat' : (/^(trim|exttrim|doors|extdoors)$/.test(key) || ITEM[key]?.kind === 'door' ? 'semigloss' : (ITEM[key] || partGroup(key) ? 'satin' : 'eggshell'));
      const m = std(defaultHex(key), SHEEN[sheen]);
      m.userData.key = key;
      mats[key] = m;
    }
    return mats[key];
  }
  function setPaint(key, hex, sheen, woodId) {
    const m = material(key);
    const tex = woodId && WOODS[woodId] ? woodTexture(woodId) : null;
    if (m.map !== tex) { m.map = tex; m.needsUpdate = true; }
    m.color.copy(tex ? new T.Color(0xffffff) : lin(hex || defaultHex(key)));     // wood: the texture carries the colour
    m.roughness = SHEEN[sheen] ?? m.roughness;
  }

  // ---------------------------------------------------------------- wood finishes (procedural, tileable veneer)
  // One tile covers 2.5' x 5' of surface; box UVs are in feet, so grain is the same scale on a drawer and on a wall.
  const WOODS = {
    walnut:   { n: 'Walnut',        light: '#8C5D3E', dark: '#3A2215', freq: 9,  warp: 0.55, pores: 0.30 },
    teak:     { n: 'Teak',          light: '#B57E49', dark: '#6A4220', freq: 7,  warp: 0.45, pores: 0.22 },
    whiteoak: { n: 'White oak',     light: '#CDAA7C', dark: '#8C6A45', freq: 12, warp: 0.35, pores: 0.35 },
    redoak:   { n: 'Red oak',       light: '#C48D63', dark: '#86513A', freq: 10, warp: 0.6,  pores: 0.35 },
    cherry:   { n: 'Cherry',        light: '#A8603F', dark: '#6A3322', freq: 8,  warp: 0.4,  pores: 0.12 },
    maple:    { n: 'Maple',         light: '#E2C99E', dark: '#BE9C70', freq: 14, warp: 0.3,  pores: 0.08 },
    rosewood: { n: 'Rosewood',      light: '#743A26', dark: '#29120B', freq: 7,  warp: 0.7,  pores: 0.25 },
    ebonized: { n: 'Ebonized oak',  light: '#3E3630', dark: '#191513', freq: 12, warp: 0.35, pores: 0.35 }
  };
  const TILE_W = 2.5, TILE_H = 5;
  const hexRGB = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  for (const w of Object.values(WOODS)) {                    // average colour, for swatch dots and paint totals
    const a = hexRGB(w.light), b = hexRGB(w.dark);
    w.avg = '#' + a.map((v, i) => Math.round(v * 0.62 + b[i] * 0.38).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  function hash(ix, iy, s) { let h = (ix * 374761393 + iy * 668265263 + s * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967295; }
  function vnoise(x, y, px, py, s) {                         // value noise that repeats every px by py cells, so tiles join
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const m = (a, p) => ((a % p) + p) % p, X0 = m(x0, px), X1 = m(x0 + 1, px), Y0 = m(y0, py), Y1 = m(y0 + 1, py);
    const a = hash(X0, Y0, s), b = hash(X1, Y0, s), c = hash(X0, Y1, s), d = hash(X1, Y1, s);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  function fbm(u, v, fx, fy, oct, s) { let sum = 0, amp = 0.5, f = 1, norm = 0; for (let o = 0; o < oct; o++) { sum += amp * vnoise(u * fx * f, v * fy * f, fx * f, fy * f, s + o); norm += amp; amp *= 0.5; f *= 2; } return sum / norm; }
  function woodCanvas(w, W, H) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'), img = ctx.createImageData(W, H), d = img.data;
    const L = hexRGB(w.light), D = hexRGB(w.dark);
    for (let y = 0; y < H; y++) {
      const v = y / H;
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const f = w.freq * 2.6;                                                                                       // growth rings across one 2.5' tile
        const warp = fbm(u, v, 3, 2, 3, 1) - 0.5;
        const r = u * f + warp * w.warp * f * 0.22 + (fbm(u, v, 4, 6, 2, 7) - 0.5) * 0.9;
        const g = r - Math.floor(r);
        const band = 0.7 * Math.exp(-(((g - 0.82) / 0.07) ** 2)) + 0.35 * Math.exp(-(((g - 0.75) / 0.22) ** 2));   // latewood lines
        const streak = fbm(u, v, 96, 3, 2, 31) - 0.5;                                                                 // fine straight streaks
        const pore = vnoise(u * 220, v * 14, 220, 14, 11) > 0.78 ? 1 : 0;                                            // long open pores
        const tone = fbm(u, v, 2, 1, 2, 21) - 0.5;                                                                    // slow colour drift
        const t = Math.max(0, Math.min(1, band * 0.45 + streak * 0.5 + pore * w.pores * 0.7 + tone * 0.4 + 0.22));
        const i = (y * W + x) * 4;
        d[i] = L[0] + (D[0] - L[0]) * t; d[i + 1] = L[1] + (D[1] - L[1]) * t; d[i + 2] = L[2] + (D[2] - L[2]) * t; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
  const woodTex = {}, woodSw = {};
  function woodTexture(id) {
    if (!woodTex[id]) {
      const t = new T.CanvasTexture(woodCanvas(WOODS[id], 384, 768));
      t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(1 / TILE_W, 1 / TILE_H);
      t.encoding = T.sRGBEncoding; t.anisotropy = 8;
      woodTex[id] = t;
    }
    return woodTex[id];
  }
  function woodSwatch(id) {                                  // small image for colour chips
    if (!woodSw[id]) woodSw[id] = woodCanvas(WOODS[id], 96, 192).toDataURL('image/png');
    return woodSw[id];
  }

  // fixed (non-paintable) materials
  const M = {
    cut: std('#B7B4AD', 0.95), counter: std('#F3F3F0', 0.25), tile: std('#EEEEEA', 0.15), appWhite: std('#ECEEEE', 0.35),
    steel: std('#BFC3C7', 0.3, 0.9), black: std('#141518', 0.25), brass: std('#B8923C', 0.35, 0.9), chrome: std('#D8DADD', 0.15, 1),
    porc: std('#FBFBFA', 0.12), winframe: std('#F7F7F5', 0.45), wire: std('#E8E8E6', 0.5), heater: std('#E2E4E6', 0.4),
    pump: std('#35607F', 0.45), skirt: std('#C9C6BD', 0.85), deck: std('#7A5A3B', 0.8), ground: std('#7E8A6A', 1), reveal: std('#3A3C40', 0.6),
    glass: new T.MeshStandardMaterial({ color: lin('#CFE3EE'), roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false }),
    floor: std(H.floor.color || '#B09672', 0.55)
  };

  // ---------------------------------------------------------------- helpers
  const root = new T.Group(), ceilings = new T.Group(), pickables = [];
  root.add(ceilings);
  function box(x0, y0, z0, x1, y1, z1, mat, parent = root) {
    if (x1 < x0) [x0, x1] = [x1, x0]; if (y1 < y0) [y0, y1] = [y1, y0]; if (z1 < z0) [z0, z1] = [z1, z0];
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return null;
    const g = new T.BoxGeometry(x1 - x0, z1 - z0, y1 - y0);
    // UVs in feet (face width x face height), so textures keep real-world scale on every box
    const sx = x1 - x0, sy = z1 - z0, sz = y1 - y0, dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]], uv = g.attributes.uv;
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0], uv.getY(k) * dims[f][1]); }
    const m = new T.Mesh(g, mat);
    m.position.set((x0 + x1) / 2, (z0 + z1) / 2, (y0 + y1) / 2);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function pick(mesh, key) { if (!mesh) return mesh; mesh.userData.key = key; pickables.push(mesh); return mesh; }
  function cylinder(cx, cy, rx, ry, z0, z1, mat) {
    const m = new T.Mesh(new T.CylinderGeometry(1, 1, 1, 36), mat);
    m.scale.set(rx, z1 - z0, ry); m.position.set(cx, (z0 + z1) / 2, cy);
    m.castShadow = m.receiveShadow = true; root.add(m); return m;
  }
  function rectsGeometry(rects, z, faceDown) {             // flat quads in plan, at height z
    const pos = [], uv = [], idx = [];
    rects.forEach(([x0, y0, x1, y1]) => {
      const b = pos.length / 3;
      pos.push(x0, z, y0, x1, z, y0, x1, z, y1, x0, z, y1);
      uv.push(x0, y0, x1, y0, x1, y1, x0, y1);
      idx.push(...(faceDown ? [b, b + 1, b + 2, b, b + 2, b + 3] : [b, b + 2, b + 1, b, b + 3, b + 2]));
    });
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }

  // ---------------------------------------------------------------- rooms (shapes from the core, centroids)
  const roomInfo = {};
  for (const r of R.rooms) {
    const rects = r.shape;
    if (!rects.length) continue;
    let a = 0, sx = 0, sy = 0, bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
    rects.forEach(([x0, y0, x1, y1]) => { const ar = (x1 - x0) * (y1 - y0); a += ar; sx += ar * (x0 + x1) / 2; sy += ar * (y0 + y1) / 2;
      bx0 = Math.min(bx0, x0); by0 = Math.min(by0, y0); bx1 = Math.max(bx1, x1); by1 = Math.max(by1, y1); });
    let cx = sx / a, cy = sy / a;
    if (R.roomAt(cx, cy) !== r.id) {                       // L-shaped room: use the biggest rect's centre
      const big = rects.reduce((m, q) => ((q[2] - q[0]) * (q[3] - q[1]) > (m[2] - m[0]) * (m[3] - m[1]) ? q : m), rects[0]);
      cx = (big[0] + big[2]) / 2; cy = (big[1] + big[3]) / 2;
    }
    roomInfo[r.id] = { cx, cy, bbox: [bx0, by0, bx1, by1], rects };
    const ceil = new T.Mesh(rectsGeometry(rects, CEIL - 0.004, true), material('C:' + r.id));
    ceil.receiveShadow = true;
    ceilings.add(pick(ceil, 'C:' + r.id));
  }

  // ---------------------------------------------------------------- walls
  const surfByWall = {};
  R.surfaces.forEach(s => { if (s.wall !== undefined) (surfByWall[s.wall] ||= []).push(s); });
  // BoxGeometry material order: +X, -X, +Y(top), -Y(bottom), +Z(south), -Z(north)
  H.walls.forEach((w, wi) => {
    if (w.status === 'removed') return;
    const horiz = (w.x1 - w.x0) >= (w.y1 - w.y0);
    const s = horiz ? w.x0 : w.y0, e = horiz ? w.x1 : w.y1;
    const ops = (w.openings || []).filter(o => o.type !== 'panel').sort((p, q) => p.a - q.a);
    const surfs = surfByWall[wi] || [];
    const faceKey = (side, t) => { const f = surfs.find(x => x.side === side && x.kind !== 'end' && t >= x.a - 1e-3 && t <= x.b + 1e-3); return f ? f.id : null; };
    const nearest = (side, t) => {                         // closest painted surface on this side, within 0.4 ft
      let best = null, bd = 0.4;
      for (const x of surfs) if (x.side === side && x.kind !== 'end') { const d = t < x.a ? x.a - t : t > x.b ? t - x.b : 0; if (d < bd) { bd = d; best = x.id; } }
      return best;
    };
    const endKey = side => { const f = surfs.find(x => x.kind === 'end' && x.side === side); return f ? f.id : null; };
    const isExt = k => k && k.startsWith('EXT-');
    const cuts = new Set([s, e]);
    ops.forEach(o => { cuts.add(o.a); cuts.add(o.b); });
    surfs.forEach(x => { if (x.kind !== 'end') { cuts.add(Math.max(s, Math.min(e, x.a))); cuts.add(Math.max(s, Math.min(e, x.b))); } });
    const ts = [...cuts].sort((a, b) => a - b);

    for (let i = 0; i < ts.length - 1; i++) {
      const t0 = ts[i], t1 = ts[i + 1];
      if (t1 - t0 < 1e-3) continue;
      const tm = (t0 + t1) / 2, o = ops.find(q => tm > q.a && tm < q.b);
      const zr = !o ? [[0, CEIL]] : o.type === 'window' ? [[0, o.z0], [o.z1, CEIL]] : [[o.z1, CEIL]];
      const lo = faceKey('lo', tm), hi = faceKey('hi', tm);
      const fallback = lo || hi;
      // end faces: a jamb takes trim; a face that lines up with another wall's face (an outside corner) takes that
      // surface's paint so the colour wraps the corner; a free end takes its own end surface; else the nearest face
      const endMat = (t, dir) => {
        if (ops.some(q => Math.abs(q.a - t) < 1e-3 || Math.abs(q.b - t) < 1e-3)) return { m: material('trim'), k: 'trim' };
        const flush = R.surfaces.find(x => x.kind !== 'end' && (horiz
          ? x.normal[0] === dir && x.normal[1] === 0 && Math.abs(x.seg[0][0] - t) < 0.02 && Math.min(x.seg[0][1], x.seg[1][1]) <= w.y1 + 0.02 && Math.max(x.seg[0][1], x.seg[1][1]) >= w.y0 - 0.02
          : x.normal[1] === dir && x.normal[0] === 0 && Math.abs(x.seg[0][1] - t) < 0.02 && Math.min(x.seg[0][0], x.seg[1][0]) <= w.x1 + 0.02 && Math.max(x.seg[0][0], x.seg[1][0]) >= w.x0 - 0.02));
        if (flush) return { m: material(flush.id), k: flush.id };
        const ek = (Math.abs(t - s) < 1e-3 && endKey('start')) || (Math.abs(t - e) < 1e-3 && endKey('end'));
        if (ek) return { m: material(ek), k: ek };
        const k = fallback || nearest('lo', t) || nearest('hi', t);
        return k ? { m: material(k), k } : { m: M.cut, k: null };
      };
      const st = endMat(t0, -1), en = endMat(t1, 1);
      for (const [z0, z1] of zr) {
        const faceMat = k => (k ? material(k) : M.cut);
        const loK = lo || nearest('lo', tm), hiK = hi || nearest('hi', tm);   // hairline slivers at junctions borrow the neighbour's paint
        const topMat = z1 >= CEIL - 1e-3 ? M.cut : material('trim');   // window stool / door head soffit read as trim
        const botMat = z0 <= 1e-3 ? M.cut : material('trim');
        const mats = horiz
          ? [en.m, st.m, topMat, botMat, faceMat(hiK), faceMat(loK)]
          : [faceMat(hiK), faceMat(loK), topMat, botMat, en.m, st.m];
        const keys = horiz ? [en.k, st.k, z1 < CEIL - 1e-3 ? 'trim' : null, z0 > 1e-3 ? 'trim' : null, hiK, loK]
                           : [hiK, loK, z1 < CEIL - 1e-3 ? 'trim' : null, z0 > 1e-3 ? 'trim' : null, en.k, st.k];
        const mesh = horiz ? box(t0, w.y0, z0, t1, w.y1, z1, mats) : box(w.x0, t0, z0, w.x1, t1, z1, mats);
        if (mesh) { mesh.userData.keys = keys; pickables.push(mesh); }
        // baseboards on interior faces of floor-level pieces
        if (z0 <= 1e-3) for (const [k, side] of [[lo, 'lo'], [hi, 'hi']]) {
          if (!k || isExt(k)) continue;
          const bb = horiz
            ? (side === 'lo' ? box(t0, w.y0 - BASE_T, 0, t1, w.y0, BASE_H, material('trim')) : box(t0, w.y1, 0, t1, w.y1 + BASE_T, BASE_H, material('trim')))
            : (side === 'lo' ? box(w.x0 - BASE_T, t0, 0, w.x0, t1, BASE_H, material('trim')) : box(w.x1, t0, 0, w.x1 + BASE_T, t1, BASE_H, material('trim')));
          pick(bb, 'trim');
        }
      }
    }

    // casings (clamped so neighbouring openings share the gap), windows, doors
    ops.forEach((o, k) => {
      const roomL = k > 0 ? (o.a - ops[k - 1].b) / 2 : CASE_W, roomR = k + 1 < ops.length ? (ops[k + 1].a - o.b) / 2 : CASE_W;
      const el = Math.min(CASE_W, roomL) - 0.002, er = Math.min(CASE_W, roomR) - 0.002;
      const z0 = o.z0, z1 = o.z1;
      for (const side of ['lo', 'hi']) {
        const fk = faceKey(side, (o.a + o.b) / 2) || faceKey(side, o.a - 0.05);
        const key = isExt(fk) ? 'exttrim' : 'trim', mat = material(key);
        const b = (a0, a1, zz0, zz1) => pick(horiz
          ? (side === 'lo' ? box(a0, w.y0 - CASE_T, zz0, a1, w.y0, zz1, mat) : box(a0, w.y1, zz0, a1, w.y1 + CASE_T, zz1, mat))
          : (side === 'lo' ? box(w.x0 - CASE_T, a0, zz0, w.x0, a1, zz1, mat) : box(w.x1, a0, zz0, w.x1 + CASE_T, a1, zz1, mat)), key);
        b(o.a - el, o.a, z0, z1); b(o.b, o.b + er, z0, z1); b(o.a - el, o.b + er, z1, z1 + CASE_W);
        if (o.type === 'window') b(o.a - el, o.b + er, z0 - CASE_W * 0.8, z0);
      }
      if (o.type === 'window') buildWindow(w, horiz, o, z0, z1);
      if (o.type === 'door') buildDoor(w, horiz, o);
    });
  });

  function buildWindow(w, horiz, o, z0, z1) {
    const cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2, fw = 0.11, dep = 0.12;
    const fb = (a0, a1, zz0, zz1) => horiz ? box(a0, cy - dep / 2, zz0, a1, cy + dep / 2, zz1, M.winframe) : box(cx - dep / 2, a0, zz0, cx + dep / 2, a1, zz1, M.winframe);
    fb(o.a, o.a + fw, z0, z1); fb(o.b - fw, o.b, z0, z1);
    fb(o.a + fw, o.b - fw, z0, z0 + fw); fb(o.a + fw, o.b - fw, z1 - fw, z1);
    const n = o.panes || 1, mid = (z0 + z1) / 2;
    for (let k = 1; k < n; k++) { const p = o.a + (o.b - o.a) * k / n; fb(p - 0.04, p + 0.04, z0 + fw, z1 - fw); }
    fb(o.a + fw, o.b - fw, mid - 0.03, mid + 0.03);
    const g = horiz ? box(o.a + fw, cy - 0.01, z0 + fw, o.b - fw, cy + 0.01, z1 - fw, M.glass) : box(cx - 0.01, o.a + fw, z0 + fw, cx + 0.01, o.b - fw, z1 - fw, M.glass);
    if (g) g.castShadow = false;
  }

  function buildDoor(w, horiz, o) {
    const cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2;
    const hv = o.hinge === 'a' ? o.a : o.b, ov = o.hinge === 'a' ? o.b : o.a;
    const hinge = horiz ? [hv, cy] : [cx, hv], other = horiz ? [ov, cy] : [cx, ov];
    const nrm = horiz ? [0, o.swing === 's' ? 1 : -1] : [o.swing === 'e' ? 1 : -1, 0];
    doorLeaf(hinge, other, nrm, !!w.ext, o.z1);
  }
  // hinge and other: the two ends of the doorway in plan; nrm: the side the door swings to (a unit vector)
  function doorLeaf(hinge, other, nrm, ext, doorH) {
    const len = Math.hypot(other[0] - hinge[0], other[1] - hinge[1]), d = [(other[0] - hinge[0]) / len, (other[1] - hinge[1]) / len];
    const ang = (ext ? 0 : DOOR_OPEN) * Math.PI / 180;
    const dr = [d[0] * Math.cos(ang) + nrm[0] * Math.sin(ang), d[1] * Math.cos(ang) + nrm[1] * Math.sin(ang)];
    const key = ext ? 'extdoors' : 'doors', mat = material(key), L = len - 0.012, t2 = DOOR_T / 2;
    const g = new T.Group();
    g.position.set(hinge[0] + d[0] * 0.006, 0, hinge[1] + d[1] * 0.006);
    g.rotation.y = Math.atan2(-dr[1], dr[0]);
    const DH = doorH, k = DH / 6.667;
    pick(box(0, -t2, 0.03, L, t2, DH - 0.05, mat, g), key);               // local: x along the leaf, "y" across it
    const cols = [[0.3, L / 2 - 0.08], [L / 2 + 0.08, L - 0.3]], rows = [[0.9, 2.5], [2.9, 4.3], [4.7, 6.1]].map(([a, b]) => [a * k, b * k]);
    for (const sgn of [1, -1]) {
      for (const [u0, u1] of cols) for (const [z0, z1] of rows) pick(box(u0, sgn * t2, z0, u1, sgn * (t2 + 0.012), z1, mat, g), key);
      box(L - 0.32, sgn * (t2 + 0.01), 2.95, L - 0.24, sgn * (t2 + 0.08), 3.05, M.brass, g);
    }
    root.add(g);
  }

  // ---------------------------------------------------------------- angled walls
  // The same pieces as for the straight walls, built along each wall's own line. Every box here has x along the wall and
  // z across it, so its materials go in the same order as a horizontal wall's: [end b, end a, top, bottom, right face, left face].
  const slantSurfs = {};
  R.surfaces.forEach(s => { if (s.slant !== undefined) (slantSurfs[s.slant] ||= []).push(s); });
  function obox(S, s0, s1, z0, z1, off, thick, mat) {                           // off: sideways from the centre line, positive to the right
    const L = s1 - s0, hh = z1 - z0;
    if (L < 1e-4 || hh < 1e-4 || thick < 1e-4) return null;
    const g = new T.BoxGeometry(L, hh, thick), uv = g.attributes.uv, dims = [[thick, hh], [thick, hh], [L, thick], [L, thick], [L, hh], [L, hh]];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0], uv.getY(k) * dims[f][1]); }
    const m = new T.Mesh(g, mat), sm = (s0 + s1) / 2;
    m.position.set(S.p0[0] + S.u[0] * sm + S.nr[0] * off, (z0 + z1) / 2, S.p0[1] + S.u[1] * sm + S.nr[1] * off);
    m.rotation.y = -Math.atan2(S.u[1], S.u[0]);
    m.castShadow = m.receiveShadow = true; root.add(m);
    return m;
  }
  H.slants.forEach(S => {
    if (S.status === 'removed') return;
    const surfs = slantSurfs[S.i] || [], ops = S.openings.filter(o => o.type !== 'panel').sort((p, q) => p.a - q.a);
    const faceKey = (side, t) => { const f = surfs.find(x => x.side === side && t >= x.a - 1e-3 && t <= x.b + 1e-3); return f ? f.id : null; };
    const nearest = (side, t) => {
      let best = null, bd = 0.4;
      for (const x of surfs) if (x.side === side) { const d = t < x.a ? x.a - t : t > x.b ? t - x.b : 0; if (d < bd) { bd = d; best = x.id; } }
      return best;
    };
    const isExt = k => k && k.startsWith('EXT-');
    const lo0 = -S.e0, hi0 = S.len + S.e1, cuts = new Set([lo0, hi0]);
    ops.forEach(o => { cuts.add(o.a); cuts.add(o.b); });
    surfs.forEach(x => { cuts.add(Math.max(lo0, Math.min(hi0, x.a))); cuts.add(Math.max(lo0, Math.min(hi0, x.b))); });
    const ts = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < ts.length - 1; i++) {
      const t0 = ts[i], t1 = ts[i + 1];
      if (t1 - t0 < 1e-3) continue;
      const tm = (t0 + t1) / 2, o = ops.find(q => tm > q.a && tm < q.b);
      const zr = !o ? [[0, CEIL]] : o.type === 'window' ? [[0, o.z0], [o.z1, CEIL]] : [[o.z1, CEIL]];
      const lo = faceKey('lo', tm), hi = faceKey('hi', tm), loK = lo || nearest('lo', tm), hiK = hi || nearest('hi', tm);
      const endM = t => {                                                   // a doorway edge takes trim; the wall's own ends take its paint; cuts in between are hidden
        const k = ops.some(q => Math.abs(q.a - t) < 1e-3 || Math.abs(q.b - t) < 1e-3) ? 'trim' : (Math.abs(t - lo0) < 1e-3 || Math.abs(t - hi0) < 1e-3) ? (loK || hiK) : null;
        return k ? { m: material(k), k } : { m: M.cut, k: null };
      };
      const st = endM(t0), en = endM(t1), fm = k => (k ? material(k) : M.cut);
      for (const [z0, z1] of zr) {
        const topMat = z1 >= CEIL - 1e-3 ? M.cut : material('trim'), botMat = z0 <= 1e-3 ? M.cut : material('trim');
        const mesh = obox(S, t0, t1, z0, z1, 0, S.t, [en.m, st.m, topMat, botMat, fm(hiK), fm(loK)]);
        if (mesh) { mesh.userData.keys = [en.k, st.k, z1 < CEIL - 1e-3 ? 'trim' : null, z0 > 1e-3 ? 'trim' : null, hiK, loK]; pickables.push(mesh); }
        if (z0 <= 1e-3) for (const [k, side] of [[lo, 'lo'], [hi, 'hi']]) {          // baseboards on inside faces
          if (!k || isExt(k)) continue;
          pick(obox(S, t0, t1, 0, BASE_H, (side === 'lo' ? -1 : 1) * (S.t / 2 + BASE_T / 2), BASE_T, material('trim')), 'trim');
        }
      }
    }
    ops.forEach((o, k) => {                                                  // casings, windows, doors
      const roomL = k > 0 ? (o.a - ops[k - 1].b) / 2 : CASE_W, roomR = k + 1 < ops.length ? (ops[k + 1].a - o.b) / 2 : CASE_W;
      const el = Math.min(CASE_W, roomL) - 0.002, er = Math.min(CASE_W, roomR) - 0.002, z0 = o.z0, z1 = o.z1;
      for (const side of ['lo', 'hi']) {
        const fk = faceKey(side, (o.a + o.b) / 2) || faceKey(side, o.a - 0.05), key = isExt(fk) ? 'exttrim' : 'trim', mat = material(key);
        const off = (side === 'lo' ? -1 : 1) * (S.t / 2 + CASE_T / 2), b = (a0, a1, zz0, zz1) => pick(obox(S, a0, a1, zz0, zz1, off, CASE_T, mat), key);
        b(o.a - el, o.a, z0, z1); b(o.b, o.b + er, z0, z1); b(o.a - el, o.b + er, z1, z1 + CASE_W);
        if (o.type === 'window') b(o.a - el, o.b + er, z0 - CASE_W * 0.8, z0);
      }
      if (o.type === 'window') {
        const fw = 0.11, dep = 0.12, fb = (a0, a1, zz0, zz1) => obox(S, a0, a1, zz0, zz1, 0, dep, M.winframe);
        fb(o.a, o.a + fw, z0, z1); fb(o.b - fw, o.b, z0, z1); fb(o.a + fw, o.b - fw, z0, z0 + fw); fb(o.a + fw, o.b - fw, z1 - fw, z1);
        const n = o.panes || 1, mid = (z0 + z1) / 2;
        for (let q = 1; q < n; q++) { const pp = o.a + (o.b - o.a) * q / n; fb(pp - 0.04, pp + 0.04, z0 + fw, z1 - fw); }
        fb(o.a + fw, o.b - fw, mid - 0.03, mid + 0.03);
        const gl = obox(S, o.a + fw, o.b - fw, z0 + fw, z1 - fw, 0, 0.02, M.glass); if (gl) gl.castShadow = false;
      }
      if (o.type === 'door') {
        const at = t => [S.p0[0] + S.u[0] * t, S.p0[1] + S.u[1] * t];
        doorLeaf(at(o.hinge === 'a' ? o.a : o.b), at(o.hinge === 'a' ? o.b : o.a), o.swing === 'l' ? S.nl : S.nr, !!S.ext, o.z1);
      }
    });
  });

  // ---------------------------------------------------------------- fixtures
  // Every door and drawer front is its own panel with its own paint key ("kbase:door3", "island:drawer2").
  // A panel without its own colour shows the cabinet run's colour (the app resolves that).
  // Fixtures are built in their own frame (fixtures.js): p = depth from the back to the front, q = across the front.
  const FX = window.HouseFixtures;
  const cabParts = [], partN = {};
  const DOOR_PROUD = 0.045, GAP = 0.022;
  const lbox = (F, p0, q0, z0, p1, q1, z1, m) => { const r = F.box(p0, q0, p1, q1); return box(r[0], r[1], z0, r[2], r[3], z1, m); };
  const lcyl = (F, p, q, rp, rq, z0, z1, m) => { const [x, y] = F.pt(p, q); return F.swap ? cylinder(x, y, rq, rp, z0, z1, m) : cylinder(x, y, rp, rq, z0, z1, m); };
  // style: 'door-drawer' (base cabinets: a drawer over each door), 'doors', or 'drawers' (a stack of three)
  function cabinetFront(f, z0, z1, counter) {
    if (!f.front || !f.paint) return;
    const F = FX.frame(f), { n, style } = FX.cabinetLayout(f, counter), dw = F.Q / n;
    const slab = (q0, q1, zz0, zz1, o0, o1, m) => lbox(F, F.P + o0, q0, zz0, F.P + o1, q1, zz1, m);
    const kick = style === 'doors' ? 0 : 0.35, split = style === 'door-drawer' ? z1 - 0.55 : z1;
    const nextKey = kind => { const c = (partN[f.paint] ||= { door: 0, drawer: 0 }); c[kind]++;
      const key = `${f.paint}:${kind}${c[kind]}`; cabParts.push({ key, group: f.paint, kind, n: c[kind] }); return key; };
    const pull = (b0, b1, z) => slab((b0 + b1) / 2 - 0.25, (b0 + b1) / 2 + 0.25, z - 0.025, z + 0.025, DOOR_PROUD, DOOR_PROUD + 0.06, M.black);
    if (kick) slab(0, F.Q, 0, kick, 0, 0.004, M.reveal);                 // toe-kick shadow
    // doors are numbered west to east / north to south whichever way the run faces, so saved colours stay on their doors
    const rev = F.d === 's' || F.d === 'w';
    for (let j = 0; j < n; j++) {
      const i = rev ? n - 1 - j : j, b0 = i * dw + GAP, b1 = (i + 1) * dw - GAP;
      if (style === 'drawers') {                                        // shallow top drawer, two deep ones under it
        const h = z1 - kick, cuts = [kick, kick + h * 0.38, kick + h * 0.76, z1];
        for (let j = 2; j >= 0; j--) { const rk = nextKey('drawer'); pick(slab(b0, b1, cuts[j] + GAP, cuts[j + 1] - GAP, 0, DOOR_PROUD, material(rk)), rk); pull(b0, b1, cuts[j + 1] - 0.28); }
        continue;
      }
      const dk = nextKey('door');
      pick(slab(b0, b1, (kick || z0) + GAP, split - GAP, 0, DOOR_PROUD, material(dk)), dk);
      const lowEnd = j % 2 === 1, hx = lowEnd !== rev ? b0 + 0.14 : b1 - 0.14;   // handles alternate, as they always have
      const hz = style === 'door-drawer' ? split - 0.75 : (z1 - z0 > 4 ? (z0 + z1) / 2 : z0 + 0.35);
      slab(hx - 0.02, hx + 0.02, hz - 0.22, hz + 0.22, DOOR_PROUD, DOOR_PROUD + 0.06, M.black);
      if (style === 'door-drawer') {
        const rk = nextKey('drawer');
        pick(slab(b0, b1, split + GAP, z1 - GAP, 0, DOOR_PROUD, material(rk)), rk);
        slab((b0 + b1) / 2 - 0.25, (b0 + b1) / 2 + 0.25, z1 - 0.3, z1 - 0.25, DOOR_PROUD, DOOR_PROUD + 0.06, M.black);
      }
    }
  }
  // countertop: overhangs the front (past the doors) \u2014 and every side of the island \u2014 so slabs never overlap at corners
  function counterTop(f, z) {
    const o = 0.1, all = f.counter === 'all';
    let x0 = f.x, y0 = f.y, x1 = f.x + f.w, y1 = f.y + f.h;
    if (all || f.front === 'w') x0 -= o; if (all || f.front === 'e') x1 += o;
    if (all || f.front === 'n') y0 -= o; if (all || f.front === 's') y1 += o;
    box(x0, y0, z, x1, y1, z + 0.125, M.counter);
  }
  // a double sink set into the counter, faucet at the back
  function sinkIn(F, z, p0, p1, q0, q1) {
    const half = (q1 - q0) / 2;
    for (let i = 0; i < 2; i++) lbox(F, p0, q0 + i * half + 0.07, z, p1, q0 + (i + 1) * half - 0.07, z + 0.006, M.steel);
    const qm = (q0 + q1) / 2;
    lcyl(F, p0 - 0.12, qm, 0.05, 0.05, z, z + 0.6, M.chrome);
    lbox(F, p0 - 0.12, qm - 0.03, z + 0.55, p0 + 0.45, qm + 0.03, z + 0.62, M.chrome);
  }
  function basin(x, y, rx, ry, z) {
    cylinder(x, y, rx, ry, z, z + 0.012, M.porc);
    cylinder(x, y, rx * 0.78, ry * 0.78, z + 0.004, z + 0.016, M.reveal);
  }

  for (const f of H.fixtures) {
    if (f.st === 'removed') continue;
    const x0 = f.x, y0 = f.y, x1 = f.x + f.w, y1 = f.y + f.h;
    switch (f.k) {
      case 'box': {
        if (f.paint) {
          // z1: cabinet height (default 3' kitchen, 2'-9.6" bath); counter: false for tall units, 'all' to overhang every side
          const m = material(f.paint), zt = f.z1 ?? (f.c === 'cabW' ? 2.8 : 3.0), counter = f.counter ?? zt <= 4;
          pick(box(x0, y0, 0, x1, y1, zt, m), f.paint);
          cabinetFront(f, 0, zt, !!counter);
          if (counter) counterTop(f, zt);
          if (f.front && (f.sink || f.basin)) {
            const F = FX.frame(f), z = zt + 0.125;
            if (f.sink) { const w = Math.min(2.4, F.Q - 0.3), d = Math.min(1.4, F.P - 0.5); sinkIn(F, z, 0.3, 0.3 + d, (F.Q - w) / 2, (F.Q + w) / 2); }
            else { const [cx, cy] = F.pt(F.P / 2 + 0.05, F.Q / 2), rq = Math.min(0.78, F.Q / 2 - 0.2), rp = Math.min(0.55, F.P / 2 - 0.2); F.swap ? basin(cx, cy, rq, rp, z) : basin(cx, cy, rp, rq, z); }
          }
        } else if (f.c === 'app') {                                    // refrigerator
          const F = FX.frame(f);
          lbox(F, 0, 0, 0, F.P, F.Q, 5.9, M.appWhite);
          lbox(F, F.P, F.Q / 2 - 0.01, 0.4, F.P + 0.01, F.Q / 2 + 0.01, 5.8, M.black);
          for (const q of [F.Q / 2 - 0.2, F.Q / 2 + 0.2]) lbox(F, F.P, q - 0.025, 2.4, F.P + 0.07, q + 0.025, 4.6, M.steel);
        } else if (f.c === 'counter') {
          box(x0, y0, 2.5, x1, y1, 2.625, M.counter);
        }
        break;
      }
      case 'upper': pick(box(x0, y0, f.z0, x1, y1, f.z1, material(f.paint)), f.paint); cabinetFront(f, f.z0, f.z1, false); break;
      case 'splash': box(x0, y0, f.z0, x1, y1, f.z1, M.tile); break;
      case 'oval': basin(f.cx, f.cy, f.rx, f.ry, 2.8 + 0.125); break;
      case 'sink2': { const F = FX.frame(f); sinkIn(F, 3.125, 0, F.P, 0, F.Q); break; }
      case 'range': {                                                   // range with a microwave above, controls on the front
        const F = FX.frame(f);
        lbox(F, 0, 0, 0, F.P, F.Q, 3.0, M.steel); lbox(F, 0.05, 0.05, 3.0, F.P - 0.05, F.Q - 0.05, 3.025, M.black);
        lbox(F, F.P, 0.3, 1.0, F.P + 0.01, F.Q - 0.3, 2.4, M.black); lbox(F, F.P, 0.2, 2.5, F.P + 0.12, F.Q - 0.2, 2.56, M.steel);
        lbox(F, 0, 0, 4.9, 1.4, F.Q, 6.3, M.appWhite); lbox(F, 1.4, 0.2, 5.0, 1.41, F.Q - 0.9, 6.2, M.black);
        break;
      }
      case 'heater': cylinder(f.cx, f.cy, f.r * 0.85, f.r * 0.85, 0, 4.4, M.heater); break;
      case 'pumps': box(x0, y0, 0, x1, y1, 2.0, M.pump); break;
      case 'front': {                                                   // front-loading washer / dryer
        const F = FX.frame(f);
        lbox(F, 0, 0, 0, F.P, F.Q, 3.0, M.appWhite); lbox(F, 0.02, 0.1, 3.0, 0.4, F.Q - 0.1, 3.4, M.steel);
        lcyl(F, F.P + 0.01, F.Q / 2, 0.02, 0.55, 1.15, 2.25, M.black);
        break;
      }
      case 'shelf': {
        const z = f.label ? 5.9 : 5.0;
        box(x0, y0, z, x1, y1, z + 0.04, M.wire);
        box(x0 + f.w / 2 - 0.03, y0, z - 0.45, x0 + f.w / 2 + 0.03, y1, z - 0.39, M.black);
        break;
      }
      case 'toilet': {
        const r = { w: 0, n: 90, e: 180, s: 270 }[f.dir || 'w'] * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
        const tr = (dx, dy) => [f.cx + dx * cs - dy * sn, f.cy + dx * sn + dy * cs];
        const [tx, ty] = tr(0.65, 0), swap = Math.abs(sn) > 0.5;
        box(tx - (swap ? 0.55 : 0.3), ty - (swap ? 0.3 : 0.55), 1.0, tx + (swap ? 0.55 : 0.3), ty + (swap ? 0.3 : 0.55), 2.4, M.porc);
        const [bx, by] = tr(-0.1, 0);
        cylinder(bx, by, swap ? 0.52 : 0.75, swap ? 0.75 : 0.52, 0, 1.45, M.porc);
        break;
      }
      case 'tub': {
        const t = 0.28;
        box(x0, y0, 0, x1, y0 + t, 1.5, M.porc); box(x0, y1 - t, 0, x1, y1, 1.5, M.porc);
        box(x0, y0 + t, 0, x0 + t, y1 - t, 1.5, M.porc); box(x1 - t, y0 + t, 0, x1, y1 - t, 1.5, M.porc);
        box(x0 + t, y0 + t, 0, x1 - t, y1 - t, 0.35, M.porc);
        break;
      }
      case 'shower': {                                                  // the glass door is on the front
        const F = FX.frame(f);
        lbox(F, 0, 0, 0, F.P, F.Q, 0.2, M.porc);
        lcyl(F, F.P / 2, F.Q / 2, 0.12, 0.12, 0.2, 0.206, M.black);
        const gl = lbox(F, F.P, 0, 0.2, F.P + 0.02, F.Q, 6.5, M.glass); if (gl) gl.castShadow = false;
        lbox(F, F.P - 0.01, 0, 6.4, F.P + 0.03, F.Q, 6.5, M.chrome);
        break;
      }
      case 'barn': {                                                    // slides along a horizontal wall, on its front side
        const s = FX.facing(f) === 'n' ? -1 : 1, Y = (d0, d1) => s > 0 ? [f.y + d0, f.y + d1] : [f.y - d1, f.y - d0];
        const bx0 = f.x1 - 0.15, bx1 = f.x2 + 0.15, key = f.paint || 'barn', m = material(key), o = T_HALF + 0.14;
        const yb = (d0, d1, a, b, z0, z1, mm) => { const [ya, yb2] = Y(o + d0, o + d1); return box(a, ya, z0, b, yb2, z1, mm); };
        pick(yb(0, 0.1, bx0, bx1, 0.12, 7.1, m), key);
        for (const zz of [1.0, 6.0]) pick(yb(0.1, 0.12, bx0, bx1, zz, zz + 0.45, m), key);
        yb(-0.02, 0.05, bx0 - 0.1, bx0 + 2 * (bx1 - bx0) + 0.1, 7.3, 7.36, M.black);
        for (const hx of [bx0 + 0.3, bx1 - 0.3]) yb(0.02, 0.06, hx - 0.03, hx + 0.03, 7.0, 7.34, M.black);
        yb(0.12, 0.2, bx1 - 0.35, bx1 - 0.3, 3.0, 4.2, M.black);
        break;
      }
      case 'steps': {
        const t1 = y0 + f.h * 0.45, t2 = y0 + f.h * 0.72, gz = -2.0;
        box(x0, y0, gz, x1, t1, -0.25, M.deck); box(x0, t1, gz, x1, t2, -1.0, M.deck); box(x0, t2, gz, x1, y1, -1.7, M.deck);
        break;
      }
      case 'deck':
        box(x0, y0 + 0.9, -2.0, x1, y1, -0.25, M.deck); box(x0, y0, -2.0, x1, y0 + 0.9, -1.15, M.deck);
        break;
    }
  }

  // ---------------------------------------------------------------- floor, ceiling shell, outside
  const floorMesh = new T.Mesh(rectsGeometry(H.floorRects, 0, false), M.floor);
  floorMesh.receiveShadow = true;
  root.add(floorMesh);
  if (H.slants.length) H.floorRects.forEach(([x0, y0, x1, y1]) => box(x0 - 0.3, y0 - 0.3, -2.0, x1 + 0.3, y1 + 0.3, -0.02, M.skirt));
  else box(-0.05, -0.05, -2.0, H.W + 0.05, H.D + 0.05, -0.02, M.skirt);
  const ground = new T.Mesh(rectsGeometry([[-150, -150, H.W + 150, H.D + 150]], -2.0, false), M.ground);
  ground.receiveShadow = true; root.add(ground);

  // plank texture: drawn once from a photo crop of one plank (floor.texture), then tiled in world feet
  // img: a photo of one plank (grain running up the image), or a canvas drawn with the same orientation
  function floorFromImage(img, onReady) {
    {
      const PX = 256, plankW = H.floor.plankW, plankL = H.floor.plankL, rows = 14;
      const cw = Math.round(2 * plankL * PX), rh = Math.round(plankW * PX), ch = rh * rows;
      const rot = document.createElement('canvas'); rot.width = img.height; rot.height = img.width;
      const rc = rot.getContext('2d'); rc.translate(rot.width, 0); rc.rotate(Math.PI / 2); rc.drawImage(img, 0, 0);
      const c = document.createElement('canvas'); c.width = cw; c.height = ch;
      const ctx = c.getContext('2d');
      let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const pl = plankL * PX;
      for (let r = 0; r < rows; r++) {
        const off = Math.floor(rnd() * 3) * pl / 3 + rnd() * 40;
        for (let x = off - pl; x < cw; x += pl) {
          const sw = Math.round(rot.width * (0.5 + rnd() * 0.25)), sx = Math.floor(rnd() * (rot.width - sw));
          ctx.save();
          if (rnd() > 0.5) { ctx.translate(2 * x + pl, 0); ctx.scale(-1, 1); }
          ctx.drawImage(rot, sx, 0, sw, rot.height, x, r * rh, pl, rh);
          ctx.restore();
          ctx.fillStyle = rnd() > 0.5 ? `rgba(255,248,235,${rnd() * 0.07})` : `rgba(60,40,20,${rnd() * 0.07})`;
          ctx.fillRect(x, r * rh, pl, rh);
          ctx.fillStyle = 'rgba(70,52,34,0.55)';
          ctx.fillRect(x, r * rh, 2, rh);
          if (x + pl > cw) ctx.fillRect(x + pl - cw, r * rh, 2, rh);
        }
        ctx.fillStyle = 'rgba(70,52,34,0.5)';
        ctx.fillRect(0, r * rh, cw, 2);
      }
      const tex = new T.CanvasTexture(c);
      tex.wrapS = tex.wrapT = T.RepeatWrapping;
      tex.repeat.set(1 / (2 * plankL), 1 / (rows * plankW));
      tex.encoding = T.sRGBEncoding;
      tex.anisotropy = 8;
      M.floor.map = tex; M.floor.color.set(0xffffff); M.floor.needsUpdate = true;
      onReady && onReady();
    }
  }
  function loadFloorTexture(url, onReady) { const img = new Image(); img.onload = () => floorFromImage(img, onReady); img.src = url; }
  // the house's own floor: a wood species (drawn like the cabinet veneers), a photo (path or data URL), or nothing (plain colour)
  function loadFloor(onReady) {
    const fl = H.floor;
    if (fl.wood && WOODS[fl.wood]) { const cache = (window.__woodFloorCanvas ||= {}); floorFromImage(cache[fl.wood] ||= woodCanvas(WOODS[fl.wood], 384, 768), onReady); }
    else if (fl.texture) loadFloorTexture(fl.texture, onReady);
  }

  // ---------------------------------------------------------------- picking + camera helpers
  function keyAt(hit) {
    const ud = hit.object.userData;
    if (ud.keys) return ud.keys[hit.face.materialIndex] || null;
    return ud.key || null;
  }
  // where to stand to look at one wall surface: in front of it, inside its room
  function surfaceView(s) {
    const [[x0, y0], [x1, y1]] = s.seg, [nx, ny] = s.normal;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, len = Math.hypot(x1 - x0, y1 - y0);
    let free = 0.3;
    if (s.room !== 'exterior') while (free < 30 && R.roomAt(mx + nx * (free + 0.3), my + ny * (free + 0.3)) === s.room) free += 0.25;
    else free = 30;
    const want = (Math.max(len, 6) / 2 + 1) / Math.tan(30 * Math.PI / 180);
    const dist = Math.max(1.5, Math.min(want, free - 0.6));
    const ez = s.room === 'exterior' ? 3.5 : 5.0;
    return { eye: new T.Vector3(mx + nx * dist, ez, my + ny * dist), target: new T.Vector3(mx, s.room === 'exterior' ? 2.5 : 4.0, my), dist };
  }

  return {
    root, ceilings, pickables, material, setPaint, defaultHex, keyAt, roomInfo, surfaceView, loadFloorTexture, loadFloor, SHEEN, cabParts, WOODS, woodSwatch,
    center: new T.Vector3(H.W / 2, 0, H.D / 2)
  };
}
  window.House3DBuild = build;
  if (window.HOUSE && window.ROOMS) window.House3D = build(window.HOUSE, window.ROOMS);
})();
