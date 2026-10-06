// Production build:  npm run build   (node tools/build.js)  ->  dist/
// Node built-ins only. Writes a clean static bundle for Cloudflare Pages (any static host works):
//   - the HTML pages, with every local script / stylesheet / image / font reference rewritten to a content-hashed file in assets/
//   - vendor/<lib>-<version>/ : the third-party libraries, copied as they are (the version is in the path, so they never change in place)
//   - houses/ and textures/ : data the pages fetch by name (no schemes/: nothing loads them)
//   - _headers, 404.html
// ui/ (css, fonts/, img/) ships because the pages and the CSS name it: every href, src and url() is followed and emitted as assets/<name>.<hash>.<ext>.
// It fails the build when: a file is over 25 MiB (Cloudflare Pages' limit), a reference does not resolve (checked case-sensitively, so a
// Windows checkout can't hide a bug that Linux would show), a vendored file differs from vendor/SHA256SUMS, a page script asks for a CDN, or a page or stylesheet loads anything from another host (Google Fonts included).
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'dist');
const MAX_FILE = 25 * 1024 * 1024;                       // Cloudflare Pages: 25 MiB per file
const MAX_FILES = 20000;                                 // Cloudflare Pages: 20,000 files per deployment
const CDN = /https?:\/\/(?:cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|esm\.sh|ajax\.googleapis\.com|code\.jquery\.com)/;
const FONT_HOSTS = /https?:\/\/fonts\.(?:googleapis|gstatic)\.com/;
const STATIC_DIRS = ['houses', 'textures'];
const skipName = n => /^schemes(-original)?$/.test(n) || /\.(blend1?|md)$/.test(n);   // schemes/ are files to open by hand: no page loads them
const NOT_SHIPPED_JS = new Set(['paint-colors-extra.js']);                              // built from a paint maker's data on one machine: never published

const errors = [], warnings = [];
const fail = m => errors.push(m), warn = m => warnings.push(m);
const posix = p => p.split(path.sep).join('/');
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

// the file exists AND every path segment has exactly this spelling (Windows and macOS would accept a wrong case)
function existsExact(abs) {
  const rel = path.relative(ROOT, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  let cur = ROOT;
  for (const seg of rel.split(path.sep)) {
    if (!fs.existsSync(cur) || !fs.readdirSync(cur).includes(seg)) return false;
    cur = path.join(cur, seg);
  }
  return true;
}
const isLocal = u => u && !/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u);          // not http:, data:, mailto:, //host, #anchor
const splitRef = u => { const m = /^([^?#]*)([?#].*)?$/.exec(u); return [m[1], m[2] || '']; };

// ------------------------------------------------------------------ vendored libraries
function checkVendor() {
  const sums = path.join(ROOT, 'vendor', 'SHA256SUMS');
  if (!fs.existsSync(sums)) return fail('vendor/SHA256SUMS is missing');
  const listed = new Set();
  for (const line of fs.readFileSync(sums, 'utf8').split(/\r?\n/).filter(Boolean)) {
    const m = /^([0-9a-f]{64})\s+(\S.*)$/.exec(line);
    if (!m) { fail('vendor/SHA256SUMS: cannot read the line ' + line); continue; }
    const file = path.join(ROOT, 'vendor', m[2]);
    listed.add(m[2]);
    if (!existsExact(file)) fail(`vendor/${m[2]} is listed in SHA256SUMS but missing`);
    else if (sha(fs.readFileSync(file)) !== m[1]) fail(`vendor/${m[2]} does not match vendor/SHA256SUMS (edited, or its line endings were converted?)`);
  }
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name), rel = posix(path.relative(path.join(ROOT, 'vendor'), p));
      if (e.isDirectory()) walk(p);
      else if (!listed.has(rel) && !/^LICENSE|^README\.md$|^SHA256SUMS$/.test(e.name)) fail(`vendor/${rel} is not in vendor/SHA256SUMS`);
    }
  })(path.join(ROOT, 'vendor'));
}

// ------------------------------------------------------------------ the output
const written = new Map();                                                    // dist-relative path -> bytes
function put(rel, buf) {
  const to = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, buf);
  written.set(rel, buf.length);
}

