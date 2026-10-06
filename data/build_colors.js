// Builds paint-colors-extra.js (optional, never committed) from color books you download yourself.
// The paint makers own those names, codes and values, so they are not shipped with the project. See data/README.md.
//   Sherwin-Williams: data/src/sw.json (colornerd, matches SW's published RGB)
//   Behr:             data/src/behr_all.js (Behr's own color data, behr.com)
const fs = require('fs');
const title = s => s.toLowerCase().replace(/(^|[\s\-'(\/])([a-z])/g, (m, p, c) => p + c.toUpperCase());
const sw = require('./src/sw.json').map(c => ['SW ' + String(c.label).padStart(4, '0'), c.name, c.hex.toUpperCase()]);
const src = fs.readFileSync(__dirname + '/src/behr_all.js', 'utf8');
const rows = eval('(' + src.replace(/^\s*var colorData\s*=\s*/, '').replace(/;\s*$/, '') + ')');
const h = rows[0], ix = k => h.indexOf(k), seen = new Set(), behr = [];
for (const r of rows.slice(1)) {
  const id = r[ix('id')], name = title(r[ix('name')]), hex = String(r[ix('rgb')]).toUpperCase();
  const key = name + hex;
  if (!/^#[0-9A-F]{6}$/.test(hex) || seen.has(key)) continue;
  seen.add(key); behr.push([id, name, hex]);
}
// Quick picks: well-known interior colors, checked against the books below
const popular = {
  sw: ['Pure White', 'Extra White', 'Alabaster', 'Snowbound', 'Greek Villa', 'Shoji White', 'Agreeable Gray', 'Repose Gray',
       'Accessible Beige', 'Mindful Gray', 'Colonnade Gray', 'Passive', 'Sea Salt', 'Evergreen Fog', 'Naval', 'Urbane Bronze', 'Iron Ore', 'Tricorn Black'],
  behr: ['Ultra Pure White', 'Polar Bear', 'Swiss Coffee', 'Blank Canvas', 'Silver Drop', 'Wheat Bread', 'Light French Gray',
         'Back To Nature', 'Smokey Slate', 'Cracked Pepper', 'Broadway']
};
for (const [b, list] of Object.entries(popular)) {
  const book = b === 'sw' ? sw : behr;
  popular[b] = list.map(n => { const c = book.find(x => x[1].toLowerCase() === n.toLowerCase()); if (!c) console.warn('missing', b, n); return c && c[0]; }).filter(Boolean);
}
const books = [{ id: 'sw', label: 'Sherwin-Williams', colors: sw, popular: popular.sw }, { id: 'behr', label: 'Behr', colors: behr, popular: popular.behr }];
const out = '/* Extra paint color books: Sherwin-Williams (' + sw.length + ') and Behr (' + behr.length + '), [code, name, hex].\n' +
  " * Built locally by data/build_colors.js from your own downloads; not part of the project. Hex values are the brands' published screen approximations. */\n" +
  '(window.PAINT_COLORS.books ||= []).push(...' + JSON.stringify(books) + ');\n';
fs.writeFileSync(__dirname + '/../paint-colors-extra.js', out);
console.log('sw', sw.length, 'behr', behr.length, 'bytes', out.length);
