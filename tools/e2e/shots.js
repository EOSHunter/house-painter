// Screenshots of the BUILT site (dist/), not the source folder:  npm run build && node tools/e2e/shots.js <out-dir> [label]
// Serves dist/ with the Pages rules (tools/preview.js), opens the landing page, the paint studio and the plan editor at 1440x900, 1024x768 and 390x844,
// and checks on each page that the stylesheet applied (the self-hosted fonts loaded, nothing failed, nothing left the host).
// Files: <out-dir>/<label>-<page>-<width>x<height>.png.  Needs Playwright (see tools/e2e/embed.js).
const fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const preview = require('../preview.js');

const DIST = path.join(__dirname, '..', '..', 'dist');
const out = path.resolve(process.argv[2] || 'shots'), label = process.argv[3] || 'dist';
const SIZES = [[1440, 900], [1024, 768], [390, 844]];
const PAGES = [['landing', '/', null], ['studio', '/paint', () => window.__studio], ['editor', '/editor', () => window.__editor || document.querySelector('#plan, canvas')]];

(async () => {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('No dist/: run  npm run build  first'); process.exit(2); }
  fs.mkdirSync(out, { recursive: true });
  const server = preview.create(DIST).listen(0), port = server.address().port, base = 'http://127.0.0.1:' + port;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let bad = 0;
  for (const [w, h] of SIZES) for (const [name, url, ready] of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } }), page = await ctx.newPage();
    const requests = [], problems = [];
    page.on('request', r => requests.push(r.url()));
    page.on('requestfailed', r => problems.push('failed: ' + r.url()));
    page.on('response', r => { if (r.status() >= 400) problems.push(r.status() + ' ' + r.url()); });
    page.on('pageerror', e => problems.push('pageerror: ' + e.message));
    await page.goto(base + url, { waitUntil: 'load' });
    if (ready) await page.waitForFunction(ready, null, { timeout: 30000 }).catch(() => problems.push('page never became ready'));
    await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(1200);
    const info = await page.evaluate(() => ({
      sheets: [...document.styleSheets].length, bg: getComputedStyle(document.body).backgroundColor, family: getComputedStyle(document.body).fontFamily.split(',')[0],
      fontsLoaded: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, '')).filter((v, i, a) => a.indexOf(v) === i),
      overflowX: document.documentElement.scrollWidth > innerWidth + 1, nav: !!document.querySelector('.site-nav, .site-header'),
    }));
    const foreign = requests.filter(u => !u.startsWith(base) && !/^(data|blob):/.test(u));
    const styled = info.sheets > 0 && /Inter/.test(info.family) && info.fontsLoaded.length > 0 && info.bg !== 'rgba(0, 0, 0, 0)' && info.bg !== 'rgb(255, 255, 255)';
    if (!styled || foreign.length || problems.length) bad++;
    console.log(`${name.padEnd(8)} ${w}x${h}  sheets=${info.sheets} bg=${info.bg} font=${info.family} loaded=[${info.fontsLoaded.join(', ')}] overflowX=${info.overflowX} siteNav=${info.nav}` +
      `${foreign.length ? '  FOREIGN: ' + foreign.join(' ') : ''}${problems.length ? '  PROBLEMS: ' + problems.join(' | ') : ''}${styled ? '' : '  NOT STYLED'}`);
    await page.screenshot({ path: path.join(out, `${label}-${name}-${w}x${h}.png`) });
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log(bad ? `\n${bad} page(s) with a problem` : `\nall pages styled, no foreign requests; screenshots in ${out}`);
  process.exit(bad ? 1 : 0);
})();
