// American spelling: the word "colour" (any case: colours, coloured, colouring, colourful, Colour) must not appear in a page, a visible string, a comment or the docs.
// Code and data names keep whatever they have: renaming them would break saved schemes and shared links. Those few, if any, are listed in ALLOW below, by file and line.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['vendor', 'dist', 'node_modules', '.git', '.claude', 'textures', 'renders', 'fonts']);
const SKIP_FILES = new Set(['spelling.test.js', 'paint-colors-extra.js']);       // this file names the word; the extra book is built locally from a paint maker's data and never committed

// file -> line patterns that may keep the word, because the line holds a code name (an identifier), not English
const ALLOW = {
  'paint-app.js': [
    /function paint\(keys, colour, sheen\)/,                 // the parameter of paint()
    /if \(colour\) A\[k\] = \{ b: colour\.b/,
    /else if \(!colour && !sheen\) delete A\[k\]/,
    /PARTS_OF\[k\] && \(colour \|\| !sheen\)/,
    /\bcolourLine\b/,                                        // a local variable
    /\busedColours\(\)/,                                     // a function
  ],
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out); }
    else if (!SKIP_FILES.has(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}
function hits(file, text) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/'), allow = ALLOW[rel] || [], found = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (/colour/i.test(line) && !allow.some(re => re.test(line))) found.push(`${rel}:${i + 1}  ${line.trim().slice(0, 120)}`);
  });
  return found;
}
const textFiles = walk(ROOT).filter(f => { const b = fs.readFileSync(f); return b.length < 2 * 1024 * 1024 && !b.includes(0); });

test('the scan covers the pages, the scripts, the stylesheets, the docs and the Blender add-on', () => {
  const rel = textFiles.map(f => path.relative(ROOT, f).split(path.sep).join('/'));
  for (const must of ['index.html', 'paint.html', 'editor.html', 'floorplan.html', '404.html', 'paint-app.js', 'editor.js', 'ui/base.css', 'README.md', 'docs/DEPLOY.md', 'docs/DESIGN.md', 'blender_addon/house_painter/__init__.py', 'package.json'])
    assert.ok(rel.includes(must), must + ' is not scanned');
  assert.ok(rel.some(f => /^docs\/.*\.md$/.test(f)) && rel.length > 60);
});

test('the scanner finds the word in any spelling', () => {
  for (const s of ['Pick a colour', 'COLOURS', 'recoloured', 'colourful', 'Colouring']) assert.equal(hits(path.join(ROOT, 'x.html'), s).length, 1, s);
  assert.equal(hits(path.join(ROOT, 'x.html'), 'Pick a color').length, 0);
});

test('"colour" appears nowhere (pages, strings, comments, docs, tests), except the listed code names', () => {
  const found = textFiles.flatMap(f => hits(f, fs.readFileSync(f, 'utf8')));
  assert.deepStrictEqual(found, [], 'use "color": file names, identifiers, keys and formats keep their names (add those to ALLOW in tests/spelling.test.js)');
});

test('the allow-list holds only lines that are still there', () => {
  for (const [file, res] of Object.entries(ALLOW)) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const re of res) assert.ok(text.split(/\r?\n/).some(l => re.test(l)), `${file}: ${re} no longer matches a line; remove it`);
  }
});
