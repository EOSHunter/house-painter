// Cozy mid-century / Art Deco schemes. Each role gets a target color; the nearest real paint (CIEDE2000)
// in the chosen brand is used. Writes houses/waterford-4563c/schemes/<id>.json and prints the picks for review.
const { lab, de2000 } = require('./match_colors.js');   // loads the color books (and sets up window)
const { SCHEMES_DIR } = require('./example-house.js');

const R = window.ROOMS, C = window.PAINT_COLORS, fs = require('fs');
const books = { sw: C.sw.map(x => [...x, lab(x[2])]), behr: C.behr.map(x => [...x, lab(x[2])]) };
const near = (b, hex) => { const t = lab(hex); const x = books[b].map(x => [x, de2000(t, x[3])]).sort((p, q) => p[1] - q[1])[0][0]; return { b, c: x[0], n: x[1], h: x[2] }; };
const WALNUT = { b: 'custom', c: '#5E2E17', n: 'Walnut (wood look)', h: '#5E2E17' };
const walls = room => R.surfaces.filter(s => s.room === room).map(s => s.id);
const siding = R.surfaces.filter(s => s.room === 'exterior').map(s => s.id);
const GREAT = ['kitchen', 'dining', 'living', 'foyer', 'hall'];

function build(id, name, brand, t, opts) {
  const P = {}; for (const [k, v] of Object.entries(t)) P[k] = v === 'walnut' ? WALNUT : near(brand, v);
  const a = {}, put = (keys, col, s) => keys.forEach(k => { a[k] = { ...col, s }; });
  GREAT.forEach(r => { put(walls(r), P.walls, 'eggshell'); put(['C:' + r], P.ceiling, 'flat'); });
  for (const [k, role] of Object.entries(opts.accents)) put([k], P[role], 'eggshell');
  put(['trim', 'exttrim'], P.trim, 'semigloss'); put(['doors'], P.doors, 'semigloss');
  for (const k of ['kbase', 'uppers', 'island', 'pantry', 'deskbase', 'deskup']) put([k], P[k], 'satin');
  const roomMap = { master: 'master', bed1: 'bed1', bed2: 'bed2', hbath: 'hbath', mbath: 'mbath', mtoil: 'mtoil', laundry: 'laundry' };
  for (const r of R.rooms.map(r => r.id).filter(r => !GREAT.includes(r))) {
    const col = P[roomMap[r]] || P.walls, wet = /bath|toil/.test(r);
    put(walls(r), col, wet ? 'satin' : 'eggshell');
    put(['C:' + r], (opts.drench || []).includes(r) ? col : P.ceiling, 'flat');      // color-drenched rooms: ceiling matches
  }
  put(['hvanity'], P.hvanity, 'satin'); put(['mvanity'], P.mvanity, 'satin');
  put(['barn'], P.barn, 'semigloss'); put(['extdoors'], P.front, 'semigloss'); put(siding, P.siding, 'satin');
  const created = new Date(Date.now() + opts.order * 1000).toISOString();
  fs.writeFileSync(`${SCHEMES_DIR}/${id}.json`, JSON.stringify({ name, a, created, updated: created, by: null }));
  console.log('\n' + name + `  (${Object.keys(a).length} targets)`);
  for (const [k, v] of Object.entries(P)) console.log('  ' + k.padEnd(9) + (v.b === 'custom' ? v.n : `${v.c} ${v.n} ${v.h}`));
}

build('deco-emerald-brass', 'Cozy deco · Emerald & brass', 'sw', {
  walls: '#EFE7D6', ceiling: '#F3EEE3', trim: '#F2EEE3', doors: '#F2EEE3', emerald: '#2F5D4E', brass: '#C9A04B', blush: '#D8B4A8', black: '#2B2B2B',
  kbase: '#2F5D4E', uppers: 'walnut', island: 'walnut', pantry: '#2F5D4E', deskbase: '#2F5D4E', deskup: 'walnut',
  master: '#355E50', bed1: '#C9A7A0', bed2: '#D6B36A', hbath: '#D8B4A8', hvanity: '#2B2B2B', mbath: '#EFE7D6', mvanity: '#2F5D4E', mtoil: '#C9A04B',
  laundry: '#EFE7D6', barn: '#C9A04B', front: '#C9A04B', siding: '#4F5B4F'
}, { accents: { 'DIN-E': 'emerald', 'FOY-W': 'emerald', 'LIV-E3': 'blush' }, drench: ['master'], order: 10 });

build('lounge-rust-olive', "Cozy '70s lounge · Rust, olive & mustard", 'sw', {
  walls: '#E3D5BD', ceiling: '#F0E8D8', trim: '#EFE6D4', doors: 'walnut', rust: '#A9532F', olive: '#6B6B3A',
  kbase: '#6B6B3A', uppers: 'walnut', island: 'walnut', pantry: '#6B6B3A', deskbase: '#6B6B3A', deskup: 'walnut',
  master: '#B5694A', bed1: '#CFA047', bed2: '#8E8B65', hbath: '#9A9459', hvanity: 'walnut', mbath: '#E3D5BD', mvanity: '#6B6B3A', mtoil: '#A9532F',
  laundry: '#E3D5BD', barn: '#A9532F', front: '#CFA047', siding: '#6E5A45'
}, { accents: { 'DIN-E': 'rust', 'FOY-W': 'olive' }, drench: ['master'], order: 11 });

build('deco-midnight', 'Midnight deco · Navy, oxblood & gold', 'sw', {
  walls: '#EFE9DD', ceiling: '#F1ECE2', trim: '#F1ECE2', doors: '#2F2F30', navy: '#2F3D4C', oxblood: '#6E2B2B',
  kbase: '#2F3D4C', uppers: '#EFE9DD', island: 'walnut', pantry: '#2F3D4C', deskbase: '#2F3D4C', deskup: '#EFE9DD',
  master: '#2F3D4C', bed1: '#7A3B3B', bed2: '#D8C08C', hbath: '#D8C08C', hvanity: '#2F3D4C', mbath: '#EFE9DD', mvanity: '#2F3D4C', mtoil: '#6E2B2B',
  laundry: '#EFE9DD', barn: '#6E2B2B', front: '#C9A04B', siding: '#4A5560'
}, { accents: { 'DIN-E': 'oxblood', 'FOY-W': 'navy' }, drench: ['master', 'bed1'], order: 12 });

build('deco-sunset', 'Sunset deco · Peach, plum & teal', 'behr', {
  walls: '#EDD9C6', ceiling: '#F4ECE2', trim: '#F4ECE2', doors: '#F4ECE2', plum: '#5E3B4E', teal: '#2F6B6B',
  kbase: '#2F6B6B', uppers: '#F2EADF', island: 'walnut', pantry: '#2F6B6B', deskbase: '#2F6B6B', deskup: '#F2EADF',
  master: '#5E3B4E', bed1: '#D98C6F', bed2: '#8FB1A5', hbath: '#E9B9A0', hvanity: '#5E3B4E', mbath: '#F2EADF', mvanity: '#2F6B6B', mtoil: '#5E3B4E',
  laundry: '#F2EADF', barn: '#D98C6F', front: '#2F6B6B', siding: '#CDB89E'
}, { accents: { 'DIN-E': 'plum', 'FOY-W': 'teal' }, drench: ['master'], order: 13 });
