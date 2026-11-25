/* 52户型装修设计 · 桌面壳挂件：左右侧栏点一下收起 / 再点一下展开
   贴边小把手跟着面板边框走；收起来后就贴在窗口边，画布占满。
   状态记在 localStorage，重启还保持。样式在 theme.css / theme-dark.css 的「侧栏折叠」段。 */
(() => {
  const KEY = { left: 'ds-panel-left-collapsed', right: 'ds-panel-right-collapsed' };
  const left = document.getElementById('leftPanel');
  const right = document.getElementById('inspector') || document.querySelector('aside.right');
  if (!left && !right) return;
  if (document.getElementById('dsEdgeLeft')) return; // 已经挂过

  const state = { left: false, right: false };

  const CHEV = {
    leftOpen: 'M15 5l-6 7 6 7',   // 面板开着 → 箭头指向左（点了收起）
    leftShut: 'M9 5l6 7-6 7',     // 面板收起 → 箭头指向右（点了展开）
    rightOpen: 'M9 5l6 7-6 7',    // 右栏开着 → 箭头指向右（点了收起）
    rightShut: 'M15 5l-6 7 6 7',  // 右栏收起 → 箭头指向左
  };

  function makeHandle(side) {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = side === 'left' ? 'dsEdgeLeft' : 'dsEdgeRight';
    b.className = 'ds-edge ds-edge-' + side;
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + CHEV[side + 'Open'] + '"/></svg>';
    b.addEventListener('click', () => toggle(side));
    document.body.appendChild(b);
    return b;
  }

  const hL = left ? makeHandle('left') : null;
  const hR = right ? makeHandle('right') : null;

  function panelOf(side) { return side === 'left' ? left : right; }
  function handleOf(side) { return side === 'left' ? hL : hR; }

  function place() {
    const vw = window.innerWidth;
    if (hL && left) {
      const r = left.getBoundingClientRect();
      const base = state.left ? 2 : Math.round(r.right - 12);
      hL.style.left = Math.max(2, base) + 'px';
      hL.style.top = Math.round(window.innerHeight / 2 - 34) + 'px';
    }
    if (hR && right) {
      const r = right.getBoundingClientRect();
      const base = state.right ? vw - 26 : Math.round(r.left - 11);
      hR.style.left = Math.min(vw - 26, Math.max(2, base)) + 'px';
      hR.style.top = Math.round(window.innerHeight / 2 - 34) + 'px';
    }
  }

  function apply(side, collapsed, persist) {
    const el = panelOf(side);
    const h = handleOf(side);
    if (!el) return;
    state[side] = !!collapsed;
    el.classList.toggle('ds-hidden', state[side]);
    if (h) {
      h.classList.toggle('shut', state[side]);
      h.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' +
        CHEV[side + (state[side] ? 'Shut' : 'Open')] + '"/></svg>';
      h.title = (state[side] ? '展开' : '收起') + (side === 'left' ? '左栏' : '右栏') + '（点一下）';
    }
    if (persist) { try { localStorage.setItem(KEY[side], state[side] ? '1' : '0'); } catch (e) {} }
    place();
    // 画布尺寸变了，让设计器重算一次视图
    requestAnimationFrame(() => {
      place();
      try { window.dispatchEvent(new Event('resize')); } catch (e) {}
      try { window.__designer && window.__designer.requestDraw && window.__designer.requestDraw(); } catch (e) {}
    });
    setTimeout(place, 220);
  }

  function toggle(side) {
    if (side === 'both') {
      const bothShut = state.left && state.right;
      apply('left', !bothShut, true);
      apply('right', !bothShut, true);
      return { left: state.left, right: state.right };
    }
    if (!panelOf(side)) return null;
    apply(side, !state[side], true);
    return { left: state.left, right: state.right };
  }

  window.__dsTogglePanel = toggle;
  window.__dsSetPanel = (side, mode) => {
    const sides = side === 'both' ? ['left', 'right'] : [side];
    sides.forEach(s => {
      if (!panelOf(s)) return;
      apply(s, mode === 'hide' ? true : mode === 'show' ? false : !state[s], true);
    });
    return { left: state.left, right: state.right };
  };
  window.__dsPanelState = () => ({ left: state.left, right: state.right });

  // 恢复上次的收起状态
  ['left', 'right'].forEach(s => {
    let v = null;
    try { v = localStorage.getItem(KEY[s]); } catch (e) {}
    if (v === '1') apply(s, true, false);
    else { place(); }
  });

  window.addEventListener('resize', () => place());
  setTimeout(place, 300);
  setTimeout(place, 1200);
})();
