// ===== 52户型装修设计 · 桌面版：DXF 图层选择面板 =====
// 桌面壳调用 window.__dsPickLayers({file, layers}) → 弹一个页面内面板，返回勾选的图层数组（取消返回 null）
(function () {
  'use strict';
  if (window.__dsPickLayers) return;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function fmtLen(mm) { return mm >= 1000 ? (mm / 1000).toFixed(1) + ' m' : Math.round(mm) + ' mm'; }

  window.__dsPickLayers = function (payload) {
    return new Promise(function (resolve) {
      var old = document.getElementById('dsLayerPick');
      if (old) old.remove();

      var layers = (payload && payload.layers) || [];
      var rows = layers.map(function (o, i) {
        var title = o.skipped ? '标注 / 图例类，一般不用勾' : (o.wallName ? '图层名像墙线' : '');
        return '<label class="dslp-row' + (o.skipped ? ' dim' : '') + '">'
          + '<input type="checkbox" data-i="' + i + '"' + (o.suggested ? ' checked' : '') + '>'
          + '<span class="dslp-name">' + esc(o.layer) + '</span>'
          + '<span class="dslp-num">' + o.count + ' 条</span>'
          + '<span class="dslp-len">' + fmtLen(o.length) + '</span>'
          + '<span class="dslp-tip">' + esc(title) + '</span>'
          + '</label>';
      }).join('');

      var box = document.createElement('div');
      box.id = 'dsLayerPick';
      box.innerHTML = ''
        + '<div class="dslp-card">'
        + '  <div class="dslp-head">'
        + '    <b>选择墙线所在的图层</b>'
        + '    <span>' + esc((payload && payload.file) || '') + ' · 共 ' + layers.length + ' 个图层</span>'
        + '  </div>'
        + '  <div class="dslp-body">'
        + '    <div class="dslp-hint">CAD 里墙一般画成两条平行线。勾上画墙的图层，设计器会把它们还原成「墙中线 + 墙厚」，再自动生成方案。</div>'
        + '    <div class="dslp-list">' + (rows || '<div class="dslp-empty">没读到任何线——这张图可能只有块引用（INSERT），先在 CAD 里打散再导出。</div>') + '</div>'
        + '  </div>'
        + '  <div class="dslp-foot">'
        + '    <span class="dslp-count" id="dslpCount"></span>'
        + '    <button class="dslp-btn ghost" id="dslpCancel">取消</button>'
        + '    <button class="dslp-btn" id="dslpOk">识别并生成方案</button>'
        + '  </div>'
        + '</div>';
      document.body.appendChild(box);

      var list = box.querySelector('.dslp-list');
      var countEl = document.getElementById('dslpCount');
      function refresh() {
        var n = box.querySelectorAll('input[type=checkbox]:checked').length;
        countEl.textContent = n ? '已选 ' + n + ' 个图层' : '还没勾选图层';
        document.getElementById('dslpOk').disabled = n === 0;
      }
      list.addEventListener('change', refresh);
      refresh();

      function done(v) { box.remove(); document.removeEventListener('keydown', onKey); resolve(v); }
      function onKey(e) { if (e.key === 'Escape') done(null); }
      document.addEventListener('keydown', onKey);

      document.getElementById('dslpCancel').onclick = function () { done(null); };
      document.getElementById('dslpOk').onclick = function () {
        var picked = [];
        box.querySelectorAll('input[type=checkbox]:checked').forEach(function (cb) {
          picked.push(layers[Number(cb.getAttribute('data-i'))].layer);
        });
        done(picked);
      };
      box.addEventListener('mousedown', function (e) { if (e.target === box) done(null); });
    });
  };
})();
