/* 到期提醒 PWA — app.js */
(function () {
  'use strict';

  /* ---------- 儲存 ---------- */
  var KEY = 'expiry-reminder-v1';
  var mem = null;
  function canLS() {
    try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true; }
    catch (e) { return false; }
  }
  var LS = canLS();
  function load() {
    if (!LS) return mem;
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function persist(s) {
    mem = s;
    if (LS) {
      try { localStorage.setItem(KEY, JSON.stringify(s)); }
      catch (e) { try { toast('儲存空間已滿，請刪除一些照片或項目（這次的變更可能沒存到）'); } catch (e2) {} }
    }
    idbPut('snapshot', { items: s.items, settings: s.settings, categories: s.categories });
  }

  /* 小型 IndexedDB（給 Service Worker 背景檢查用） */
  function idbOpen() {
    return new Promise(function (res, rej) {
      if (!self.indexedDB) return rej();
      var r = indexedDB.open('expiry-reminder', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbPut(k, v) {
    idbOpen().then(function (db) {
      var tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(v, k);
    }).catch(function () {});
  }

  /* ---------- 預設資料 ---------- */
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  var DEFAULT_STATE = {
    version: 1,
    categories: [
      { id: 'c_goods', name: '用品' },
      { id: 'c_food', name: '食物' },
      { id: 'c_drink', name: '飲料' }
    ],
    items: [],
    settings: {
      defaultOffsets: [7, 15, 30],
      notifyEnabled: false,
      notifyTime: '09:00',
      lastDaily: ''
    }
  };

  var SUGGEST = {
    '用品': ['清潔用品', '電池', '香皂', '洗衣皂', '洗髮精', '沐浴乳', '牙膏', '衛生紙', '口罩'],
    '食物': ['零食', '餐食', '罐頭', '米麵', '調味料', '冷凍食品'],
    '飲料': ['冷藏飲品', '常溫飲品', '咖啡', '茶包', '牛奶'],
    '藥品': ['成藥', '維他命', '藥膏']
  };

  var PRESET_OFFSETS = [1, 3, 7, 15, 30, 60, 90];
  var PRESET_REPEATS = [0, 7, 30, 90, 180, 365];

  function repeatLabel(d) {
    if (!d) return '不重複';
    if (d === 7) return '每週';
    if (d === 30) return '每月';
    if (d === 90) return '每 3 個月';
    if (d === 180) return '每半年';
    if (d === 365) return '每年';
    return '每 ' + d + ' 天';
  }

  function offsetLabel(d) {
    if (d === 7) return '一週前';
    if (d === 14) return '兩週前';
    if (d === 15) return '半個月前';
    if (d === 30) return '一個月前';
    if (d === 60) return '兩個月前';
    if (d === 90) return '三個月前';
    return d + '天前';
  }

  var state = load() || JSON.parse(JSON.stringify(DEFAULT_STATE));
  if (!state.settings) state.settings = JSON.parse(JSON.stringify(DEFAULT_STATE.settings));
  if (!state.categories) state.categories = DEFAULT_STATE.categories.slice();
  if (!state.items) state.items = [];
  mem = state;

  function save() { persist(state); render(); }

  /* ---------- 日期 ---------- */
  function todayStr(d) {
    d = d || new Date();
    var m = ('0' + (d.getMonth() + 1)).slice(-2), day = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function parseD(s) {
    var p = String(s || '').split('-');
    return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1);
  }
  function daysLeft(dateStr) {
    var a = parseD(todayStr()), b = parseD(dateStr);
    return Math.round((b - a) / 86400000);
  }
  function maxOffset(it) {
    var o = (it.offsets && it.offsets.length) ? it.offsets : state.settings.defaultOffsets;
    return o.reduce(function (a, b) { return Math.max(a, b); }, 0);
  }
  function statusOf(it) {
    var d = daysLeft(it.date);
    if (d < 0) return 'exp';
    if (d <= maxOffset(it)) return 'soon';
    return 'ok';
  }
  function leftText(it) {
    var d = daysLeft(it.date);
    if (d < 0) return '已過期 ' + (-d) + ' 天';
    if (d === 0) return '今天到期';
    return '剩 ' + d + ' 天';
  }
  function catName(id) {
    var c = state.categories.filter(function (x) { return x.id === id; })[0];
    return c ? c.name : '未分類';
  }

  /* ---------- DOM 工具 ---------- */
  function $(s) { return document.querySelector(s); }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  var toastT;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.classList.remove('on'); }, 2200);
  }
  function openSheet(id) { $(id).classList.add('on'); }
  function closeSheet(id) { $(id).classList.remove('on'); }

  /* ---------- 篩選狀態 ---------- */
  var filterCat = 'all', keyword = '', sortBy = 'date';

  /* ---------- 畫面 ---------- */
  function renderBanner() {
    var b = $('#banner');
    var d = buildDigest();
    if (!d || state.settings.bannerDismissed === todayStr()) { b.classList.remove('on'); return; }
    $('#bannerT').textContent = '🔔 ' + d.title;
    $('#bannerB').textContent = d.body + '　（點一下只看這些）';
    b.classList.add('on');
  }

  function render() {
    renderBanner();
    var live = state.items.filter(function (i) { return !i.done; });
    var doneN = state.items.length - live.length;
    $('#today').textContent = '今天 ' + todayStr() + '　使用中 ' + live.length + ' 項';

    // 統計（不含已用完）
    var st = { exp: 0, soon: 0, ok: 0 };
    live.forEach(function (i) { st[statusOf(i)]++; });
    $('#sExp').textContent = st.exp;
    $('#sSoon').textContent = st.soon;
    $('#sOk').textContent = st.ok;

    // 種類篩選
    var chips = $('#catChips'); chips.innerHTML = '';
    var all = el('button', 'chip' + (filterCat === 'all' ? ' on' : ''), '全部');
    all.onclick = function () { filterCat = 'all'; render(); };
    chips.appendChild(all);
    var dueN = live.filter(function (i) { return statusOf(i) !== 'ok'; }).length;
    if (dueN) {
      var bdue = el('button', 'chip' + (filterCat === 'due' ? ' on' : ''), '🔔 快到期 ' + dueN);
      bdue.onclick = function () { filterCat = 'due'; render(); };
      chips.appendChild(bdue);
    }
    state.categories.forEach(function (c) {
      var n = live.filter(function (i) { return i.catId === c.id; }).length;
      var b = el('button', 'chip' + (filterCat === c.id ? ' on' : ''), c.name + ' ' + n);
      b.onclick = function () { filterCat = c.id; render(); };
      chips.appendChild(b);
    });
    if (doneN) {
      var bd = el('button', 'chip' + (filterCat === 'done' ? ' on' : ''), '已用完 ' + doneN);
      bd.onclick = function () { filterCat = 'done'; render(); };
      chips.appendChild(bd);
    }

    // 清單
    var list = $('#list'); list.innerHTML = '';
    var arr = state.items.filter(function (i) {
      if (filterCat === 'done') { if (!i.done) return false; }
      else if (i.done) return false;
      if (filterCat === 'due' && statusOf(i) === 'ok') return false;
      if (filterCat !== 'all' && filterCat !== 'done' && filterCat !== 'due' && i.catId !== filterCat) return false;
      if (keyword && (i.name + ' ' + (i.note || '')).toLowerCase().indexOf(keyword.toLowerCase()) < 0) return false;
      return true;
    });

    if (!arr.length) {
      var e = el('div', 'empty');
      e.appendChild(el('div', 'big', '🗓️'));
      e.appendChild(el('div', null, state.items.length ? '沒有符合條件的項目' : '還沒有項目，點右下角「＋ 新增項目」開始'));
      list.appendChild(e);
      return;
    }

    if (sortBy === 'name') arr.sort(function (a, b) { return a.name.localeCompare(b.name, 'zh-Hant'); });
    else arr.sort(function (a, b) { return parseD(a.date) - parseD(b.date); });

    if (sortBy === 'cat') {
      state.categories.forEach(function (c) {
        var sub = arr.filter(function (i) { return i.catId === c.id; });
        if (!sub.length) return;
        list.appendChild(el('div', 'group-title', c.name + '（' + sub.length + '）'));
        sub.forEach(function (i) { list.appendChild(cardOf(i)); });
      });
    } else {
      arr.forEach(function (i) { list.appendChild(cardOf(i)); });
    }
  }

  function cardOf(it) {
    if (it.done) return doneCardOf(it);
    var s = statusOf(it);
    var c = el('div', 'card ' + s);
    c.appendChild(el('div', 'bar'));
    if (it.photo) c.appendChild(thumbOf(it));
    var body = el('div', 'body');
    body.appendChild(el('div', 'name', it.name));
    var meta = el('div', 'meta');
    var tag = el('span', 'tag', catName(it.catId));
    meta.appendChild(tag);
    meta.appendChild(document.createTextNode(it.date + (it.qty ? '　' + it.qty : '')));
    if (it.repeat) meta.appendChild(el('span', 'tag rep', '🔁 ' + repeatLabel(it.repeat)));
    body.appendChild(meta);
    var offs = (it.offsets && it.offsets.length ? it.offsets : state.settings.defaultOffsets)
      .slice().sort(function (a, b) { return b - a; }).join('、');
    body.appendChild(el('div', 'meta', '提醒：到期前 ' + offs + ' 天'));
    if (it.note) {
      var n = el('div', 'meta', it.note);
      body.appendChild(n);
    }
    c.appendChild(body);

    var right = el('div', 'right');
    right.appendChild(el('span', 'badge ' + s, leftText(it)));
    var act = el('button', 'act', it.repeat ? '🔁 已更換' : '✓ 用完');
    act.title = it.repeat ? '已更換／補貨，順延到下一次到期日' : '標記為用完';
    act.onclick = function (ev) { ev.stopPropagation(); consume(it.id); };
    right.appendChild(act);
    c.appendChild(right);

    c.onclick = function () { openItem(it.id); };
    return c;
  }

  function thumbOf(it) {
    var im = document.createElement('img');
    im.className = 'thumb';
    im.src = it.photo;
    im.alt = it.name;
    im.onclick = function (ev) { ev.stopPropagation(); showLightbox(it.photo); };
    return im;
  }

  function doneCardOf(it) {
    var c = el('div', 'card done');
    c.appendChild(el('div', 'bar'));
    if (it.photo) c.appendChild(thumbOf(it));
    var body = el('div', 'body');
    body.appendChild(el('div', 'name', it.name));
    var meta = el('div', 'meta');
    meta.appendChild(el('span', 'tag', catName(it.catId)));
    meta.appendChild(document.createTextNode('原到期日 ' + it.date + (it.doneAt ? '　' + it.doneAt + ' 用完' : '')));
    body.appendChild(meta);
    c.appendChild(body);
    var right = el('div', 'right');
    var b = el('button', 'act primary', '＋ 補貨');
    b.onclick = function (ev) { ev.stopPropagation(); restock(it.id); };
    right.appendChild(b);
    var d = el('button', 'act', '刪除');
    d.onclick = function (ev) {
      ev.stopPropagation();
      if (!confirm('永久刪除「' + it.name + '」？')) return;
      state.items = state.items.filter(function (x) { return x.id !== it.id; });
      save(); toast('已刪除');
    };
    right.appendChild(d);
    c.appendChild(right);
    return c;
  }

  /* 用完 / 已更換 */
  function consume(id) {
    var it = state.items.filter(function (x) { return x.id === id; })[0];
    if (!it) return;
    if (it.repeat) {
      // 從今天或原到期日（取較晚者）往後推一個週期
      var base = parseD(it.date) > parseD(todayStr()) ? parseD(it.date) : parseD(todayStr());
      base.setDate(base.getDate() + it.repeat);
      it.date = todayStr(base);
      save();
      toast('已更換，下次到期日 ' + it.date);
    } else {
      it.done = true; it.doneAt = todayStr();
      save();
      toast('已標記用完，可在「已用完」補貨');
    }
  }

  /* 補貨：還原成使用中，並依週期或預設往後算到期日 */
  function restock(id) {
    var it = state.items.filter(function (x) { return x.id === id; })[0];
    if (!it) return;
    it.done = false; it.doneAt = '';
    var days = it.repeat || 0;
    if (days) {
      var d = parseD(todayStr()); d.setDate(d.getDate() + days);
      it.date = todayStr(d);
      save();
      toast('已補貨，到期日設為 ' + it.date);
    } else {
      save();
      openItem(id);
      toast('請設定新的到期日');
    }
  }

  /* ---------- 照片 ---------- */
  var MAX_PX = 640;      // 長邊最大像素
  var JPEG_Q = 0.62;     // 壓縮品質

  function shrinkImage(file, cb) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth, h = img.naturalHeight;
      var scale = Math.min(1, MAX_PX / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
      var cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
      var out;
      try { out = cv.toDataURL('image/jpeg', JPEG_Q); } catch (e) { out = ''; }
      URL.revokeObjectURL(url);
      cb(out);
    };
    img.onerror = function () { URL.revokeObjectURL(url); cb(''); };
    img.src = url;
  }

  function drawPhotoPreview() {
    var box = $('#photoPrev');
    box.innerHTML = '';
    if (curPhoto) {
      var im = document.createElement('img');
      im.src = curPhoto;
      im.onclick = function () { showLightbox(curPhoto); };
      box.appendChild(im);
    } else {
      box.appendChild(el('span', null, '尚未加照片'));
    }
    $('#btnPhotoDel').style.display = curPhoto ? '' : 'none';
  }

  function showLightbox(src) {
    $('#lightboxImg').src = src;
    $('#lightbox').classList.add('on');
  }

  function pickPhoto(input) {
    var f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    if (!/^image\//.test(f.type)) return toast('請選擇圖片檔');
    toast('處理照片中…');
    shrinkImage(f, function (dataUrl) {
      if (!dataUrl) return toast('這張圖片無法讀取');
      curPhoto = dataUrl;
      drawPhotoPreview();
      toast('照片已加入（約 ' + Math.round(dataUrl.length / 1400) + ' KB）');
    });
  }

  /* ---------- 項目編輯 ---------- */
  var editingId = null, curOffsets = [], curRepeat = 0, curPhoto = '';

  function renderOffsetPicker(container, selected, onToggle) {
    container.innerHTML = '';
    var all = PRESET_OFFSETS.slice();
    selected.forEach(function (d) { if (all.indexOf(d) < 0) all.push(d); });
    all.sort(function (a, b) { return a - b; });
    all.forEach(function (d) {
      var on = selected.indexOf(d) >= 0;
      var b = el('button', 'opt' + (on ? ' on' : ''), offsetLabel(d));
      b.onclick = function () { onToggle(d); };
      container.appendChild(b);
    });
  }

  function fillCatSelect() {
    var sel = $('#fCat'); sel.innerHTML = '';
    state.categories.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.id; o.textContent = c.name;
      sel.appendChild(o);
    });
  }

  function renderSuggest() {
    var box = $('#suggest'); box.innerHTML = '';
    var name = catName($('#fCat').value);
    (SUGGEST[name] || []).forEach(function (s) {
      var b = el('button', null, s);
      b.type = 'button';
      b.onclick = function () { $('#fName').value = s; };
      box.appendChild(b);
    });
  }

  function openItem(id) {
    editingId = id || null;
    fillCatSelect();
    var it = id ? state.items.filter(function (x) { return x.id === id; })[0] : null;
    $('#itemTitle').textContent = it ? '編輯項目' : '新增項目';
    $('#fName').value = it ? it.name : '';
    $('#fCat').value = it ? it.catId : (state.categories[0] ? state.categories[0].id : '');
    $('#fDate').value = it ? it.date : todayStr();
    $('#fQty').value = it ? (it.qty || '') : '';
    $('#fNote').value = it ? (it.note || '') : '';
    curOffsets = (it && it.offsets && it.offsets.length ? it.offsets : state.settings.defaultOffsets).slice();
    curRepeat = it ? (it.repeat || 0) : 0;
    curPhoto = it ? (it.photo || '') : '';
    drawPhotoPreview();
    drawItemOffsets();
    drawRepeat();
    renderSuggest();
    $('#itemDeleteWrap').style.display = it ? 'flex' : 'none';
    openSheet('#shItem');
  }

  function drawRepeat() {
    var box = $('#fRepeat'); box.innerHTML = '';
    var all = PRESET_REPEATS.slice();
    if (all.indexOf(curRepeat) < 0) all.push(curRepeat);
    all.sort(function (a, b) { return a - b; });
    all.forEach(function (d) {
      var b = el('button', 'opt' + (curRepeat === d ? ' on' : ''), repeatLabel(d));
      b.onclick = function () { curRepeat = d; drawRepeat(); };
      box.appendChild(b);
    });
  }

  function drawItemOffsets() {
    renderOffsetPicker($('#fOffsets'), curOffsets, function (d) {
      var i = curOffsets.indexOf(d);
      if (i >= 0) curOffsets.splice(i, 1); else curOffsets.push(d);
      drawItemOffsets();
    });
  }

  function saveItem() {
    var name = $('#fName').value.trim();
    if (!name) return toast('請輸入項目名稱');
    if (!$('#fDate').value) return toast('請選擇到期日');
    if (!curOffsets.length) return toast('請至少選一個提醒區間');
    var data = {
      name: name,
      catId: $('#fCat').value,
      date: $('#fDate').value,
      qty: $('#fQty').value.trim(),
      note: $('#fNote').value.trim(),
      offsets: curOffsets.slice().sort(function (a, b) { return a - b; }),
      repeat: curRepeat,
      photo: curPhoto
    };
    if (editingId) {
      state.items = state.items.map(function (x) {
        return x.id === editingId ? Object.assign({}, x, data) : x;
      });
      toast('已更新');
    } else {
      data.id = uid();
      data.createdAt = new Date().toISOString();
      state.items.push(data);
      toast('已新增');
    }
    closeSheet('#shItem');
    save();
  }

  /* ---------- 種類管理 ---------- */
  function renderCats() {
    var box = $('#catList'); box.innerHTML = '';
    state.categories.forEach(function (c) {
      var n = state.items.filter(function (i) { return i.catId === c.id; }).length;
      var row = el('div', 'list-row');
      var name = el('div', 'n', c.name);
      var cnt = el('div', 'c', n + ' 項');
      var ren = el('button', 'mini', '改名');
      ren.onclick = function () {
        var v = prompt('新的種類名稱', c.name);
        if (v && v.trim()) { c.name = v.trim(); save(); renderCats(); }
      };
      var del = el('button', 'mini d', '刪除');
      del.onclick = function () {
        if (!confirm('刪除「' + c.name + '」會一併刪除底下 ' + n + ' 個項目，確定嗎？')) return;
        state.categories = state.categories.filter(function (x) { return x.id !== c.id; });
        state.items = state.items.filter(function (i) { return i.catId !== c.id; });
        if (filterCat === c.id) filterCat = 'all';
        save(); renderCats();
      };
      row.appendChild(name); row.appendChild(cnt); row.appendChild(ren); row.appendChild(del);
      box.appendChild(row);
    });
  }

  function addCat(name) {
    name = (name || '').trim();
    if (!name) return null;
    if (state.categories.some(function (c) { return c.name === name; })) { toast('種類已存在'); return null; }
    var c = { id: uid(), name: name };
    state.categories.push(c);
    save();
    return c;
  }

  /* ---------- 設定 ---------- */
  function renderSettings() {
    $('#sNotify').checked = !!state.settings.notifyEnabled;
    $('#sTime').value = state.settings.notifyTime || '09:00';
    renderOffsetPicker($('#sOffsets'), state.settings.defaultOffsets, function (d) {
      var arr = state.settings.defaultOffsets, i = arr.indexOf(d);
      if (i >= 0) arr.splice(i, 1); else arr.push(d);
      arr.sort(function (a, b) { return a - b; });
      save(); renderSettings();
    });
    var isFile = location.protocol === 'file:';
    if (isFile) {
      $('#permNote').textContent =
        '你現在是直接開啟本機 HTML 檔（網址列是 file://），Android Chrome 不允許這種頁面發送系統通知，' +
        '所以「開啟通知權限」會沒有反應。不過每次打開 App 時，最上方仍會出現黃色的到期提醒橫幅。' +
        '想要真正的手機通知，請把檔案放到 https 網站再「加入主畫面」，或改用原生版 APK。';
      return;
    }
    var p = (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported';
    $('#permNote').textContent =
      p === 'granted' ? '通知權限：已開啟。App 開啟時會依設定時間發送每日提醒；已「加入主畫面」的話，系統也會在背景定期檢查。'
      : p === 'denied' ? '通知權限：已被拒絕。請到瀏覽器網站設定中重新允許通知。'
      : p === 'unsupported' ? '此瀏覽器不支援系統通知，App 內仍會用顏色標示即將到期的項目。'
      : '通知權限：尚未開啟，請點「開啟通知權限」。';
  }

  /* ---------- 通知 ---------- */
  function dueItems() {
    return state.items.filter(function (i) { return !i.done && statusOf(i) !== 'ok'; })
      .sort(function (a, b) { return parseD(a.date) - parseD(b.date); });
  }

  function showNotification(title, body) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
    var opts = {
      body: body, icon: 'icon-192.png', badge: 'icon-192.png',
      tag: 'expiry-daily', renotify: true, requireInteraction: false
    };
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then(function (reg) {
        reg.showNotification(title, opts);
      }).catch(function () { try { new Notification(title, opts); } catch (e) {} });
    } else {
      try { new Notification(title, opts); } catch (e) {}
    }
    return true;
  }

  function buildDigest() {
    var due = dueItems();
    if (!due.length) return null;
    var names = due.slice(0, 4).map(function (i) { return i.name + '（' + leftText(i) + '）'; });
    if (due.length > 4) names.push('等 ' + due.length + ' 項');
    return { title: '有 ' + due.length + ' 項即將到期／已過期', body: names.join('、') };
  }

  function checkDaily(force) {
    var s = state.settings;
    if (!force) {
      if (!s.notifyEnabled) return;
      var now = new Date();
      var hm = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
      if (hm < (s.notifyTime || '09:00')) return;
      if (s.lastDaily === todayStr()) return;
    }
    var d = buildDigest();
    if (!d) { if (force) toast('目前沒有即將到期的項目'); return; }
    if (showNotification(d.title, d.body)) {
      s.lastDaily = todayStr();
      persist(state);
    } else if (force) {
      toast('請先開啟通知權限');
    }
  }

  function askPermission() {
    if (typeof Notification === 'undefined') return toast('此瀏覽器不支援通知');
    Notification.requestPermission().then(function (p) {
      renderSettings();
      if (p === 'granted') {
        toast('通知已開啟');
        registerPeriodicSync();
      } else toast('未取得通知權限');
    });
  }

  function registerPeriodicSync() {
    if (!navigator.serviceWorker) return;
    navigator.serviceWorker.ready.then(function (reg) {
      if (!('periodicSync' in reg)) return;
      navigator.permissions.query({ name: 'periodic-background-sync' }).then(function (st) {
        if (st.state !== 'granted') return;
        reg.periodicSync.register('expiry-daily-check', { minInterval: 12 * 60 * 60 * 1000 })
          .catch(function () {});
      }).catch(function () {});
    }).catch(function () {});
  }

  /* ---------- 匯出匯入 ---------- */
  function exportData() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '到期提醒備份-' + todayStr() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    toast('已匯出備份檔');
  }
  function importData(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var d = JSON.parse(r.result);
        if (!d || !Array.isArray(d.items) || !Array.isArray(d.categories)) throw 0;
        state = d;
        if (!state.settings) state.settings = JSON.parse(JSON.stringify(DEFAULT_STATE.settings));
        save(); renderSettings(); renderCats();
        toast('匯入完成，共 ' + state.items.length + ' 項');
      } catch (e) { toast('備份檔格式不正確'); }
    };
    r.readAsText(file);
  }

  /* ---------- 事件綁定 ---------- */
  $('#btnAdd').onclick = function () { openItem(null); };
  $('#itemCancel').onclick = function () { closeSheet('#shItem'); };
  $('#itemSave').onclick = saveItem;
  $('#itemDelete').onclick = function () {
    if (!confirm('確定刪除此項目？')) return;
    state.items = state.items.filter(function (x) { return x.id !== editingId; });
    closeSheet('#shItem'); save(); toast('已刪除');
  };
  $('#fCat').onchange = renderSuggest;
  $('#btnNewCatInline').onclick = function () {
    var v = prompt('新增種類名稱');
    var c = addCat(v);
    if (c) { fillCatSelect(); $('#fCat').value = c.id; renderSuggest(); }
  };
  $('#banner').onclick = function () { filterCat = 'due'; render(); };
  $('#bannerClose').onclick = function (ev) {
    ev.stopPropagation();
    state.settings.bannerDismissed = todayStr();
    save();
  };

  $('#btnPhotoCam').onclick = function () { $('#filePhotoCam').click(); };
  $('#btnPhotoPick').onclick = function () { $('#filePhotoPick').click(); };
  $('#filePhotoCam').onchange = function () { pickPhoto(this); };
  $('#filePhotoPick').onchange = function () { pickPhoto(this); };
  $('#btnPhotoDel').onclick = function () { curPhoto = ''; drawPhotoPreview(); toast('已移除照片'); };
  $('#lightbox').onclick = function () { this.classList.remove('on'); };

  $('#btnRepCustom').onclick = function () {
    var v = parseInt($('#fRepCustom').value, 10);
    if (!v || v < 1) return toast('請輸入天數');
    curRepeat = v; $('#fRepCustom').value = ''; drawRepeat();
  };
  $('#btnAddOffset').onclick = function () {
    var v = parseInt($('#fCustom').value, 10);
    if (!v || v < 1) return toast('請輸入天數');
    if (curOffsets.indexOf(v) < 0) curOffsets.push(v);
    $('#fCustom').value = ''; drawItemOffsets();
  };

  $('#btnCats').onclick = function () { renderCats(); openSheet('#shCats'); };
  $('#catsClose').onclick = function () { closeSheet('#shCats'); };
  $('#btnAddCat').onclick = function () {
    var c = addCat($('#newCat').value);
    if (c) { $('#newCat').value = ''; renderCats(); }
  };

  $('#btnSettings').onclick = function () { renderSettings(); openSheet('#shSet'); };
  $('#setClose').onclick = function () { closeSheet('#shSet'); };
  $('#sNotify').onchange = function () {
    state.settings.notifyEnabled = this.checked;
    save();
    if (this.checked && typeof Notification !== 'undefined' && Notification.permission !== 'granted') askPermission();
    else if (this.checked) registerPeriodicSync();
  };
  $('#sTime').onchange = function () { state.settings.notifyTime = this.value || '09:00'; save(); };
  $('#btnPerm').onclick = askPermission;
  $('#btnTest').onclick = function () { checkDaily(true); };
  $('#btnAddDefOffset').onclick = function () {
    var v = parseInt($('#sCustom').value, 10);
    if (!v || v < 1) return toast('請輸入天數');
    if (state.settings.defaultOffsets.indexOf(v) < 0) state.settings.defaultOffsets.push(v);
    state.settings.defaultOffsets.sort(function (a, b) { return a - b; });
    $('#sCustom').value = ''; save(); renderSettings();
  };
  $('#btnExport').onclick = exportData;
  $('#btnImport').onclick = function () { $('#fileImport').click(); };
  $('#fileImport').onchange = function () { if (this.files[0]) importData(this.files[0]); this.value = ''; };
  $('#btnClear').onclick = function () {
    if (!confirm('這會刪除所有種類與項目，確定嗎？')) return;
    state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    save(); renderCats(); renderSettings(); toast('已清除');
  };

  $('#q').oninput = function () { keyword = this.value; render(); };
  $('#sort').onchange = function () { sortBy = this.value; render(); };

  // 點背景關閉
  ['#shItem', '#shCats', '#shSet'].forEach(function (id) {
    $(id).onclick = function (e) { if (e.target === this) this.classList.remove('on'); };
  });

  /* ---------- 啟動 ---------- */
  render();
  persist(state);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then(function () { registerPeriodicSync(); }).catch(function () {});
  }

  checkDaily(false);
  setInterval(function () { checkDaily(false); }, 60000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { render(); checkDaily(false); }
  });

  if (!LS) toast('注意：此瀏覽器停用了本機儲存，資料只會保留在本次開啟期間');

  window.__expiry = {
    get state() { return state; },
    daysLeft: daysLeft, statusOf: statusOf, buildDigest: buildDigest,
    addItem: function (o) { o.id = uid(); state.items.push(o); save(); }
  };
})();
