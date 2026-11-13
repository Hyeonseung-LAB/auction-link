/* 📝 입찰기록 → ⭐ 관심물건(캘린더) 자동 담기 — 11/13 사장님 "우리 입찰목록에 넣으면 당연히 관심목록에 들어가서 캘린더에서 확인할 수 있게".
 *
 * 입찰기록(bids)은 📝 입찰 페이지·📌 오늘 ✅ 넣었음·Claude 가 적고, 캘린더는 관심물건(items)만 그린다.
 * 그래서 입찰을 적어도 캘린더에 안 나왔다. 입찰·캘린더·오늘 화면이 열릴 때(그리고 입찰을 적은 뒤) BidSync.sync(db) 로 맞춘다.
 *  · 결과를 기다리는 입찰(대기 · 매각기일이 사흘 전 이후)마다
 *      같은 사건의 관심물건이 있으면 → 그 매각기일 일정이 없을 때 넣고, 상태 관심·입찰 예정 → 입찰 완료, 입찰가가 비었으면 채운다.
 *      없으면 → 빌라 페이지 ☆ 관심과 같은 이름(c연도-번호)으로 새로 담는다(빌라 카드에도 ★ 로 보인다).
 *  · 한 번 담은 입찰은 notes/bid-items 에 적어 둔다 — 사람이 캘린더에서 지운 물건은 다시 살리지 않는다.
 *  · 결과(낙찰·패찰)가 나오면 관심물건 상태도 따라간다 — 그 물건의 마지막 매각기일 결과이고 상태가 관심·입찰 예정·입찰 완료일 때만.
 *  · 기기에 남은 옛 사본(시트에서 못 받아 옴)으로는 아무것도 안 쓴다(남이 고친 물건을 덮지 않게).
 */
(function () {
  // 사건번호 → 'c2026-501617' (물건번호 1은 안 붙인다 — 빌라 페이지·오늘 화면과 같게)
  const ck = c => { const m = String(c || '').replace(/\s/g, '').match(/(\d{4})타경(\d+)(?:\((\d+)\))?/); return m ? 'c' + m[1] + '-' + m[2] + (m[3] && m[3] !== '1' ? '-' + m[3] : '') : ''; };
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
  const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const WAIT = new Set(['', '대기']);
  const OPEN = new Set(['관심', '입찰 예정', '입찰 완료']);
  const LOOKBACK = 3;                   // 결과가 늦게 올라와도(bid_watch 와 같은 사흘) 담는다
  const won = n => Math.round(Number(n) || 0).toLocaleString('ko-KR') + '원';
  let running = null;

  async function sync(db) {
    if (!db) return 0;
    if (running) return running;        // 페이지 열 때·저장 직후가 겹쳐도 한 번만
    running = (async () => {
      const bs = await db.collection('bids').get(), is = await db.collection('items').get();
      if (bs.metadata.fromCache || is.metadata.fromCache) return 0;
      const rows = d => d.docs.filter(x => x.exists).map(x => Object.assign({ id: x.id }, x.data() || {}));
      const bids = rows(bs), items = rows(is);
      const nd = await db.doc('notes/bid-items').get();
      const seen = new Set(((nd.exists && nd.data()) || {}).keys || []);
      const find = k => items.find(it => ck(it.caseNo) === k || it.id === k);
      const now = new Date().toISOString(), cut = daysAgo(LOOKBACK);
      let n = 0, seenAdd = false;
      for (const b of bids) {
        const k = ck(b.case);
        if (!k || !isDay(b.date) || !WAIT.has(b.result || '') || b.date < cut) continue;
        const key = k + '@' + b.date, it = find(k);
        if (it) {
          const body = Object.assign({}, it); delete body.id;
          const evs = (it.events || []).slice();
          let ch = false;
          if (!evs.some(e => e.kind === '매각기일' && e.date === b.date)) {
            evs.push({ id: 'b' + b.date.replace(/-/g, ''), date: b.date, time: '10:00', kind: '매각기일', note: '📝 우리 입찰 ' + won(b.bid) }); ch = true;
          }
          if (OPEN.has(it.status || '관심') && it.status !== '입찰 완료') { body.status = '입찰 완료'; ch = true; }
          if (!it.bid && b.bid) { body.bid = b.bid; body.who = b.who || it.who || '서영'; ch = true; }
          if (ch) { body.events = evs; body.updatedAt = now; await db.collection('items').doc(it.id).set(body); items.splice(items.indexOf(it), 1, Object.assign({ id: it.id }, body)); n++; }
          if (!seen.has(key)) { seen.add(key); seenAdd = true; }
        } else if (!seen.has(key)) {
          const body = { caseNo: b.case, court: b.court || '', title: b.title || '', appraisal: b.appraisal || 0, minPrice: b.min || 0,
            status: '입찰 완료', bid: b.bid || 0, who: b.who || '서영', url: '',
            memo: '📝 입찰기록에서 자동으로 담았어요 · 우리 입찰가 ' + won(b.bid) + (b.note ? '\n' + b.note : ''),
            events: [{ id: 'b' + b.date.replace(/-/g, ''), date: b.date, time: '10:00', kind: '매각기일', note: '📝 우리 입찰 ' + won(b.bid) }],
            updatedAt: now, from: '입찰기록' };
          await db.collection('items').doc(k).set(body); items.push(Object.assign({ id: k }, body)); n++;
          seen.add(key); seenAdd = true;
        }
      }
      // 결과 따라가기 — 그 물건의 마지막 매각기일보다 앞선 결과(지난 회차)는 안 쓴다
      for (const b of bids) {
        if (b.result !== '낙찰' && b.result !== '패찰') continue;
        const it = find(ck(b.case));
        if (!it || !OPEN.has(it.status || '관심') || !isDay(b.date)) continue;
        const last = (it.events || []).filter(e => e.kind === '매각기일' && isDay(e.date)).map(e => e.date).sort().pop() || '';
        if (last && b.date < last) continue;
        const body = Object.assign({}, it); delete body.id; body.status = b.result; body.updatedAt = now;
        await db.collection('items').doc(it.id).set(body); items.splice(items.indexOf(it), 1, Object.assign({ id: it.id }, body)); n++;
      }
      if (seenAdd) await db.doc('notes/bid-items').set({ keys: [...seen].slice(-500), updatedAt: now });
      return n;
    })();
    try { return await running; } finally { running = null; }
  }

  // ✅ 넣었음 취소 — 자동으로 담은 관심물건(그 매각기일 하나뿐)이면 같이 뺀다. 사람이 담은·고친 물건은 그대로
  async function drop(db, c, day) {
    const k = ck(c);
    if (!db || !k) return;
    const d = await db.collection('items').doc(k).get(), it = d.exists ? d.data() : null;
    if (it && it.from === '입찰기록' && (it.events || []).every(e => e.date === day)) await db.collection('items').doc(k).delete();
  }

  window.BidSync = { ck, sync, drop };
})();
