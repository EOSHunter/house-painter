// Rewrites non-ASCII characters in the page's scripts as \uXXXX escapes, so they read the same whatever charset they're served with.
const fs = require('fs');
const BS = String.fromCharCode(92);
for (const f of ['house-core.js', 'house-loader.js', 'storage.js', 'house3d.js', 'paint-app.js', 'paint-colors.js', 'floorplan.js', 'editor.js', 'fixtures.js', 'tracer.js', 'dimensions.js']) {
  const s = fs.readFileSync(__dirname + '/../' + f, 'utf8');
  const out = s.replace(/[^\x00-\x7f]/g, ch => BS + 'u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
  if (out !== s) { fs.writeFileSync(__dirname + '/../' + f, out); console.log('escaped', f, (s.match(/[^\x00-\x7f]/g) || []).length); }
}