// Emit a source file as dist/assets/<name>.<hash>.<ext> (or, under vendor/, at its own versioned path). Returns the dist path.
// CSS is scanned first: what it points at (fonts, images) is emitted before it, so its hash covers the rewritten text.
const emitted = new Map(), inProgress = new Set();
function emit(abs, why) {
  if (emitted.has(abs)) return emitted.get(abs);
  if (!existsExact(abs)) { fail(`${why}: ${posix(path.relative(ROOT, abs))} does not exist (check the spelling and capital letters)`); return null; }
  const relSrc = posix(path.relative(ROOT, abs));
  if (NOT_SHIPPED_JS.has(path.basename(abs))) return null;
  let out;
  if (relSrc.startsWith('vendor/')) {
    put(relSrc, fs.readFileSync(abs));
    out = relSrc;
  } else {
    if (inProgress.has(abs)) { fail(`${relSrc} refers back to itself`); return null; }
    inProgress.add(abs);
    let buf = fs.readFileSync(abs);
    const ext = path.extname(abs);
    if (ext === '.css') buf = Buffer.from(rewriteCss(buf.toString('utf8'), abs, relSrc), 'utf8');
    inProgress.delete(abs);
    out = `assets/${path.basename(abs, ext)}.${sha(buf).slice(0, 10)}${ext}`;
    put(out, buf);
  }
  emitted.set(abs, out);
  return out;
}

// a url, as written in a file at `fromDir` in dist, for the dist path `to`
const refFrom = (fromDirDist, to) => posix(path.posix.relative(fromDirDist || '.', to)) || to;

