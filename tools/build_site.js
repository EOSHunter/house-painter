// Assembles the static site (what GitHub Pages serves) into _site/:  node tools/build_site.js
// Only what the pages need: the HTML and scripts, the example houses, textures and the two pictures on the landing page.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, '_site');

const files = [
  'index.html', 'paint.html', 'editor.html', 'floorplan.html',
  'house-core.js', 'house-loader.js', 'storage.js', 'fixtures.js', 'tracer.js', 'dimensions.js', 'house3d.js', 'paint-app.js', 'paint-colors.js', 'floorplan.js', 'editor.js',
  'renders/cozy-deco-emerald-brass/doll.png', 'renders/cozy-deco-emerald-brass/export.png'
];
const dirs = ['houses', 'textures'];
const skip = name => name === 'schemes-original' || name.endsWith('.blend') || name.endsWith('.blend1');

function copy(from, to) {
  const st = fs.statSync(from);
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const n of fs.readdirSync(from)) if (!skip(n)) copy(path.join(from, n), path.join(to, n));
  } else { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
}

fs.rmSync(OUT, { recursive: true, force: true });
for (const f of files) {
  if (!fs.existsSync(path.join(ROOT, f))) throw new Error('missing ' + f);
  copy(path.join(ROOT, f), path.join(OUT, f));
}
for (const d of dirs) copy(path.join(ROOT, d), path.join(OUT, d));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');                  // serve files as they are
let n = 0, bytes = 0;
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { n++; bytes += fs.statSync(p).size; } } })(OUT);
console.log(`_site: ${n} files, ${(bytes / 1048576).toFixed(1)} MB`);
