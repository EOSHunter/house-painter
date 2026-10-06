// Serves dist/ the way Cloudflare Pages does, so you can check a build before deploying:  npm run preview   (then open http://localhost:8788/)
//   - /_headers rules are applied (every matching rule is merged, as Pages does)
//   - /paint.html redirects to /paint (308), and /paint serves paint.html; / serves index.html
//   - an address with no file gets 404.html with status 404
// Also exported for tools/e2e/embed.js, which runs it over HTTPS under the real host names.
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.gz': 'application/gzip', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };

function parseHeaders(text) {                       // [{ pattern: RegExp, headers: [[name, value]] }]
  const rules = []; let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    if (/^\S/.test(raw)) { const pat = raw.trim(); cur = { pattern: new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'), headers: [] }; rules.push(cur); }
    else if (cur) { const i = raw.indexOf(':'); cur.headers.push([raw.slice(0, i).trim(), raw.slice(i + 1).trim()]); }
  }
  return rules;
}

function handler(dist) {
  const rules = parseHeaders(fs.existsSync(path.join(dist, '_headers')) ? fs.readFileSync(path.join(dist, '_headers'), 'utf8') : '');
  const file = rel => { const p = path.join(dist, rel); return p.startsWith(dist) && fs.existsSync(p) && fs.statSync(p).isFile() ? p : null; };
  return (req, res) => {
    const url = new URL(req.url, 'http://x');
    let pathname = decodeURIComponent(url.pathname);
    const send = (status, body, extra = {}, reqPath = pathname) => {
      const h = {};
      for (const r of rules) if (r.pattern.test(reqPath)) for (const [k, v] of r.headers) h[k] = h[k] ? h[k] + ', ' + v : v;     // Pages merges matching rules
      Object.assign(h, extra);
      res.writeHead(status, h); res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (pathname.endsWith('/index.html') || (pathname.endsWith('.html') && pathname !== '/404.html' && file(pathname.slice(1)))) {
      const to = pathname.endsWith('/index.html') ? pathname.slice(0, -'index.html'.length) : pathname.slice(0, -5);
      return send(308, '', { Location: to + url.search }, pathname);
    }
    let f = pathname.endsWith('/') ? file(pathname.slice(1) + 'index.html') : (file(pathname.slice(1)) || file(pathname.slice(1) + '.html'));
    if (f) {
      const body = fs.readFileSync(f);
      return send(200, body, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Content-Length': body.length }, pathname);
    }
    const nf = file('404.html');
    send(404, nf ? fs.readFileSync(nf) : 'Not found', { 'Content-Type': 'text/html; charset=utf-8' }, pathname);
  };
}

function create(dist, tls) {
  const h = handler(path.resolve(dist));
  return tls ? https.createServer(tls, h) : http.createServer(h);
}

module.exports = { create, handler, parseHeaders };

if (require.main === module) {
  const dist = path.join(__dirname, '..', 'dist'), port = +process.env.PORT || 8788;
  if (!fs.existsSync(dist)) { console.error('No dist/ yet: run  npm run build'); process.exit(1); }
  create(dist).listen(port, () => console.log(`Serving dist/ at http://localhost:${port}/ (like Cloudflare Pages)`));
}
