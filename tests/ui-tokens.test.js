// The interface follows the R7 Orbit design rules (docs/DESIGN.md): tokens only, one accent, dark only, fonts self-hosted.
// This reads the CSS and HTML as text, so it needs no browser. ui/tokens.css is the one file allowed to hold raw values;
// anywhere else a raw value may only be the definition of a custom property (--name: value), which is how a layout constant or a token is born.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const CSS = fs.readdirSync(path.join(ROOT, 'ui')).filter(f => f.endsWith('.css') && f !== 'tokens.css');
const PAGES = ['index.html', 'paint.html', 'editor.html', 'floorplan.html'];

// every declaration in the file as { file, line, prop, value }: comments removed, @media preludes ignored (widths there cannot use variables)
function declarations(file) {
  const src = read('ui/' + file).replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  const out = []; let line = 1, depth = 0, buf = '', bufLine = 1;
  const flush = () => {
    const m = buf.match(/^\s*([\w-]+)\s*:\s*([\s\S]*?)\s*$/);
    if (m && depth > 0 && !/^@/.test(buf.trim())) out.push({ file, line: bufLine, prop: m[1], value: m[2] });
    buf = '';
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\n') line++;
    if (c === '{') {                       // a rule or @media opens: what came before is a selector or a prelude, not a declaration
      const pre = buf.trim(); buf = ''; depth++;
      if (/^@(?:media|supports)/.test(pre)) depth--;           // @media wraps rules: its body is more rules, not declarations
      else if (/^@(?:keyframes|font-face)/.test(pre)) { /* declarations inside are read like any rule */ }
      continue;
    }
    if (c === '}') { flush(); depth = Math.max(0, depth - 1); continue; }
    if (c === ';') { flush(); continue; }
    if (!buf.trim()) bufLine = line;
    buf += c;
  }
  return out;
}
const ALL = CSS.flatMap(declarations);
const strip = v => v.replace(/\bvar\([^)]*\)/g, '');            // what is left once the token references are taken out
const fail = (list, why) => assert.deepStrictEqual(list.map(d => `${d.file}:${d.line}  ${d.prop}: ${d.value}`), [], why);

test('the declaration reader sees the stylesheets', () => {
  assert.ok(ALL.length > 800, 'read ' + ALL.length + ' declarations');
  assert.ok(ALL.some(d => d.prop === 'border-radius'));
});

test('no raw colors in the interface CSS', () => {
  const bad = ALL.filter(d => !d.prop.startsWith('--') && !/^mask/.test(d.prop)).filter(d => {
    const v = strip(d.value).replace(SYSTEM, '');
    return /#[0-9a-fA-F]{3,8}\b/.test(v) || /\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch)\(/.test(v) || (d.prop !== 'content' && /(?:^|[\s,(])(?:white|black|red|green|blue|orange|yellow|purple|pink|gray|grey|silver|navy|teal|brown)(?=[\s,;)]|$)/i.test(v));
  });
  fail(bad, 'use a color token (var(--text), var(--brass), ...)');
});
const SYSTEM = /\b(?:ButtonText|ButtonFace|Highlight|HighlightText|Canvas|CanvasText|GrayText|LinkText|Field|FieldText)\b/g;

test('lengths are rem, em, % or a token: no raw px, and no raw time', () => {
  const bad = ALL.filter(d => !d.prop.startsWith('--')).filter(d => {
    const v = strip(d.value);
    if (/^(?:animation|transition)-duration$/.test(d.prop) && /^0\.001ms( !important)?$/.test(v)) return false;     // the reduced-motion rule, as in the site's components.css
    return /\d(?:\.\d+)?px\b/.test(v) || /\d(?:\.\d+)?m?s\b/.test(v);
  }).filter(d => !(/^(?:width|height)$/.test(d.prop) && d.value === '1px'));                      // .visually-hidden
  fail(bad, 'use --s-*, --bw, --ctl*, a rem value, or define a custom property for a layout constant');
});