function rewriteCss(css, abs, why) {
  const dir = path.dirname(abs);
  const one = (u, hint) => {
    if (!isLocal(u)) { if (FONT_HOSTS.test(u)) fail(`${why}: loads ${u.slice(0, 60)}... (Google Fonts): the fonts are self-hosted in ui/fonts, so the page makes no third-party request`); else if (/^(https?:)?\/\//i.test(u)) fail(`${why}: loads ${u.slice(0, 60)} from another host`); return u; }
    const [file, tail] = splitRef(u), out = emit(path.resolve(dir, file), why + ' ' + hint);
    return out ? refFrom('assets', out) + tail : u;
  };
  return css
    .replace(/url\(\s*(['"]?)([^'")]+?)\1\s*\)/g, (m, q, u) => `url(${q}${one(u.trim(), 'url()')}${q})`)
    .replace(/@import\s+(['"])([^'"]+)\1/g, (m, q, u) => `@import ${q}${one(u, '@import')}${q}`);
}

// ------------------------------------------------------------------ HTML pages
function buildPage(name) {
  const abs = path.join(ROOT, name);
  let html = fs.readFileSync(abs, 'utf8');
  const startup = new Set();                                                  // dist files this page pulls in as it opens
  const rewrite = (u, hint, optional) => {
    if (!isLocal(u)) return u;
    const [file, tail] = splitRef(u), target = path.resolve(path.dirname(abs), file);
    if (optional && (!existsExact(target) || NOT_SHIPPED_JS.has(path.basename(target)))) return null;   // an optional script that isn't there: leave it out
    const out = emit(target, `${name} ${hint}`);
    if (!out) return u;
    startup.add(out);
    return out + tail;
  };

  // comments hold example markup sometimes: leave them alone
  const parts = html.split(/(<!--[\s\S]*?-->)/);
  html = parts.map((part, i) => {
    if (i % 2) return part;
    part = part.replace(/<(script|link|img|source|video|audio)\b[^>]*>/gi, tag => {
      const tn = /^<(\w+)/.exec(tag)[1].toLowerCase();
      const rel = (/\srel=["']([^"']*)["']/i.exec(tag) || [])[1] || '';
      return tag.replace(/(\s)(src|href|data-then)=(["'])([^"']*)\3/gi, (m, sp, attr, q, val) => {
        attr = attr.toLowerCase();
        if (attr === 'href' && (tn !== 'link' || /preconnect|dns-prefetch|canonical|alternate|author/i.test(rel))) return m;
        if (attr === 'src' && tn === 'link') return m;
        if (attr === 'data-then') {                                           // house-loader.js: scripts to load in order; "name?" is optional
          const toks = val.split(/\s+/).filter(Boolean).map(t => {
            const optional = t.endsWith('?'), r = rewrite(optional ? t.slice(0, -1) : t, 'data-then', optional);
            return r === null ? null : r + (optional ? '?' : '');
          }).filter(t => t !== null);
          return `${sp}${attr}=${q}${toks.join(' ')}${q}`;
        }
        if (tn === 'link' && !/stylesheet|icon|manifest|preload|modulepreload|prefetch|mask-icon/i.test(rel)) return m;
        return `${sp}${attr}=${q}${rewrite(val, `<${tn} ${attr}>`)}${q}`;
      });
    });
    return part;
  }).join('');

  // inline <style> blocks and style="" attributes can name files too
  html = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, a, css, z) => a + rewriteCssInline(css, abs, name, startup) + z);

  // pages have no business requesting a script from a CDN, or fonts from Google (they are self-hosted in ui/fonts)
  for (const m of html.matchAll(/<script\b[^>]*\ssrc=["'](https?:[^"']+)["']/gi)) fail(`${name}: loads a script from ${m[1]}; vendor it under vendor/ instead`);
  let fonts = false;
  for (const m of html.matchAll(/<link\b[^>]*\shref=["'](https?:[^"']+)["'][^>]*>/gi)) {
    if (/preconnect|stylesheet|preload/i.test(m[0]) && FONT_HOSTS.test(m[1])) fonts = true;
    else if (/stylesheet|preload|modulepreload/i.test(m[0])) fail(`${name}: loads ${m[1]} from another host`);
  }
  if (fonts) fail(`${name}: loads Google Fonts: use the self-hosted fonts in ui/fonts so the page makes no third-party request`);
  for (const m of html.matchAll(/\sdata-default=["']([^"']+)["']/g)) if (!existsExact(path.resolve(path.dirname(abs), splitRef(m[1])[0]))) fail(`${name}: data-default ${m[1]} does not exist`);
  put(name, Buffer.from(html, 'utf8'));
  return startup;
}
function rewriteCssInline(css, abs, name, startup) {
  return css.replace(/url\(\s*(['"]?)([^'")]+?)\1\s*\)/g, (m, q, u) => {
    u = u.trim();
    if (!isLocal(u)) { if (FONT_HOSTS.test(u)) fail(`${name}: <style> loads ${u.slice(0, 50)}... (Google Fonts)`); else if (/^(https?:)?\/\//i.test(u)) fail(`${name}: <style> loads ${u.slice(0, 60)} from another host`); return m; }
    const [file, tail] = splitRef(u), out = emit(path.resolve(path.dirname(abs), file), `${name} <style> url()`);
    if (!out) return m;
    startup.add(out);
    return `url(${q}${out}${tail}${q})`;
  });
}

// ------------------------------------------------------------------ static data
function copyDir(from, to) {
  fs.mkdirSync(path.join(OUT, to), { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (skipName(e.name)) continue;
    const src = path.join(from, e.name), dst = posix(path.join(to, e.name));
    if (e.isDirectory()) copyDir(src, dst); else put(dst, fs.readFileSync(src));
  }
}

// ------------------------------------------------------------------ checks on what the page scripts ask for by name
function checkScriptRefs(files) {
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (CDN.test(text.replace(/(^|\s)\/\/.*$|\/\*[\s\S]*?\*\//gm, '$1'))) fail(`${f} requests a script from a CDN: vendor it under vendor/ instead`);
    for (const m of text.matchAll(/VENDOR\('([^']+)'\)/g)) {
      const p = path.join(ROOT, 'vendor', m[1]);
      if (!existsExact(p)) fail(`${f}: VENDOR('${m[1]}') does not exist under vendor/`);
    }
    for (const m of text.matchAll(/['"`]((?:textures|houses|renders|vendor)\/[^'"`$\s]*)['"`]/g)) {      // 'textures/desert_sand_plank.png', 'houses/'
      const p = path.join(ROOT, m[1].replace(/^tex:/, ''));
      if (!existsExact(p)) fail(`${f}: refers to ${m[1]}, which does not exist`);
    }
  }
}

// ------------------------------------------------------------------ _headers
function checkHeaders(pages) {
  const file = path.join(ROOT, '_headers');
  if (!fs.existsSync(file)) return fail('_headers is missing');
  const text = fs.readFileSync(file, 'utf8');
  if (/x-frame-options/i.test(text.replace(/^\s*#.*$/gm, ''))) fail('_headers sets X-Frame-Options, which would stop the site being embedded; use frame-ancestors only');
  if (!/frame-ancestors\s+'self'\s+https:\/\/r7orbit\.io\s+https:\/\/www\.r7orbit\.io/.test(text)) fail("_headers: Content-Security-Policy must contain frame-ancestors 'self' https://r7orbit.io https://www.r7orbit.io");
  for (const p of pages) {
    const urls = p === 'index.html' ? ['/', '/index.html'] : ['/' + p, '/' + p.replace(/\.html$/, '')];
    for (const u of urls) if (!new RegExp('^' + u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'm').test(text)) fail(`_headers: no no-cache rule for ${u}`);
  }
  for (const rule of ['/assets/*', '/vendor/*']) if (!text.includes(rule)) fail(`_headers: no immutable caching rule for ${rule}`);
  put('_headers', Buffer.from(text, 'utf8'));
}

// ------------------------------------------------------------------ run
const t0 = Date.now();
fs.rmSync(OUT, { recursive: true, force: true });
checkVendor();

const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html') && f !== '404.html').sort();
if (!pages.includes('index.html')) fail('index.html is missing');
const startupOf = {};
for (const p of pages) startupOf[p] = buildPage(p);
if (!fs.existsSync(path.join(ROOT, '404.html'))) fail('404.html is missing'); else put('404.html', fs.readFileSync(path.join(ROOT, '404.html')));
for (const d of STATIC_DIRS) copyDir(path.join(ROOT, d), d);
if (fs.existsSync(path.join(ROOT, 'vendor'))) {                              // every vendored file ships: some load lazily (PDF, OCR, the wall-finding model)
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name !== 'SHA256SUMS' && e.name !== 'README.md') emit(p, 'vendor'); } })(path.join(ROOT, 'vendor'));
}
checkScriptRefs(fs.readdirSync(ROOT).filter(f => f.endsWith('.js')));
checkHeaders(pages);
put('.nojekyll', Buffer.alloc(0));

for (const [f, n] of written) if (n > MAX_FILE) fail(`dist/${f} is ${(n / 1048576).toFixed(1)} MiB: Cloudflare Pages allows 25 MiB per file`);
if (written.size > MAX_FILES) fail(`${written.size} files: Cloudflare Pages allows ${MAX_FILES}`);

// ------------------------------------------------------------------ report
const total = [...written.values()].reduce((a, b) => a + b, 0), mb = n => (n / 1048576).toFixed(2) + ' MB';
console.log(`dist/: ${written.size} files, ${mb(total)} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
const lazy = [...written].filter(([f]) => /^vendor\/(tesseract|onnxruntime|pdfjs)/.test(f)).reduce((a, [, n]) => a + n, 0);
console.log(`  loaded only when used (PDF reader, text reader, wall-finding model): ${mb(lazy)}`);
for (const p of pages) {
  const bytes = written.get(p) + [...startupOf[p]].reduce((a, f) => a + written.get(f), 0);
  console.log(`  ${p.padEnd(15)} ${mb(bytes).padStart(9)} on open (${startupOf[p].size + 1} files, before houses/ and textures/)`);
}
const big = [...written].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([f, n]) => `${f} ${mb(n)}`);
console.log('  largest: ' + big.join(', '));
for (const w of warnings) console.warn('warning: ' + w);
if (errors.length) { for (const e of errors) console.error('error: ' + e); console.error(`\nbuild failed: ${errors.length} problem${errors.length === 1 ? '' : 's'}`); process.exit(1); }
