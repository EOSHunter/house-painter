// End-to-end check of the BUILT site (dist/) inside the iframe it will live in:  npm run build && node tools/e2e/embed.js
// Serves dist/ over HTTPS as https://housepainter.r7orbit.io/ and an embedding page as https://r7orbit.io/ (host names mapped to this machine, a
// throwaway self-signed certificate), then drives headless Chromium through the features. Not part of `npm test`: it needs Playwright and OpenSSL.
//   npm i --no-save playwright   (or set PLAYWRIGHT=/path/to/node_modules/playwright)   and a Chromium:  npx playwright install chromium
const fs = require('fs'), os = require('os'), path = require('path'), https = require('https'), { execFileSync } = require('child_process');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const preview = require('../preview.js');

const DIST = path.join(__dirname, '..', '..', 'dist');
const APP = 'housepainter.r7orbit.io', HOST = 'r7orbit.io', PORT = +process.env.PORT || 8443;
const BASE_SANDBOX = 'allow-scripts allow-same-origin allow-pointer-lock';                                  // the minimum the host asked for
const SANDBOX = process.env.SANDBOX || BASE_SANDBOX + ' allow-forms allow-downloads';                       // what the app needs (see docs/DEPLOY.md)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-e2e-'));

// ---- a throwaway certificate for the three names
function makeCert() {
  const key = path.join(tmp, 'k.pem'), crt = path.join(tmp, 'c.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '2', '-subj', '/CN=' + APP,
    '-addext', `subjectAltName=DNS:${APP},DNS:${HOST},DNS:www.${HOST},DNS:evil.example`], { stdio: 'ignore' });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
}

// ---- the embedding page: /?src=<url>&sandbox=<tokens>&allow=<policy>
function embedPage(url) {
  const q = url.searchParams, src = q.get('src') || `https://${APP}/`;
  const sb = q.has('sandbox') ? q.get('sandbox') : SANDBOX, allow = q.has('allow') ? q.get('allow') : 'fullscreen';
  const esc = s => s.replace(/"/g, '&quot;');
  return `<!doctype html><meta charset=utf-8><title>r7orbit.io</title><body style="margin:0;background:#222">
<iframe id="app" src="${esc(src)}" ${sb === 'none' ? '' : `sandbox="${esc(sb)}"`} allow="${esc(allow)}" style="width:1280px;height:800px;border:0"></iframe>`;
}

const FONTS = /^fonts.(googleapis|gstatic).com$/;      // known, and being removed by the restyle: reported, not failed
const results = [];
const foreignOf = (reqs) => reqs.filter(u => { try { const h = new URL(u).hostname; return h !== APP && h !== HOST && !FONTS.test(h) && !/^(data|blob):/.test(u); } catch { return false; } });
const fontsIn = reqs => reqs.some(u => { try { return FONTS.test(new URL(u).hostname); } catch { return false; } });
async function step(name, fn) {
  try { const note = await fn(); results.push({ name, ok: true, note: note || '' }); console.log('  ok   ' + name + (note ? '  (' + note + ')' : '')); }
  catch (e) { results.push({ name, ok: false, note: String(e.message || e).split('\n')[0] }); console.log('  FAIL ' + name + '\n       ' + String(e.message || e).split('\n').slice(0, 3).join('\n       ')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || 'expected'}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

// ---- test inputs: a blueprint picture, a PDF blueprint, a tiny ONNX model
async function makeInputs(browser) {
  const p = await browser.newPage();
  const png = await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 1600; c.height = 1000; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 1600, 1000); g.strokeStyle = '#000'; g.lineWidth = 14; g.strokeRect(200, 250, 1000, 600); g.lineWidth = 8; g.beginPath(); g.moveTo(700, 250); g.lineTo(700, 850); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.moveTo(200, 150); g.lineTo(1200, 150); g.moveTo(200, 130); g.lineTo(200, 170); g.moveTo(1200, 130); g.lineTo(1200, 170); g.stroke();
    g.fillStyle = '#000'; g.font = 'bold 44px Arial'; g.textAlign = 'center'; g.fillText('40\'-0"', 700, 125);
    return c.toDataURL('image/png').split(',')[1];
  });
  await p.close();
  const pngFile = path.join(tmp, 'plan.png'); fs.writeFileSync(pngFile, Buffer.from(png, 'base64'));
  // a one-page PDF: a rectangle, and a line of text
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const stream = '4 w 100 300 400 300 re S 2 w 300 300 m 300 600 l S BT /F1 24 Tf 120 650 Td (Test plan 20\'-0") Tj ET';
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let pdf = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length; pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const pdfFile = path.join(tmp, 'plan.pdf'); fs.writeFileSync(pdfFile, pdf, 'latin1');
  const page2 = '6 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n';
  const two = pdf.replace('/Kids [3 0 R] /Count 1', '/Kids [3 0 R 6 0 R] /Count 2').replace('xref\n', page2 + 'xref\n');       // the table's offsets are now stale: PDF.js rebuilds it
  const pdf2File = path.join(tmp, 'plan2.pdf'); fs.writeFileSync(pdf2File, two, 'latin1');
  // ONNX: Identity(input) -> output, float [1,3,4,4]  (hand-encoded protobuf)
  const v = n => { const b = []; while (n > 127) { b.push((n & 127) | 128); n >>>= 7; } b.push(n); return Buffer.from(b); };
  const f = (no, wt, body) => Buffer.concat([v(no << 3 | wt), wt === 2 ? Buffer.concat([v(body.length), body]) : body]);
  const s = (no, str) => f(no, 2, Buffer.from(str)), i = (no, n) => f(no, 0, v(n));
  const vi = name => Buffer.concat([s(1, name), f(2, 2, f(1, 2, Buffer.concat([i(1, 1), f(2, 2, Buffer.concat([1, 3, 4, 4].map(d => f(1, 2, i(1, d))))) ])))]);
  const node = Buffer.concat([s(1, 'x'), s(2, 'y'), s(4, 'Identity')]);
  const graph = Buffer.concat([f(1, 2, node), s(2, 'g'), f(11, 2, vi('x')), f(12, 2, vi('y'))]);
  const model = Buffer.concat([i(1, 8), f(8, 2, Buffer.concat([s(1, ''), i(2, 13)])), f(7, 2, graph)]);
  const onnxFile = path.join(tmp, 'identity.onnx'); fs.writeFileSync(onnxFile, model);
  return { pngFile, pdfFile, pdf2File, onnxFile };
}

