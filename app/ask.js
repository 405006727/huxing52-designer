// ===== 52户型装修设计 · 页面内数字输入浮层 =====
// 壳调用 window.__dsAsk({title, hint, label, def, suffix, presets}) → 返回数字（取消返回 null）
(function () {
  'use strict';
  if (window.__dsAsk) return;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  window.__dsAsk = function (payload) {
    payload = payload || {};
    return new Promise(function (resolve) {
      var old = document.getElementById('dsAsk');
      if (old) old.remove();

      var presets = (payload.presets || []).map(function (v) {
        return '<button class="dsak-chip" data-v="' + v + '">' + v + (payload.suffix || '') + '</button>';
      }).join('');

      var box = document.createElement('div');
      box.id = 'dsAsk';
      box.innerHTML = ''
        + '<div class="dsak-card">'
        + '  <div class="dsak-head"><b>' + esc(payload.title || '填一个数') + '</b></div>'
        + '  <div class="dsak-body">'
        + (payload.hint ? '    <div class="dsak-hint">' + esc(payload.hint) + '</div>' : '')
        + '    <div class="dsak-line">'
        + '      <span class="dsak-label">' + esc(payload.label || '数值') + '</span>'
        + '      <input class="dsak-input" id="dsakInput" type="text" inputmode="decimal" value="' + (payload.def == null ? '' : payload.def) + '">'
        + '      <span class="dsak-suffix">' + esc(payload.suffix || '') + '</span>'
        + '    </div>'
        + (presets ? '    <div class="dsak-chips">' + presets + '</div>' : '')
        + '    <div class="dsak-err" id="dsakErr"></div>'
        + '  </div>'
        + '  <div class="dsak-foot">'
        + '    <button class="dsak-btn ghost" id="dsakCancel">取消</button>'
        + '    <button class="dsak-btn" id="dsakOk">确定</button>'
        + '  </div>'
        + '</div>';
      document.body.appendChild(box);

      var input = document.getElementById('dsakInput');
      var err = document.getElementById('dsakErr');
      setTimeout(function () { input.focus(); input.select(); }, 30);

      function done(v) { box.remove(); document.removeEventListener('keydown', onKey); resolve(v); }
      function onKey(e) {
        if (e.key === 'Escape') done(null);
        if (e.key === 'Enter') ok();
      }
      function ok() {
        var raw = String(input.value || '').replace(/[^\d.]/g, '');
        var v = Number(raw);
        if (!raw || !isFinite(v) || v <= 0) { err.textContent = '填一个大于 0 的数字'; return; }
        done(v);
      }
      document.addEventListener('keydown', onKey);
      document.getElementById('dsakOk').onclick = ok;
      document.getElementById('dsakCancel').onclick = function () { done(null); };
      input.addEventListener('input', function () { err.textContent = ''; });
      box.querySelectorAll('.dsak-chip').forEach(function (b) {
        b.onclick = function () { input.value = b.getAttribute('data-v'); err.textContent = ''; };
      });
      box.addEventListener('mousedown', function (e) { if (e.target === box) done(null); });
    });
  };
})();
