// Builds paint-colors.js from the downloaded colour books.
//   Sherwin-Williams: data/src/sw.json (colornerd, matches SW's published RGB)
//   Behr:             data/src/behr_all.js (Behr's own colour data, behr.com)
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
// Quick picks: well-known interior colours, checked against the books below
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
const out = '/* Paint colour books. Sherwin-Williams (' + sw.length + ') and Behr (' + behr.length + ').\n' +
  ' * [code, name, hex]. Hex values are the brands\' published screen approximations — confirm with a real chip. */\n' +
  'window.PAINT_COLORS = ' + JSON.stringify({ sw, behr, popular }) + ';\n';
fs.writeFileSync(__dirname + '/../paint-colors.js', out);
console.log('sw', sw.length, 'behr', behr.length, 'bytes', out.length, JSON.stringify(popular));
