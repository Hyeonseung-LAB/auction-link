/* 경매 데이터 저장소 연결 — 구글 시트(앱스 스크립트 웹앱)를 claude.ai 아티팩트 db 와 같은 모양으로 쓴다(10/23).
 *
 * 서영이 만든 캘린더·계산기·입찰기록 페이지는 원래 claude.ai 의 db(collection/doc/onSnapshot)를 썼다.
 * 같은 모양을 흉내 내서 페이지 코드는 거의 그대로 두고 저장소만 시트로 바꾼다.
 *
 *   const db = await SheetDB.use();          // 연결 못 하면 null
 *   db.collection('items').onSnapshot(snap => snap.docs.map(d => ({id: d.id, ...d.data()})))
 *   await db.collection('items').doc(id).set({...});   await db.collection('items').doc().set({...})
 *   await db.collection('bids').add({...});  await db.doc('notes/checklist').set({...})
 *
 * · 처음엔 이 기기에 남겨 둔 마지막 사본을 바로 보여 주고, 시트에서 받아 오면 다시 그린다.
 * · 다른 사람이 고친 것은 화면을 다시 볼 때(탭 전환·폰 켜기)와 1분마다 받아 온다.
 * · 저장은 화면에 먼저 반영하고 시트로 보낸다. 실패하면 되돌리고 오류를 낸다(페이지가 안내).
 * · API 주소가 비어 있거나 주소창에 ?mock=1 이면 이 기기에만 저장하는 시험 모드.
 * · 🔑 두 번째 열쇠(11/2 사장님): 개인 값 읽기와 모든 저장은 두 번째 열쇠(K2)가 있어야 된다. 이 파일엔 없고,
 *   두 폰·PC 가 '…html#k2=열쇠' 링크를 한 번 열면 기기 저장소에 남는다(주소창에선 바로 지운다).
 *   열쇠 없이 저장하면 한 번 물어본다. 열쇠가 없는 방문자는 공개 보기(개인 값 빠짐)만 받는다.
 */
