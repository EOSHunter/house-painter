// Rewrites schemes so every colour that came from an extra colour book (Sherwin-Williams, Behr, ...) becomes the nearest
// colour of the House Painter palette, by CIEDE2000. Custom colours and woods are left alone.
//   node data/remap_schemes.js <file or folder> ...        (scheme files, or exports from "Export for Blender")
// Before a file is changed, a copy is kept in a schemes-original/ folder beside it (git-ignored).
const fs = require('fs'), path = require('path');
const { byId } = require('./colors.js');
const { lab, de2000 } = require('./color-math.js');

const hp = byId.hp.colors.map(c => ({ c, lab: lab(c[2]) }));
const cache = new Map();
const nearest = hex => {
  if (!cache.has(hex)) { const t = lab(hex); cache.set(hex, hp.map(x => [x, de2000(t, x.lab)]).sort((a, b) => a[1] - b[1])[0]); }
  return cache.get(hex);
};
const stats = { mapped: 0, kept: 0, worst: 0, worstName: '' };
function remap(col, label) {                                       // col: { b, c, n, h, ... }
  if (!col || col.b === 'hp' || col.b === 'wood' || col.b === 'custom' || !/^#[0-9A-Fa-f]{6}$/.test(col.h || '')) { stats.kept++; return col; }
  const [x, d] = nearest(col.h.toUpperCase());
  stats.mapped++; if (d > stats.worst) { stats.worst = d; stats.worstName = `${col.n} -> ${x.c[1]} (${label})`; }
  return { ...col, b: 'hp', c: x.c[0], n: x.c[1], h: x.c[2] };
}

function remapFile(file) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  let touched = false;
  const isExport = doc.format === 'house-painter/scheme';
  const a = isExport ? doc.assignments : doc.a;
  for (const k of Object.keys(a || {})) { const r = remap(a[k], k); if (r !== a[k]) { a[k] = r; touched = true; } }
  if (isExport) for (const k of Object.keys(doc.resolved || {})) {
    const v = doc.resolved[k];
    if (v.brand && !['hp', 'wood', 'custom', 'primer'].includes(v.brand) && /^#/.test(v.hex || '')) {
      const [x] = nearest(v.hex.toUpperCase()); Object.assign(v, { hex: x.c[2], brand: 'hp', code: x.c[0], name: x.c[1] }); touched = true;
    }
  }
  if (!touched) { console.log('unchanged', file); return; }
  const keep = path.join(path.dirname(file), 'schemes-original');
  fs.mkdirSync(keep, { recursive: true });
  const dest = path.join(keep, path.basename(file));
  if (!fs.existsSync(dest)) fs.copyFileSync(file, dest);
  fs.writeFileSync(file, isExport ? JSON.stringify(doc, null, 1) : JSON.stringify(doc));
  console.log('remapped ', file);
}

const targets = process.argv.slice(2);
if (!targets.length) { console.error('usage: node data/remap_schemes.js <file or folder> ...'); process.exit(1); }
for (const t of targets) {
  if (fs.statSync(t).isDirectory()) fs.readdirSync(t).filter(f => f.endsWith('.json')).forEach(f => remapFile(path.join(t, f)));
  else remapFile(t);
}
console.log(`${stats.mapped} colours mapped, ${stats.kept} left alone; the biggest shift was ${stats.worst.toFixed(1)} dE (${stats.worstName}).`);
