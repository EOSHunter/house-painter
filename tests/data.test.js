// The palette, the shipped schemes and the example export, and that every page can find the files it loads.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const HouseCore = require('../house-core.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const readJSON = f => JSON.parse(read(f));

// evaluate paint-colors.js the way a page would (no extra books: those are never committed)
const win = {}; new Function('window', read('paint-colors.js'))(win);
const books = win.PAINT_COLORS.books, hp = books.find(b => b.id === 'hp');

test('the shipped palette is the House Painter palette and nothing else', () => {
  assert.equal(books.length, 1);
  assert.ok(hp && hp.colors.length >= 100, 'palette size ' + (hp && hp.colors.length));
});

test('palette codes and names are unique and every colour is a valid hex', () => {
  const codes = new Set(), names = new Set();
  for (const [code, name, hex] of hp.colors) {
    assert.match(code, /^HP \d+$/); assert.match(hex, /^#[0-9A-F]{6}$/, name);
    assert.ok(!codes.has(code) && !names.has(name), 'duplicate ' + code + ' ' + name);
    codes.add(code); names.add(name);
  }
  for (const c of hp.popular) assert.ok(codes.has(c), 'quick pick ' + c + ' is not in the palette');
});

test('every House Painter colour used in a scheme exists in the palette with the same name and hex', () => {
  const byCode = Object.fromEntries(hp.colors.map(c => [c[0], c]));
  const files = ['examples/house-cozy-deco-emerald-brass.json'];
  for (const h of fs.readdirSync(path.join(ROOT, 'houses'))) {
    const d = path.join('houses', h, 'schemes');
    if (fs.existsSync(path.join(ROOT, d))) fs.readdirSync(path.join(ROOT, d)).filter(f => f.endsWith('.json')).forEach(f => files.push(path.join(d, f)));
  }
  assert.ok(files.length >= 8, files.length + ' scheme files');
  for (const f of files) {
    const doc = readJSON(f), a = doc.assignments || doc.a;
    for (const [key, v] of Object.entries(a)) {
      assert.ok(['hp', 'wood', 'custom'].includes(v.b), `${f} ${key}: colour book "${v.b}" is not shipped (run data/remap_schemes.js)`);
      if (v.b === 'hp') { const c = byCode[v.c]; assert.ok(c, `${f} ${key}: ${v.c} missing`); assert.equal(v.h, c[2], `${f} ${key} hex`); assert.equal(v.n, c[1], `${f} ${key} name`); }
    }
  }
});

test('every key in a shipped scheme is a real paint target of that house', () => {
  for (const h of fs.readdirSync(path.join(ROOT, 'houses'))) {
    const dir = path.join(ROOT, 'houses', h, 'schemes');
    if (!fs.existsSync(dir)) continue;
    const { HOUSE, ROOMS } = HouseCore.build(readJSON(path.join('houses', h, 'house.json')));
    const keys = new Set([...ROOMS.surfaces.map(s => s.id), ...ROOMS.rooms.map(r => 'C:' + r.id), ...HOUSE.items.map(i => i.key), 'trim', 'doors', 'extdoors', 'exttrim']);
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
      for (const k of Object.keys(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).a)) {
        const part = /^(\w+):(door|drawer)\d+$/.exec(k);
        assert.ok(keys.has(k) || (part && keys.has(part[1])), `${h}/${f}: "${k}" is not a paint target`);
      }
    }
  }
});

test('the example export carries a house that builds, and a resolved colour for every surface', () => {
  const ex = readJSON('examples/house-cozy-deco-emerald-brass.json');
  assert.equal(ex.format, 'house-painter/scheme'); assert.equal(ex.house.format, 'house-painter/built-house');
  for (const s of ex.house.surfaces) assert.ok(ex.resolved[s.id], 'no resolved colour for ' + s.id);
  assert.ok(ex.view.camera.position.length === 3);
});

test('floor textures named by a house exist', () => {
  for (const h of fs.readdirSync(path.join(ROOT, 'houses'))) {
    const f = readJSON(path.join('houses', h, 'house.json')).floor || {};
    if (f.texture && !f.texture.startsWith('data:')) assert.ok(fs.existsSync(path.join(ROOT, f.texture)), f.texture);
  }
});

test('every page finds the scripts it loads', () => {
  for (const page of fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))) {
    const html = read(page), refs = [];
    for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) refs.push(m[1]);
    for (const m of html.matchAll(/data-then="([^"]+)"/g)) refs.push(...m[1].split(/\s+/));
    for (const m of html.matchAll(/data-default="([^"]+)"/g)) refs.push(m[1]);
    for (const ref of refs) {
      if (/^https?:/.test(ref)) continue;
      if (ref.endsWith('?')) continue;                              // optional on purpose (extra colour books)
      assert.ok(fs.existsSync(path.join(ROOT, ref)), `${page} loads ${ref}, which is missing`);
    }
  }
});

test('page scripts are plain ASCII so they read the same under any charset', () => {
  for (const f of ['house-core.js', 'house-loader.js', 'storage.js', 'fixtures.js', 'house3d.js', 'paint-app.js', 'paint-colors.js', 'floorplan.js', 'editor.js', 'tracer.js']) {
    const bad = read(f).match(/[^\x00-\x7f]/);
    assert.ok(!bad, `${f} has a non-ASCII character (${bad && bad[0]}): run node data/ascii_js.js`);
  }
});
