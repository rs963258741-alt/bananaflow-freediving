/*
 * 蕉流 Freediving — 網站渲染器
 * 同一份程式同時給「後台預覽／發佈（瀏覽器）」與「本機建置（Node：scripts/build.js）」使用，
 * 把 content/site.json 轉成完整的 index.html，確保預覽與正式網站完全一致。
 */
(function (root) {
  'use strict';

  /* ---------------- 小工具 ---------------- */
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** 只允許安全的網址；站內相對路徑、#錨點、http(s)、mailto、tel */
  function safeUrl(u) {
    u = String(u == null ? '' : u).trim();
    if (!u) return '';
    if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
    if (/^#[\w\-一-鿿]*$/.test(u)) return u;
    if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(u)) return 'mailto:' + u;
    if (/^(www\.)?[\w-]+(\.[\w-]+)+\.[a-z]{2,}(\/|$)/i.test(u) || /^www\./i.test(u)) return 'https://' + u;
    if (/^(\.{0,2}\/)?[\w\-一-鿿][\w\-./一-鿿%?=&]*$/.test(u) && !/^javascript/i.test(u)) return u;
    return '';
  }
  function isExternal(href) { return /^https?:/i.test(href); }
  function aOpen(url, cls) {
    var href = safeUrl(url);
    if (!href) return null;
    return '<a' + (cls ? ' class="' + cls + '"' : '') + ' href="' + esc(href) + '"' +
      (isExternal(href) ? ' target="_blank" rel="noopener"' : '') + '>';
  }

  /** 行內格式：**粗體**、[文字](網址)；其餘全部跳脫 */
  function inline(text) {
    var s = esc(text);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, t, u) {
      var o = aOpen(u.replace(/&amp;/g, '&'));
      return o ? o + t + '</a>' : t;
    });
    return s;
  }
  function lines(text) {
    return String(text || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function multiline(text) { return lines(text).map(inline).join('<br>'); }

  function slug(s) {
    var t = String(s || '').trim().toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/^-+|-+$/g, '');
    return t || 'item';
  }

  /** 圖片路徑：外部網址原樣；站內路徑交給 opt.resolve（後台預覽會換成 ../ 或暫存圖） */
  function src(path, opt) {
    path = String(path || '').trim();
    if (!path) return '';
    if (opt && opt.resolve) return opt.resolve(path);
    if (/^(data:|https?:|blob:|\/)/.test(path)) return path;
    return (opt && opt.base || '') + path;
  }

  /* ---------------- 影片網址解析 ---------------- */
  function parseVideo(url) {
    url = String(url || '').trim();
    var m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/i);
    if (m) return { kind: 'youtube', id: m[1], embed: 'https://www.youtube-nocookie.com/embed/' + m[1], thumb: 'https://i.ytimg.com/vi/' + m[1] + '/hqdefault.jpg' };
    m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
    if (m) return { kind: 'vimeo', id: m[1], embed: 'https://player.vimeo.com/video/' + m[1] };
    m = url.match(/instagram\.com\/(?:[\w.]+\/)?(p|reel|tv)\/([\w-]+)/i);
    if (m) return { kind: 'instagram', embed: 'https://www.instagram.com/' + m[1] + '/' + m[2] + '/embed' };
    if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url)) return { kind: 'file' };
    return { kind: 'link' };
  }

  var PLAY = '<svg viewBox="0 0 68 68" aria-hidden="true"><circle cx="34" cy="34" r="33" fill="#f2c318"/><path d="M27 20l23 14-23 14z" fill="#1c1600"/></svg>';

  /* ---------------- 內容區塊 ---------------- */
  var B = {};

  B.text = function (b, opt, ctx) {
    var ls = lines(b.text);
    if (!ls.length) return '';
    var cls = { sub: 'sub', more: 'more', fn: 'fn', note: 'more' }[b.style] || '';
    var attr = cls ? ' class="' + cls + '"' : '';
    var st = b.style === 'note' ? ' style="margin-top:0"' : '';
    if (!cls && ctx && ctx.inBio) return ls.map(function (l) { return '<p>' + inline(l) + '</p>'; }).join('');
    if (!cls) return '<div class="blk-p">' + ls.map(function (l) { return '<p>' + inline(l) + '</p>'; }).join('') + '</div>';
    return ls.map(function (l) { return '<p' + attr + st + '>' + inline(l) + '</p>'; }).join('\n');
  };

  B.heading = function (b) {
    if (!b.text) return '';
    var tag = b.level === 'h4' ? 'h4' : 'h3';
    return '<' + tag + ' class="blk-' + tag + '">' + inline(b.text) + '</' + tag + '>';
  };

  B.list = function (b) {
    var it = (b.items || []).filter(Boolean);
    if (!it.length) return '';
    return '<ul class="blk-list">' + it.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</ul>';
  };

  B.notes = function (b) {
    var it = (b.items || []).filter(Boolean);
    if (!it.length) return '';
    return '<div class="notes">\n    <ul>\n' + it.map(function (x) { return '      <li>' + inline(x) + '</li>'; }).join('\n') + '\n    </ul>\n  </div>';
  };

  B.image = function (b, opt, ctx) {
    if (!b.src) return '';
    var img = '<img loading="lazy" alt="' + esc(b.alt || '') + '" src="' + esc(src(b.src, opt)) + '">';
    var o = b.link && aOpen(b.link);
    if (o) img = o + img + '</a>';
    var cls = ctx && ctx.inBio ? '' : ' class="blk-img"';
    return '<figure' + cls + '>' + img + (b.caption ? '<figcaption>' + inline(b.caption) + '</figcaption>' : '') + '</figure>';
  };

  B.video = function (b, opt) {
    var url = String(b.url || '').trim();
    if (!url) return '';
    var v = parseVideo(url);
    var title = b.title || '觀看影片';
    var h = '';
    if (b.mode === 'embed' && v.embed) {
      h = '<div class="vid-embed"><iframe src="' + esc(v.embed) + '" title="' + esc(title) + '" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>';
    } else if (v.kind === 'file') {
      var poster = b.thumb ? ' poster="' + esc(src(b.thumb, opt)) + '"' : '';
      h = '<div class="vid-embed"><video controls playsinline preload="metadata"' + poster + ' src="' + esc(src(url, opt)) + '"></video></div>';
    } else {
      var thumb = b.thumb ? src(b.thumb, opt) : (v.thumb || '');
      var href = safeUrl(url);
      h = '<a class="vid" href="' + esc(href) + '" target="_blank" rel="noopener" aria-label="' + esc(title) + '"' +
        (thumb ? ' style="background-image:url(&quot;' + esc(thumb) + '&quot;)"' : '') + '>\n    ' + PLAY + '\n  </a>';
    }
    if (b.caption) h += '\n  <p class="more">' + inline(b.caption) + '</p>';
    return h;
  };

  B.gallery = function (b, opt) {
    var im = (b.images || []).filter(function (x) { return x && x.src; });
    if (!im.length) return '';
    var init = Number(b.initial);
    return '<div class="gal"' + (init ? ' data-initial="' + init + '"' : '') + '>\n' + im.map(function (x) {
      return '    <img tabindex="0" role="button" loading="lazy" alt="' + esc(x.alt || '照片，點擊放大') + '" src="' + esc(src(x.src, opt)) + '">';
    }).join('\n') + '\n  </div>';
  };

  B.cards = function (b) {
    var cs = (b.cards || []);
    if (!cs.length) return '';
    return '<div class="grid">\n' + cs.map(function (c) {
      var h = '\n    <article class="card">\n';
      h += '      <h3>' + inline(c.title) + (c.tag ? ' <span>' + inline(c.tag) + '</span>' : '') + '</h3>\n';
      if (c.price) h += '      <div class="price">' + esc(c.price) + (c.unit ? '<small>' + esc(c.unit) + '</small>' : '') + '</div>\n';
      if (c.days) h += '      <p class="days">' + inline(c.days) + '</p>\n';
      if (c.where) h += '      <p class="where">' + multiline(c.where) + '</p>\n';
      var hrs = (c.hours || []).filter(function (x) { return x && (x.value || x.label); });
      if (hrs.length) h += '      <div class="hrs">' + hrs.map(function (x) { return '<div><b>' + esc(x.value) + '</b>' + esc(x.label) + '</div>'; }).join('') + '</div>\n';
      var det = (c.details || []).filter(function (x) { return x && (x.heading || x.text); });
      if (det.length) {
        h += '      <details>\n        <summary>' + esc(c.detailsLabel || '課程內容') + '</summary>\n';
        h += det.map(function (d) { return '        ' + (d.heading ? '<h4>' + inline(d.heading) + '</h4>' : '') + '<p>' + multiline(d.text) + '</p>'; }).join('\n') + '\n      </details>\n';
      }
      if (c.gift) h += '      <p class="gift">' + inline(c.gift) + '</p>\n';
      h += '    </article>\n';
      return h;
    }).join('') + '\n  </div>';
  };

  B.table = function (b) {
    var hd = (b.headers || []);
    var rows = (b.rows || []).filter(function (r) { return r && (r.cells || []).some(Boolean); });
    if (!rows.length) return '';
    var h = '<div class="tw">\n    <table>\n';
    if (hd.length) h += '      <thead><tr>' + hd.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') + '</tr></thead>\n';
    h += '      <tbody>\n' + rows.map(function (r) {
      return '        <tr>' + (r.cells || []).map(function (c, i) {
        if (i === 0) return '<td class="n">' + inline(c) + (r.note ? '<small>' + inline(r.note) + '</small>' : '') + '</td>';
        var cls = /^[\d,.\s+\-~～元]+$/.test(String(c || '')) ? 'pr' : 'in';
        return '<td class="' + cls + '">' + inline(c) + '</td>';
      }).join('') + '</tr>';
    }).join('\n') + '\n      </tbody>\n    </table>\n  </div>';
    if (b.footnote) h += '\n  <p class="fn">' + inline(b.footnote) + '</p>';
    return h;
  };

  B.buttons = function (b) {
    var bs = (b.buttons || []).filter(function (x) { return x && x.text; });
    if (!bs.length) return '';
    return '<div class="btns' + (b.center ? '' : ' blk-btns') + '"' + (b.center ? ' style="justify-content:center"' : '') + '>\n' + bs.map(function (x) {
      var o = aOpen(x.url, 'btn ' + ({ p: 'p', s: 's', o: 'o' }[x.style] || 'p'));
      return '    ' + (o ? o + esc(x.text) + '</a>' : '<span class="btn ' + (x.style || 'p') + '">' + esc(x.text) + '</span>');
    }).join('\n') + '\n  </div>';
  };

  B.links = function (b) {
    var it = (b.items || []).filter(function (x) { return x && (x.text || x.label); });
    if (!it.length) return '';
    return '<ul class="soc">\n' + it.map(function (x) {
      var o = aOpen(x.url);
      var t = o ? o + esc(x.text || x.url) + '</a>' : esc(x.text);
      return '    <li>' + (x.label ? esc(x.label) + '：' : '') + t + (x.note ? inline(x.note) : '') + '</li>';
    }).join('\n') + '\n  </ul>';
  };

  B.people = function (b, opt) {
    var ps = (b.people || []);
    if (!ps.length) return '';
    return '<div class="grid">\n' + ps.map(function (p) {
      var h = '    <article class="card person">\n';
      if (p.photo) h += '      <div class="ph" role="img" aria-label="' + esc(p.photoAlt || p.name) + '" style="background-image:url(&quot;' + esc(src(p.photo, opt)) + '&quot;);background-position:' + esc(p.photoPos || '50% 40%') + '"></div>\n';
      h += '      <div class="tx">\n        <h3>' + inline(p.name) + (p.tag ? ' <span>' + inline(p.tag) + '</span>' : '') + '</h3>\n';
      if (p.role) h += '        <p class="role">' + inline(p.role) + '</p>\n';
      var lk = (p.links || []).filter(function (x) { return x && x.text; });
      if (lk.length) h += '        <div class="lk">\n' + lk.map(function (x) { var o = aOpen(x.url); return '          ' + (o ? o + esc(x.text) + '</a>' : '<span>' + esc(x.text) + '</span>'); }).join('\n') + '\n        </div>\n';
      var bio = renderBlocks(p.bio, opt, { inBio: true });
      if (bio) h += '        <details class="bio"><summary><span class="o">' + esc(p.moreLabel || '顯示更多') + '</span><span class="c">收合</span></summary>\n          <div class="bio-body">\n' + bio + '\n          </div>\n        </details>\n';
      h += '      </div>\n    </article>\n';
      return h;
    }).join('') + '  </div>';
  };

  B.product = function (b, opt) {
    var im = (b.images || []).filter(function (x) { return x && x.src; });
    var h = '<div class="prod">\n';
    if (im.length) {
      h += '    <div class="pimgs">\n      <img class="pmain" loading="lazy" alt="' + esc(im[0].alt || '') + '" src="' + esc(src(im[0].src, opt)) + '">\n';
      if (im.length > 1) h += '      <div class="prow">\n' + im.slice(1).map(function (x) { return '        <img loading="lazy" alt="' + esc(x.alt || '') + '" src="' + esc(src(x.src, opt)) + '">'; }).join('\n') + '\n      </div>\n';
      h += '    </div>\n';
    }
    h += '    <article class="card pinfo">\n';
    if (b.title) h += '      <h3>' + inline(b.title) + '</h3>\n';
    if (b.subtitle) h += '      <p class="role">' + inline(b.subtitle) + '</p>\n';
    var st = (b.steps || []).filter(Boolean);
    if (st.length) h += '      <ol class="how">\n' + st.map(function (s) { return '        <li>' + inline(s) + '</li>'; }).join('\n') + '\n      </ol>\n';
    if (b.code) h += '      <div class="code"><span>' + esc(b.codeLabel || '專屬折扣碼') + '</span><b class="dc">' + esc(b.code) + '</b><button type="button" class="cp">複製</button></div>\n';
    if (b.note) h += '      <p class="note">' + inline(b.note) + '</p>\n';
    var btn = B.buttons({ buttons: b.buttons, center: false });
    if (btn) h += '      ' + btn.replace(' blk-btns', '') + '\n';
    h += '    </article>\n  </div>';
    return h;
  };

  B.html = function (b) { return String(b.html || ''); };

  function renderBlocks(blocks, opt, ctx) {
    return (blocks || []).map(function (b) {
      if (!b || b.hidden) return '';
      var f = B[b.type];
      return f ? f(b, opt || {}, ctx || {}) : '';
    }).filter(Boolean).join('\n  ');
  }

  /* ---------------- 大項／細項（樹狀） ---------------- */
  function visibleChildren(n) { return (n.children || []).filter(function (c) { return c && !c.hidden; }); }
  function countLabel(n) {
    if (n.count) return n.count;
    var k = visibleChildren(n).length;
    return k ? k + ' 個項目' : '';
  }

  function childHtml(n, opt, parentDepth, parentCollapsible) {
    return visibleChildren(n).map(function (c) { return renderNode(c, opt, parentDepth + 1, parentCollapsible); }).join('\n');
  }

  function renderNode(n, opt, depth, parentCollapsible) {
    var id = n.id ? ' id="' + esc(n.id) + '"' : '';
    var blocks = renderBlocks(n.blocks, opt);
    var kids = visibleChildren(n);
    var h = '';
    if (n.layout === 'collapsible') {
      var excl = n.exclusive ? ' data-exclusive' : '';
      var details = '<details class="archive-group' + (depth === 0 ? ' service-accordion' : '') + '"' + (depth === 0 ? '' : id) + (n.open ? ' open' : '') + '>\n' +
        '    <summary><span class="archive-title">' + esc(n.title) + '</span>' + (countLabel(n) ? '<span class="archive-count">' + esc(countLabel(n)) + '</span>' : '') + '</summary>\n' +
        '    <div class="archive-content' + (depth === 0 ? ' service-content' + (kids.length ? '' : ' service-single') : '') + '"' + excl + '>\n';
      if (n.subtitle) details += '      <p class="' + (depth === 0 ? 'sub' : 'more') + '">' + multiline(n.subtitle) + '</p>\n';
      if (blocks) details += '  ' + blocks + '\n';
      if (kids.length) details += childHtml(n, opt, depth, true) + '\n';
      details += '    </div>\n  </details>';
      if (depth === 0) h = '<section class="sec service-toggle"' + id + '>\n  ' + details + '\n</section>';
      else h = details;
      return h;
    }
    if (depth === 0) {
      h = '<section class="sec"' + id + (n.exclusive ? ' data-exclusive' : '') + '>\n';
      if (n.title) h += '  <h2>' + inline(n.title) + '</h2>\n';
      if (n.subtitle) h += '  <p class="sub">' + multiline(n.subtitle) + '</p>\n';
      if (blocks) h += '  ' + blocks + '\n';
      if (kids.length) h += childHtml(n, opt, depth, false) + '\n';
      return h + '</section>';
    }
    if (depth === 1 && parentCollapsible) {
      h = '      <section class="service-inner"' + id + '>\n';
      if (n.title) h += '<h2>' + inline(n.title) + '</h2>\n';
      if (n.subtitle) h += '  <p class="sub">' + multiline(n.subtitle) + '</p>\n';
      if (blocks) h += '  ' + blocks + '\n';
      if (kids.length) h += childHtml(n, opt, depth, false) + '\n';
      return h + '</section>';
    }
    h = '      <div class="archive-item"' + id + '>\n';
    if (n.title) h += '<h3 class="gh">' + inline(n.title) + '</h3>\n';
    if (n.subtitle) h += '  <p class="more" style="margin-top:0">' + multiline(n.subtitle) + '</p>\n';
    if (blocks) h += '  ' + blocks + '\n';
    if (kids.length) h += childHtml(n, opt, depth, false) + '\n';
    return h + '      </div>';
  }

  function renderContact(n, opt) {
    var h = '<section class="contact" id="' + esc(n.id || 'contact') + '">\n';
    if (n.title) h += '  <h2>' + inline(n.title) + '</h2>\n';
    if (n.subtitle) h += '  <p>' + multiline(n.subtitle) + '</p>\n';
    var blocks = (n.blocks || []).map(function (b) {
      if (b && b.type === 'buttons') return B.buttons(Object.assign({}, b, { center: true }));
      return renderBlocks([b], opt);
    }).filter(Boolean).join('\n  ');
    if (blocks) h += '  ' + blocks + '\n';
    return h + '</section>';
  }

  /* ---------------- 導覽列 ---------------- */
  function nodeHref(sec, child, opt) {
    if (child.link) return safeUrl(child.link);
    if (sec.showOnPage === false) return (opt.base || '') + 'p/' + child.id + '/';
    return (opt.home || '') + '#' + child.id;
  }

  function renderNav(site, opt) {
    var h = '<nav aria-label="頁面導覽">\n';
    (site.sections || []).forEach(function (s, i) {
      if (!s || s.hidden || s.showInNav === false) return;
      var label = s.nav || s.title;
      var kids = visibleChildren(s);
      if (s.navMenu && kids.length) {
        var mid = 'navMenu' + i;
        h += '    <div class="nav-dropdown">\n      <button class="nav-dropdown-toggle" type="button" aria-expanded="false" aria-controls="' + mid + '">\n        ' +
          esc(label) + ' <span class="chevron" aria-hidden="true">⌄</span>\n      </button>\n      <div class="nav-dropdown-menu" id="' + mid + '">\n';
        kids.forEach(function (c) {
          var href = nodeHref(s, c, opt);
          var ext = c.link && (isExternal(href) || c.newTab !== false) ? ' target="_blank" rel="noopener"' : '';
          h += '        <a href="' + esc(href) + '"' + ext + '>' + esc(c.nav || c.title) + ' <small>' + esc(c.navNote || '') + '</small></a>\n';
        });
        h += '      </div>\n    </div>\n';
      } else if (s.link) {
        var o = aOpen(s.link);
        if (o) h += '    ' + o + esc(label) + '</a>\n';
      } else if (s.showOnPage !== false) {
        h += '    <a href="' + esc((opt.home || '') + '#' + s.id) + '">' + esc(label) + '</a>\n';
      }
    });
    return h + '  </nav>';
  }

  /* ---------------- 頁面 ---------------- */
  var SCRIPT = [
    '<script>',
    '// 標記 data-exclusive 的區塊：同一時間只展開一個分類',
    'document.querySelectorAll("[data-exclusive]").forEach(function(box){var gs=[].filter.call(box.children,function(e){return e.matches("details.archive-group")});gs.forEach(function(g){g.addEventListener("toggle",function(){if(!g.open)return;gs.forEach(function(o){if(o!==g)o.open=false})})})});',
    '',
    '(function(){var lb=document.getElementById("lb"),lbi=document.getElementById("lbi");',
    'function open(i){lbi.src=i.src;lbi.alt=i.alt;lb.showModal()}',
    'document.querySelectorAll(".gal img").forEach(function(i){i.addEventListener("click",function(){open(i)});i.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();open(i)}})});',
    'lb.addEventListener("click",function(){lb.close()});',
    'document.querySelectorAll(".gal").forEach(function(g){var im=g.querySelectorAll("img"),initial=Number(g.getAttribute("data-initial"))||3,n=im.length-initial;if(n<=0)return;var t="顯示更多（"+n+" 張）";for(var i=initial;i<im.length;i++)im[i].hidden=true;var b=document.createElement("button");b.type="button";b.className="more-btn";b.setAttribute("aria-expanded","false");b.textContent=t;b.addEventListener("click",function(){var o=b.getAttribute("aria-expanded")==="true";for(var i=initial;i<im.length;i++)im[i].hidden=o;b.setAttribute("aria-expanded",o?"false":"true");b.textContent=o?t:"收合"});g.parentNode.insertBefore(b,g.nextSibling)});})();',
    '</script>',
    '<script>',
    'document.querySelectorAll(".code").forEach(function(box){var b=box.querySelector(".cp"),c=box.querySelector(".dc");if(!b||!c)return;',
    'b.addEventListener("click",function(){var t=c.textContent;',
    'function done(){b.textContent="已複製";setTimeout(function(){b.textContent="複製"},1800)}',
    'function fb(){try{var r=document.createRange();r.selectNodeContents(c);var s=getSelection();s.removeAllRanges();s.addRange(r);document.execCommand("copy");done()}catch(e){b.textContent="請長按複製"}}',
    'try{navigator.clipboard.writeText(t).then(done,fb)}catch(e){fb()}})});',
    '</script>',
    '<script>',
    'document.querySelectorAll(".nav-dropdown").forEach(function(wrap){',
    '  var button=wrap.querySelector(".nav-dropdown-toggle");',
    '  function setOpen(open){wrap.classList.toggle("open",open);button.setAttribute("aria-expanded",open?"true":"false");}',
    '  button.addEventListener("click",function(){setOpen(button.getAttribute("aria-expanded")!=="true")});',
    '  document.addEventListener("click",function(event){if(!wrap.contains(event.target))setOpen(false)});',
    '  document.addEventListener("keydown",function(event){if(event.key==="Escape")setOpen(false)});',
    '});',
    '</script>'
  ].join('\n');

  function head(title, desc, css) {
    return '<!DOCTYPE html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
      '<title>' + esc(title) + '</title>\n' +
      (desc ? '<meta name="description" content="' + esc(desc) + '">\n' : '') +
      '<meta name="generator" content="bananaflow-cms">\n' +
      '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&display=swap">\n' +
      '<style>\n' + (css || '') + '\n</style>\n</head>\n';
  }

  function tail(site) {
    return '<footer>' + inline(site.footer || '') + '</footer>\n\n<dialog id="lb" aria-label="放大檢視"><img id="lbi" alt=""></dialog>\n' + SCRIPT + '\n</body>\n</html>\n';
  }

  /** 首頁完整 HTML。opt: { css, base, resolve } */
  function renderPage(site, opt) {
    opt = opt || {};
    var hero = site.hero || {};
    var meta = site.meta || {};
    var h = head(meta.title || '蕉流 Freediving', meta.description, opt.css) + '<body>\n\n<header class="hero">\n  ' + renderNav(site, opt) + '\n';
    h += '  <div class="depth" aria-hidden="true"></div>\n  <div class="hero-in">\n';
    if (hero.logo) h += '    <div class="badge"><img src="' + esc(src(hero.logo, opt)) + '" alt="' + esc(hero.logoAlt || '標誌') + '"></div>\n';
    h += '    <h1>' + esc(hero.title) + (hero.subtitle ? '<small>' + esc(hero.subtitle) + '</small>' : '') + '</h1>\n';
    if (hero.lead) h += '    <p class="lead">' + multiline(hero.lead) + '</p>\n';
    var hb = B.buttons({ buttons: hero.buttons, center: false });
    if (hb) h += '    ' + hb.replace(' blk-btns', '') + '\n';
    h += '  </div>\n</header>\n\n<main>\n';
    var after = '';
    (site.sections || []).forEach(function (s) {
      if (!s || s.hidden || s.showOnPage === false) return;
      if (s.layout === 'contact') after += renderContact(s, opt) + '\n';
      else h += renderNode(s, opt, 0, false) + '\n\n';
    });
    h += '</main>\n\n' + after;
    return h + tail(site);
  }

  /** 獨立頁面（例如國外潛旅底下沒有外部連結的細項）→ p/<id>/index.html */
  function renderSubPage(site, sec, child, opt) {
    opt = Object.assign({}, opt, { base: '../../', home: '../../' });
    var meta = site.meta || {};
    var h = head((child.title || '') + '｜' + (meta.siteName || '蕉流 Freediving'), child.subtitle || meta.description, opt.css) +
      '<body>\n\n<header class="hero" style="padding-bottom:2.5rem">\n  ' + renderNav(site, opt) + '\n  <div class="hero-in">\n' +
      '    <h1>' + esc(child.title) + (child.navNote ? '<small>' + esc(child.navNote.replace(/\s*↗\s*$/, '')) + '</small>' : '') + '</h1>\n' +
      (child.subtitle ? '    <p class="lead">' + multiline(child.subtitle) + '</p>\n' : '') +
      '    <a class="page-back" href="../../">← 回首頁</a>\n  </div>\n</header>\n\n<main>\n';
    var copy = Object.assign({}, child, { layout: 'open', title: '', subtitle: '', id: 'content' });
    h += renderNode(copy, opt, 0, false) + '\n</main>\n';
    return h + tail(site);
  }

  /** 列出所有需要產生的檔案：[{ path, html }] */
  function renderAll(site, opt) {
    var out = [{ path: 'index.html', html: renderPage(site, opt) }];
    (site.sections || []).forEach(function (s) {
      if (!s || s.hidden || s.showOnPage !== false) return;
      visibleChildren(s).forEach(function (c) {
        if (c.link) return;
        out.push({ path: 'p/' + c.id + '/index.html', html: renderSubPage(site, s, c, opt) });
      });
    });
    return out;
  }

  /** 確保每個節點都有唯一 id（網址錨點用） */
  function ensureIds(site) {
    var used = {};
    ['top', 'lb', 'lbi'].forEach(function (k) { used[k] = 1; });
    function walk(list) {
      (list || []).forEach(function (n) {
        if (!n) return;
        var id = n.id && /^[\w-]+$/.test(n.id) ? n.id : ('s-' + Math.random().toString(36).slice(2, 8));
        while (used[id]) id = id + '-' + Math.random().toString(36).slice(2, 4);
        used[id] = 1; n.id = id;
        walk(n.children);
      });
    }
    walk(site.sections);
    return site;
  }

  var API = {
    esc: esc, safeUrl: safeUrl, inline: inline, parseVideo: parseVideo, slug: slug,
    renderBlocks: renderBlocks, renderNode: renderNode, renderPage: renderPage,
    renderSubPage: renderSubPage, renderAll: renderAll, ensureIds: ensureIds
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.BananaCMS = API;
})(typeof window !== 'undefined' ? window : this);
