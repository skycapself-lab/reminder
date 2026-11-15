/* 到期提醒 — Service Worker（離線快取 + 背景每日檢查） */
var CACHE = 'expiry-v1';
var ASSETS = ['./', 'index.html', 'app.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(ASSETS).catch(function () {});
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(function (r) {
      var copy = r.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); }).catch(function () {});
      return r;
    }).catch(function () { return caches.match(e.request).then(function (m) { return m || caches.match('index.html'); }); })
  );
});

/* ---- IndexedDB ---- */
function idbOpen() {
  return new Promise(function (res, rej) {
    var r = indexedDB.open('expiry-reminder', 1);
    r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
    r.onsuccess = function () { res(r.result); };
    r.onerror = function () { rej(r.error); };
  });
}
function idbGet(k) {
  return idbOpen().then(function (db) {
    return new Promise(function (res) {
      var rq = db.transaction('kv', 'readonly').objectStore('kv').get(k);
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { res(null); };
    });
  });
}
function idbSet(k, v) {
  return idbOpen().then(function (db) {
    db.transaction('kv', 'readwrite').objectStore('kv').put(v, k);
  });
}

/* ---- 到期判斷（與 app.js 相同邏輯） ---- */
function todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function parseD(s) { var p = String(s || '').split('-'); return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1); }
function daysLeft(s) { return Math.round((parseD(s) - parseD(todayStr())) / 86400000); }

function digest(snap) {
  var def = (snap.settings && snap.settings.defaultOffsets) || [30];
  var due = (snap.items || []).filter(function (i) {
    if (i.done) return false;
    var offs = (i.offsets && i.offsets.length) ? i.offsets : def;
    var max = offs.reduce(function (a, b) { return Math.max(a, b); }, 0);
    return daysLeft(i.date) <= max;
  }).sort(function (a, b) { return parseD(a.date) - parseD(b.date); });
  if (!due.length) return null;
  var names = due.slice(0, 4).map(function (i) {
    var d = daysLeft(i.date);
    return i.name + '（' + (d < 0 ? '已過期 ' + (-d) + ' 天' : d === 0 ? '今天到期' : '剩 ' + d + ' 天') + '）';
  });
  if (due.length > 4) names.push('等 ' + due.length + ' 項');
  return { title: '有 ' + due.length + ' 項即將到期／已過期', body: names.join('、') };
}

function runCheck() {
  return idbGet('snapshot').then(function (snap) {
    if (!snap || !snap.settings || !snap.settings.notifyEnabled) return;
    return idbGet('swLastDaily').then(function (last) {
      if (last === todayStr()) return;
      var d = digest(snap);
      if (!d) return;
      return self.registration.showNotification(d.title, {
        body: d.body, icon: 'icon-192.png', badge: 'icon-192.png',
        tag: 'expiry-daily', renotify: true
      }).then(function () { return idbSet('swLastDaily', todayStr()); });
    });
  }).catch(function () {});
}

self.addEventListener('periodicsync', function (e) {
  if (e.tag === 'expiry-daily-check') e.waitUntil(runCheck());
});
self.addEventListener('sync', function (e) {
  if (e.tag === 'expiry-daily-check') e.waitUntil(runCheck());
});
self.addEventListener('message', function (e) {
  if (e.data === 'check') e.waitUntil(runCheck());
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (ws) {
    for (var i = 0; i < ws.length; i++) { if ('focus' in ws[i]) return ws[i].focus(); }
    if (clients.openWindow) return clients.openWindow('./');
  }));
});
