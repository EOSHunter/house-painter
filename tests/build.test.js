// The production build (tools/build.js -> dist/) is what gets deployed, so its guarantees are tested: it succeeds, nothing in it points at a
// file that isn't there, no page script comes from a CDN, nothing is over Cloudflare Pages' 25 MiB limit, only what the app needs is in it,
// and the headers allow embedding on r7orbit.io only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..'), DIST = path.join(ROOT, 'dist');
const run = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build.js')], { encoding: 'utf8' });
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(path.relative(DIST, p).split(path.sep).join('/')); } })(fs.existsSync(DIST) ? DIST : ROOT);
const read = f => fs.readFileSync(path.join(DIST, f), 'utf8');
const pages = () => files.filter(f => /^[^/]+\.html$/.test(f) && f !== '404.html');

test('the build succeeds', () => assert.equal(run.status, 0, run.stderr + run.stdout));

test('every page, script and stylesheet it names is in dist (spelled exactly)', () => {
  for (const page of pages()) {
    const html = read(page), refs = [];
    for (const m of html.matchAll(/<(?:script|img)\b[^>]*\ssrc="([^"]+)"/g)) refs.push(m[1]);
    for (const m of html.matchAll(/<link\b[^>]*\srel="(?:stylesheet|icon)"[^>]*\shref="([^"]+)"/g)) refs.push(m[1]);
    for (const m of html.matchAll(/\sdata-then="([^"]+)"/g)) refs.push(...m[1].split(/\s+/).map(t => t.replace(/\?$/, '')));
    for (const m of html.matchAll(/\sdata-default="([^"]+)"/g)) refs.push(m[1]);
    assert.ok(refs.length > 0, page + ' names no scripts');
    for (const ref of refs) {
      if (/^https?:/.test(ref)) continue;                        // Google Fonts, until the restyle self-hosts them (the build warns)
      assert.ok(!ref.startsWith('/') && !ref.startsWith('..'), `${page}: ${ref} should be relative to the page`);
      assert.ok(files.includes(ref), `${page} names ${ref}, which is not in dist`);
    }
  }
});

test('no page loads a script from another host', () => {
  for (const page of pages()) assert.ok(!/<script\b[^>]*\ssrc="https?:/.test(read(page)), page);
  for (const f of files.filter(f => /^assets\/.*\.js$/.test(f))) assert.ok(!/https?:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com)/.test(read(f).replace(/(^|\s)\/\/.*$/gm, '$1')), f + ' asks a CDN for code');
});

test('app files are content-hashed, libraries sit in versioned folders', () => {
  const html = read('paint.html');
  assert.match(html, /src="assets\/paint-app\.[0-9a-f]{10}\.js"|assets\/paint-app\.[0-9a-f]{10}\.js/);
  assert.match(html, /src="vendor\/three-r128\/three\.min\.js"/);
  assert.ok(files.some(f => /^vendor\/pdfjs-[\d.]+\/pdf\.worker\.min\.js$/.test(f)));
});

test('nothing is over 25 MiB, and the bundle holds only what the app needs', () => {
  for (const f of files) assert.ok(fs.statSync(path.join(DIST, f)).size <= 25 * 1024 * 1024, f + ' is over 25 MiB');
  for (const f of files) assert.ok(!/^(blender_addon|docs|tests|tools|data|examples|\.git|\.github|node_modules)\//.test(f) && !/\.(blend1?|py|md)$/.test(f) && !/(^|\/)schemes\//.test(f), 'should not ship: ' + f);
  assert.ok(!files.includes('paint-colors-extra.js') && !files.some(f => /paint-colors-extra/.test(f)), 'a locally built paint maker colour book must never be published');
  assert.ok(files.includes('404.html') && files.includes('_headers') && files.includes('index.html'));
  assert.ok(files.includes('houses/waterford-4563c/house.json') && files.includes('textures/desert_sand_plank.png'));
});

test('the headers allow embedding on r7orbit.io only, and cache hashed files forever and pages never', () => {
  const h = read('_headers');
  assert.ok(h.includes("Content-Security-Policy: frame-ancestors 'self' https://r7orbit.io https://www.r7orbit.io"));
  assert.ok(!/x-frame-options/i.test(h.replace(/^\s*#.*$/gm, '')));
  assert.match(h, /nosniff/); assert.match(h, /Referrer-Policy/);
  assert.match(h, /\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/);
  assert.match(h, /\/paint\.html\n\s+Cache-Control: no-cache/);
  assert.ok(!/^\/\*\n(?:\s+.*\n)*?\s+Cache-Control/m.test(h), 'Cache-Control must not be on /*: Cloudflare merges matching rules');
});

test('the 404 page names no other file (it is served at any depth)', () => {
  const html = read('404.html');
  assert.ok(!/<script|<link\b[^>]*stylesheet|<img/i.test(html));
  assert.ok(!/href="(?!\/|https?:|#)/.test(html), 'links in 404.html must start at the site root');
});
