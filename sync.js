// GearWatch account + sync layer (Supabase). Loaded by GearWatch; does nothing until config.js has a Supabase URL and key.
(function () {
  if (window.GWSync) return; // never run two copies; the app would talk to one that isn't signed in
  const META = 'gearwatch.sync', AUTH = 'gearwatch.auth', FL = 'fitlog.v2', GW = 'gearwatch.v1';
  const LIBS = ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', 'https://unpkg.com/@supabase/supabase-js@2'];
  const cfg = () => ({ url: String(window.GW_SUPABASE_URL || '').trim(), key: String(window.GW_SUPABASE_ANON_KEY || '').trim() });
  let sb = null, host = null, timer = null, busy = false, again = false, lastUid;
  const subs = new Set();
  const S = { configured: !!(cfg().url && cfg().key), ready: false, user: null, email: '', username: null, needName: false, status: 'idle', lastSync: null, error: '', firstDone: false };
  const emit = () => subs.forEach(f => { try { f(Object.assign({}, S)); } catch (e) {} });
  async function profSel(q) { let r = await q('id,username,avatar'); if (r.error && /avatar/i.test(r.error.message || '')) r = await q('id,username'); return r; }
  const set = o => { Object.assign(S, o); emit(); };
  const meta = () => { try { return JSON.parse(localStorage.getItem(META)) || {}; } catch (e) { return {}; } };
  const setMeta = o => { const m = Object.assign(meta(), o); try { localStorage.setItem(META, JSON.stringify(m)); } catch (e) {} return m; };
  const hash = s => { if (s == null) return ''; let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + '-' + s.length; };
  const loadOne = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = () => (window.supabase && window.supabase.createClient ? res() : rej(new Error('no client'))); s.onerror = () => rej(new Error('load failed')); document.head.appendChild(s); });
  async function loadLib() { if (window.supabase && window.supabase.createClient) return; let err; for (const src of LIBS) { try { await loadOne(src); return; } catch (e) { err = e; } } throw err; }
  let started = false, why = '';
  const cachedUser = () => { try { const a = JSON.parse(localStorage.getItem(AUTH)); return a && a.user ? { id: a.user.id, email: a.user.email } : null; } catch (e) { return null; } };
  const uname = s => String(s || '').trim().replace(/^@/, '').toLowerCase();

  async function connect() {
    if (sb) return true;
    try { await loadLib(); } catch (e) { why = navigator.onLine ? 'Couldn’t load the sign-in service. A content blocker may be stopping cdn.jsdelivr.net.' : 'You’re offline.'; return false; }
    const c = cfg();
    try { sb = window.supabase.createClient(c.url, c.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: AUTH } }); }
    catch (e) { why = 'The Supabase address in config.js looks wrong. It should look like https://abcd.supabase.co'; return false; }
    sb.auth.onAuthStateChange((ev, s) => { setTimeout(() => onSession(s), 0); });
    try { const { data } = await sb.auth.getSession(); await onSession(data.session); } catch (e) {}
    return true;
  }
  async function init() {
    if (!S.configured) { set({ ready: true }); return; }
    if (!started) { started = true;
      window.addEventListener('online', () => { connect().then(() => schedule(0)); });
      window.addEventListener('offline', () => set({ status: 'offline' }));
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(0); }); }
    if (!(await connect())) { const u = cachedUser(); set({ ready: true, user: u, email: u ? u.email : '', avatar: u ? meta().avatar || null : null, status: 'offline', firstDone: true, error: why }); return; }
    set({ ready: true });
  }

  async function onSession(s) {
    const u = s ? s.user : null, uid = u ? u.id : null;
    if (uid === lastUid) return; lastUid = uid;
    if (!u) { set({ user: null, email: '', username: null, avatar: null, needName: false, firstDone: false }); return; }
    const mm = meta(); set({ user: { id: u.id, email: u.email }, email: u.email || '', avatar: mm.uid === uid ? mm.avatar || null : null });
    try { const { data, error } = await profSel(c => sb.from('profiles').select(c).eq('id', uid).maybeSingle()); if (error) throw error; const avv = data && data.avatar || null; set({ username: data ? data.username : null, needName: !data, avatar: avv }); setMeta({ avatar: avv }); }
    catch (e) { set({ needName: false }); }
    await sync(); set({ firstDone: true });
  }

  const hasStuff = gw => !!gw && (gw.profiles || []).some(p => (p.items || []).length || (p.outfits || []).length);
  function merge(a, b) {
    const out = JSON.parse(JSON.stringify(a || {})), L = JSON.parse(JSON.stringify(b || {}));
    out.profiles = out.profiles || [];
    (L.profiles || []).forEach(lp => {
      let sp = out.profiles.find(p => p.id === lp.id);
      if (!sp && out.profiles.length === 1 && (L.profiles || []).length === 1) sp = out.profiles[0];
      if (!sp) { out.profiles.push(lp); return; }
      if (!(sp.items || []).length && !(sp.outfits || []).length) { Object.keys(sp).forEach(k => delete sp[k]); Object.assign(sp, lp); if (out.activeId !== lp.id && out.profiles.length === 1) out.activeId = lp.id; return; }
      const ids = new Set((sp.items || []).map(i => i.id)); (lp.items || []).forEach(i => { if (!ids.has(i.id)) (sp.items = sp.items || []).push(i); });
      const oids = new Set((sp.outfits || []).map(o => o.id)); (lp.outfits || []).forEach(o => { if (!oids.has(o.id)) (sp.outfits = sp.outfits || []).push(o); });
      if (!sp.session && lp.session) sp.session = lp.session;
      if (!(sp.budget && sp.budget.amount) && lp.budget && lp.budget.amount) sp.budget = lp.budget;
    });
    out.collCats = [...new Set((out.collCats || []).concat(L.collCats || []))];
    out.onboarded = !!(out.onboarded || L.onboarded); out.v = out.v || L.v || 1;
    Object.keys(L).forEach(k => { if (/^imp\d+$/.test(k) && L[k]) out[k] = true; });
    if (!out.profiles.find(p => p.id === out.activeId)) out.activeId = (out.profiles[0] || {}).id;
    return out;
  }
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(sync, ms == null ? 1500 : ms); }

  async function uploadPhotos(gw, uid) {
    const up = async src => {
      if (!/^data:image\//.test(src || '')) return src;
      const blob = await (await fetch(src)).blob(), ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg'), path = uid + '/' + hash(src) + '.' + ext;
      const r = await sb.storage.from('photos').upload(path, blob, { contentType: blob.type, upsert: false, cacheControl: '31536000' });
      if (r.error && !/exist|duplicate/i.test(r.error.message || '')) throw r.error;
      return sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
    };
    for (const p of gw.profiles || []) {
      for (const it of p.items || []) if (it.photos) it.photos = await Promise.all(it.photos.map(up));
      for (const o of p.outfits || []) if (o.photos) o.photos = await Promise.all(o.photos.map(up));
    }
  }

  function publicList(gw) {
    const p = (gw.profiles || []).find(x => x.id === gw.activeId) || (gw.profiles || [])[0] || { items: [] };
    const web = a => (a || []).filter(x => /^https?:/.test(x)).slice(0, 4);
    const items = p.items || [];
    return {
      wish: items.filter(i => i.status === 'wanted').map(i => ({ id: i.id, n: i.name, b: i.brand, cat: i.category, ph: web(i.photos), u: i.url, c: i.currency, p: i.price, r: i.rating, a: i.added, s: i.size || undefined, co: i.colour || undefined, m: i.m2m ? 1 : undefined })),
      coll: items.filter(i => i.status === 'owned' || i.status === 'ordered').map(i => ({ id: i.id, n: i.name, b: i.brand, cat: i.category, g: i.cgroup, ph: web(i.photos), o: i.ownedOn || i.orderedOn || i.added, ow: i.status === 'ordered' ? 1 : undefined, s: i.size || undefined, co: i.colour || undefined, m: i.m2m ? 1 : undefined, u: i.url })),
      outfits: (p.outfits || []).map((o, i) => ({ id: o.id, n: o.name || 'Outfit ' + (i + 1), ids: o.itemIds, pos: o.pos, ph: web(o.photos), w: (o.worn || []).length, lw: (o.worn || []).slice(-1)[0], cr: o.created }))
    };
  }

  async function sync() {
    if (!sb || !S.user || !host) return;
    if (busy) { again = true; return; }
    if (!navigator.onLine) { set({ status: 'offline' }); return; }
    busy = true; set({ status: 'syncing', error: '' });
    try {
      if (!(await fresh())) throw new Error('Signed-in session is refreshing. Trying again shortly.');
      const uid = S.user.id, m = meta(), known = m.uid === uid;
      let gw = host.get(); const before = gw.mod || 0, fl = localStorage.getItem(FL);
      let lmod = before; if (known && hash(fl) !== m.flHash) lmod = Math.max(lmod, Date.now());
      const { data: row, error } = await sb.from('user_data').select('data').eq('user_id', uid).maybeSingle(); if (error) throw error;
      const rmod = row && row.data ? row.data.mod || 0 : 0, base = known ? m.base || 0 : 0;
      let action = 'none';
      if (!row) action = 'push';
      else if (!known) { const sg = row.data && row.data.gw; action = !hasStuff(sg) ? (hasStuff(gw) ? 'push' : 'pull') : !hasStuff(gw) ? 'pull' : 'merge'; }
      else { const ld = lmod > base, rd = rmod > base; action = ld && rd ? (lmod >= rmod ? 'push' : 'pull') : ld ? 'push' : rd ? 'pull' : 'none'; }
      if (action === 'pull') {
        const d = row.data; if (d.gw) host.apply(d.gw);
        if (d.fitlog != null) { try { localStorage.setItem(FL, d.fitlog); } catch (e) {} }
        setMeta({ uid, base: rmod, flHash: hash(d.fitlog != null ? d.fitlog : fl) });
      } else if (action === 'push' || action === 'merge') {
        gw = action === 'merge' ? merge(row.data.gw, gw) : JSON.parse(JSON.stringify(gw));
        if (action === 'merge') lmod = Math.max(lmod, rmod, Date.now()); await uploadPhotos(gw, uid); gw.mod = lmod || Date.now();
        if ((host.get().mod || 0) === before) host.apply(gw); else again = true;
        const now = new Date().toISOString();
        const r = await sb.from('user_data').upsert({ user_id: uid, data: { v: 1, mod: gw.mod, gw, fitlog: fl }, updated_at: now }); if (r.error) throw r.error;
        await sb.from('public_lists').upsert({ user_id: uid, list: publicList(gw), updated_at: now });
        setMeta({ uid, base: gw.mod, flHash: hash(fl) });
      }
      set({ status: 'synced', lastSync: Date.now() });
    } catch (e) { set({ status: navigator.onLine ? 'error' : 'offline', error: (e && e.message) || 'Sync failed' }); }
    busy = false; if (again) { again = false; schedule(500); }
  }

  // Make sure the sign-in token is valid before asking the database. After the app sleeps it can be expired,
  // and the database then answers with nothing instead of an error.
  const within = (p, ms) => Promise.race([p, new Promise(res => setTimeout(() => res('timeout'), ms))]);
  async function fresh() {
    try { const g = await within(sb.auth.getSession(), 5000); if (g === 'timeout') return true; const s = g.data && g.data.session; if (!s) return false;
      return true; } catch (e) { return true; }
  }
  async function social() {
    if (!sb) await connect(); if (!sb || !S.user) return null; const me = S.user.id;
    if (!(await fresh())) return null;
    const [a, b] = await Promise.all([sb.from('follows').select('followee,status').eq('follower', me), sb.from('follows').select('follower,status').eq('followee', me)]);
    if (a.error || b.error) throw new Error((a.error || b.error).message || 'Couldn’t load friends');
    const out = a.data || [], inc = b.data || [], ids = [...new Set(out.map(x => x.followee).concat(inc.map(x => x.follower)))], names = {}, avs = {}, lists = {};
    if (ids.length) { const r = await profSel(c => sb.from('profiles').select(c).in('id', ids)); if (r.error) throw new Error(r.error.message); (r.data || []).forEach(x => { names[x.id] = x.username; avs[x.id] = x.avatar || null; }); }
    const acc = out.filter(x => x.status === 'accepted').map(x => x.followee);
    if (acc.length) { const r = await sb.from('public_lists').select('user_id,list').in('user_id', acc); if (r.error) throw new Error(r.error.message); (r.data || []).forEach(x => { lists[x.user_id] = x.list; }); }
    return {
      following: out.map(x => ({ id: x.followee, username: names[x.followee] || 'unknown', avatar: avs[x.followee] || null, status: x.status })),
      requests: inc.filter(x => x.status === 'pending').map(x => ({ id: x.follower, username: names[x.follower] || 'unknown', avatar: avs[x.follower] || null })),
      followers: inc.filter(x => x.status === 'accepted').map(x => ({ id: x.follower, username: names[x.follower] || 'unknown', avatar: avs[x.follower] || null })),
      lists
    };
  }
  async function follow(name) {
    const u = uname(name); if (!u) throw new Error('Type a username.');
    if (!(await connect()) || !S.user) throw new Error(why || 'You’re offline.');
    const { data } = await sb.from('profiles').select('id,username').eq('username', u).maybeSingle();
    if (!data) throw new Error('No one is called @' + u + '.');
    if (data.id === S.user.id) throw new Error('That’s you.');
    const r = await sb.from('follows').insert({ follower: S.user.id, followee: data.id });
    if (r.error && !/duplicate/i.test(r.error.message || '')) throw r.error;
    return data.username;
  }
  const unfollow = id => sb.from('follows').delete().eq('follower', S.user.id).eq('followee', id);
  const accept = id => sb.from('follows').update({ status: 'accepted' }).eq('follower', id).eq('followee', S.user.id);
  const decline = id => sb.from('follows').delete().eq('follower', id).eq('followee', S.user.id);
  async function setUsername(name) {
    const u = uname(name);
    if (!/^[a-z0-9_.]{3,20}$/.test(u)) throw new Error('Use 3–20 letters, numbers, dots or underscores.');
    if (!(await connect()) || !S.user) throw new Error(why || 'You’re offline.');
    const me = S.user.id, own = await sb.from('profiles').select('id,username').eq('id', me).maybeSingle();
    if (own.data && own.data.username === u) { set({ username: u, needName: false }); schedule(0); return; }
    const taken = await sb.from('profiles').select('id').eq('username', u).maybeSingle();
    if (taken.data && taken.data.id !== me) throw new Error('@' + u + ' is taken.');
    const r = own.data ? await sb.from('profiles').update({ username: u }).eq('id', me) : await sb.from('profiles').insert({ id: me, username: u });
    if (r.error) { const m = r.error.message || ''; throw new Error(r.error.code === '23505' && /username/i.test(m) ? '@' + u + ' is taken.' : 'Couldn’t save: ' + m); }
    set({ username: u, needName: false }); schedule(0);
  }
  async function setAvatar(src) {
    if (!navigator.onLine || !(await connect()) || !S.user) throw new Error(why || 'You’re offline. Try again when you’re connected.');
    const me = S.user.id; let url = null;
    if (src) { const blob = await (await fetch(src)).blob(), path = me + '/avatar-' + hash(src) + '.jpg';
      const r = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
      if (r.error && !/exist|duplicate/i.test(r.error.message || '')) throw new Error('Couldn’t upload: ' + r.error.message);
      url = sb.storage.from('photos').getPublicUrl(path).data.publicUrl; }
    const r = await sb.from('profiles').update({ avatar: url }).eq('id', me);
    if (r.error) throw new Error(/avatar/i.test(r.error.message || '') ? 'Profile photos need a database update. Run supabase/setup.sql again.' : 'Couldn’t save: ' + r.error.message);
    set({ avatar: url }); setMeta({ avatar: url });
  }
  async function sendCode(email) {
    if (!(await connect())) throw new Error(why || 'You’re offline.');
    const r = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } });
    if (r.error) throw r.error;
  }
  async function verify(email, token) { const r = await sb.auth.verifyOtp({ email, token, type: 'email' }); if (r.error) throw r.error; }
  async function signOut() {
    await sync();
    if (S.status !== 'synced') throw new Error('Couldn’t back up your latest changes. Try again when you’re online.');
    await sb.auth.signOut();
    [META, GW, FL].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
    location.reload();
  }

  window.GWSync = {
    init, schedule, sync, social, setAvatar, follow, unfollow, accept, decline, setUsername, sendCode, verify, signOut,
    attach: h => { host = h; },
    on: f => { subs.add(f); f(Object.assign({}, S)); return () => subs.delete(f); },
    state: () => Object.assign({}, S)
  };
})();
