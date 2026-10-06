// Extends the three mid-century schemes to the whole house. Starts from the live documents (so edits made on the
// page are kept) and only fills surfaces that have no colour yet.
//   node data/build_house_schemes.js <dir with live scheme json>
const { SCHEMES_DIR } = require('./example-house.js'); require('../paint-colors.js');
const R = window.ROOMS, C = window.PAINT_COLORS, fs = require('fs'), path = require('path');
const liveDir = process.argv[2];
const p = (b, code) => { const x = C[b].find(c => c[0] === code); if (!x) throw new Error('missing ' + b + ' ' + code); return { b, c: x[0], n: x[1], h: x[2] }; };
const sw = c => p('sw', c), behr = c => p('behr', c);
const WALNUT = { b: 'custom', c: '#5E2E17', n: 'Walnut (wood look)', h: '#5E2E17' };
const walls = room => R.surfaces.filter(s => s.room === room).map(s => s.id);
const siding = R.surfaces.filter(s => s.room === 'exterior').map(s => s.id);
const ALL_ROOMS = R.rooms.map(r => r.id);

const PLANS = {
  'mcm-burnt-orange': { ceiling: sw('SW 7006'), white: sw('SW 7563'), rooms: {
      master: sw('SW 9130'), bed1: sw('SW 9026'), bed2: sw('SW 0069'), hbath: sw('SW 6485'), mtoil: sw('SW 6487') },
    items: { hvanity: WALNUT, mvanity: WALNUT, barn: sw('SW 6883'), extdoors: sw('SW 6487'), exttrim: sw('SW 7006') }, siding: sw('SW 7048') },
  'mcm-tangerine-blush': { ceiling: sw('SW 7005'), white: sw('SW 7005'), rooms: {
      master: behr('S170-2'), bed1: behr('550E-3'), bed2: behr('M420-3'), hbath: behr('S170-2'), mtoil: behr('550E-3') },
    items: { hvanity: behr('230B-7'), mvanity: WALNUT, barn: behr('230B-7'), extdoors: behr('230B-7'), exttrim: sw('SW 7005') }, siding: behr('ECC-56-2') },
  'mcm-teal-walnut': { ceiling: sw('SW 7006'), white: sw('SW 7005'), rooms: {
      master: sw('SW 2810'), bed1: sw('SW 6225'), bed2: sw('SW 6141'), hbath: sw('SW 6485'), mtoil: sw('SW 6487') },
    items: { hvanity: WALNUT, mvanity: WALNUT, barn: sw('SW 6487'), extdoors: sw('SW 6691'), exttrim: sw('SW 7006') }, siding: sw('SW 9137') }
};

for (const [id, plan] of Object.entries(PLANS)) {
  const live = JSON.parse(fs.readFileSync(path.join(liveDir, id + '.json'), 'utf8'));
  const doc = live.data || live, a = { ...doc.a };
  let added = 0;
  const fill = (keys, col, s) => keys.forEach(k => { if (!a[k]) { a[k] = { ...col, s }; added++; } });
  for (const room of ALL_ROOMS) {
    fill(['C:' + room], plan.ceiling, 'flat');
    fill(walls(room), plan.rooms[room] || plan.white, room === 'hbath' || room === 'mbath' || room === 'mtoil' ? 'satin' : 'eggshell');
  }
  for (const [k, col] of Object.entries(plan.items)) fill([k], col, /door|barn|trim/.test(k) ? 'semigloss' : 'satin');
  fill(siding, plan.siding, 'satin');
  const out = { name: doc.name, a, created: doc.created, updated: new Date().toISOString(), by: doc.by || null };
  fs.writeFileSync(path.join(SCHEMES_DIR, id + '.json'), JSON.stringify(out));
  console.log(id, 'added', added, 'total', Object.keys(a).length);
}
