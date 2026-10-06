// Adds accent walls (one per room) to every scheme, using colors from that scheme's own palette.
//   bed wall: master MBR-W1, bedroom 1 BR1-W, bedroom 2 BR2-N   feature wall: living LIV-E3   vanity wall: HB-E, MB-W
//   node data/add_accent_walls.js <dir with live scheme json>
const { SCHEMES_DIR } = require('./example-house.js'); require('./colors.js');
const C = window.PAINT_COLORS, fs = require('fs'), path = require('path');
const p = (b, code) => { const x = C[b].find(c => c[0] === code); if (!x) throw new Error('missing ' + b + ' ' + code); return { b, c: x[0], n: x[1], h: x[2] }; };
const sw = c => p('sw', c), behr = c => p('behr', c);
const ACCENTS = {
  'mcm-burnt-orange':    { 'MBR-W1': sw('SW 7048'), 'BR1-W': sw('SW 6487'), 'BR2-N': sw('SW 6883'), 'HB-E': sw('SW 6487'), 'MB-W': sw('SW 9130') },   // living already has your teal wall
  'mcm-tangerine-blush': { 'MBR-W1': behr('550E-3'), 'BR1-W': behr('230B-7'), 'BR2-N': behr('S170-2'), 'LIV-E3': behr('M420-3'), 'HB-E': behr('550E-3'), 'MB-W': behr('S170-2') },
  'mcm-teal-walnut':     { 'MBR-W1': sw('SW 6487'), 'BR1-W': sw('SW 2810'), 'BR2-N': sw('SW 6487'), 'LIV-E3': sw('SW 6487'), 'HB-E': sw('SW 6487'), 'MB-W': sw('SW 6225') },
  'deco-emerald-brass':  { 'MBR-W1': sw('SW 6395'), 'BR1-W': sw('SW 6468'), 'BR2-N': sw('SW 6258'), 'HB-E': sw('SW 6468'), 'MB-W': sw('SW 6331') },     // living keeps Smoky Salmon
  'lounge-rust-olive':   { 'MBR-W1': sw('SW 6425'), 'BR1-W': sw('SW 6349'), 'BR2-N': sw('SW 6425'), 'LIV-E3': sw('SW 6395'), 'HB-E': sw('SW 6349'), 'MB-W': sw('SW 6348') },
  'deco-midnight':       { 'MBR-W1': sw('SW 6395'), 'BR1-W': sw('SW 6401'), 'BR2-N': sw('SW 6244'), 'LIV-E3': sw('SW 6244'), 'HB-E': sw('SW 7585'), 'MB-W': sw('SW 6244') },
  'deco-sunset':         { 'MBR-W1': behr('ICC-63'), 'BR1-W': behr('500D-7'), 'BR2-N': behr('S-G-690'), 'LIV-E3': behr('500D-7'), 'HB-E': behr('500D-7'), 'MB-W': behr('M200-3') }
};
const dir = process.argv[2];
for (const [id, acc] of Object.entries(ACCENTS)) {
  const doc = JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8'));
  const a = { ...doc.a };
  for (const [k, col] of Object.entries(acc)) a[k] = { ...col, s: /^(HB|MB)-/.test(k) ? 'satin' : 'eggshell' };
  fs.writeFileSync(path.join(SCHEMES_DIR, id + '.json'), JSON.stringify({ name: doc.name, a, created: doc.created, updated: new Date().toISOString(), by: doc.by || null }));
  console.log(id.padEnd(20), Object.entries(acc).map(([k, v]) => `${k}=${v.n}`).join(', '));
}
