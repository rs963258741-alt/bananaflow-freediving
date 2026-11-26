/* 蕉流 Freediving — 網站後台
 * 編輯 content/site.json → 用 cms/render.js 產生 index.html → 一次 commit 到 GitHub → Vercel 自動更新。
 */
(function () {
  'use strict';
  var CMS = window.BananaCMS;
  var $ = function (id) { return document.getElementById(id); };
  var LS = { token: 'bf.token', repo: 'bf.repo', branch: 'bf.branch', draft: 'bf.draft' };
  var SITE_PATH = 'content/site.json', CSS_PATH = 'cms/site.css';
  var DEFAULT_REPO = 'rs963258741-alt/bananaflow-freediving';

  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} }

  var state = {
    site: null, sha: null, css: '', uploads: {}, dirty: false,
    view: { kind: 'home', path: [] }, open: new WeakSet(), busy: false
  };

  /* ================= 小工具 ================= */
  var esc = CMS.esc;
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'on') Object.keys(attrs.on).forEach(function (ev) { e.addEventListener(ev, attrs.on[ev]); });
      else if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    if (html != null) e.innerHTML = html;
    return e;
  }
  function btn(text, cls, fn, title) {
    var b = el('button', { type: 'button', class: cls || 'btn', title: title || null }, text);
    b.addEventListener('click', function (ev) { ev.stopPropagation(); fn(ev); });
    return b;
  }
  function msg(box, text, kind) { $(box).innerHTML = text ? '<div class="msg ' + (kind || '') + '">' + text + '</div>' : ''; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function rid() { return Math.random().toString(36).slice(2, 8); }
  function move(arr, i, d) { var j = i + d; if (j < 0 || j >= arr.length) return; var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }

  /* ================= 草稿（自動暫存在這台裝置） ================= */
  var saveTimer;
  function markDirty() {
    state.dirty = true;
    updateStatus();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 400);
  }
  function saveDraft() {
    try {
      localStorage.setItem(LS.draft, JSON.stringify({ site: state.site, sha: state.sha, uploads: state.uploads, at: Date.now() }));
    } catch (e) {
      // 圖片太多放不下時，至少保存文字內容
      try { localStorage.setItem(LS.draft, JSON.stringify({ site: state.site, sha: state.sha, uploads: {}, at: Date.now() })); } catch (e2) {}
    }
  }
  function clearDraft() { lsSet(LS.draft, ''); }
  function updateStatus() {
    var s = $('status');
    var n = Object.keys(state.uploads).length;
    if (state.dirty) { s.textContent = '● 有尚未發佈的修改'; s.className = 'status dirty'; }
    else { s.textContent = state.sha ? '✓ 與網站同步' : (cfg().token ? '' : '尚未連線 GitHub'); s.className = 'status'; }
    $('bottomInfo').textContent = state.dirty ? ('修改已自動暫存在這台裝置' + (n ? '（含 ' + n + ' 張新圖片）' : '') + '，按「發佈」才會更新網站') : '';
  }

  /* ================= GitHub API ================= */
  function cfg() {
    return { token: lsGet(LS.token), repo: (lsGet(LS.repo) || DEFAULT_REPO).trim(), branch: (lsGet(LS.branch) || 'main').trim() };
  }
  function gh(path, opts) {
    var c = cfg();
    opts = opts || {};
    return fetch('https://api.github.com/repos/' + c.repo + path, {
      method: opts.method || 'GET',
      headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store'
    }).then(function (r) {
      if (r.status === 404 && opts.allow404) return null;
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var hint = r.status === 401 ? '（Token 錯誤或已過期）' : r.status === 403 || r.status === 404 ? '（Token 沒有這個存放庫的寫入權限，或存放庫名稱錯誤）' : r.status === 409 || r.status === 422 ? '（網站剛好有其他更新，請再按一次）' : '';
          throw new Error('GitHub ' + r.status + '：' + (j.message || '') + hint);
        }
        return j;
      });
    });
  }
  function b64ToUtf8(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function ghFile(path) {
    return gh('/contents/' + path + '?ref=' + encodeURIComponent(cfg().branch), { allow404: true }).then(function (j) {
      if (!j) return null;
      if (j.content) return { sha: j.sha, text: b64ToUtf8(j.content) };
      return gh('/git/blobs/' + j.sha).then(function (b) { return { sha: j.sha, text: b64ToUtf8(b.content) }; });
    });
  }
  /** 一次 commit 多個檔案。files: [{path, text}|{path, base64}|{path, remove:true}] */
  function commit(files, message, removeFn) {
    var br = cfg().branch, headSha, baseTree;
    return gh('/git/ref/heads/' + encodeURIComponent(br)).then(function (ref) {
      headSha = ref.object.sha;
      return gh('/git/commits/' + headSha);
    }).then(function (c) {
      baseTree = c.tree.sha;
      if (!removeFn) return [];
      return gh('/git/trees/' + baseTree + '?recursive=1').then(function (t) { return removeFn((t.tree || []).map(function (x) { return x.path; })); });
    }).then(function (removals) {
      files = files.concat((removals || []).map(function (p) { return { path: p, remove: true }; }));
      var tree = [], i = 0;
      // 依序建立 blob（避免一次送太多請求）
      function next() {
        if (i >= files.length) return Promise.resolve(tree);
        var f = files[i++];
        if (f.remove) { tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null }); return next(); }
        var body = f.base64 != null ? { content: f.base64, encoding: 'base64' } : { content: f.text, encoding: 'utf-8' };
        return gh('/git/blobs', { method: 'POST', body: body }).then(function (b) { tree.push({ path: f.path, mode: '100644', type: 'blob', sha: b.sha }); return next(); });
      }
      return next();
    }).then(function (tree) {
      return gh('/git/trees', { method: 'POST', body: { base_tree: baseTree, tree: tree } });
    }).then(function (t) {
      return gh('/git/commits', { method: 'POST', body: { message: message, tree: t.sha, parents: [headSha] } });
    }).then(function (c) {
      return gh('/git/refs/heads/' + encodeURIComponent(br), { method: 'PATCH', body: { sha: c.sha } }).then(function () { return c; });
    });
  }

  /* ================= 圖片（上傳前先縮圖） ================= */
  function resizeImage(file, maxSide, quality) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var im = new Image();
      im.onload = function () {
        var s = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
        var w = Math.round(im.naturalWidth * s), h = Math.round(im.naturalHeight * s);
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(im, 0, 0, w, h);
        URL.revokeObjectURL(url);
        var dataUrl = cv.toDataURL('image/jpeg', quality);
        resolve({ dataUrl: dataUrl, base64: dataUrl.split(',')[1] });
      };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('無法讀取這張圖片，請改用 JPG 或 PNG')); };
      im.src = url;
    });
  }
  function addUpload(file) {
    return resizeImage(file, 2000, 0.84).then(function (r) {
      var d = new Date();
      var p = 'uploads/' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '-' + rid() + '.jpg';
      state.uploads[p] = r;
      return p;
    });
  }
  function pickFiles(multiple, cb) {
    var inp = el('input', { type: 'file', accept: 'image/*', multiple: multiple || null });
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', function () {
      var fs = [].slice.call(inp.files || []);
      inp.remove();
      if (fs.length) cb(fs);
    });
    inp.click();
  }
  /** 給預覽／縮圖用的實際圖片網址 */
  function resolve(p) {
    p = String(p || '').trim();
    if (!p) return '';
    if (state.uploads[p]) return state.uploads[p].dataUrl;
    if (/^(data:|https?:|blob:|\/)/.test(p)) return p;
    return '../' + p;
  }

  /* ================= 內容區塊定義 ================= */
  var STYLE_BTN = [['p', '黃色實心'], ['s', '黃色外框'], ['o', '灰色外框']];
  var BLOCKS = {
    text: { label: '文字段落', sum: function (b) { return b.text; }, fields: [
      { k: 'text', t: 'textarea', l: '內容', hint: '每一行會變成一段。可用 **粗體**、[連結文字](https://網址)' },
      { k: 'style', t: 'select', l: '樣式', opts: [['', '一般內文'], ['sub', '區塊說明（灰色）'], ['more', '小字說明'], ['note', '小字（緊貼上方）'], ['fn', '註腳']] }] },
    heading: { label: '小標題', sum: function (b) { return b.text; }, fields: [
      { k: 'text', t: 'text', l: '標題文字' },
      { k: 'level', t: 'select', l: '大小', opts: [['h3', '大標'], ['h4', '小標（黃色）']] }] },
    image: { label: '圖片', sum: function (b) { return b.caption || b.alt || b.src; }, fields: [
      { k: 'src', t: 'image', l: '圖片' },
      { k: 'alt', t: 'text', l: '圖片描述（給搜尋引擎與視障者）' },
      { k: 'caption', t: 'text', l: '圖片下方說明（選填）' },
      { k: 'link', t: 'url', l: '點圖片前往的網址（選填）' }] },
    video: { label: '影片', sum: function (b) { return b.url; }, fields: [
      { k: 'url', t: 'url', l: '影片網址', hint: '可貼 YouTube、Vimeo、Instagram Reels 或 .mp4 影片連結' },
      { k: 'mode', t: 'select', l: '顯示方式', opts: [['thumb', '封面圖＋播放鍵（點擊開新視窗）'], ['embed', '直接嵌入播放']] },
      { k: 'thumb', t: 'image', l: '封面圖（選填，YouTube 會自動抓）' },
      { k: 'title', t: 'text', l: '影片標題' },
      { k: 'caption', t: 'textarea', l: '影片下方文字（選填）' }] },
    gallery: { label: '相簿（多張照片）', sum: function (b) { return (b.images || []).length + ' 張照片'; }, fields: [
      { k: 'images', t: 'list', l: '照片', bulk: 'src', thumbs: true, item: function (x, i) { return (i + 1) + '. ' + (x.alt || x.src || '新照片'); }, of: [
        { k: 'src', t: 'image', l: '照片' }, { k: 'alt', t: 'text', l: '照片描述' }] },
      { k: 'initial', t: 'number', l: '一開始顯示幾張（其餘按「顯示更多」）', hint: '留空預設 3 張' }] },
    cards: { label: '價格卡片', sum: function (b) { return (b.cards || []).map(function (c) { return c.title; }).join('、'); }, fields: [
      { k: 'cards', t: 'list', l: '卡片', item: function (x) { return (x.title || '新卡片') + (x.price ? '｜' + x.price : ''); }, of: [
        { k: 'title', t: 'text', l: '標題', half: 1 }, { k: 'tag', t: 'text', l: '右側小字（例：18+）', half: 1 },
        { k: 'price', t: 'text', l: '價格', half: 1 }, { k: 'unit', t: 'text', l: '價格單位（例：元／潛）', half: 1 },
        { k: 'days', t: 'text', l: '天數' }, { k: 'where', t: 'textarea', l: '地點／說明' },
        { k: 'hours', t: 'list', l: '時數格子', item: function (x) { return (x.value || '') + ' ' + (x.label || ''); }, of: [{ k: 'value', t: 'text', l: '數字（例：2 hr）', half: 1 }, { k: 'label', t: 'text', l: '名稱（例：理論課）', half: 1 }] },
        { k: 'detailsLabel', t: 'text', l: '展開按鈕文字', ph: '課程內容' },
        { k: 'details', t: 'list', l: '展開內容', item: function (x) { return x.heading || '項目'; }, of: [{ k: 'heading', t: 'text', l: '小標' }, { k: 'text', t: 'textarea', l: '內容' }] },
        { k: 'gift', t: 'text', l: '黃底小禮（選填）' }] }] },
    table: { label: '價目表格', sum: function (b) { return (b.rows || []).length + ' 列'; }, fields: [
      { k: 'headers', t: 'strings', l: '表頭欄位' },
      { k: 'rows', t: 'list', l: '表格列', item: function (x) { return (x.cells || []).join('｜'); }, of: [
        { k: 'cells', t: 'strings', l: '各欄內容（依表頭順序）' }, { k: 'note', t: 'text', l: '第一欄下方小字（選填）' }] },
      { k: 'footnote', t: 'text', l: '表格下方註腳' }] },
    notes: { label: '重點提醒框', sum: function (b) { return (b.items || [])[0]; }, fields: [{ k: 'items', t: 'strings', l: '提醒項目', multi: true }] },
    list: { label: '項目清單', sum: function (b) { return (b.items || []).join('、'); }, fields: [{ k: 'items', t: 'strings', l: '項目', multi: true }] },
    buttons: { label: '按鈕', sum: function (b) { return (b.buttons || []).map(function (x) { return x.text; }).join('、'); }, fields: [
      { k: 'buttons', t: 'list', l: '按鈕', item: function (x) { return x.text || '新按鈕'; }, of: [
        { k: 'text', t: 'text', l: '按鈕文字', half: 1 }, { k: 'style', t: 'select', l: '樣式', opts: STYLE_BTN, half: 1 }, { k: 'url', t: 'url', l: '連結網址' }] },
      { k: 'center', t: 'bool', l: '置中' }] },
    links: { label: '聯絡連結清單', sum: function (b) { return (b.items || []).map(function (x) { return x.label; }).join('、'); }, fields: [
      { k: 'items', t: 'list', l: '連結', item: function (x) { return (x.label || '') + '：' + (x.text || ''); }, of: [
        { k: 'label', t: 'text', l: '名稱（例：官方 IG）', half: 1 }, { k: 'text', t: 'text', l: '顯示文字', half: 1 },
        { k: 'url', t: 'url', l: '網址' }, { k: 'note', t: 'text', l: '後方補充（選填）' }] }] },
    people: { label: '人物卡片（教練）', sum: function (b) { return (b.people || []).map(function (x) { return x.name; }).join('、'); }, fields: [
      { k: 'people', t: 'list', l: '人物', item: function (x) { return x.name || '新人物'; }, of: [
        { k: 'name', t: 'text', l: '名字', half: 1 }, { k: 'tag', t: 'text', l: '名字旁小字（例：教練）', half: 1 },
        { k: 'role', t: 'text', l: '頭銜' },
        { k: 'photo', t: 'image', l: '照片' }, { k: 'photoAlt', t: 'text', l: '照片描述', half: 1 },
        { k: 'photoPos', t: 'text', l: '照片對焦位置', ph: '50% 40%', hint: '左右% 上下%，例：50% 28%', half: 1 },
        { k: 'links', t: 'list', l: '連結按鈕', item: function (x) { return x.text || '新連結'; }, of: [{ k: 'text', t: 'text', l: '文字', half: 1 }, { k: 'url', t: 'url', l: '網址', half: 1 }] },
        { k: 'bio', t: 'blocks', l: '「顯示更多」裡的介紹', only: ['text', 'heading', 'list', 'image', 'video'] }] }] },
    product: { label: '產品／折扣介紹', sum: function (b) { return b.title; }, fields: [
      { k: 'images', t: 'list', l: '產品照片（第一張為大圖）', bulk: 'src', thumbs: true, item: function (x, i) { return (i + 1) + '. ' + (x.alt || x.src || '新照片'); }, of: [{ k: 'src', t: 'image', l: '照片' }, { k: 'alt', t: 'text', l: '照片描述' }] },
      { k: 'title', t: 'text', l: '產品名稱' }, { k: 'subtitle', t: 'text', l: '副標' },
      { k: 'steps', t: 'strings', l: '使用步驟', multi: true },
      { k: 'codeLabel', t: 'text', l: '折扣碼標籤', half: 1 }, { k: 'code', t: 'text', l: '折扣碼（留空則不顯示）', half: 1 },
      { k: 'note', t: 'text', l: '補充說明' },
      { k: 'buttons', t: 'list', l: '按鈕', item: function (x) { return x.text || '新按鈕'; }, of: [
        { k: 'text', t: 'text', l: '按鈕文字', half: 1 }, { k: 'style', t: 'select', l: '樣式', opts: STYLE_BTN, half: 1 }, { k: 'url', t: 'url', l: '連結網址' }] }] },
    html: { label: '自訂 HTML（進階）', sum: function (b) { return (b.html || '').slice(0, 60); }, fields: [
      { k: 'html', t: 'textarea', l: 'HTML 原始碼', hint: '可貼上外部網站提供的嵌入碼（例如 Google 地圖、表單）' }] }
  };
  var BLOCK_ORDER = ['text', 'heading', 'image', 'video', 'gallery', 'cards', 'table', 'notes', 'list', 'buttons', 'links', 'people', 'product', 'html'];
  function newBlock(type) {
    var b = { type: type };
    if (type === 'gallery') b.images = [];
    if (type === 'video') b.mode = 'thumb';
    if (type === 'heading') b.level = 'h3';
    return b;
  }

  /* ================= 表單產生器 ================= */
  function getV(obj, f) { var v = obj[f.k]; return v == null ? (f.dflt != null ? f.dflt : '') : v; }

  function renderFields(box, obj, fields, rerender) {
    var grid = null;
    fields.forEach(function (f) {
      if (f.when && !f.when(obj)) return;
      var node = renderField(obj, f, rerender);
      if (f.half) {
        if (!grid) { grid = el('div', { class: 'grid2' }); box.appendChild(grid); }
        grid.appendChild(node);
      } else { grid = null; box.appendChild(node); }
    });
  }

  function renderField(obj, f, rerender) {
    var wrap;
    if (f.t === 'text' || f.t === 'url' || f.t === 'number') {
      wrap = el('label', { class: 'f' }, '<span>' + esc(f.l) + '</span>');
      var inp = el('input', { type: f.t === 'number' ? 'number' : 'text', inputmode: f.t === 'url' ? 'url' : null, placeholder: f.ph || (f.t === 'url' ? 'https://…' : null) });
      inp.value = getV(obj, f);
      inp.addEventListener('input', function () {
        if (f.t === 'number') { if (inp.value === '') delete obj[f.k]; else obj[f.k] = Number(inp.value); }
        else obj[f.k] = inp.value;
        markDirty(); if (f.live) f.live();
      });
      wrap.appendChild(inp);
    } else if (f.t === 'textarea') {
      wrap = el('label', { class: 'f' }, '<span>' + esc(f.l) + '</span>');
      var ta = el('textarea', { placeholder: f.ph || null });
      ta.value = getV(obj, f);
      ta.addEventListener('input', function () { obj[f.k] = ta.value; markDirty(); });
      wrap.appendChild(ta);
    } else if (f.t === 'select') {
      wrap = el('label', { class: 'f' }, '<span>' + esc(f.l) + '</span>');
      var sel = el('select');
      f.opts.forEach(function (o) { var op = el('option', { value: o[0] }, esc(o[1])); sel.appendChild(op); });
      sel.value = getV(obj, f) || f.opts[0][0];
      sel.addEventListener('change', function () { obj[f.k] = sel.value; markDirty(); if (f.rerender) rerender(); });
      wrap.appendChild(sel);
    } else if (f.t === 'bool') {
      wrap = el('label', { class: 'chk' });
      var cb = el('input', { type: 'checkbox' });
      var v = obj[f.k]; cb.checked = v == null ? !!f.dflt : !!v;
      cb.addEventListener('change', function () { obj[f.k] = cb.checked; markDirty(); if (f.rerender) rerender(); });
      wrap.appendChild(cb);
      wrap.appendChild(el('span', {}, esc(f.l) + (f.hint ? '<small>' + esc(f.hint) + '</small>' : '')));
      return wrap;
    } else if (f.t === 'image') {
      wrap = el('div', { class: 'f' });
      wrap.appendChild(el('span', { class: 'flabel' }, esc(f.l)));
      var row = el('div', { class: 'img-f' });
      var th = el('div', { class: 'thumb' });
      var r = el('div', { class: 'r' });
      var ii = el('input', { type: 'text', placeholder: '上傳圖片，或貼上外部圖片網址 https://…' });
      ii.value = getV(obj, f);
      function upd() { var u = resolve(ii.value); th.style.backgroundImage = u ? 'url("' + u.replace(/"/g, '%22') + '")' : ''; }
      ii.addEventListener('input', function () { obj[f.k] = ii.value.trim(); markDirty(); upd(); });
      var acts = el('div', { class: 'actions' });
      acts.appendChild(btn('📷 上傳圖片', 'btn small', function () {
        pickFiles(false, function (fs) {
          ii.value = '處理中…';
          addUpload(fs[0]).then(function (p) { ii.value = p; obj[f.k] = p; markDirty(); upd(); })
            .catch(function (e) { ii.value = obj[f.k] || ''; alert(e.message); });
        });
      }));
      if (ii.value) acts.appendChild(btn('清除', 'btn small ghost', function () { ii.value = ''; obj[f.k] = ''; markDirty(); upd(); }));
      r.appendChild(ii); r.appendChild(acts);
      row.appendChild(th); row.appendChild(r);
      wrap.appendChild(row);
      upd();
    } else if (f.t === 'strings') {
      wrap = el('div', { class: 'f strs' });
      wrap.appendChild(el('span', { class: 'flabel' }, esc(f.l)));
      var arr = obj[f.k] = obj[f.k] || [];
      var lb = el('div');
      wrap.appendChild(lb);
      var draw = function () {
        lb.innerHTML = '';
        arr.forEach(function (s, i) {
          var sr = el('div', { class: 'sr' });
          var si = el(f.multi ? 'textarea' : 'input', f.multi ? { rows: 2, style: 'min-height:0' } : { type: 'text' });
          si.value = s;
          si.addEventListener('input', function () { arr[i] = si.value; markDirty(); });
          sr.appendChild(si);
          sr.appendChild(btn('↑', 'ib', function () { move(arr, i, -1); markDirty(); draw(); }, '上移'));
          sr.appendChild(btn('✕', 'ib x', function () { arr.splice(i, 1); markDirty(); draw(); }, '刪除'));
          lb.appendChild(sr);
        });
        var add = btn('＋ 新增一項', 'btn small ghost', function () { arr.push(''); markDirty(); draw(); var t = lb.querySelectorAll('input,textarea'); if (t.length) t[t.length - 1].focus(); });
        lb.appendChild(add);
      };
      draw();
    } else if (f.t === 'list') {
      wrap = el('div', { class: 'f' });
      wrap.appendChild(el('span', { class: 'flabel' }, esc(f.l)));
      var list = obj[f.k] = obj[f.k] || [];
      var box = el('div', { class: 'items' });
      wrap.appendChild(box);
      var drawList = function () {
        box.innerHTML = '';
        if (f.thumbs && list.length) {
          var tb = el('div', { class: 'thumbs' });
          list.forEach(function (x, i) {
            var t = el('div', { class: 'th', title: x.alt || '' }, '<span>' + (i + 1) + '</span>');
            var u = resolve(x[f.bulk]); if (u) t.style.backgroundImage = 'url("' + u.replace(/"/g, '%22') + '")';
            t.addEventListener('click', function () { state.open.add(x); drawList(); });
            tb.appendChild(t);
          });
          box.appendChild(tb);
        }
        list.forEach(function (x, i) {
          var it = el('div', { class: 'item' });
          var head = el('div', { class: 'ih' });
          var isOpen = state.open.has(x);
          head.appendChild(el('span', { class: 'it' }, (isOpen ? '▾ ' : '▸ ') + esc(f.item ? f.item(x, i) : '項目 ' + (i + 1))));
          head.appendChild(btn('↑', 'ib', function () { move(list, i, -1); markDirty(); drawList(); }, '上移'));
          head.appendChild(btn('↓', 'ib', function () { move(list, i, 1); markDirty(); drawList(); }, '下移'));
          head.appendChild(btn('⧉', 'ib', function () { var c = clone(x); list.splice(i + 1, 0, c); state.open.add(c); markDirty(); drawList(); }, '複製'));
          head.appendChild(btn('✕', 'ib x', function () { if (confirm('確定刪除這一項？')) { list.splice(i, 1); markDirty(); drawList(); } }, '刪除'));
          head.addEventListener('click', function () { if (isOpen) state.open.delete(x); else state.open.add(x); drawList(); });
          it.appendChild(head);
          if (isOpen) {
            var body = el('div', { class: 'ib2' });
            renderFields(body, x, f.of, drawList);
            it.appendChild(body);
          }
          box.appendChild(it);
        });
        var acts = el('div', { class: 'actions', style: 'margin-top:4px' });
        acts.appendChild(btn('＋ 新增', 'btn small ghost', function () { var n = {}; list.push(n); state.open.add(n); markDirty(); drawList(); }));
        if (f.bulk) acts.appendChild(btn('📷 一次上傳多張照片', 'btn small', function () {
          pickFiles(true, function (fs) {
            var info = el('span', { class: 'hint' }, '處理中… 0/' + fs.length); acts.appendChild(info);
            var done = 0, chain = Promise.resolve();
            fs.forEach(function (file) {
              chain = chain.then(function () {
                return addUpload(file).then(function (p) { var n = {}; n[f.bulk] = p; list.push(n); done++; info.textContent = '處理中… ' + done + '/' + fs.length; });
              }).catch(function (e) { alert(e.message); });
            });
            chain.then(function () { markDirty(); if (rerender) rerender(); else drawList(); });
          });
        }));
        box.appendChild(acts);
      };
      drawList();
    } else if (f.t === 'blocks') {
      wrap = el('div', { class: 'f' });
      wrap.appendChild(el('span', { class: 'flabel' }, esc(f.l)));
      var bl = obj[f.k] = obj[f.k] || [];
      var bbox = el('div', { class: 'items' });
      wrap.appendChild(bbox);
      blocksEditor(bbox, bl, f.only);
    }
    if (f.hint && wrap && f.t !== 'bool') wrap.appendChild(el('small', { class: 'hint' }, esc(f.hint)));
    return wrap;
  }

  function blocksEditor(box, blocks, only) {
    function draw() {
      box.innerHTML = '';
      if (!blocks.length) box.appendChild(el('p', { class: 'hint' }, '目前沒有內容區塊。'));
      blocks.forEach(function (b, i) {
        var def = BLOCKS[b.type] || { label: b.type, fields: [], sum: function () { return ''; } };
        var isOpen = state.open.has(b);
        var card = el('div', { class: 'blk' + (b.hidden ? ' off' : '') });
        var h = el('div', { class: 'bh' });
        var sum = '';
        try { sum = def.sum(b) || ''; } catch (e) {}
        h.appendChild(el('div', { class: 'bt' }, '<b>' + (isOpen ? '▾ ' : '▸ ') + esc(def.label) + (b.hidden ? '<span class="tag off">已隱藏</span>' : '') + '</b><small>' + esc(String(sum).replace(/\n/g, ' ').slice(0, 80)) + '</small>'));
        h.appendChild(btn('↑', 'ib', function () { move(blocks, i, -1); markDirty(); draw(); }, '上移'));
        h.appendChild(btn('↓', 'ib', function () { move(blocks, i, 1); markDirty(); draw(); }, '下移'));
        h.appendChild(btn(b.hidden ? '👁' : '🙈', 'ib', function () { b.hidden = !b.hidden; markDirty(); draw(); }, b.hidden ? '顯示' : '暫時隱藏'));
        h.appendChild(btn('✕', 'ib x', function () { if (confirm('確定刪除「' + def.label + '」區塊？')) { blocks.splice(i, 1); markDirty(); draw(); } }, '刪除'));
        h.addEventListener('click', function () { if (isOpen) state.open.delete(b); else state.open.add(b); draw(); });
        card.appendChild(h);
        if (isOpen) {
          var body = el('div', { class: 'bb' });
          renderFields(body, b, def.fields, draw);
          card.appendChild(body);
        }
        box.appendChild(card);
      });
      var bar = el('div', { class: 'addbar' });
      var sel = el('select');
      (only || BLOCK_ORDER).forEach(function (k) { sel.appendChild(el('option', { value: k }, esc(BLOCKS[k].label))); });
      bar.appendChild(sel);
      bar.appendChild(btn('＋ 新增內容區塊', 'btn small', function () { var n = newBlock(sel.value); blocks.push(n); state.open.add(n); markDirty(); draw(); }));
      box.appendChild(bar);
    }
    draw();
  }

  /* ================= 大項／細項 ================= */
  function nodeAt(path) {
    var n = null, list = state.site.sections;
    path.forEach(function (i) { n = list[i]; list = n.children = n.children || []; });
    return n;
  }
  var ID_FIELD = { k: 'id', t: 'text', l: '網址代稱（英文、數字、-）', hint: '用於網址，例如 #courses 或 p/okinawa/。只能用英文、數字與 -，修改後舊連結會失效。' };
  function fieldsFor(node, depth, parent) {
    if (depth === 0) return [
      { k: 'title', t: 'text', l: '網頁上的標題', half: 1 },
      { k: 'nav', t: 'text', l: '上方選單顯示名稱', half: 1, hint: '留空則使用標題' },
      { k: 'subtitle', t: 'textarea', l: '標題下方說明（選填）' },
      { k: 'layout', t: 'select', l: '顯示方式', rerender: true, opts: [['open', '直接顯示'], ['collapsible', '點擊展開（摺疊區塊）'], ['contact', '底部聯絡區（深色）']] },
      { k: 'count', t: 'text', l: '摺疊標題右側小字', ph: '例：3 個課程分類', when: function (o) { return o.layout === 'collapsible'; } },
      { k: 'showInNav', t: 'bool', l: '顯示在網站上方選單', dflt: true },
      { k: 'showOnPage', t: 'bool', l: '顯示在網頁內容中', dflt: true, rerender: true, hint: '關閉＝只出現在選單（例如「國外潛旅」），細項會變成獨立頁面或外部連結' },
      { k: 'navMenu', t: 'bool', l: '選單做成下拉式，列出所有細項', rerender: true },
      { k: 'exclusive', t: 'bool', l: '細項一次只展開一個', hint: '例如相片集的「賽事／潛旅」' },
      { k: 'link', t: 'url', l: '點選單直接前往外部網址（選填）', hint: '填了之後選單會連到這個網址' },
      { k: 'hidden', t: 'bool', l: '暫時隱藏整個大項（不刪除）' },
      ID_FIELD
    ];
    var f = [
      { k: 'title', t: 'text', l: '標題' },
      { k: 'subtitle', t: 'textarea', l: '標題下方說明（選填）' },
      { k: 'layout', t: 'select', l: '顯示方式', rerender: true, opts: [['open', '直接顯示'], ['collapsible', '點擊展開（摺疊區塊）']] },
      { k: 'count', t: 'text', l: '摺疊標題右側小字', ph: '例：3 項賽事紀錄', when: function (o) { return o.layout === 'collapsible'; } },
      { k: 'open', t: 'bool', l: '預設展開', when: function (o) { return o.layout === 'collapsible'; } }
    ];
    if (depth === 1 && parent && parent.navMenu) f.push(
      { k: 'nav', t: 'text', l: '選單中顯示名稱（選填）', half: 1 },
      { k: 'navNote', t: 'text', l: '選單中右側小字', ph: '例：MIYAKO BLUE ↗', half: 1 },
      { k: 'link', t: 'url', l: '點選單前往的網址', hint: parent.showOnPage === false ? '留空＝自動用下方內容產生一個獨立頁面；也可填站內頁面（例：miyako/）或外部網址' : '留空＝跳到網頁中這個細項的位置' });
    f.push({ k: 'hidden', t: 'bool', l: '暫時隱藏（不刪除）' }, ID_FIELD);
    return f;
  }

  function nodeTags(n) {
    var t = '';
    if (n.hidden) t += '<span class="tag off">已隱藏</span>';
    if (n.showOnPage === false) t += '<span class="tag">只在選單</span>';
    if (n.showInNav === false && n.showOnPage !== false) t += '<span class="tag">不在選單</span>';
    if (n.layout === 'collapsible') t += '<span class="tag">摺疊</span>';
    if (n.link) t += '<span class="tag">連結</span>';
    return t;
  }

  function newNode(title, siblings) {
    var n = { id: '', title: title, layout: 'open', blocks: [], children: [] };
    var sib = (siblings || []).filter(function (x) { return x && x.layout !== 'contact'; });
    var last = sib[sib.length - 1];
    if (last) {
      n.layout = last.layout;
      // 參考同層最後一項的區塊類型（例如相簿），預先放一個空的
      if (last.blocks && last.blocks[0] && last.blocks[0].type === 'gallery') n.blocks.push(newBlock('gallery'));
    }
    var base = CMS.slug(title);
    n.id = /^[\w-]+$/.test(base) ? base : 's-' + rid();
    return n;
  }

  function nodeList(box, list, pathPrefix, emptyText, addLabel) {
    if (!list.length) box.appendChild(el('p', { class: 'hint' }, emptyText));
    list.forEach(function (n, i) {
      var row = el('div', { class: 'row' });
      var sub = n.layout === 'contact' ? '底部聯絡區' : ((n.children || []).length ? n.children.length + ' 個細項・' : '') + (n.blocks || []).length + ' 個內容區塊';
      var t = el('div', { class: 't' }, '<b>' + esc(n.nav || n.title || '（未命名）') + nodeTags(n) + '</b><small>' + esc(sub) + '</small>');
      t.style.cursor = 'pointer';
      t.addEventListener('click', function () { go(pathPrefix.concat(i)); });
      row.appendChild(t);
      row.appendChild(btn('↑', 'ib', function () { move(list, i, -1); markDirty(); render(); }, '上移'));
      row.appendChild(btn('↓', 'ib', function () { move(list, i, 1); markDirty(); render(); }, '下移'));
      row.appendChild(btn('編輯', 'btn small', function () { go(pathPrefix.concat(i)); }));
      row.appendChild(btn('✕', 'ib x', function () {
        if (confirm('確定刪除「' + (n.title || n.nav) + '」以及裡面所有內容？\n（發佈前都還可以按「放棄修改」復原）')) { list.splice(i, 1); markDirty(); render(); }
      }, '刪除'));
      box.appendChild(row);
    });
    var acts = el('div', { class: 'actions' });
    acts.appendChild(btn(addLabel, 'btn small', function () {
      var t = prompt('名稱？');
      if (!t || !t.trim()) return;
      var n = newNode(t.trim(), list);
      if (!pathPrefix.length && list.length && list[list.length - 1].showOnPage === false) {
        // 新大項放在「只在選單」的項目（國外潛旅）前面，維持選單順序
        var at = list.length; while (at > 0 && (list[at - 1].showOnPage === false || list[at - 1].layout === 'contact')) at--;
        list.splice(at, 0, n); CMS.ensureIds(state.site); markDirty(); go(pathPrefix.concat(at)); return;
      }
      list.push(n); CMS.ensureIds(state.site); markDirty(); go(pathPrefix.concat(list.length - 1));
    }));
    box.appendChild(acts);
  }

  /* ================= 畫面 ================= */
  function go(path, kind) {
    state.view = { kind: kind || (path && path.length ? 'node' : 'home'), path: path || [] };
    render();
    window.scrollTo(0, 0);
  }

  function crumbs(path) {
    var c = el('div', { class: 'crumbs' });
    c.appendChild(btn('首頁', '', function () { go([]); }));
    var cur = [];
    path.forEach(function (i, k) {
      cur = cur.concat(i);
      var p = cur.slice();
      var n = nodeAt(p);
      c.appendChild(el('span', {}, '›'));
      if (k === path.length - 1) c.appendChild(el('b', {}, esc(n.nav || n.title || '（未命名）')));
      else c.appendChild(btn(esc(n.nav || n.title), '', function () { go(p); }));
    });
    return c;
  }

  function card(title, desc) {
    var c = el('section', { class: 'card' });
    c.appendChild(el('h2', {}, title));
    if (desc) c.appendChild(el('p', { class: 'desc' }, desc));
    return c;
  }

  function render() {
    var v = $('view');
    v.innerHTML = '';
    if (!state.site) return;
    var st = state.view;
    if (st.kind === 'hero') {
      v.appendChild(crumbs([]));
      var c = card('網站頂部', '最上方深藍色區塊：標誌、大標題、介紹文字與按鈕。');
      var hero = state.site.hero = state.site.hero || {};
      renderFields(c, hero, [
        { k: 'logo', t: 'image', l: '標誌圖片' },
        { k: 'title', t: 'text', l: '大標題', half: 1 }, { k: 'subtitle', t: 'text', l: '大標題下方英文', half: 1 },
        { k: 'lead', t: 'textarea', l: '介紹文字' },
        BLOCKS.buttons.fields[0]
      ], render);
      v.appendChild(c);
      return;
    }
    if (st.kind === 'meta') {
      v.appendChild(crumbs([]));
      var m = card('網頁標題與頁尾');
      var meta = state.site.meta = state.site.meta || {};
      renderFields(m, meta, [
        { k: 'title', t: 'text', l: '瀏覽器分頁標題（也是 Google 搜尋標題）' },
        { k: 'description', t: 'textarea', l: 'Google 搜尋結果的介紹文字' },
        { k: 'siteName', t: 'text', l: '網站名稱' }
      ], render);
      renderFields(m, state.site, [{ k: 'footer', t: 'text', l: '頁尾文字' }], render);
      v.appendChild(m);
      return;
    }
    if (st.kind === 'node') {
      var node = nodeAt(st.path);
      if (!node) { go([]); return; }
      var depth = st.path.length - 1;
      var parent = depth ? nodeAt(st.path.slice(0, -1)) : null;
      v.appendChild(crumbs(st.path));
      var c1 = card(depth === 0 ? '大項設定' : '細項設定');
      renderFields(c1, node, fieldsFor(node, depth, parent), render);
      v.appendChild(c1);

      var c2 = card('內容區塊', '這個' + (depth === 0 ? '大項' : '細項') + '裡的文字、圖片、影片、相簿、價格⋯ 每個區塊都可以獨立修改、排序、隱藏。點區塊標題展開編輯。');
      var bb = el('div');
      node.blocks = node.blocks || [];
      blocksEditor(bb, node.blocks);
      c2.appendChild(bb);

      if (node.layout !== 'contact') {
        var c3 = card('下一層細項', '例如「課程 → AIDA 證照課程」、「相片集 → 賽事 → 2026 PRC」。點細項可以再往下一層新增。');
        node.children = node.children || [];
        nodeList(c3, node.children, st.path, '目前沒有細項。', '＋ 新增細項');
        // 細項排在內容區塊上方比較好找（相片集、課程）
        if (node.children.length) { v.appendChild(c3); v.appendChild(c2); }
        else { v.appendChild(c2); v.appendChild(c3); }
      } else v.appendChild(c2);
      return;
    }
    // 首頁
    var h = card('網站整體');
    var r1 = el('div', { class: 'row' });
    r1.appendChild(el('div', { class: 't' }, '<b>網站頂部</b><small>標誌、大標題「' + esc((state.site.hero || {}).title || '') + '」、介紹文字、按鈕</small>'));
    r1.appendChild(btn('編輯', 'btn small', function () { go([], 'hero'); }));
    h.appendChild(r1);
    var r2 = el('div', { class: 'row' });
    r2.appendChild(el('div', { class: 't' }, '<b>網頁標題與頁尾</b><small>' + esc((state.site.meta || {}).title || '') + '</small>'));
    r2.appendChild(btn('編輯', 'btn small', function () { go([], 'meta'); }));
    h.appendChild(r2);
    v.appendChild(h);

    var s = card('上方選單大項', '介紹影片、教練、課程、小琉球導潛、折扣產品、相片集、報名、國外潛旅⋯ 順序＝選單與網頁的順序。點「編輯」可修改內容、新增下一層細項。');
    nodeList(s, state.site.sections, [], '還沒有任何大項。', '＋ 新增大項');
    v.appendChild(s);

    var tip = card('使用小提醒');
    tip.appendChild(el('ul', { class: 'help' },
      '<li>修改會自動暫存在這台裝置；按下方「發佈到網站」才會更新正式網站（約 1 分鐘生效）。</li>' +
      '<li>圖片可以直接上傳（會自動縮小），也可以貼上外部圖片網址。影片可貼 YouTube／Vimeo／IG 連結。</li>' +
      '<li>文字中可用 <code>**粗體**</code> 與 <code>[連結文字](https://網址)</code>。</li>' +
      '<li>發佈前可先按「👀 預覽」看看手機與電腦的樣子。</li>'));
    var acts = el('div', { class: 'actions' });
    acts.appendChild(btn('放棄所有未發佈的修改', 'btn small danger', function () {
      if (!confirm('確定放棄這台裝置上所有尚未發佈的修改，重新載入網站目前的內容？')) return;
      clearDraft(); state.uploads = {}; state.dirty = false; load(true);
    }));
    tip.appendChild(acts);
    v.appendChild(tip);
  }

  /* ================= 預覽 ================= */
  function previewHtml() {
    var site = CMS.ensureIds(clone(state.site));
    var v = state.view, html;
    // 正在編輯「只在選單」大項底下的獨立頁面時，預覽那一頁
    if (v.kind === 'node' && v.path.length >= 2) {
      var sec = site.sections[v.path[0]], child = sec && sec.children[v.path[1]];
      if (sec && child && sec.showOnPage === false && !child.link) html = CMS.renderSubPage(site, sec, child, { css: state.css, resolve: resolve });
    }
    if (!html) html = CMS.renderPage(site, { css: state.css, resolve: resolve });
    // 讓預覽中的連結不要把後台換掉
    return html.replace('<head>', '<head><base target="_blank">');
  }
  function scrollTargetId() {
    var v = state.view;
    if (v.kind !== 'node') return '';
    var n = nodeAt(v.path);
    return n && n.id;
  }
  $('previewBtn').onclick = function () {
    if (!state.site) return;
    var f = $('pvFrame');
    var id = scrollTargetId();
    f.onload = function () {
      try {
        var d = f.contentDocument;
        // 站內錨點在預覽中直接捲動
        d.querySelectorAll('a[href^="#"]').forEach(function (a) { a.target = '_self'; a.addEventListener('click', function (e) { var t = d.getElementById(a.getAttribute('href').slice(1)); if (t) { e.preventDefault(); t.scrollIntoView(); } }); });
        var t = id && d.getElementById(id);
        if (t) {
          var p = t; while (p) { if (p.tagName === 'DETAILS') p.open = true; p = p.parentElement; }
          var det = t.querySelector('details'); if (det) det.open = true;
          t.scrollIntoView();
        }
      } catch (e) {}
    };
    f.srcdoc = previewHtml();
    $('pv').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  };
  $('pvClose').onclick = function () { $('pv').classList.add('hidden'); document.body.style.overflow = ''; $('pvFrame').srcdoc = ''; };
  $('pvPhone').onclick = function () { $('pv').classList.add('phone'); };
  $('pvDesk').onclick = function () { $('pv').classList.remove('phone'); };

  /* ================= 發佈 ================= */
  $('publishBtn').onclick = function () {
    if (state.busy || !state.site) return;
    if (!cfg().token) { $('settingsCard').classList.remove('hidden'); msg('settingsMsg', '請先設定 GitHub Token 才能發佈。', 'err'); window.scrollTo(0, 0); return; }
    var b = $('publishBtn');
    state.busy = true; b.disabled = true; b.innerHTML = '<span class="spinner"></span> 發佈中…';
    msg('loadMsg', '');
    var site = CMS.ensureIds(clone(state.site));
    state.site = clone(site);
    ghFile(SITE_PATH).then(function (remote) {
      if (remote && state.sha && remote.sha !== state.sha) {
        if (!confirm('網站內容在你開始編輯後，已經被其他裝置更新過了。\n\n按「確定」用你目前的版本覆蓋；按「取消」先不發佈（可以按「放棄所有未發佈的修改」載入最新版）。')) throw new Error('已取消發佈');
      }
      var json = JSON.stringify(site, null, 2) + '\n';
      var pages = CMS.renderAll(site, { css: state.css });
      var files = [{ path: SITE_PATH, text: json }].concat(pages.map(function (p) { return { path: p.path, text: p.html }; }));
      var used = Object.keys(state.uploads).filter(function (p) { return json.indexOf(p) !== -1; });
      used.forEach(function (p) { files.push({ path: p, base64: state.uploads[p].base64 }); });
      var keep = {}; pages.forEach(function (p) { keep[p.path] = 1; });
      return commit(files, '後台更新網站內容' + (used.length ? '（新增 ' + used.length + ' 張圖片）' : ''), function (all) {
        return all.filter(function (p) { return /^p\/[^/]+\/index\.html$/.test(p) && !keep[p]; });
      });
    }).then(function () {
      return ghFile(SITE_PATH);
    }).then(function (f) {
      state.sha = f && f.sha; state.uploads = {}; state.dirty = false; clearDraft();
      updateStatus(); render();
      msg('loadMsg', '✓ 發佈成功！約 1 分鐘後網站會更新（手機若沒變化請重新整理）。', 'ok');
      window.scrollTo(0, 0);
    }).catch(function (e) {
      msg('loadMsg', esc(e.message), e.message === '已取消發佈' ? '' : 'err');
      window.scrollTo(0, 0);
    }).then(function () { state.busy = false; b.disabled = false; b.textContent = '發佈到網站'; });
  };

  /* ================= 載入 ================= */
  function fetchText(u) { return fetch(u, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(u + ' ' + r.status); return r.text(); }); }
  function load(ignoreDraft) {
    var c = cfg();
    msg('loadMsg', '載入中…');
    var p = c.token
      ? Promise.all([ghFile(SITE_PATH), ghFile(CSS_PATH)]).then(function (r) {
        if (!r[0]) throw new Error('GitHub 上找不到 ' + SITE_PATH);
        return { site: JSON.parse(r[0].text), sha: r[0].sha, css: r[1] ? r[1].text : null };
      }).catch(function (e) {
        msg('settingsMsg', esc(e.message), 'err');
        return null;
      })
      : Promise.resolve(null);
    return p.then(function (r) {
      if (r && r.css) return r;
      return Promise.all([r ? r.site : fetchText('../' + SITE_PATH).then(JSON.parse), fetchText('../' + CSS_PATH)]).then(function (x) {
        return { site: x[0], sha: r ? r.sha : null, css: x[1] };
      });
    }).then(function (r) {
      state.css = r.css;
      state.site = r.site; state.sha = r.sha; state.dirty = false;
      var draft = null;
      if (!ignoreDraft) try { draft = JSON.parse(lsGet(LS.draft) || 'null'); } catch (e) {}
      if (draft && draft.site) {
        var when = new Date(draft.at).toLocaleString();
        var stale = state.sha && draft.sha && draft.sha !== state.sha;
        if (confirm('這台裝置有尚未發佈的修改（' + when + '）。要繼續編輯嗎？' + (stale ? '\n\n⚠️ 注意：之後網站有被其他裝置更新過，繼續發佈會覆蓋那些更新。' : '') + '\n\n按「取消」會放棄這些修改。')) {
          state.site = draft.site; state.uploads = draft.uploads || {}; state.dirty = true;
          if (!stale) state.sha = draft.sha || state.sha;
        } else clearDraft();
      }
      CMS.ensureIds(state.site);
      msg('loadMsg', '');
      updateStatus(); render();
    }).catch(function (e) {
      msg('loadMsg', '載入失敗：' + esc(e.message), 'err');
    });
  }

  /* ================= 連線設定 ================= */
  function refreshSettingsUI() {
    var c = cfg();
    $('sToken').value = c.token; $('sRepo').value = lsGet(LS.repo); $('sBranch').value = lsGet(LS.branch);
    $('settingsCard').classList.toggle('hidden', !!c.token);
  }
  $('openSettings').onclick = function () { $('settingsCard').classList.toggle('hidden'); };
  $('saveSettings').onclick = function () {
    lsSet(LS.token, $('sToken').value.trim()); lsSet(LS.repo, $('sRepo').value.trim()); lsSet(LS.branch, $('sBranch').value.trim());
    msg('settingsMsg', '測試中…');
    gh('').then(function (repo) {
      if (repo.permissions && !repo.permissions.push) throw new Error('這個 Token 沒有寫入權限（需要 Contents：Read and write）');
      return gh('/branches/' + encodeURIComponent(cfg().branch));
    }).then(function () {
      msg('settingsMsg', '✓ 連線成功', 'ok');
      setTimeout(function () { $('settingsCard').classList.add('hidden'); }, 900);
      if (!state.dirty) load(); else ghFile(SITE_PATH).then(function (f) { if (f && !state.sha) state.sha = f.sha; updateStatus(); });
    }).catch(function (e) { msg('settingsMsg', esc(e.message), 'err'); });
  };
  $('clearSettings').onclick = function () { lsSet(LS.token, ''); refreshSettingsUI(); msg('settingsMsg', '已清除', 'ok'); updateStatus(); };

  window.addEventListener('beforeunload', function (e) { if (state.dirty) saveDraft(); });

  refreshSettingsUI();
  load();
})();