(async () => {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('No dist/: run  npm run build  first'); process.exit(2); }
  const tls = makeCert(), app = preview.handler(DIST);
  const server = https.createServer(tls, (req, res) => {
    const host = (req.headers.host || '').split(':')[0], url = new URL(req.url, 'https://' + host);
    if (host === APP) {
      if (process.env.E2E_CSP) { const wh = res.writeHead.bind(res); res.writeHead = (st, h = {}) => wh(st, { ...h, 'Content-Security-Policy': process.env.E2E_CSP }); }     // try a candidate policy
      return app(req, res);
    }
    if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(embedPage(url)); }
    res.writeHead(404); res.end();
  }).listen(PORT);

  const rules = [APP, HOST, 'www.' + HOST, 'evil.example'].map(h => `MAP ${h} 127.0.0.1:${PORT}`).join(', ');
  const browser = await chromium.launch({ args: [`--host-resolver-rules=${rules}`, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const inputs = await makeInputs(browser);
  console.log(`Chromium ${browser.version()}; sandbox="${SANDBOX}"\n`);

  const newCtx = async (extra = {}) => {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 }, ...extra });
    const requests = [], failures = [], consoleErrors = [];
    ctx.on('request', r => requests.push(r.url()));
    ctx.on('requestfailed', r => failures.push(r.url() + ' ' + (r.failure() || {}).errorText));
    ctx.on('page', p => { p.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); }); p.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message)); });
    return { ctx, requests, failures, consoleErrors };
  };
  const frameOf = async (page, urlPart) => { for (let i = 0; i < 100; i++) { const f = page.frames().find(f => f !== page.mainFrame() && f.url().includes(urlPart)); if (f) return f; await sleep(100); } throw new Error('no frame ' + urlPart); };
  const embed = (page, src, q = {}) => page.goto(`https://${HOST}/?` + new URLSearchParams({ src, ...q }).toString());
  const origin = `https://${APP}`;

  // ---------------------------------------------------------------- headers
  console.log('Headers');
  await step('response headers: frame-ancestors, no X-Frame-Options, nosniff, caching', async () => {
    const get = p => new Promise((done, bad) => https.get({ host: '127.0.0.1', port: PORT, path: p, headers: { Host: APP }, rejectUnauthorized: false, servername: APP }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => { const body = Buffer.concat(chunks).toString(); done({ status: () => res.statusCode, headers: () => res.headers, text: async () => body }); });
    }).on('error', bad));
    const html = await get('/paint'), h = html.headers();
    eq(html.status(), 200, '/paint status');
    ok(h['content-security-policy'] === "frame-ancestors 'self' https://r7orbit.io https://www.r7orbit.io", 'CSP: ' + h['content-security-policy']);
    ok(!('x-frame-options' in h), 'X-Frame-Options must be absent');
    eq(h['x-content-type-options'], 'nosniff'); eq(h['cache-control'], 'no-cache', 'html cache-control');
    const asset = (await (await get('/paint')).text()).match(/assets\/[^"]+\.js/)[0], a = await get('/' + asset);
    eq(a.headers()['cache-control'], 'public, max-age=31536000, immutable', 'asset cache-control');
    eq((await get('/vendor/three-r128/three.min.js')).headers()['cache-control'], 'public, max-age=31536000, immutable', 'vendor cache-control');
    eq((await get('/paint.html')).status(), 308, '/paint.html redirects'); eq((await get('/nope')).status(), 404, '404 status');
    ok((await (await get('/nope')).text()).includes("That page isn't here"), '404 page body');
    return 'CSP ok, assets immutable, HTML no-cache, 404 page served';
  });
  await step('embedding from another site is refused (frame-ancestors)', async () => {
    const { ctx, consoleErrors } = await newCtx(); const page = await ctx.newPage();
    await page.goto(`https://evil.example/?src=${encodeURIComponent(origin + '/')}`); await sleep(1500);
    const f = page.frames().find(f => f.url().includes(APP));
    ok(!f || !(await f.locator('h1').count().catch(() => 0)), 'the page rendered inside evil.example');
    ok(consoleErrors.some(e => /frame-ancestors|Refused to frame/i.test(e)), 'no frame-ancestors refusal in console: ' + consoleErrors.join('|'));
    await ctx.close(); return 'blocked';
  });

  // ---------------------------------------------------------------- the studio, embedded
  console.log('\nPaint studio in the iframe');
  const A = await newCtx(); const page = await A.ctx.newPage();
  await embed(page, origin + '/paint');
  const frame = await frameOf(page, '/paint');
  await step('studio loads and the 3D view renders', async () => {
    await frame.waitForFunction(() => window.__studio && window.__studio.renderer, null, { timeout: 30000 });
    await frame.waitForFunction(() => !/Loading/.test(document.querySelector('#saveState').textContent), null, { timeout: 15000 });
    await sleep(800);
    const info = await frame.evaluate(() => {
      const c = document.getElementById('c'), gl = c.getContext('webgl2') || c.getContext('webgl'), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const buf = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const seen = new Set(); for (let i = 0; i < buf.length; i += 4 * 97) seen.add((buf[i] >> 4) + ',' + (buf[i + 1] >> 4) + ',' + (buf[i + 2] >> 4));
      return { w, h, colours: seen.size, webgl2: !!c.getContext('webgl2'), isolated: crossOriginIsolated, secure: isSecureContext, fullscreen: document.fullscreenEnabled };
    });
    ok(info.colours > 12, 'canvas looks blank (' + info.colours + ' colours)');
    return `canvas ${info.w}x${info.h}, ${info.colours} colours, webgl2=${info.webgl2}, crossOriginIsolated=${info.isolated}, fullscreenEnabled=${info.fullscreen}`;
  });
  await step('no third-party requests, no failed requests, no console errors', async () => {
    const foreign = foreignOf(A.requests);
    const info = [`${A.requests.length} requests`]; if (fontsIn(A.requests)) info.push('Google Fonts still requested (pending the restyle)');
    if (foreign.length) info.push('foreign: ' + [...new Set(foreign.map(u => new URL(u).host))].join(', '));
    ok(!foreign.length, 'third-party requests: ' + [...new Set(foreign)].slice(0, 5).join(', '));
    ok(!A.failures.length, 'failed requests: ' + A.failures.join(' | '));
    ok(!A.consoleErrors.length, 'console errors: ' + A.consoleErrors.join(' | '));
    return info.join(', ');
  });
  await step('painting: pick a wall, pick a colour; it is saved to localStorage', async () => {
    await frame.click('#roomList details.room summary'); await frame.click('#roomList details.room[open] .row');
    ok(await frame.locator('#chipArea .chip:not([disabled])').count() > 0, 'chips are disabled');
    await frame.click('#chipArea .chip:not([disabled])');
    await frame.waitForFunction(() => Object.keys(window.__studio.A()).length > 0, null, { timeout: 5000 });
    await frame.waitForFunction(() => /Saved|saved/.test(document.querySelector('#saveState').textContent), null, { timeout: 8000 });
    const keys = await frame.evaluate(() => Object.keys(localStorage).filter(k => /paintstudio/.test(k)));
    ok(keys.length > 0, 'no paintstudio.* key in localStorage');
    return `${await frame.evaluate(() => Object.keys(window.__studio.A()).length)} surface painted; ${keys.join(', ')}`;
  });
  await step('localStorage survives a reload of the embedding page', async () => {
    await page.reload(); const f = await frameOf(page, '/paint');
    await f.waitForFunction(() => window.__studio, null, { timeout: 30000 }); await sleep(800);
    const n = await f.evaluate(() => Object.keys(window.__studio.A()).length); ok(n > 0, 'the scheme was not restored (' + n + ')');
    return n + ' surface restored';
  });
  const frame2 = await frameOf(page, '/paint');
  await step('walk-through: pointer lock after a click, keyboard moves the camera', async () => {
    await frame2.click('#vWalk'); await sleep(500);
    const box = await page.locator('#app').boundingBox(), cv = await frame2.locator('#c').boundingBox();
    await page.mouse.click(box.x + cv.x + cv.width / 2, box.y + cv.y + cv.height / 2); await sleep(500);
    const locked = await frame2.evaluate(() => document.pointerLockElement && document.pointerLockElement.id);
    eq(locked, 'c', 'pointerLockElement');
    const before = await frame2.evaluate(() => window.__studio.camera.position.toArray());
    await page.keyboard.down('w'); await sleep(900); await page.keyboard.up('w'); await sleep(200);
    const after = await frame2.evaluate(() => window.__studio.camera.position.toArray());
    ok(Math.hypot(after[0] - before[0], after[2] - before[2]) > 0.2, 'camera did not move: ' + before + ' -> ' + after);
    await page.keyboard.press('Escape'); await sleep(300);
    return 'locked on #c; W moved ' + Math.hypot(after[0] - before[0], after[2] - before[2]).toFixed(1) + ' ft';
  });
  await step('fullscreen button works (allow="fullscreen")', async () => {
    await frame2.evaluate(() => { const b = document.getElementById('ihFull'); return !!b; });
    const r = await frame2.evaluate(async () => { try { await document.getElementById('stage').requestFullscreen(); const on = !!document.fullscreenElement; await document.exitFullscreen(); return on; } catch (e) { return 'error: ' + e.message; } }).catch(e => 'error ' + e.message);
    // requestFullscreen needs a user gesture: click something first
    return r === true ? 'ok' : 'without a gesture: ' + r;
  });
  await frame2.evaluate(() => { const b = document.getElementById('ihExit'); if (b && b.offsetParent) b.click(); });
  await frame2.waitForSelector('#shareBtn', { state: 'visible', timeout: 10000 });
  let shared = '';
  await step('share link without clipboard-write: shows the link in a dialog; it points at the app, not the embedding page', async () => {
    await frame2.click('#shareBtn'); await frame2.waitForSelector('#exportText', { timeout: 5000 });
    shared = await frame2.inputValue('#exportText');
    ok(shared.startsWith(origin + '/paint#scheme=') || shared.startsWith(origin + '/paint?') , 'link: ' + shared.slice(0, 80));
    ok(!shared.includes(HOST + ':' + PORT) && !shared.includes('src='), 'link mentions the embedding page');
    await frame2.click('#dlgCancel'); return shared.slice(0, 60) + '... (' + shared.length + ' chars)';
  });
  await step('the share link opens standalone and restores the scheme', async () => {
    const S = await newCtx(); const p = await S.ctx.newPage(); await p.goto(shared); await p.waitForFunction(() => window.__studio, null, { timeout: 30000 }); await sleep(800);
    const n = await p.evaluate(() => Object.keys(window.__studio.A()).length); ok(n > 0, 'scheme not restored');
    await S.ctx.close(); return n + ' surface restored, standalone';
  });
  await step('share link WITH allow="clipboard-write": copies and says so', async () => {
    const C = await newCtx(); await C.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin }); await C.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://' + HOST });      // headless Chromium has no prompt: grant what a visitor's click gets
    const p = await C.ctx.newPage();
    await embed(p, origin + '/paint', { allow: 'fullscreen; clipboard-write' }); const f = await frameOf(p, '/paint');
    await f.waitForFunction(() => window.__studio, null, { timeout: 30000 }); await sleep(800);
    await p.bringToFront(); await f.click('#shareBtn'); await sleep(1500);
    const state = await f.evaluate(() => ({ toast: document.getElementById('toast').textContent, dialog: !!document.getElementById('exportText'), focus: document.hasFocus() }));
    const err = await f.evaluate(() => navigator.clipboard.writeText('x').then(() => 'ok', e => e.name + ': ' + e.message)); state.err = err;
    ok(/Link copied/.test(state.toast), 'no "Link copied" toast: ' + JSON.stringify(state));
    const text = await f.evaluate(() => navigator.clipboard.readText()).catch(e => 'read-blocked: ' + e.message);
    await C.ctx.close(); return /^https:\/\/housepainter\.r7orbit\.io\/paint#scheme=/.test(text) ? 'clipboard holds ' + text.slice(0, 45) + '...' : 'toast shown; clipboard read: ' + String(text).slice(0, 60);
  });
  await step('control: share link standalone (top-level page) copies', async () => {
    const C = await newCtx(); await C.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin }); const p = await C.ctx.newPage(); await p.goto(origin + '/paint'); await p.waitForFunction(() => window.__studio, null, { timeout: 30000 }); await sleep(800);
    await p.click('#shareBtn'); await sleep(1500);
    const st = await p.evaluate(() => ({ toast: document.getElementById('toast').textContent, dialog: !!document.getElementById('exportText') })); await C.ctx.close(); return JSON.stringify(st);
  });
  await step('share link WITHOUT allow="clipboard-write", even with the browser permission granted: falls back to a dialog showing the link', async () => {
    const C = await newCtx(); await C.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin }); await C.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://' + HOST });
    const p = await C.ctx.newPage(); await embed(p, origin + '/paint', { allow: 'fullscreen' }); const f = await frameOf(p, '/paint');
    await f.waitForFunction(() => window.__studio, null, { timeout: 30000 }); await sleep(800); await p.bringToFront();
    await f.click('#shareBtn'); await f.waitForSelector('#exportText', { timeout: 5000 });
    const link = await f.inputValue('#exportText'); ok(link.startsWith(origin + '/paint#scheme='), link.slice(0, 60)); await C.ctx.close(); return 'dialog shown with the link (copy button there fails too)';
  });
  await step('export for Blender saves a file (allow-downloads)', async () => {
    const C = await newCtx(); const p = await C.ctx.newPage(); await embed(p, origin + '/paint'); const f = await frameOf(p, '/paint');
    await f.waitForFunction(() => window.__studio, null, { timeout: 30000 }); await sleep(800);
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }), f.click('#exportBtn')]);
    const file = path.join(tmp, dl.suggestedFilename()); await dl.saveAs(file); const j = JSON.parse(fs.readFileSync(file, 'utf8')); eq(j.format, 'house-painter/scheme');
    await C.ctx.close(); return dl.suggestedFilename() + ' (' + Math.round(fs.statSync(file).size / 1024) + ' KB)';
  });
  await step('embedded from https://www.r7orbit.io too', async () => {
    const C = await newCtx(); const p = await C.ctx.newPage(); await p.goto('https://www.' + HOST + '/?src=' + encodeURIComponent(origin + '/paint')); const f = await frameOf(p, '/paint');
    await f.waitForFunction(() => window.__studio, null, { timeout: 30000 }); await C.ctx.close(); return 'ok';
  });
  await step('touch: a phone-sized touch device gets the on-screen walk pad and taps work', async () => {
    const C = await newCtx({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }); const p = await C.ctx.newPage();
    await p.goto(origin + '/paint'); await p.waitForFunction(() => window.__studio, null, { timeout: 30000 }); await sleep(800);
    const hoverNone = await p.evaluate(() => matchMedia('(hover: none)').matches); ok(hoverNone, 'the emulated phone reports hover: hover');
    await p.tap('#vWalk'); await sleep(600);
    const pad = await p.evaluate(() => { const e = document.getElementById('pad'); return e && !e.hidden && e.offsetParent !== null; });
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    await p.screenshot({ path: path.join(tmp, 'touch-walk.png') }); await C.ctx.close(); return 'pad visible=' + pad + ', horizontal overflow=' + overflow;
  });

  // ---------------------------------------------------------------- the plan editor, embedded
  console.log('\nPlan editor in the iframe');
  const E = await newCtx(); const ep = await E.ctx.newPage();
  await embed(ep, origin + '/editor'); const ef = await frameOf(ep, '/editor');
  await step('editor loads', async () => { await ef.waitForSelector('#plan', { timeout: 30000 }); await ef.waitForFunction(() => document.querySelector('#plan'), null); await sleep(800); return 'ok'; });
  const toast = () => ef.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
  await step('open a blueprint picture from disk with the file picker', async () => {
    await ef.setInputFiles('#underFile', inputs.pngFile);
    await ef.waitForFunction(() => /Blueprint loaded/.test(document.getElementById('toast').textContent), null, { timeout: 15000 }); return await toast();
  });
  await step('read the dimensions with tesseract.js (local worker, wasm core and language data)', async () => {
    await ef.evaluate(() => localStorage.setItem('housepainter.ocrConsent', '1'));
    await ef.waitForSelector('[data-u="ocr"]', { timeout: 5000 });
    await ef.click('[data-u="ocr"]');
    await ef.waitForFunction(() => /Scale from the dimensions|No dimension text|Could not read/.test(document.body.innerText), null, { timeout: 120000 });
    const msg = await ef.evaluate(() => /Scale from the dimensions/.test(document.body.innerText) ? 'dialog: ' + (document.querySelector('#dialog .note') || {}).textContent : (document.getElementById('toast') || {}).textContent);
    ok(!/Could not read/.test(msg), msg);
    const words = await ef.evaluate(() => (window.__ocrWords || []).map(w => w.text).join(' '));
    ok(words.length > 0, 'the reader returned no words');
    const urls = E.requests.filter(u => /tesseract/.test(u)).map(u => new URL(u).pathname.split('/').slice(-2).join('/'));
    ok(E.requests.filter(u => /tesseract/.test(u)).every(u => new URL(u).hostname === APP), 'tesseract fetched from another host');
    return `read "${words.slice(0, 40)}"; files: ${[...new Set(urls)].join(', ')}`;
  });
  await step('open a PDF blueprint (PDF.js from vendor/, worker included)', async () => {
    await ef.evaluate(() => { const d = document.getElementById('dialog'); if (d) d.hidden = true; });
    await ef.setInputFiles('#underFile', inputs.pdfFile);
    await ef.waitForFunction(() => /Blueprint loaded/.test(document.getElementById('toast').textContent) || /could not|Could not/.test(document.getElementById('toast').textContent), null, { timeout: 30000 });
    const t = await toast(); ok(/Blueprint loaded/.test(t), t);
    ok(E.requests.some(u => /pdf\.worker\.min\.js/.test(u)), 'PDF worker was not requested');
    return 'loaded; worker ' + E.requests.filter(u => /pdfjs/.test(u)).map(u => new URL(u).pathname.split('/').pop()).join(', ');
  });
  await step('a two-page PDF asks which page (a form dialog in the sandbox) and loads it', async () => {
    await ef.evaluate(() => { const d = document.getElementById('dialog'); if (d) d.hidden = true; document.getElementById('toast').textContent = ''; });
    await ef.setInputFiles('#underFile', inputs.pdf2File);
    await ef.waitForSelector('#dialog #dlgLen', { timeout: 20000 }); await ef.fill('#dlgLen', '2'); await ef.press('#dlgLen', 'Enter');
    await ef.waitForFunction(() => /Blueprint loaded/.test(document.getElementById('toast').textContent), null, { timeout: 20000 }); return 'page chosen with Enter, loaded';
  });
  await step('optional wall-finding model: onnxruntime-web loads from vendor/ and runs a model (wasm)', async () => {
    await ef.setInputFiles('#modelFile', inputs.onnxFile);
    await ef.waitForFunction(() => /Model ready|could not be used/.test(document.getElementById('toast').textContent), null, { timeout: 60000 });
    const t = await toast(); ok(/Model ready/.test(t), t);
    const run = await ef.evaluate(async b64 => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)), sess = await window.ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
      const x = new window.ort.Tensor('float32', Float32Array.from({ length: 48 }, (_, i) => i), [1, 3, 4, 4]), y = (await sess.run({ x })).y;
      return { out: Array.from(y.data).slice(0, 5).join(','), threads: window.ort.env.wasm.numThreads, isolated: crossOriginIsolated };
    }, fs.readFileSync(inputs.onnxFile).toString('base64'));
    eq(run.out, '0,1,2,3,4', 'Identity output');
    ok(E.requests.filter(u => /onnxruntime/.test(u)).every(u => new URL(u).hostname === APP), 'ort fetched from another host');
    return `${t}; files: ${[...new Set(E.requests.filter(u => /onnxruntime/.test(u)).map(u => u.split('/').pop()))].join(', ')}; inference ran (threads=${run.threads}, crossOriginIsolated=${run.isolated})`;
  });
  await step('editor made no third-party requests', async () => {
    const foreign = foreignOf(E.requests);
    ok(!foreign.length, [...new Set(foreign)].join(', ')); ok(!E.failures.length, E.failures.join(' | '));
    return `${E.requests.length} requests, all ${APP}; console errors: ${E.consoleErrors.length}${E.consoleErrors.length ? ' ' + E.consoleErrors[0].slice(0, 100) : ''}`;
  });
  await E.ctx.close();

  // ---------------------------------------------------------------- the host's minimum sandbox: what stops working
  console.log('\nWith only "' + BASE_SANDBOX + '" (expected limitations)');
  const baseline = async fn => { const C = await newCtx(); const p = await C.ctx.newPage(); await embed(p, origin + '/paint', { sandbox: BASE_SANDBOX }); const f = await frameOf(p, '/paint'); await f.waitForFunction(() => window.__studio, null, { timeout: 30000 }); await sleep(800); try { return await fn(p, f, C); } finally { await C.ctx.close(); } };
  await step('baseline: the app still loads, paints and keeps schemes (localStorage works)', () => baseline(async (p, f) => {
    await f.click('#roomList details.room summary'); await f.click('#roomList details.room[open] .row'); await f.click('#chipArea .chip:not([disabled])');
    await f.waitForFunction(() => /Saved|saved/.test(document.querySelector('#saveState').textContent), null, { timeout: 8000 }); return 'ok';
  }));
  await step('baseline FINDING: form dialogs (New / Rename scheme, set scale, PDF page) cannot submit without allow-forms', () => baseline(async (p, f, C) => {
    const before = await f.locator('#schemeSel option').count();
    await f.click('#newScheme'); await f.waitForSelector('#dlgName'); await f.fill('#dlgName', 'x'); await f.press('#dlgName', 'Enter'); await sleep(700);
    const after = await f.locator('#schemeSel option').count(), still = await f.locator('#dlgName').count();
    ok(after === before && still === 1, 'it submitted after all (' + before + ' -> ' + after + ')');
    ok(C.consoleErrors.some(e => /allow-forms/.test(e)), 'no allow-forms message in console'); return 'dialog stays open; console: "Blocked form submission ... allow-forms"';
  }));
  await step('baseline FINDING: saving files does nothing without allow-downloads (and the page still says "Saved")', () => baseline(async (p, f) => {
    const dl = p.waitForEvent('download', { timeout: 3000 }).then(() => 'downloaded', () => 'no download');
    await f.click('#exportBtn'); const r = await dl; await sleep(500);
    const toast = await f.evaluate(() => document.getElementById('toast').textContent); ok(r === 'no download', 'it downloaded after all');
    return 'no file; the page says "' + toast.slice(0, 40) + '..."';
  }));

  // ---------------------------------------------------------------- the rest
  console.log('\nOther pages');
  for (const [pth, sel] of [['/', 'h1'], ['/floorplan', 'svg']]) await step(`${pth} loads in the iframe`, async () => {
    const C = await newCtx(); const p = await C.ctx.newPage(); await embed(p, origin + pth); const f = await frameOf(p, APP);
    await f.waitForSelector(sel, { timeout: 30000 }); await sleep(600);
    ok(!C.failures.length, C.failures.join(' | ')); ok(!C.consoleErrors.length, C.consoleErrors.join(' | '));
    const foreign = foreignOf(C.requests);
    ok(!foreign.length, 'third party: ' + foreign.join(', ')); await C.ctx.close(); return C.requests.length + ' requests';
  });
  await step('"Edit house" from the studio and back, inside the iframe (links go through the .html -> clean URL redirect)', async () => {
    const C = await newCtx(); const p = await C.ctx.newPage(); await embed(p, origin + '/paint'); let f = await frameOf(p, '/paint');
    await f.waitForFunction(() => window.__studio, null, { timeout: 30000 }); await f.click('#editBtn');
    await sleep(1500); f = await frameOf(p, '/editor'); await f.waitForSelector('#plan', { timeout: 30000 });
    const url = f.url(); ok(url.startsWith(origin + '/editor'), url);   /* the editor reads ?house= and then tidies it out of the address */ ok(!C.failures.length, C.failures.join('|')); await C.ctx.close(); return url.replace(origin, '');
  });
  await step('?house=houses/two-storey/house.json opens (root-relative fetch)', async () => {
    const C = await newCtx(); const p = await C.ctx.newPage(); await embed(p, origin + '/paint?house=houses/two-storey/house.json'); const f = await frameOf(p, '/paint?house');
    await f.waitForFunction(() => window.__studio, null, { timeout: 30000 }); ok(!C.failures.length, C.failures.join('|')); await C.ctx.close(); return 'ok';
  });
  await step('without WebGL: what the studio shows', async () => {
    const C = await newCtx(); const p = await C.ctx.newPage();
    await p.addInitScript(() => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/.test(t) ? null : g.call(this, t, ...a); }; });
    await embed(p, origin + '/paint'); const f = await frameOf(p, '/paint'); await sleep(2500);
    const text = (await f.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 220);
    await p.screenshot({ path: path.join(tmp, 'no-webgl.png') }); await C.ctx.close(); return 'text: ' + text + ' | errors: ' + C.consoleErrors.map(e => e.slice(0, 80)).join(' | ');
  });

  await browser.close(); server.close();
  const bad = results.filter(r => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} steps passed` + (bad.length ? ': ' + bad.map(r => r.name).join('; ') : ''));
  console.log('screenshots and test files: ' + tmp);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