(function () {
  // 앱스 스크립트 웹앱 주소 — 사장님 구글 시트 '경매 데이터'(10/23 배포)
  const API = 'https://script.google.com/macros/s/AKfycbxzqgv3iy5PxAp7n6pvFPfLwdR27HLjimkOL7tUZ_DlPV0G7C56p9SGpn30sWHzA3XDrQ/exec';
  const KEY = '_fCysFJKdJX8agbA';       // Code.gs 의 KEY 와 같아야 한다
  const CACHE = 'sheetdb-cache-v1';
  const K2_STORE = 'sheetdb-k2-v1';
  const MOCK = !API || /[?&]mock=1/.test(location.search);
  const POLL_MS = 60000;

  let state = null;                     // {col: {id: {data, version}}}
  let fresh = false;                    // 시트에서 한 번이라도 받아 왔나(아니면 기기에 남은 사본)
  let loading = null;
  const subs = new Set();               // 화면 갱신 함수들

  // 🔑 두 번째 열쇠 — 주소창 #k2=… 로 한 번 넣으면 기기에 남긴다(주소창·방문 기록에서는 바로 지운다)
  function readK2() { try { return localStorage.getItem(K2_STORE) || ''; } catch (e) { return ''; } }
  function saveK2(v) { try { if (v) localStorage.setItem(K2_STORE, v); else localStorage.removeItem(K2_STORE); } catch (e) { /* 저장 공간 없음 */ } }
  let k2 = readK2();
  (function takeK2FromHash() {
    const m = /(?:^#|&)k2=([A-Za-z0-9_\-]{16,})/.exec(location.hash || '');
    if (!m) return;
    k2 = m[1]; saveK2(k2);
    const rest = (location.hash || '').replace(/(^#|&)k2=[^&]*/, '$1').replace(/^#&/, '#').replace(/^#$/, '');
    try { history.replaceState(null, '', location.pathname + location.search + rest); } catch (e) { /* 그대로 둔다 */ }
    try {
      const t = document.createElement('div');
      t.textContent = '🔑 이 기기에 열쇠를 넣었어요';
      t.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);background:#1f7a4d;color:#fff;'
        + 'padding:10px 16px;border-radius:8px;font-size:14px;z-index:99999;box-shadow:0 2px 8px rgba(0,0,0,.25)';
      const put = () => { document.body.appendChild(t); setTimeout(() => t.remove(), 3500); };
      if (document.body) put(); else document.addEventListener('DOMContentLoaded', put);
    } catch (e) { /* 알림 없이 진행 */ }
  })();
  function askK2() {
    let v = '';
    try { v = (window.prompt('이 기기에서 저장하려면 두 번째 열쇠를 한 번 넣어 주세요.\n(사장님이 보내 준 열쇠 — 한 번 넣으면 이 기기에 남아요)') || '').trim(); } catch (e) { v = ''; }
    if (v.length < 16) return false;
    k2 = v; saveK2(v);
    return true;
  }

  const clone = o => JSON.parse(JSON.stringify(o));
  const newId = () => 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const fail = (code, msg) => Object.assign(new Error(msg || code), { code });

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch (e) { return null; }
  }
  function writeCache() {
    try { localStorage.setItem(CACHE, JSON.stringify(state)); } catch (e) { /* 저장 공간 없음 — 무시 */ }
  }
  function notify() { subs.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }

  async function fetchAll() {
    if (MOCK) return readCache() || {};
    let j = null;
    if (k2) {
      // 열쇠가 있으면 POST 로 전부 읽는다(비밀을 주소에 싣지 않게). 옛 앱스 스크립트는 'read' 를 몰라 공개 읽기로 넘어간다.
      try {
        const r = await fetch(API, { method: 'POST', body: JSON.stringify({ key: KEY, k2: k2, action: 'read' }) });
        j = await r.json();
        if (!j.ok) j = null;
      } catch (e) { j = null; }
    }
    if (!j) {
      const r = await fetch(API + '?key=' + encodeURIComponent(KEY) + '&action=all', { cache: 'no-store' });
      j = await r.json();
    }
    if (!j.ok) throw fail('server', j.error);
    const out = {};
    Object.keys(j.data || {}).forEach(c => {
      out[c] = {};
      (j.data[c] || []).forEach(d => { out[c][d.id] = { data: d.data || {}, version: d.version }; });
    });
    return out;
  }

  async function refresh() {
    try {
      state = await fetchAll();
      fresh = true;
      writeCache();
      notify();
      return true;
    } catch (e) {
      console.warn('시트에서 받아 오지 못함', e);
      return false;
    }
  }

  async function send(body) {
    if (MOCK) return { ok: true };
    let r, j;
    try {
      r = await fetch(API, { method: 'POST', body: JSON.stringify(Object.assign({ key: KEY }, k2 ? { k2: k2 } : {}, body)) });
    } catch (e) { throw fail('unsure', String(e)); }
    try { j = await r.json(); } catch (e) { throw fail('unsure', 'HTTP ' + r.status); }
    if (!j.ok && j.error === 'k2') {
      // 두 번째 열쇠가 없거나 틀렸다 — 한 번 물어보고 그 열쇠로 다시 보낸다
      if (askK2()) return send(body);
      throw fail('k2', '이 기기엔 두 번째 열쇠가 없어 저장하지 못했어요');
    }
    if (!j.ok) throw fail(j.error === 'key' ? 'invalid_argument' : 'server', j.error);
    return j;
  }

  // 답을 못 받았을 때 — 실제로 들어갔는지 시트를 다시 읽어 본다(10/23 실측).
  // 앱스 스크립트가 오래 걸리면(30초↑) 쓰기는 됐는데 답장 주소가 404 로 와서, 그대로 두면 '저장 실패'로 잘못 보였다.
  async function confirmWrite(col, id, data) {
    try {
      const got = await fetchAll();
      const x = got[col] && got[col][id];
      const ok = data === null ? !x : !!x && JSON.stringify(x.data) === JSON.stringify(data);
      if (ok) { state = got; fresh = true; writeCache(); notify(); }
      return ok;
    } catch (e) { return false; }
  }

  async function write(col, id, data) {
    const before = state[col] && state[col][id] ? clone(state[col][id]) : null;
    state[col] = state[col] || {};
    state[col][id] = { data: clone(data), version: before ? before.version : 0 };
    writeCache(); notify();
    try {
      const j = await send({ action: 'set', col, id, data });
      if (j.version) state[col][id].version = j.version;
      writeCache();
    } catch (e) {
      if (e.code === 'unsure' && await confirmWrite(col, id, data)) return;
      if (before) state[col][id] = before; else delete state[col][id];
      writeCache(); notify();
      throw e.code ? e : fail('network', String(e));
    }
  }

  async function remove(col, id) {
    const before = state[col] && state[col][id] ? clone(state[col][id]) : null;
    if (state[col]) delete state[col][id];
    writeCache(); notify();
    try {
      await send({ action: 'delete', col, id });
    } catch (e) {
      if (e.code === 'unsure' && await confirmWrite(col, id, null)) return;
      if (before) { state[col] = state[col] || {}; state[col][id] = before; writeCache(); notify(); }
      throw e.code ? e : fail('network', String(e));
    }
  }

  function docSnap(col, id) {
    const x = state && state[col] && state[col][id];
    return { id, exists: !!x, data: () => (x ? clone(x.data) : undefined), metadata: { fromCache: !fresh && !MOCK } };
  }

  function makeDoc(col, id) {
    id = id || newId();
    return {
      id,
      set: data => write(col, id, data),
      update: data => write(col, id, Object.assign(docSnap(col, id).data() || {}, data)),
      delete: () => remove(col, id),
      get: async () => docSnap(col, id),
      onSnapshot(cb, err) {
        const fn = () => cb(docSnap(col, id));
        subs.add(fn); if (state) fn();
        return () => subs.delete(fn);
      },
    };
  }

  function makeCol(col, order) {
    const snap = () => {
      const docs = Object.keys((state && state[col]) || {}).map(id => docSnap(col, id));
      if (order) {
        const [f, dir] = order;
        docs.sort((a, b) => {
          const x = (a.data() || {})[f] ?? '', y = (b.data() || {})[f] ?? '';
          return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1);
        });
      }
      return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: !fresh && !MOCK } };
    };
    return {
      doc: id => makeDoc(col, id),
      add: async data => { const d = makeDoc(col); await d.set(data); return d; },
      orderBy: (f, dir) => makeCol(col, [f, dir || 'asc']),
      get: async () => snap(),
      onSnapshot(cb, err) {
        const fn = () => cb(snap());
        subs.add(fn); if (state) fn();
        return () => subs.delete(fn);
      },
    };
  }

  const db = {
    collection: name => makeCol(name),
    doc: path => { const [c, id] = String(path).split('/'); return makeDoc(c, id); },
    refresh,
    mock: MOCK,
  };

  async function use() {
    if (!loading) {
      loading = (async () => {
        state = readCache();
        if (state) notify();
        const ok = await refresh();
        if (!ok && !state) { if (MOCK) { state = {}; return db; } return null; }
        if (!state) state = {};
        setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
        return db;
      })();
    }
    return loading;
  }

  // 🔒 잠근 자료 파일(villa_today.json·villa_watch.json) 풀기 — pagelock.py 와 같은 방식(11/6). 안 잠긴 자료는 그대로 돌려준다
  async function openLocked(j) {
    if (!j || !j.lock) return j;
    if (!k2) throw Object.assign(new Error('k2'), { code: 'k2' });
    const enc = new TextEncoder(), bin = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
    const base = await crypto.subtle.importKey('raw', enc.encode(k2), 'HKDF', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: bin(j.s), info: enc.encode('auction-link-lock-v1') },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bin(j.i) }, key, bin(j.d));
    return JSON.parse(await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  }

  window.SheetDB = { use, API, MOCK, hasKey: () => !!k2, forgetKey: () => { k2 = ''; saveK2(''); }, openLocked };
})();
