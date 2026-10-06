// Loads the color books for the Node tools: the House Painter palette (paint-colors.js) plus any extra books in
// paint-colors-extra.js (optional, never committed). Returns { books: [{ id, label, colors, popular }], byId, window }.
// Also sets global.window.PAINT_COLORS, which is where the page scripts keep them.
const fs = require('fs'), path = require('path');
global.window = global.window || {};
const root = path.join(__dirname, '..');
for (const f of ['paint-colors.js', 'paint-colors-extra.js']) {
  const p = path.join(root, f);
  if (fs.existsSync(p)) (0, eval)(fs.readFileSync(p, 'utf8').replace(/^window\./m, 'global.window.').replace(/\(window\.PAINT_COLORS\.books/g, '(global.window.PAINT_COLORS.books'));
}
const C = global.window.PAINT_COLORS;
const byId = Object.fromEntries(C.books.map(b => [b.id, b]));
// the old shape (C.sw, C.behr) for the brand scripts that still use it, when those books are present
for (const b of C.books) if (!(b.id in C)) C[b.id] = b.colors;
module.exports = { C, books: C.books, byId };
