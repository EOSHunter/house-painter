// Nearest paints to sampled colors in every loaded color book, by CIEDE2000.
//   node data/match_colors.js "#FC5001" "#BA410B" ...
const { books } = require('./colors.js');
const { lab, de2000 } = require('./color-math.js');
const labs = books.map(b => ({ id: b.id, rows: b.colors.map(x => [...x, lab(x[2])]) }));
if (require.main === module) for (const hex of process.argv.slice(2)) {
  const t = lab(hex);
  console.log(hex);
  for (const b of labs) {
    const best = b.rows.map(x => [x, de2000(t, x[3])]).sort((p, q) => p[1] - q[1]).slice(0, 4);
    console.log('  ' + b.id.padEnd(6) + best.map(([x, d]) => `${x[0]} ${x[1]} ${x[2]} (dE ${d.toFixed(1)})`).join(' | '));
  }
}
module.exports = { lab, de2000 };
