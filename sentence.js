/* 整句译文 · 方案 F（全站通用版）
   ------------------------------------------------------------------
   三层嵌套，句子照抄单词的挂法：
     <p> ... <span class=f-sent>英文整句（内含原来的 <w>）
                 <span class=f-mark>▾</span>
                 <span class=f-zh>整句中文</span>
             </span> ... </p>
   第 1 层 英文 / 第 2 层 词义（站点原生，点单词）/ 第 3 层 句义（点句子）。
   句义完全独立：点 ▾ 只切这一句的 f-on，绝不改 w.known / state.shown /
   localStorage / progress.json；点单词由站点原生处理，句义不受影响。

   页面只需在 </body> 前加一行：
     根目录页：<script src="sentence.js" data-sent="2021"></script>
     xt/ 子页：<script src="../sentence.js" data-sent="2021-xt"></script>
   译文数据按 key 放在 sentences/<key>.js，缺数据则不出现任何 ▾。

   安全：仅在本地预览（file:// / 127.0.0.1 / localhost）拦截 api.github.com
   写入，避免副本演示污染线上进度；线上域名不拦截，云同步照常工作。
*/
(function () {
  'use strict';

  var cur = document.currentScript;
  var KEY = (cur && cur.getAttribute('data-sent')) || '';
  var BASE = cur ? String(cur.src).replace(/sentence\.js.*$/, '') : '';

  /* ---- 本地演示护栏（线上不启用） ---- */
  if (location.protocol === 'file:' ||
      location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
    try {
      var origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function () {
        var a = Array.prototype.slice.call(arguments);
        if (String(a[1]).indexOf('api.github.com') !== -1) {
          a[1] = 'https://api.github.com.invalid/__sent_guard__';
        }
        return origOpen.apply(this, a);
      };
      window.__SENT_GUARD = true;
    } catch (e) { }
  }
  if (window.__SENT_READY || !KEY) return;
  window.__SENT_READY = true;

  var DATA = null, wrapped = 0, skipped = [];
  function log(s) { try { console.log('[整句译文] ' + s); } catch (e) { } }

  /* ---- 样式：三层用颜色区分，形态完全沿用原站 ---- */
  var CSS = ''
    + '.f-sent{display:inline;cursor:pointer}'
    + '.f-mark{display:inline-block;vertical-align:middle;margin-left:3px;padding:0 3px;'
    + 'font-size:12px;line-height:1.3;font-weight:700;color:#7cb0f5;'
    + 'user-select:none;transition:.15s}'
    + '.f-sent:hover>.f-mark{color:#1d4ed8}'
    + '.f-sent.f-on>.f-mark{color:#1d4ed8;transform:rotate(180deg)}'
    + '.f-sent>.f-zh{display:none}'
    + '.f-sent.f-on>.f-zh{display:block;margin:3px 0 11px;padding:4px 10px;'
    + 'font-size:13px;line-height:1.65;font-weight:400;color:#1d4ed8;'
    + 'background:#f5f9ff;border-left:3px solid #93c5fd;border-radius:0 6px 6px 0;'
    + 'white-space:normal}'
    + '@media(max-width:640px){.f-sent.f-on>.f-zh{font-size:12.5px}}';
  var st = document.createElement('style');
  st.id = 'sentStyle';
  st.textContent = CSS;
  document.head.appendChild(st);

  /* ---- 译文数据（动态 script，兼容 file:// 离线双击） ---- */
  function pick() {
    return (window.SENT_DATA && window.SENT_DATA.key === KEY) ? window.SENT_DATA : null;
  }
  function loadData(cb) {
    var d = pick();
    if (d) { cb(d); return; }
    var s = document.createElement('script');
    s.src = BASE + 'sentences/' + KEY + '.js';
    s.onload = function () { cb(pick()); };
    s.onerror = function () { log('译文数据加载失败：' + KEY); cb(null); };
    document.head.appendChild(s);
  }

  var RE_END = /[.!?][”"'’)\]]*(?=\s|$)/g;
  var RE_ABBR = /(?:^|[^A-Za-z])(?:Mr|Mrs|Ms|Dr|Prof|St|No|vs|etc|Inc|Ltd|Jr|Sr|U\.S|U\.K|e\.g|i\.e)\.$/i;

  function nextCharAfter(tn, pos) {
    var rest = tn.nodeValue.slice(pos).replace(/^\s+/, '');
    if (rest.length) return rest.charAt(0);
    var n = tn.nextSibling;
    while (n) {
      var t = '';
      if (n.nodeType === 3) t = n.nodeValue;
      else if (n.nodeType === 1 && n.childNodes[0]) t = n.childNodes[0].textContent || '';
      var s = t.replace(/^\s+/, '');
      if (s.length) return s.charAt(0);
      n = n.nextSibling;
    }
    return '';
  }

  /* 段落可见英文（<w> 只取词形），并记录文本节点在串中的起点 */
  function flatText(p) {
    var all = '', map = [], i, n, t;
    for (i = 0; i < p.childNodes.length; i++) {
      n = p.childNodes[i]; t = '';
      if (n.nodeType === 3) { t = n.nodeValue; map.push({ node: n, start: all.length }); }
      else if (n.nodeType === 1 && n.tagName === 'W' && n.childNodes[0]) t = n.childNodes[0].textContent;
      else continue;
      all += t;
    }
    return { all: all, map: map };
  }
  function absOf(flat, sp) {
    for (var i = 0; i < flat.map.length; i++) {
      if (flat.map[i].node === sp.tn) return flat.map[i].start + sp.pos;
    }
    return -1;
  }
  function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }

  /* 用译文里的英文原句反推切点：
     缩写（U.S. / Ms.）、引号内感叹号、无标点小标题都会让标点正则多切或少切。
     这里从宽松候选里挑出「逐句英文完全一致」的那组切点，自动排除误切；
     任何一句对不上就整段跳过（不插任何 ▾），绝不出现译文错位。 */
  function chooseSpots(cands, sents, flat, endSpot) {
    var abs = [], i, j;
    for (i = 0; i < cands.length; i++) {
      var v = absOf(flat, cands[i]);
      if (v < 0) return null;
      abs.push(v);
    }
    var chosen = [], prev = 0, start = 0;
    for (i = 0; i < sents.length - 1; i++) {
      var hit = -1;
      for (j = start; j < cands.length; j++) {
        if (abs[j] <= prev) continue;
        if (norm(flat.all.slice(prev, abs[j])) === norm(sents[i][0])) { hit = j; break; }
      }
      if (hit < 0) return null;
      chosen.push(cands[hit]);
      prev = abs[hit];
      start = hit + 1;
    }
    if (norm(flat.all.slice(prev)) !== norm(sents[sents.length - 1][0])) return null;
    chosen.push(endSpot);
    return chosen;
  }

  /* 插锚点 + 搬兄弟节点：<w> 整体移动，不克隆不重解析 */
  function wrapPara(p, sents) {
    var tns = [], i;
    for (i = 0; i < p.childNodes.length; i++) {
      if (p.childNodes[i].nodeType === 3) tns.push(p.childNodes[i]);
    }
    var cands = [];
    tns.forEach(function (tn) {
      RE_END.lastIndex = 0;
      var m;
      while ((m = RE_END.exec(tn.nodeValue)) !== null) {
        var pos = m.index + m[0].length;
        if (RE_ABBR.test(tn.nodeValue.slice(0, pos))) continue;
        var ch = nextCharAfter(tn, pos);
        if (ch && /[a-z]/.test(ch)) continue;
        cands.push({ tn: tn, pos: pos });
      }
    });
    /* 段落末尾的空文本节点作为末句锚点：不改变任何可见文字，
       也让「没有句尾标点的小标题」能整段作为一句。 */
    var endTn = document.createTextNode('');
    p.appendChild(endTn);
    var endSpot = { tn: endTn, pos: 0 };
    var spots = chooseSpots(cands, sents, flatText(p), endSpot);
    (window.__SENT_DIAG || (window.__SENT_DIAG = []))
      .push(cands.length + '/' + sents.length + (spots ? '' : ' MISS'));
    if (!spots) {
      if (endTn.parentNode) endTn.parentNode.removeChild(endTn);
      skipped.push('英文逐句对齐失败，已跳过');
      return 0;
    }

    var anchors = [];
    for (i = spots.length - 1; i >= 0; i--) {
      var sp = spots[i], after;
      try { after = sp.tn.splitText(sp.pos); } catch (e) { return 0; }
      var a = document.createElement('span');
      a.className = 'f-cut';
      sp.tn.parentNode.insertBefore(a, after);
      anchors[i] = a;
    }

    var first = p.firstChild, made = 0;
    for (i = 0; i < anchors.length; i++) {
      var anchor = anchors[i];
      var box = document.createElement('span');
      box.className = 'f-sent';
      box.setAttribute('data-si', String(i));
      p.insertBefore(box, first);
      var node = first, guard = 0;
      while (node && node !== anchor && guard++ < 20000) {
        var nx = node.nextSibling;
        box.appendChild(node);
        node = nx;
      }
      if (node !== anchor) return 0;
      anchor.parentNode.removeChild(anchor);

      var mark = document.createElement('span');
      mark.className = 'f-mark';
      mark.textContent = '▾';
      mark.title = '点这里看这一句的中文意思（只出句义，不影响单词释义）';
      var zh = document.createElement('span');
      zh.className = 'f-zh';
      zh.textContent = sents[i][1];

      box.appendChild(mark);
      box.appendChild(zh);
      first = box.nextSibling;
      made++;
    }
    return made;
  }

  /* ---- 点击隔离：句子归句子，单词归单词 ---- */
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('w')) return;
    var s = t.closest('.f-sent');
    if (!s) return;
    s.classList.toggle('f-on');
  }, false);

  function sentsFor(areaKey, idx) {
    var arr = (DATA && DATA.articles && DATA.articles[areaKey]) || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].p === idx) return arr[i].s;
    return null;
  }

  function init() {
    loadData(function (d) {
      if (!d) return;
      DATA = d;
      var areas = document.querySelectorAll('[id^="passageArea"]');
      Array.prototype.slice.call(areas).forEach(function (area) {
        var key = area.id.replace(/^passageArea/, '');
        var ps = Array.prototype.slice.call(area.querySelectorAll('p'))
          .filter(function (p) { return p.querySelector('w'); });
        ps.forEach(function (p, idx) {
          if (p.querySelector('.f-sent')) return;
          var sents = sentsFor(key, idx);
          if (!sents || !sents.length) { skipped.push(key + '#' + idx + ' 无译文数据'); return; }
          var n = wrapPara(p, sents);
          if (n === sents.length) wrapped += n;
          else skipped.push(key + '#' + idx + ' 包裹 ' + n + '/' + sents.length);
        });
      });
      window.__SENT_COUNT = wrapped;
      window.__SENT_BOXES = document.querySelectorAll('.f-sent').length;
      window.__SENT_SKIPPED = skipped.slice();
      log(KEY + '：已包裹 ' + wrapped + ' 句 · 跳过 ' + skipped.length + ' 段');
      if (skipped.length) log('跳过明细：' + skipped.join(' | '));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
