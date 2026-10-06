/*
 * Where paint schemes live, plus file and share-link helpers. The paint studio only talks to this interface,
 * so a self-hosted copy can add its own backend (Supabase, Firebase, a small server) without touching the app.
 *
 *   const store = await PaintStore.open(HOUSE_SOURCE)
 *   store.kind          'shared' (everyone with the page sees the same schemes) | 'local' (this browser only)
 *   store.canWrite      false when the viewer may only look
 *   store.watch(onList, onError)       onList([{ id, name, a, created, updated, by }]) now and on every change
 *   await store.save({ id, name, a, created }) -> id      (no id = create)
 *   await store.remove(id)
 *   await store.who(scheme) -> 'you' | a name | null      (who made the last change, when the backend knows)
 *   store.current / store.setCurrent(id)                  the scheme this browser had open last
 *
 *   await PaintStore.saveFile(filename, text) -> 'saved' | 'declined'   (throws when the browser can't save files)
 *   await PaintStore.pack(obj) / PaintStore.unpack(str)                 compact text for share links
 *
 * Backends included:
 *   artifact  the Claude artifact runtime (window.claude): a shared database, viewer identity and downloads
 *   local     localStorage
 * A scheme document: { name, a: { <paintKey>: { b, c, n, h, s } }, house, created, updated, by }
 *   b = brand ('sw' | 'behr' | 'wood' | 'custom'), c = code, n = name, h = hex, s = sheen
 */
(function () {
  const LS = 'paintstudio.schemes.v1';
  const keyFor = source => (source.kind === 'default' ? LS : LS + '.' + source.id);   // the example house keeps the original key
  const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { } };
  const claudeUse = name => { const use = window.claude && window.claude.use; return use ? use.call(window.claude, name) : Promise.reject(new Error('no runtime')); };

  // ------------------------------------------------------------------ local (this browser)
  function localBackend(source) {
    const key = keyFor(source);
    const read = () => { try { return JSON.parse(lsGet(key) || '[]'); } catch { return []; } };
    const write = list => lsSet(key, JSON.stringify(list));
    let listener = null;
    return {
      kind: 'local', canWrite: true,
      watch(onList) { listener = onList; onList(read()); },
      async save(doc) {
        const list = read(), now = new Date().toISOString();
        let id = doc.id;
        if (!id) { id = 'local-' + Date.now(); list.push({ id, created: now }); }
        let s = list.find(x => x.id === id);
        if (!s) { s = { id, created: doc.created || now }; list.push(s); }
        Object.assign(s, { name: doc.name, a: doc.a, updated: now });
        write(list); listener && listener(read());
        return id;
      },
      async remove(id) { write(read().filter(s => s.id !== id)); listener && listener(read()); },
      async who() { return null; },
      get current() { return lsGet(key + '.cur'); },
      setCurrent(id) { lsSet(key + '.cur', id || ''); }
    };
  }

  // ------------------------------------------------------------------ Claude artifact runtime (shared)
  async function artifactBackend(source) {
    if (!(window.claude && window.claude.use)) return null;
    let db = null, user = null;
    try { [db, user] = await Promise.all([claudeUse('db'), claudeUse('user').catch(() => null)]); } catch { db = null; }
    if (!db) return null;
    let canWrite = true, me = null;
    if (user) { const cw = await user.can('data.write'); canWrite = cw !== false; me = await user.id(); }
    const house = source.kind === 'default' ? null : source.id;          // schemes from before houses existed belong to the example
    const mine = d => (d.house || null) === house;
    const col = db.collection('schemes'), key = keyFor(source);
    return {
      kind: 'shared', canWrite,
      watch(onList, onError) {
        col.onSnapshot(snap => onList(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(mine)), onError);
      },
      async save(doc) {
        const now = new Date().toISOString();
        const body = { name: doc.name, a: JSON.parse(JSON.stringify(doc.a)), updated: now, by: me || null };
        if (house) body.house = house;
        if (!doc.id) { const ref = col.doc(); await ref.set({ ...body, created: now }); return ref.id; }
        await col.doc(doc.id).set({ ...body, created: doc.created || now });
        return doc.id;
      },
      async remove(id) { await col.doc(id).delete(); },
      async who(s) {
        if (!s || !s.by || !user) return null;
        const ps = await user.profiles([s.by]);
        return ps[s.by]?.isMe ? 'you' : (ps[s.by]?.name || 'someone');
      },
      get current() { return lsGet(key + '.cur'); },
      setCurrent(id) { lsSet(key + '.cur', id || ''); }
    };
  }

  async function open(source) {
    return (await artifactBackend(source)) || localBackend(source);
  }

  // ------------------------------------------------------------------ files
  async function saveFile(filename, text) {
    if (window.claude && window.claude.use) {
      let dl = null; try { dl = await claudeUse('downloads'); } catch { dl = null; }
      if (dl) {
        try { await dl.save({ filename, data: text }); return 'saved'; }
        catch (e) { if (e && e.code === 'declined') return 'declined'; throw e; }
      }
      throw new Error('downloads unavailable');
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return 'saved';
  }

  // ------------------------------------------------------------------ share links: JSON -> deflate -> base64url
  const b64u = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64u = str => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/')); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };
  async function pack(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    if (window.CompressionStream) {
      const z = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
      return 'z' + b64u(z);
    }
    return 'j' + b64u(bytes);
  }
  async function unpack(str) {
    const bytes = unb64u(str.slice(1));
    if (str[0] === 'z') return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text());
    if (str[0] === 'j') return JSON.parse(new TextDecoder().decode(bytes));
    throw new Error('Unknown share format');
  }

  window.PaintStore = { open, saveFile, pack, unpack };
})();
