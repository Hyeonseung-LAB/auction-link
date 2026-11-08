/* 📲 홈 화면 앱 설치용 서비스 워커(11/8) — 저장(캐시)은 하지 않는다. pwa.py
   페이지 이동만 받아 인터넷에서 그대로 가져오고, 끊겼을 때만 안내 화면을 보여 준다.
   시트 읽기·쓰기·지도·글꼴·자료 파일 같은 나머지 요청은 손대지 않는다(브라우저가 평소대로). */
const OFFLINE = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>경매</title></head>'
  + '<body style="margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;background:#f2f4f7;color:#191f28;font-family:-apple-system,BlinkMacSystemFont,\'Apple SD Gothic Neo\',\'Malgun Gothic\',sans-serif;word-break:keep-all">'
  + '<div style="width:100%;max-width:340px;padding:24px 20px;border-radius:16px;background:#fff;box-shadow:0 4px 20px rgba(0,0,0,.08);text-align:center">'
  + '<div style="font-size:34px">📡</div><h1 style="margin:8px 0 6px;font-size:18px">인터넷에 연결되지 않았어요</h1>'
  + '<p style="margin:0 0 14px;color:#6b7684;font-size:14px">연결되면 다시 열어 주세요.</p>'
  + '<button onclick="location.reload()" style="padding:10px 18px;border:0;border-radius:10px;background:#191f28;box-shadow:inset 0 0 0 200px #191f28;color:#fff;font-size:14px;font-weight:700">다시 열기</button>'
  + '</div></body></html>';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