test('type, radii, shadows and fonts come from tokens', () => {
  const bad = [];
  for (const d of ALL.filter(d => !d.prop.startsWith('--'))) {
    const v = d.value.replace(/\s*!important$/, '');
    if (d.prop === 'font-size' && !/^(?:var\(--(?:fs|dt)-[\w-]+\)|inherit|[\d.]+em)$/.test(v)) bad.push(d);
    if (d.prop === 'font' && /\d(?:\.\d+)?(?:px|rem)\b/.test(strip(v))) bad.push(d);
    if (d.prop === 'font-family' && !/^var\(--font-[\w-]+\)$/.test(v)) bad.push(d);
    if (d.prop === 'border-radius' && !/^(?:0|inherit|var\(--r-[\w-]+\)(?: var\(--r-[\w-]+\))*)$/.test(v)) bad.push(d);
    if (d.prop === 'box-shadow' && !/^(?:none|var\(--(?:shadow|glow)-[\w-]+\)(?:, var\(--(?:shadow|glow)-[\w-]+\))*)$/.test(v)) bad.push(d);
    if (/^(?:transition|animation)$/.test(d.prop) && /\d(?:\.\d+)?m?s\b/.test(strip(v))) bad.push(d);
  }
  fail(bad, 'sizes: --fs-*; radii: --r-*; shadows: --shadow-*; fonts: --font-ui / --font-display / --font-mono');
});

test('dark only: no light theme, no theme switch', () => {
  for (const f of [...CSS.map(c => 'ui/' + c), 'ui/tokens.css', ...PAGES]) {
    const s = read(f);
    assert.ok(!/prefers-color-scheme/.test(s), f + ' has a prefers-color-scheme rule');
    assert.ok(!/data-theme/.test(s), f + ' mentions data-theme');
    assert.ok(!/theme-toggle|themeToggle/i.test(s), f + ' has a theme toggle');
  }
  assert.ok(/color-scheme:\s*dark/.test(read('ui/tokens.css')));
});

test('every page loads the shared tokens and its own stylesheet, and no font service', () => {
  for (const p of PAGES) {
    const s = read(p);
    assert.ok(/href="ui\/tokens\.css"/.test(s) && /href="ui\/base\.css"/.test(s), p + ' misses tokens.css or base.css');
    assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(s), p + ' still uses Google Fonts');
    assert.ok(!/<style[\s>]/.test(s), p + ' has an inline <style> block: put it in ui/');
    for (const m of s.matchAll(/<link rel="preload" href="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(ROOT, m[1])), p + ' preloads a missing file ' + m[1]);
    for (const m of s.matchAll(/<link rel="stylesheet" href="(ui\/[^"]+)"/g)) assert.ok(fs.existsSync(path.join(ROOT, m[1])), p + ' links a missing file ' + m[1]);
  }
});

test('the self-hosted font files in tokens.css exist, with their licences', () => {
  const tokens = read('ui/tokens.css');
  const urls = [...tokens.matchAll(/url\('([^']+\.woff2)'\)/g)].map(m => m[1]);
  assert.ok(urls.length >= 12);
  for (const u of urls) { assert.ok(!u.startsWith('/'), u + ' must be relative'); assert.ok(fs.existsSync(path.join(ROOT, 'ui', u)), 'missing ui/' + u); }
  for (const l of ['Cormorant-Garamond-OFL.txt', 'Inter-OFL.txt', 'JetBrains-Mono-OFL.txt']) assert.ok(fs.existsSync(path.join(ROOT, 'ui/fonts/LICENSES', l)), 'missing licence ' + l);
});

test('the paint colors are never recolored: swatches take their color from --c (data)', () => {
  const swatches = ['.chip .sw', '.row .dot', '.bigchip', '.rdots i', '.totals .dot'];
  const paint = read('ui/paint.css');
  for (const sel of swatches) {
    const m = paint.match(new RegExp('(?:^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*\\}'));
    assert.ok(m && /background(?:-color)?:\s*var\(--c\)/.test(m[0]), sel + ' must take its color from --c');
  }
});
