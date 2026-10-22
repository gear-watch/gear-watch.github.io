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

  let upFails = 0, upMsg = '';
  async function uploadPhotos(gw, uid) {
    upFails = 0;
    const up = async src => {
      if (!/^data:image\//.test(src || '')) return src;
      const blob = await (await fetch(src)).blob(), ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg'), path = uid + '/' + hash(src) + '.' + ext;
      const r = await sb.storage.from('photos').upload(path, blob, { contentType: blob.type, upsert: false, cacheControl: '31536000' });
      if (r.error && !/exist|duplicate/i.test(r.error.message || '')) { console.warn('photo upload failed', r.error.message); upFails++; upMsg = r.error.message || ''; return src; }
      return sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
    };
    for (const p of gw.profiles || []) {
      if (p.banner) p.banner = await up(p.banner);
      for (const it of p.items || []) { if (it.photos) it.photos = await Promise.all(it.photos.map(up)); if (it.origs) it.origs = await Promise.all(it.origs.map(async x => Object.assign({}, x, { c: await up(x.c), o: await up(x.o) }))); }
      for (const o of p.outfits || []) if (o.photos) o.photos = await Promise.all(o.photos.map(up));
    }
  }

  function publicList(gw) {
    const p = (gw.profiles || []).find(x => x.id === gw.activeId) || (gw.profiles || [])[0] || { items: [] };
    const web = a => (a || []).filter(x => /^https?:/.test(x)).slice(0, 4);
    const items = (p.items || []).filter(i => !i.private);
    return {
      bn: /^https?:/.test(p.banner || '') ? p.banner : undefined,
      wish: items.filter(i => i.status === 'wanted').map(i => ({ id: i.id, n: i.name, b: i.brand, cat: i.category, ph: web(i.photos), u: i.url, c: i.currency, p: i.price, r: i.rating, a: i.added, at: i.addedAt || undefined, s: i.size || undefined, co: i.colour || undefined, po: i.photosOn || undefined, pt: i.photosAt || undefined, z: i.zip || undefined, m: i.m2m ? 1 : undefined })),
      coll: items.filter(i => i.status === 'owned' || i.status === 'ordered').map(i => ({ id: i.id, n: i.name, b: i.brand, cat: i.category, g: i.cgroup, ph: web(i.photos), o: i.preGw ? i.added : i.ownedOn || i.orderedOn || i.added, pre: i.preGw ? 1 : undefined, ad: i.preGw || (i.ownedOn && i.added && i.ownedOn < i.added) ? 1 : undefined, ad2: i.added || undefined, ot: i.ownedAt || i.addedAt || undefined, ow: i.status === 'ordered' ? 1 : undefined, rc: i.status === 'owned' && i.rec ? i.rec : undefined, pp: i.priceUnknown ? undefined : (i.paid != null ? i.paid : i.price != null ? i.price : undefined), pc: i.paid != null ? (i.paidCur || '€') : (i.currency || '€'), hm: i.handmade ? 1 : undefined, sh: i.secondHand ? 1 : undefined, cnd: i.secondHand && i.condition ? i.condition : undefined, pu: i.priceUnknown ? 1 : undefined, ap: i.approx ? 1 : undefined, b: i.brandUnknown ? 'Unknown brand' : i.brand, md: i.modified ? (i.mods || 1) : undefined, s: i.size || undefined, co: i.colour || undefined, po: i.photosOn || undefined, pt: i.photosAt || undefined, z: i.zip || undefined, m: i.m2m ? 1 : undefined, u: i.url })),
      outfits: (p.outfits || []).map((o, i) => ({ id: o.id, n: o.name || 'Outfit ' + (i + 1), ids: o.itemIds, sz: o.sizes && Object.keys(o.sizes).length ? o.sizes : undefined, tg: o.tags && Object.keys(o.tags).length ? o.tags : undefined, ph: web(o.photos), w: (o.worn || []).length, lw: (o.worn || []).slice(-1)[0], cr: o.created, ct: o.createdAt || undefined, wt: o.wornAt || undefined }))
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
        if (action === 'merge') lmod = Math.max(lmod, rmod, Date.now()); await uploadPhotos(gw, uid); set({ photoErr: upFails ? { n: upFails, msg: upMsg, at: Date.now() } : null }); gw.mod = lmod || Date.now();
        if ((host.get().mod || 0) === before) host.apply(gw); else again = true;
        const now = new Date().toISOString();
        const r = await sb.from('user_data').upsert({ user_id: uid, data: { v: 1, mod: gw.mod, gw, fitlog: fl }, updated_at: now }); if (r.error) throw r.error;
        await sb.from('public_lists').upsert({ user_id: uid, list: publicList(gw), updated_at: now });
        setMeta({ uid, base: gw.mod, flHash: hash(fl) });
      }
      if (action === 'none' || action === 'pull') { try { const pl = publicList(host.get()), ph = hash(JSON.stringify(pl)); if (localStorage.getItem('gearwatch.plhash.' + uid) !== ph && !JSON.stringify(((host.get().profiles || []).find(x => x.id === host.get().activeId) || {}).items || []).includes('"data:image')) { const r2 = await sb.from('public_lists').upsert({ user_id: uid, list: pl, updated_at: new Date().toISOString() }); if (!r2.error) localStorage.setItem('gearwatch.plhash.' + uid, ph); } } catch (e) {} }
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
    if (acc.length) { const r = await sb.from('public_lists').select('user_id,list,updated_at').in('user_id', acc); if (r.error) throw new Error(r.error.message); (r.data || []).forEach(x => { lists[x.user_id] = Object.assign({}, x.list, { _up: x.updated_at || null }); }); }
    return {
      following: out.map(x => ({ id: x.followee, username: names[x.followee] || 'unknown', avatar: avs[x.followee] || null, status: x.status })),
      requests: inc.filter(x => x.status === 'pending').map(x => ({ id: x.follower, username: names[x.follower] || 'unknown', avatar: avs[x.follower] || null })),
      followers: inc.filter(x => x.status === 'accepted').map(x => ({ id: x.follower, username: names[x.follower] || 'unknown', avatar: avs[x.follower] || null })),
      lists
    };
  }
  // Friends are mutual: a request becomes a friendship on both sides once either person accepts.
  async function follow(name) {
    const u = uname(name); if (!u) throw new Error('Type a username.');
    if (!(await connect()) || !S.user) throw new Error(why || 'You’re offline.');
    const { data } = await sb.from('profiles').select('id,username').eq('username', u).maybeSingle();
    if (!data) throw new Error('No one is called @' + u + '.');
    if (data.id === S.user.id) throw new Error('That’s you.');
    const inc = await sb.from('follows').select('status').eq('follower', data.id).eq('followee', S.user.id).maybeSingle();
    if (inc.data) { await accept(data.id); return { username: data.username, mutual: true }; }
    const r = await sb.from('follows').insert({ follower: S.user.id, followee: data.id });
    if (r.error && !/duplicate/i.test(r.error.message || '')) throw r.error;
    return { username: data.username, mutual: false };
  }
  async function unfollow(id) { const me = S.user.id; await Promise.all([sb.from('follows').delete().eq('follower', me).eq('followee', id), sb.from('follows').delete().eq('follower', id).eq('followee', me)]); }
  async function accept(id) {
    const r = await sb.rpc('accept_friend', { other: id });
    if (!r.error) return;
    // Database not updated yet: accept one way, like before.
    const u = await sb.from('follows').update({ status: 'accepted' }).eq('follower', id).eq('followee', S.user.id); if (u.error) throw u.error;
    if (/accept_friend|function/i.test(r.error.message || '')) console.warn('Run supabase/setup.sql again to make friendships two-way.');
  }
  async function findUser(name) {
    const u = uname(name); if (!u || !(await connect())) return null;
    const r = await profSel(c => sb.from('profiles').select(c).eq('username', u).maybeSingle()); return r.data ? { id: r.data.id, username: r.data.username, avatar: r.data.avatar || null } : null;
  }
  async function searchUsers(q) {
    const u = uname(q).replace(/[^a-z0-9_.]/g, ''); if (!u || !sb || !S.user) return [];
    const pat = u.replace(/[_%\\]/g, m => '\\' + m) + '%';
    const r = await profSel(c => sb.from('profiles').select(c).ilike('username', pat).neq('id', S.user.id).order('username').limit(6));
    return (r.data || []).map(x => ({ id: x.id, username: x.username, avatar: x.avatar || null }));
  }
  const rpcErr = e => new Error(/function|schema cache|does not exist/i.test((e && e.message) || '') ? 'Run supabase/setup.sql again to turn this on.' : (e && e.message) || 'Couldn’t load');
  async function friendsOf(id) { if (!sb) await connect(); if (!sb || !S.user) return null;
    const r = await sb.rpc('friends_of', { target: id }); if (r.error) throw rpcErr(r.error);
    return (r.data || []).map(x => ({ id: x.id, username: x.username, avatar: x.avatar || null })); }
  async function suggestions() { if (!sb || !S.user) return [];
    const r = await sb.rpc('friend_suggestions'); if (r.error) return [];
    return (r.data || []).map(x => ({ id: x.id, username: x.username, avatar: x.avatar || null, mutuals: x.mutuals || 0, via: x.via || [] })); }
  async function shareCreate(data) { if (!sb) await connect(); if (!sb || !S.user) return null; const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    for (let t = 0; t < 3; t++) { const id = Array.from(crypto.getRandomValues(new Uint8Array(7)), b => A[b % A.length]).join(''); const r = await sb.from('shares').insert({ id, data }); if (!r.error) return id; if (!/duplicate|exist/i.test(r.error.message || '')) return null; } return null; }
  async function shareGet(id) { if (!sb) await connect(); if (!sb) return null; const r = await sb.from('shares').select('data').eq('id', id).maybeSingle(); return r.data ? r.data.data : null; }
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

  // ===== Stories =====
  const urlCache = new Map(); // path -> { url, until }
  async function signed(paths) {
    const now = Date.now(), need = [...new Set(paths)].filter(p => { const c = urlCache.get(p); return !c || c.until < now; });
    for (let i = 0; i < need.length; i += 100) {
      const r = await sb.storage.from('stories').createSignedUrls(need.slice(i, i + 100), 3600);
      (r.data || []).forEach(x => { if (x.signedUrl) urlCache.set(x.path, { url: x.signedUrl, until: now + 50 * 60000 }); });
    }
    const out = {}; paths.forEach(p => { const c = urlCache.get(p); if (c) out[p] = c.url; }); return out;
  }
  async function storiesLoad() {
    if (!sb) await connect(); if (!sb || !S.user) return null; if (!(await fresh())) return null; const me = S.user.id, nowISO = new Date().toISOString();
    const r = await sb.from('stories').select('id,user_id,created_at,expires_at,audience,blur,caption,media,items,poll,highlight').or('expires_at.gt.' + nowISO + ',highlight.not.is.null').order('created_at', { ascending: true }).limit(400);
    if (r.error) { if (/stories/i.test(r.error.message || '') && /exist|schema/i.test(r.error.message || '')) return { missing: true, list: [] }; throw new Error(r.error.message); }
    const list = r.data || [], ids = list.map(s => s.id), urls = await signed(list.flatMap(s => (s.media || []).map(m => m.path)));
    list.forEach(s => (s.media || []).forEach(m => { m.url = urls[m.path] || ''; }));
    const mine = list.filter(s => s.user_id === me).map(s => s.id), polls = list.filter(s => s.poll).map(s => s.id);
    const q = (t, sel, col, vals) => vals.length ? sb.from(t).select(sel).in(col, vals) : Promise.resolve({ data: [] });
    const NONE = ['00000000-0000-0000-0000-000000000000'];
    const [sv, vw, rx, rp, vt, cf] = await Promise.all([sb.from('story_views').select('story_id').eq('viewer', me).in('story_id', ids.length ? ids : NONE), q('story_views', 'story_id,viewer,seen_at', 'story_id', mine), q('story_reactions', 'story_id,user_id,kind,created_at', 'story_id', ids), q('story_replies', 'id,story_id,from_user,body,created_at', 'story_id', mine), q('story_votes', 'story_id,user_id,choice', 'story_id', polls), sb.from('close_friends').select('friend').eq('owner', me)]);
    const who = [...new Set([].concat((vw.data || []).map(x => x.viewer), (rx.data || []).map(x => x.user_id), (rp.data || []).map(x => x.from_user)))].filter(id => id !== me), prof = {};
    if (who.length) { const pr = await profSel(c => sb.from('profiles').select(c).in('id', who)); (pr.data || []).forEach(x => { prof[x.id] = { id: x.id, username: x.username, avatar: x.avatar || null }; }); }
    return { list, me, seenIds: (sv.data || []).map(x => x.story_id), views: (vw.data || []).filter(x => x.viewer !== me), reactions: rx.data || [], replies: rp.data || [], votes: vt.data || [], close: (cf.data || []).map(x => x.friend), prof };
  }
  // Deletes your own stories that have ended (and aren't Highlights), files included. Runs from your own app.
  async function storiesCleanup() {
    if (!sb || !S.user || !navigator.onLine) return 0; const cut = new Date(Date.now() - 3600000).toISOString();
    const r = await sb.from('stories').select('id,media').eq('user_id', S.user.id).is('highlight', null).lt('expires_at', cut).limit(50);
    const list = r.data || []; if (!list.length) return 0;
    const paths = list.flatMap(s => (s.media || []).map(m => m.path)); for (let i = 0; i < paths.length; i += 100) await sb.storage.from('stories').remove(paths.slice(i, i + 100));
    await sb.from('stories').delete().in('id', list.map(s => s.id)); return list.length;
  }
  async function storyPost(o) {
    if (!navigator.onLine || !(await connect()) || !S.user) throw new Error('You’re offline. Try again when you’re connected.');
    const me = S.user.id, sid = (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); })), media = [];
    for (let i = 0; i < o.files.length; i++) { const f = o.files[i], ext = f.type === 'video' ? ((f.blob.type.split('/')[1] || 'mp4').replace('quicktime', 'mov')) : 'jpg', path = me + '/' + sid + '/' + i + '.' + ext;
      const u = await sb.storage.from('stories').upload(path, f.blob, { contentType: f.blob.type || (f.type === 'video' ? 'video/mp4' : 'image/jpeg'), upsert: false });
      if (u.error) throw new Error(/bucket/i.test(u.error.message || '') ? 'Stories need a database update. Run supabase/setup.sql again.' : 'Couldn’t upload: ' + u.error.message);
      media.push({ path, type: f.type, w: f.w || null, h: f.h || null, dur: f.dur || null, tags: (f.tags || []).slice(0, 12).map(g => ({ id: g.id, x: g.x, y: g.y })) }); if (o.onProgress) o.onProgress((i + 1) / o.files.length); }
    const r = await sb.from('stories').insert({ id: sid, user_id: me, audience: o.audience === 'close' ? 'close' : 'all', blur: !!o.blur, caption: (o.caption || '').trim().slice(0, 300) || null, media, items: o.items || [], poll: o.poll || null });
    if (r.error) throw new Error(/stories/i.test(r.error.message || '') ? 'Stories need a database update. Run supabase/setup.sql again.' : 'Couldn’t post: ' + r.error.message);
    return sid;
  }
  async function storyView(sid) { if (!sb || !S.user || !sid) return; const r = await sb.from('story_views').upsert({ story_id: sid, viewer: S.user.id }, { onConflict: 'story_id,viewer', ignoreDuplicates: true }); if (r.error) console.warn('story view', r.error.message); }
  async function storyReact(sid, kind, on) { const r = on ? await sb.from('story_reactions').upsert({ story_id: sid, user_id: S.user.id, kind }, { onConflict: 'story_id,user_id,kind', ignoreDuplicates: true }) : await sb.from('story_reactions').delete().eq('story_id', sid).eq('user_id', S.user.id).eq('kind', kind); if (r.error) throw new Error(r.error.message); }
  async function storyReply(sid, body) { const r = await sb.from('story_replies').insert({ story_id: sid, from_user: S.user.id, body: String(body).trim().slice(0, 500) }); if (r.error) throw new Error(r.error.message); }
  async function storyVote(sid, choice) { const r = await sb.from('story_votes').upsert({ story_id: sid, user_id: S.user.id, choice }, { onConflict: 'story_id,user_id' }); if (r.error) throw new Error(r.error.message); }
  async function storyPin(sid, name) { const r = await sb.from('stories').update({ highlight: name ? String(name).slice(0, 30) : null }).eq('id', sid); if (r.error) throw new Error(r.error.message); }
  async function storyDelete(s) { await sb.storage.from('stories').remove((s.media || []).map(m => m.path)); const r = await sb.from('stories').delete().eq('id', s.id); if (r.error) throw new Error(r.error.message); }
  async function closeSet(id, on) { const me = S.user.id; const r = on ? await sb.from('close_friends').upsert({ owner: me, friend: id }, { onConflict: 'owner,friend', ignoreDuplicates: true }) : await sb.from('close_friends').delete().eq('owner', me).eq('friend', id); if (r.error) throw new Error(r.error.message); }
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
    init, schedule, sync, social, shareCreate, shareGet, publicList: () => { try { return host ? publicList(host.get()) : null; } catch (e) { return null; } }, friendsOf, suggestions, setAvatar, follow, findUser, searchUsers, storiesLoad, storiesCleanup, storyPost, storyView, storyReact, storyReply, storyVote, storyPin, storyDelete, closeSet, unfollow, accept, decline, setUsername, sendCode, verify, signOut,
    attach: h => { host = h; },
    on: f => { subs.add(f); f(Object.assign({}, S)); return () => subs.delete(f); },
    state: () => Object.assign({}, S)
  };
})();
