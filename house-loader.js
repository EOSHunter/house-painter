/*
 * Picks the house to show, builds it with HouseCore, then loads the page's own scripts in order.
 * A script name ending in "?" is optional: if it is missing the page carries on (extra color books use this).
 *
 *   <script src="house-core.js"></script>
 *   <script src="house-loader.js" data-default="houses/waterford-4563c/house.json" data-then="a.js b.js"></script>
 *
 * Which house:  ?house=<url>    a house.json at that address (relative, or another site that allows CORS)
 *               ?house=local    the file last opened with "Open file" (kept in this browser)
 *               otherwise       data-default
 * Sets window.HOUSE, window.ROOMS and window.LEVELS (see house-core.js) and
 *      window.HOUSE_SOURCE = { kind: 'default' | 'url' | 'local', url, id, src }   (src = the house file as loaded)
 */
(function () {
  const me = document.currentScript;
  const DEFAULT = me.dataset.default, THEN = (me.dataset.then || '').split(/\s+/).filter(Boolean);
  const LOCAL_KEY = 'housepainter.localHouse';

  function readLocal() {
    for (const st of [() => localStorage, () => sessionStorage]) { try { const v = st().getItem(LOCAL_KEY); if (v) return v; } catch { } }
    return null;
  }
  function writeLocal(text) {
    for (const st of [() => localStorage, () => sessionStorage]) { try { st().setItem(LOCAL_KEY, text); return true; } catch { } }
    return false;
  }

  // open a house file the person picked: keep it in this browser and reload onto it
  function openHouseText(text) {
    let src;
    try { src = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
    const problems = HouseCore.validate(src);
    if (problems.length) { const e = new Error('That house file has problems:\n- ' + problems.join('\n- ')); e.problems = problems; throw e; }
    if (!writeLocal(JSON.stringify(src))) throw new Error('This browser blocked saving the house file (private window?).');
    const u = new URL(location.href); u.searchParams.set('house', 'local'); u.hash = '';
    location.href = u.toString();
  }

  function fail(err) {
    const box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;padding:16px;background:var(--bg,#E9EAEC);color:var(--ink,#1C1D20);font:14px/1.5 system-ui,sans-serif;z-index:100';
    const fileMode = location.protocol === 'file:';
    box.innerHTML = `<div style="max-width:520px;display:grid;gap:12px;padding:20px;border:1px solid var(--line,#D6D8DC);border-radius:12px;background:var(--panel,#fff)">
      <h1 style="margin:0;font-size:18px">Couldn't load the house</h1>
      <p style="margin:0;white-space:pre-line" id="hlMsg"></p>
      ${fileMode ? '<p style="margin:0">Pages opened straight from disk can\'t read other files. Run <code>python -m http.server</code> in this folder and open <code>http://localhost:8000/</code>, or open a house file here:</p>' : '<p style="margin:0">You can open a house file instead:</p>'}
      <label style="display:inline-flex;gap:8px;align-items:center"><input type="file" accept=".json,application/json" id="hlFile"></label>
      ${new URLSearchParams(location.search).get('house') ? '<a href="?" style="color:inherit">Back to the example house</a>' : ''}
    </div>`;
    document.body.appendChild(box);
    box.querySelector('#hlMsg').textContent = err && err.message ? err.message : String(err);
    box.querySelector('#hlFile').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try { openHouseText(await f.text()); } catch (x) { box.querySelector('#hlMsg').textContent = x.message; }
    });
  }

  function loadScripts(list) {
    return list.reduce((p, name) => p.then(() => new Promise((ok, bad) => {
      const optional = name.endsWith('?'), src = optional ? name.slice(0, -1) : name;
      const s = document.createElement('script'); s.src = src; s.async = false;
      s.onload = ok; s.onerror = () => (optional ? ok() : bad(new Error('Could not load ' + src)));
      document.body.appendChild(s);
    })), Promise.resolve());
  }

  async function main() {
    const want = new URLSearchParams(location.search).get('house');
    let source, text;
    // a share link (#scheme=...) from the paint studio; one made for a house opened from a file carries that house
    if (location.hash.startsWith('#scheme=') && window.PaintStore) {
      try { window.SHARED_SCHEME = await PaintStore.unpack(location.hash.slice(8)); } catch { window.SHARED_SCHEME = null; }
    }
    const shared = window.SHARED_SCHEME;
    if (shared && shared.house) {
      text = JSON.stringify(shared.house); writeLocal(text);
      source = { kind: 'local', url: null };
    } else if (want === 'local') {
      text = readLocal();
      if (!text) throw new Error('No house file has been opened in this browser yet.');
      source = { kind: 'local', url: null };
    } else {
      const url = want || DEFAULT;
      const res = await fetch(url, { cache: 'no-cache' }).catch(() => null);
      if (!res || !res.ok) throw new Error(`Couldn't read ${url}${res ? ' (' + res.status + ')' : ''}.`);
      text = await res.text();
      source = { kind: want ? 'url' : 'default', url };
    }
    let src;
    try { src = JSON.parse(text); } catch { throw new Error('The house file is not valid JSON.'); }
    const built = HouseCore.build(src);                  // throws with a readable list of problems
    window.HOUSE = built.HOUSE; window.ROOMS = built.ROOMS; window.LEVELS = built.LEVELS;
    window.HOUSE_SOURCE = Object.assign(source, { id: built.HOUSE.id, src });
    await loadScripts(THEN);
  }

  window.HouseLoader = { openHouseText, LOCAL_KEY };
  main().catch(fail);
})();
