// 52户型装修设计 · 桌面版主进程
// 只做「桌面外壳」该做的事：窗口、菜单、读写本机文件、下载落盘、主题与外挂小挂件。
// 设计器本体逻辑全部在 app/designer.html 内，一行未改。

const { app, BrowserWindow, Menu, dialog, shell, session, ipcMain, nativeTheme, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_NAME = '52户型装修设计';

const ROOT = __dirname;
const HTML = path.join(ROOT, 'app', 'designer.html');
const THEME = path.join(ROOT, 'theme.css');
const THEME_DARK = path.join(ROOT, 'theme-dark.css');
const PICKER = path.join(ROOT, 'app', 'picker.js');
const ASK = path.join(ROOT, 'app', 'ask.js');
const SHELL = path.join(ROOT, 'app', 'shell.js');
const BUILDER_ICON = path.join(ROOT, 'build', 'icon.ico');
const DXF = require('./app/dxf.js');
const IMGWALL = require('./app/imgwall.js');
const AUDIT = require('./app/audit.js');

const IS_SELFTEST = process.argv.includes('--selftest');
const DEBUG = process.argv.includes('--debug');

/* ------------------------------- 数据目录 --------------------------------
   所有数据（窗口状态、最近打开、方案自动存档、导入备份、导出的文件）都放
   安装目录下的 data\。安装目录不可写（比如装进了 Program Files 又没管理
   权限）就退回 %LOCALAPPDATA%\<应用名>\data，并在「帮助 → 数据存在哪」里说明。 */
function pickDataDir() {
  const exeDir = app.isPackaged ? path.dirname(process.execPath) : ROOT;
  const candidates = [
    path.join(exeDir, 'data'),
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), APP_NAME, 'data'),
  ];
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, '.probe');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      return { dir, writable: true, fallback: false };
    } catch (e) { /* 下一个候选 */ }
  }
  return { dir: path.join(os.tmpdir(), 'huxing52-data'), writable: false, fallback: true };
}

const DATA = pickDataDir();
const IS_FALLBACK_DATA = DATA.fallback;
try {
  app.setPath('userData', DATA.dir);
  app.setPath('sessionData', DATA.dir);
} catch (e) { console.warn('[data]', e && e.message); }

// 用户导出的方案 / 图纸默认落在安装目录的「方案」子目录里
const PLAN_DIR = path.join(DATA.dir, '..', '方案');
try { fs.mkdirSync(PLAN_DIR, { recursive: true }); } catch (e) {}

let darkKey = null;      // 深色主题的 insertCSS key（没插入时为 null）
let appearance = 'auto'; // light | dark | auto

let win = null;
let recent = [];

/* ---------------------------------- 状态 ---------------------------------- */
function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}
function loadState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return {}; }
}
function saveState(patch) {
  try {
    const cur = loadState();
    fs.writeFileSync(stateFile(), JSON.stringify(Object.assign(cur, patch), null, 2), 'utf8');
  } catch (e) {}
}

/* -------------------------------- 渲染层工具 ------------------------------- */
// 在页面里执行一段 JS（设计器通过 window.__designer 暴露了运行时 API）
function run(code) {
  if (!win || win.isDestroyed()) return Promise.resolve(null);
  return win.webContents.executeJavaScript(code, true).catch(err => {
    console.warn('[run]', err && err.message);
    return null;
  });
}
// 按顶栏按钮文字点一下（工具切换最稳，不依赖内部枚举名）
function clickByText(text) {
  const q = JSON.stringify(text);
  return run(`(() => {
    const root = document.querySelector('header, .topbar, .top-bar, #toolbar, #leftPanel, .leftPanel, #side, aside') || document.body;
    const btns = [...root.querySelectorAll('button')].filter(b => (b.textContent||'').trim() === ${q});
    if (!btns.length) return false;
    btns[0].click(); return true;
  })()`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 切换视图（菜单用）。顶栏按钮是设计器自己的入口，点完再核实一次，没切过去就重试
async function switchView(label, want) {
  try {
    const ok = await clickByText(label);
    await sleep(1300);
    let v = await run('window.__designer && window.__designer.app && window.__designer.app.view');
    if (!ok) { console.log('[view] 没找到按钮', label); await API.view(want); }
    else if (v !== want) {
      console.log('[view] 第一次没切过去，重试', label, v);
      await clickByText(label);
      await sleep(1600);
      v = await run('window.__designer && window.__designer.app && window.__designer.app.view');
      if (v !== want) await API.view(want);
    }
    console.log('[view]', label, '=>', v);
  } catch (e) { console.log('[view] fail', label, e && e.message); }
}

const API = {
  view: v => run(`window.__designer && window.__designer.setView(${JSON.stringify(v)})`),
  floorView: v => run(`window.__designer && window.__designer.setFloorView(${JSON.stringify(v)})`),
  goFloor: i => run(`window.__designer && window.__designer.goFloor(${i})`),
  fit: () => run(`window.__designer && window.__designer.fit2D()`),
  undo: () => run(`window.__designer && window.__designer.undo()`),
  redo: () => run(`window.__designer && window.__designer.redo()`),
  commit: () => run(`window.__designer && window.__designer.commit && window.__designer.commit()`),
};

/* ---------------------------- 左右栏（点一下收起） ---------------------------- */
// 折叠逻辑在 app/shell.js（页面内挂两个贴边小把手），主进程只负责发指令和菜单
const PANELS = {
  toggle: side => run(`window.__dsTogglePanel ? window.__dsTogglePanel(${JSON.stringify(side)}) : 'no-module'`),
  hide: side => run(`window.__dsSetPanel ? window.__dsSetPanel(${JSON.stringify(side)}, 'hide') : 'no-module'`),
  show: side => run(`window.__dsSetPanel ? window.__dsSetPanel(${JSON.stringify(side)}, 'show') : 'no-module'`),
  state: () => run(`window.__dsPanelState ? window.__dsPanelState() : null`),
};

/* ------------------------------- 打开 / 保存 ------------------------------- */
async function openPlan() {
  const r = await dialog.showOpenDialog(win, {
    title: '打开装修方案',
    filters: [{ name: '装修方案', extensions: ['json'] }, { name: '全部文件', extensions: ['*'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths.length) return;
  loadPlanFile(r.filePaths[0]);
}

// 走设计器自己的导入入口：塞进隐藏的 fileIn，再触发 change，和手动“开文件”完全一致
function injectPlanText(text, filename) {
  return run(`(() => {
    const inp = document.getElementById('fileIn');
    if (!inp) return 'no-input';
    const text = ${JSON.stringify(text)};
    const dt = new DataTransfer();
    dt.items.add(new File([text], ${JSON.stringify(filename)}, {type:'application/json'}));
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', {bubbles:true}));
    return 'ok';
  })()`);
}

function loadPlanFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (e) { dialog.showErrorBox('打开失败', String(e.message || e)); return; }
  try { JSON.parse(text); }
  catch (e) { dialog.showErrorBox('不是有效的方案文件', '这个 .json 读不出方案结构：' + (e.message || e)); return; }

  injectPlanText(text, path.basename(file)).then(res => {
    if (res === 'ok') {
      recent = [file, ...recent.filter(f => f !== file)].slice(0, 8);
      saveState({ recent });
      buildMenu();
      win.setTitle(path.basename(file) + ' — ' + APP_NAME);
      notice('已打开方案：' + path.basename(file));
    }
  });
}

/* --------------------------- 空白首屏（不带任何自带数据） ---------------------------
   安装完第一次打开就是一张空白户型：没有任何自带墙、家具、方案。
   设计器自己会把用户的工作存进它自己的数据库里，所以只有「本机还没存过方案」
   时才清成空白，不会把用户已经画好的东西清掉。 */
const BLANK_BUILDING = {
  version: 2, kind: 'building', name: '未命名户型', cur: 0, slab: 120, base: 0, grade: 0,
  floors: [{
    id: 'fl1', name: '一层',
    plan: {
      version: 2, name: '未命名户型 · 一层', height: 3000, phase: 'renovate',
      nodes: [], walls: [], openings: [], furniture: [], structs: [], beams: [],
      rooms: [], measures: [], elec: [], prices: {}, north: 0, voids: [], comments: [],
    },
  }],
};

async function startBlank() {
  // 只在「本机第一次启动」时清成空白：装完打开就是一张空白户型，不带任何自带方案。
  // 之后设计器自己会记着用户的工作，再打开就恢复上次的进度。
  if (loadState().started) return;
  saveState({ started: true });
  const res = await run(`(() => {
    try {
      window.__designer.replacePlan(${JSON.stringify(BLANK_BUILDING)});
      if (window.__designer.fit2D) window.__designer.fit2D();
      return { walls: window.__designer.app.plan.walls.length, rooms: Object.keys(window.__designer.app.rooms || {}).length };
    } catch (e) { return 'ERR:' + (e && e.message); }
  })()`);
  console.log('[blank]', JSON.stringify(res));
  if (res && typeof res === 'object') {
    notice('空白户型已就绪：文件 →「从 CAD 图纸新建」自动识别，或「导入户型图」照着底图描墙；也可以打开之前备份的方案', 6200);
  }
}

function savePlan() {
  // 复用设计器的“存文件”，导出动作会走下载，再由 will-download 弹保存框
  return run(`(() => { const b = document.getElementById('saveFileBtn'); if (b) { b.click(); return true; } return false; })()`);
}

/* ----------------------- 导入户型图（当描图底图，半自动） -----------------------
   图片不做自动识墙（那需要视觉模型），走设计器自带的「户型底图描图」：
   导入图片 → 拉一段已知尺寸的线校准比例 → 照着底图画墙。 */
async function importUnderlay() {
  await clickByText('选择').catch(() => {});
  const res = await run(`(() => {
    const tab = document.querySelector('#leftPanel [data-tab="plan"], .tabs button');
    if (tab) tab.click();
    let btn = document.getElementById('ulBtn');
    if (!btn) {
      // 面板是点标签后重绘的，稍等一拍再找
      const later = () => document.getElementById('ulBtn');
      return new Promise(resolve => setTimeout(() => {
        const b = later();
        if (b) { b.click(); return resolve('clicked-late'); }
        resolve('no-button');
      }, 700));
    }
    btn.click();
    return 'clicked';
  })()`);
  console.log('[underlay]', res);
  if (res === 'no-button') {
    dialog.showMessageBox(win, {
      title: '导入户型图',
      message: '没找到「导入户型图」入口',
      detail: '可以在左栏「户型」页往下拉，点「导入户型图」；也可以直接用「从 CAD 图纸新建」导入 DXF。',
      buttons: ['知道了'], noLink: true,
    });
  }
}

/* ---------------------------- DXF 图纸识别（导入） --------------------------- */
// DXF 常是 GBK 写的，图层名用中文——先按 utf8 试，乱码多了换 gbk 解
function decodeDxf(buf) {
  let utf = buf.toString('utf8').replace(/^\uFEFF/, '');
  const bad = (utf.match(/\uFFFD/g) || []).length;
  if (bad > 6) {
    try {
      const gbk = new TextDecoder('gbk').decode(buf);
      if ((gbk.match(/\uFFFD/g) || []).length < bad) return gbk;
    } catch (e) {}
  }
  return utf;
}

function notice(text, ms) {
  run(`(() => {
    let n = document.getElementById('dsNotice');
    if (!n) { n = document.createElement('div'); n.id = 'dsNotice'; document.body.appendChild(n); }
    n.textContent = ${JSON.stringify(text)};
    n.classList.add('on');
    clearTimeout(n._t);
    n._t = setTimeout(() => n.classList.remove('on'), ${ms || 3600});
  })()`).catch(() => {});
}

// 左侧「水电」面板里的“一键布置水电”：点顶栏水电工具 → 必要时点左栏水电标签 → 点按钮 → 回选择工具
async function autoPlaceMep() {
  const log = {};
  try {
    await run(`(() => { const b = document.querySelector('[data-tool="elec"]'); if (b) b.click(); return !!b; })()`);
    await sleep(800);
    log.panelBtn = await run(`!!document.getElementById('autoElec')`);
    if (!log.panelBtn) {
      await run(`(() => {
        const els = [...document.querySelectorAll('#leftPanel button, .tabbar button, .tabs button, .tabhead button')]
          .filter(b => /水电|点位/.test((b.textContent || '')));
        if (els[0]) { els[0].click(); return true; } return false;
      })()`);
      await sleep(800);
      log.panelBtn2 = await run(`!!document.getElementById('autoElec')`);
    }
    log.click = await run(`(() => { const b = document.getElementById('autoElec'); if (!b) return 'no-button'; b.click(); return 'clicked'; })()`);
    await sleep(900);
    // 有点位时会弹“会替换现有的 N 个点位”确认，只在那个弹窗里点“重新布置”
    log.confirm = await run(`(() => {
      const boxes = [...document.querySelectorAll('.modal-box, .modal, .dialog, .confirm, .pop, .sheet, .overlay')];
      const host = boxes.find(b => /一键布置水电|替换现有/.test(b.textContent || ''));
      const btns = (host ? [...host.querySelectorAll('button')] : []).filter(b => /重新布置/.test((b.textContent || '').trim()));
      if (btns[0]) { btns[0].click(); return '重新布置'; }
      return null;
    })()`);
    await sleep(1200);
    log.elec = await run(`(() => { const D = window.__designer; return D && D.app && D.app.plan ? D.app.plan.elec.length : -1; })()`);
    await run(`(() => { const b = document.querySelector('[data-tool="select"]'); if (b) b.click(); })()`);
    console.log('[mep]', JSON.stringify(log));
    return { elec: log.elec, log };
  } catch (e) { return { err: String(e && e.message), log }; }
}

/* ---------------------------- DXF 图纸识别（导入） --------------------------- */
// 把「选文件 → 盘点图层 → 识别 → 生成方案 → 自动布水电」抽成可复用的核心函数，
// 菜单和自测都走它（自测时 interactive=false，不弹对话框）。
async function applyDxf(file, opt) {
  opt = opt || {};
  const interactive = opt.interactive !== false;
  const autoMep = opt.autoMep !== false;
  const label = opt.name || path.basename(file).replace(/\.dxf$/i, '');

  if (/\.dwg$/i.test(file)) {
    if (interactive) {
      dialog.showMessageBox(win, {
        title: '需要先转成 DXF',
        message: APP_NAME + '直接读 DXF，不读 DWG',
        detail: '在 AutoCAD / 浩辰 / 中望里打开这张图，文件 → 另存为 → 选 “AutoCAD 2013 DXF(*.dxf)”，再回来导入。\n（DWG 是封装格式，需要完整的 CAD 内核才能解，本软件不带。）',
        buttons: ['知道了'], noLink: true,
      });
    }
    return { ok: false, error: 'dwg' };
  }

  let text;
  try { text = decodeDxf(fs.readFileSync(file)); }
  catch (e) {
    if (interactive) dialog.showErrorBox('读取失败', String(e.message || e));
    return { ok: false, error: String(e.message || e) };
  }

  const a = DXF.analyzeLayers(text);
  if (!a.layers.length) {
    if (interactive) dialog.showErrorBox('没读到任何线', '这张 DXF 里没有直线 / 多段线。若墙是用“块（INSERT）”拼的，先在 CAD 里 EXPLODE 打散再导出。');
    return { ok: false, error: 'no-entities' };
  }

  // 只建议到一个图层就直接用，否则弹页面内面板让用户勾
  const auto = a.layers.filter(o => o.suggested).map(o => o.layer);
  let picked;
  if (!interactive) picked = auto.length ? auto : a.layers.slice(0, 3).map(o => o.layer);
  else if (auto.length === 1) picked = auto;
  else picked = await run(`window.__dsPickLayers ? window.__dsPickLayers(${JSON.stringify({ file: path.basename(file), layers: a.layers.slice(0, 120) })}) : null`);
  if (!picked || !picked.length) return { ok: false, error: 'cancel' };

  const res = DXF.parse(text, { layers: picked });
  if (!res.ok) {
    if (interactive) dialog.showErrorBox('识别失败', (res.error || '未知原因') + '\n可以换个图层组合再试。');
    return { ok: false, error: res.error || 'parse-failed', layers: picked, stats: res.stats || null };
  }

  const s = res.stats;

  // 尺寸标注校核：图上标注的数字 vs 识别出的墙长（只报偏差，不改墙）
  let dimsInfo = null;
  try {
    const d = DXF.analyzeDims(text);
    if (d.total) {
      const vr = DXF.verifyDims(res.walls, d);
      dimsInfo = {
        total: d.total, checked: vr.checked, ok: vr.ok, bad: vr.badFlag, unmatched: vr.unmatched,
        pairs: vr.pairs.filter(p => p.判定 !== 'ok').slice(0, 12), source: d,
      };
      try {
        fs.mkdirSync(path.join(DATA.dir, '对账'), { recursive: true });
        fs.writeFileSync(path.join(DATA.dir, '对账', 'last-dims-report.json'),
          JSON.stringify({ file: path.basename(file), generatedAt: new Date().toISOString(), dims: d, verify: vr }, null, 1), 'utf8');
      } catch (e) {}
    }
  } catch (e) { console.warn('dims', e.message); }

  // 整栋：一张图里并排画了几层
  let split = null;
  try { split = DXF.splitFloors(res.walls, { gap: opt.floorGap || 2200, minWalls: 4 }); } catch (e) { console.warn('split', e.message); }
  let multi = !!(split && split.multi) && opt.multi !== false;
  if (interactive && split && split.multi) {
    const ok = await dialog.showMessageBox(win, {
      type: 'question',
      title: '图里像是画了 ' + split.count + ' 层',
      message: '按墙群之间的空当判断，这张图里有 ' + split.count + ' 个互不相连的平面',
      detail: [
        split.floors.map(f => `第 ${f.index + 1} 处：${f.walls} 面墙，约 ${(f.w / 1000).toFixed(1)} × ${(f.h / 1000).toFixed(1)} 米`).join('\n'),
        '',
        '「整栋生成」= 每处当一层，生成 ' + split.count + ' 层楼的整栋方案（层高 3000、楼板 120）',
        '「合成一层」= 全部并进当前这一层（上下游的关系由你后面自己改）',
      ].join('\n'),
      buttons: ['整栋生成（' + split.count + ' 层）', '合成为一层'], defaultId: 0, cancelId: 1, noLink: true,
    });
    multi = ok.response === 0;
  }

  if (interactive) {
    const dimLine = dimsInfo
      ? '图上标注 ' + dimsInfo.total + ' 条，可对账 ' + dimsInfo.checked + ' 条：一致 ' + dimsInfo.ok + '，偏差 ' + dimsInfo.bad + '，未匹配 ' + dimsInfo.unmatched
      : '图上没读到尺寸标注（不影响生成）';
    const ok = await dialog.showMessageBox(win, {
      type: 'question',
      title: '生成方案',
      message: multi
        ? '识别出 ' + res.walls.length + ' 面墙，将生成 ' + split.count + ' 层的整栋方案'
        : '识别出 ' + res.walls.length + ' 面墙，其中承重墙 ' + s.bearingWalls + ' 面',
      detail: [
        '图纸范围约 ' + (s.widthMM / 1000).toFixed(1) + ' × ' + (s.depthMM / 1000).toFixed(1) + ' 米',
        multi ? split.floors.map(f => `第 ${f.index + 1} 层：${f.walls} 面墙`).join('；') : null,
        '已勾选图层：' + picked.join('、'),
        '层高按 3000、楼板 120 生成；房间分区与水电位点由设计器自动识别布置。',
        dimLine,
        dimsInfo && dimsInfo.bad ? '有 ' + dimsInfo.bad + ' 条标注与图线不一致（图上改过没倒标注），建议生成后在「工具 → 方案对账」里逐条核对。' : null,
        '',
        '当前打开的方案会被替换（替换前会自动备份一份到数据目录）。',
      ].filter(Boolean).join('\n'),
      buttons: ['生成方案', '取消'],
      defaultId: 0, cancelId: 1, noLink: true,
    });
    if (ok.response !== 0) return { ok: false, error: 'cancel', layers: picked, stats: s, dims: dimsInfo };
  }

  // 先备份当前整栋方案
  try {
    const cur = await run('window.__designer && window.__designer.bld ? JSON.stringify(window.__designer.bld) : null');
    if (cur && cur.length > 10) fs.writeFileSync(path.join(DATA.dir, 'backup-before-dxf-import.json'), cur, 'utf8');
  } catch (e) {}

  let spec;
  if (multi && split && split.count > 1) {
    // 整栋：每处墙群各自归一坐标，一层一组墙
    const groups = split.groups.map(g => DXF.reorigin(g, 300));
    spec = DXF.toSpecMulti(groups, null, { name: label + '（整栋）', city: '成都', height: 3000, slab: 120 });
  } else {
    spec = DXF.toSpec(res, label, { city: '成都', height: 3000, slab: 120 });
  }
  const specWalls = spec.floors.reduce((n, f) => n + (f.walls || []).length, 0);
  const done = await run(`(() => {
    try {
      if (!window.__dsSpecToBuilding) return 'ERR:设计器缺少 spec 入口';
      const b = window.__dsSpecToBuilding(${JSON.stringify(spec)});
      window.__designer.replacePlan(b);
      if (window.__designer.fit2D) window.__designer.fit2D();
      return b.floors[0].plan.walls.length;
    } catch (e) { return 'ERR:' + (e && e.message); }
  })()`);

  if (typeof done !== 'number') {
    if (interactive) dialog.showErrorBox('生成失败', String(done || '设计器没有接受这份方案'));
    return { ok: false, error: String(done), layers: picked, stats: s };
  }

  const mep = autoMep ? await autoPlaceMep() : { elec: -1 };
  const counts = await run(`(() => {
    const D = window.__designer;
    return { walls: D.app.plan.walls.length, rooms: Object.keys(D.app.rooms || {}).length, elec: D.app.plan.elec.length };
  })()`);
  const elecN = (mep && typeof mep.elec === 'number' && mep.elec > 0) ? mep.elec : (counts && counts.elec) || 0;

  if (interactive) {
    await sleep(1200);
    win.setTitle(label + ' — ' + APP_NAME);
    saveState({ dxf: file });
    const floorNote = multi && split ? ' · ' + split.count + ' 层整栋' : '';
    const dimNote = dimsInfo && dimsInfo.bad ? ' · ' + dimsInfo.bad + ' 条标注与图线不一致（见 对账\\last-dims-report.json）' : '';
    notice('已从「' + label + '」生成方案：' + specWalls + ' 面墙' + floorNote + (elecN ? ' · ' + elecN + ' 个水电点位已自动布置' : '') + dimNote + ' · 门窗可在「门窗」工具里补、房间名可在左栏改', 6000);
  }
  return { ok: true, specWalls: specWalls, floors: spec.floors.length, walls: counts && counts.walls, rooms: counts && counts.rooms, elec: elecN, layers: picked, stats: s, dims: dimsInfo ? { total: dimsInfo.total, checked: dimsInfo.checked, ok: dimsInfo.ok, bad: dimsInfo.bad, unmatched: dimsInfo.unmatched } : null, split: split ? { count: split.count, multi: split.multi, floors: split.floors } : null };
}

/* ------------------------------ 方案对账（报告） ------------------------------ */
// 把当前整栋方案导成 JSON，和最近导入的 DXF 一起喂给 app/audit.js，
// 生成 markdown 报告落到 对账\ 目录，再用系统默认程序打开。
async function runAudit() {
  let bld = null;
  try { bld = await run('window.__designer && window.__designer.bld ? JSON.stringify(window.__designer.bld) : null'); } catch (e) {}
  if (!bld || bld.length < 20) { notice('当前没有打开的方案，先导入图纸或新建一个'); return { ok: false, error: 'no-plan' }; }
  let plan;
  try { plan = JSON.parse(bld); } catch (e) { return { ok: false, error: 'bad-plan' }; }

  // building → 规整成 {name, floors:[{name,walls}]}
  const floors = (plan.floors || []).map((f, i) => {
    const p = f.plan || f;
    return { name: p.name || f.name || ('第' + (i + 1) + '层'), walls: (p.walls || []).map(normalizeWall) };
  });
  const spec = { name: (plan.name || '当前方案'), floors: floors.filter(f => f.walls.length) };

  let dxfText = null, layers = null;
  const dxfPath = (loadState() || {}).dxf || '';
  try {
    if (dxfPath && fs.existsSync(dxfPath)) {
      dxfText = decodeDxf(fs.readFileSync(dxfPath));
      const ls = DXF.analyzeLayers(dxfText).layers || [];
      const guess = ls.filter(o => o.suggested).map(o => o.layer);
      layers = guess.length ? guess : null;
    }
  } catch (e) { console.warn('audit dxf', e.message); }

  const rep = AUDIT.audit({ spec, dxfText, layers });
  const outDir = path.join(DATA.dir, '对账');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const mdPath = path.join(outDir, '对账-' + stamp + '.md');
  fs.writeFileSync(mdPath, rep.markdown, 'utf8');
  fs.writeFileSync(mdPath.replace(/\.md$/, '.json'), JSON.stringify(rep, null, 1), 'utf8');
  shell.openPath(mdPath);
  notice('对账完成：' + rep.verdict + ' · 报告已保存到 ' + mdPath, 6000);
  return { ok: true, verdict: rep.verdict, file: mdPath, errors: rep.structure.errors.length, warnings: rep.structure.warnings.length, dims: rep.dims ? { checked: rep.dims.checked, bad: rep.dims.bad } : null, roundtrip: rep.roundtrip ? { same: rep.roundtrip.same } : null };
}

// building 里的墙字段名可能不同（a/b + t），统一成 {a,b,t}
function normalizeWall(w) {
  if (!w) return null;
  const a = w.a || w.p1 || [w.x1, w.y1];
  const b = w.b || w.p2 || [w.x2, w.y2];
  if (!a || !b) return null;
  return { a: [a[0], a[1]], b: [b[0], b[1]], t: w.t || w.thick || 200 };
}

/* ------------------------- 户型图片识别（位图 → 方案） ------------------------ */
// 流程：读图（nativeImage 解码，无需第三方库）→ 灰度 → 识墙（app/imgwall.js）
// → 用户给「图上这套房的实际总宽」做比例尺 → 生成方案 → 自动布水电。
async function applyImagePlan(file, opt) {
  opt = opt || {};
  const interactive = opt.interactive !== false;
  const autoMep = opt.autoMep !== false;
  const label = opt.name || path.basename(file).replace(/\.(png|jpg|jpeg|bmp|webp)$/i, '');

  const img = nativeImage.createFromPath(file);
  if (img.isEmpty()) {
    if (interactive) dialog.showErrorBox('读图失败', '这张图打不开（可能是 CMYK / 超大 TIFF / 损坏文件）。用 PNG / JPG 再试。');
    return { ok: false, error: 'decode' };
  }
  let size = img.getSize();
  // 控制分辨率上限，避免一张 8K 图把内存吃满
  const MAXSIDE = 2600;
  if (Math.max(size.width, size.height) > MAXSIDE) {
    const k = MAXSIDE / Math.max(size.width, size.height);
    size = { width: Math.round(size.width * k), height: Math.round(size.height * k) };
    img = img.resize({ width: size.width, height: size.height, quality: 'good' });
  }
  const bmp = img.toBitmap(); // BGRA
  const gray = IMGWALL.toGrayFromRGBA(bmp, size.width, size.height);

  const det = IMGWALL.detect(gray, size.width, size.height, opt.detect || {});
  if (!det.ok) {
    if (interactive) dialog.showErrorBox('没认出墙', det.error || '这张图里没读到像墙的线条。');
    return { ok: false, error: det.error || 'detect' };
  }

  const bb = det.bboxPx;
  const bbW = bb.w, bbH = bb.h;
  let realW = opt.realWidthMM || 0;
  if (!realW && interactive) {
    realW = await run(`window.__dsAsk ? window.__dsAsk(${JSON.stringify({
      title: '确认比例尺',
      hint: '图上识别到 ' + det.walls.length + ' 面墙（墙厚约 ' + det.thicknessPx + ' 像素）。量一下这套房子最外沿的总宽（毫米），或者直接选一个常见尺寸。',
      label: '实际总宽',
      def: Math.round(bbW * 11.9 / 100) * 100,
      suffix: 'mm',
      presets: [8000, 10000, 12000, 14000, 16000],
    })}) : null`);
    if (!realW) return { ok: false, error: 'cancel', walls: det.walls.length };
  }
  if (!realW) realW = Math.round(bbW * 11.9); // 自测/静默模式：按常见比例估

  const mmPerPx = realW / bbW;
  const wallsMM = IMGWALL.toMillisWalls(det.walls, mmPerPx, { maxThick: 400, minThick: 80 });
  if (interactive) {
    const totalH = Math.round(bbH * mmPerPx);
    const ok = await dialog.showMessageBox(win, {
      type: 'question',
      title: '生成方案',
      message: '识别出 ' + det.walls.length + ' 面墙，面积尺度约 ' + (realW / 1000).toFixed(1) + ' × ' + (totalH / 1000).toFixed(1) + ' 米',
      detail: [
        '墙厚按 1 像素 ≈ ' + mmPerPx.toFixed(2) + ' 毫米换算',
        '识别得到的墙只含「直墙中线 + 墙厚」：门洞、飘窗、家具需要生成后再补。',
        '图上若有尺寸标注，可用菜单「工具 → 方案对账」核对尺寸。',
        '',
        '当前打开的方案会被替换（替换前自动备份一份到数据目录）。',
      ].join('\n'),
      buttons: ['生成方案', '取消'], defaultId: 0, cancelId: 1, noLink: true,
    });
    if (ok.response !== 0) return { ok: false, error: 'cancel', walls: det.walls.length };
  }

  try {
    const cur = await run('window.__designer && window.__designer.bld ? JSON.stringify(window.__designer.bld) : null');
    if (cur && cur.length > 10) fs.writeFileSync(path.join(DATA.dir, 'backup-before-img-import.json'), cur, 'utf8');
  } catch (e) {}

  const spec = DXF.toSpec({ walls: wallsMM }, label, { city: '成都', height: 3000, slab: 120 });
  const done = await run(`(() => {
    try {
      if (!window.__dsSpecToBuilding) return 'ERR:设计器缺少 spec 入口';
      const b = window.__dsSpecToBuilding(${JSON.stringify(spec)});
      window.__designer.replacePlan(b);
      if (window.__designer.fit2D) window.__designer.fit2D();
      return b.floors[0].plan.walls.length;
    } catch (e) { return 'ERR:' + (e && e.message); }
  })()`);
  if (typeof done !== 'number') {
    if (interactive) dialog.showErrorBox('生成失败', String(done || '设计器没有接受这份方案'));
    return { ok: false, error: String(done), walls: det.walls.length };
  }

  const mep = autoMep ? await autoPlaceMep() : { elec: -1 };
  const counts = await run(`(() => {
    const D = window.__designer;
    return { walls: D.app.plan.walls.length, rooms: Object.keys(D.app.rooms || {}).length, elec: D.app.plan.elec.length };
  })()`);
  const elecN = (mep && typeof mep.elec === 'number' && mep.elec > 0) ? mep.elec : (counts && counts.elec) || 0;

  if (interactive) {
    await sleep(1000);
    win.setTitle(label + ' — ' + APP_NAME);
    saveState({ image: file });
    notice('已从图片「' + label + '」生成方案：' + done + ' 面墙 · 比例 1 像素 ≈ ' + mmPerPx.toFixed(2) + ' 毫米' + (elecN ? ' · ' + elecN + ' 个水电点位' : '') + ' · 门洞与家具请在图上补', 6000);
  }
  return { ok: true, specWalls: spec.floors.reduce((n, f) => n + (f.walls || []).length, 0), floors: spec.floors.length, walls: counts && counts.walls, rooms: counts && counts.rooms, elec: elecN, pxWalls: det.walls.length, thicknessPx: det.thicknessPx, mmPerPx: Number(mmPerPx.toFixed(3)), inkRatio: det.inkRatio };
}

async function importImage() {
  const r = await dialog.showOpenDialog(win, {
    title: '从户型图片新建方案',
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp'] }, { name: '全部文件', extensions: ['*'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths.length) return;
  await applyImagePlan(r.filePaths[0], { interactive: true });
}

async function importDxf() {
  const r = await dialog.showOpenDialog(win, {
    title: '从 CAD 图纸新建方案（DXF）',
    filters: [{ name: 'CAD 图纸（DXF）', extensions: ['dxf'] }, { name: '全部文件', extensions: ['*'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths.length) return;
  await applyDxf(r.filePaths[0], { interactive: true });
}
/* --------------------------------- 下载落盘 -------------------------------- */
function setupDownloads() {
  session.defaultSession.on('will-download', async (event, item) => {
    const suggested = item.getFilename() || ('装修方案-' + new Date().toISOString().slice(0, 10) + '.json');
    const r = await dialog.showSaveDialog(win, {
      title: '保存到本机',
      defaultPath: path.join(PLAN_DIR, suggested),
    });
    if (r.canceled || !r.filePath) { item.cancel(); return; }
    item.setSavePath(r.filePath);
    item.once('done', (e, stateName) => {
      if (stateName === 'completed') {
        if (win) win.setTitle(path.basename(r.filePath) + ' — ' + APP_NAME);
        notice('已保存：' + r.filePath);
      } else if (stateName !== 'cancelled') {
        dialog.showErrorBox('保存失败', '文件没有写入成功：' + stateName);
      }
    });
  });
}

/* ----------------------------------- 菜单 ---------------------------------- */
function buildMenu() {
  const recentItems = recent.length
    ? recent.map(f => ({ label: path.basename(f), sublabel: path.dirname(f), click: () => loadPlanFile(f) }))
    : [{ label: '（还没有打开过文件）', enabled: false }];

  const template = [
    {
      label: '文件',
      submenu: [
        { label: '打开方案…', accelerator: 'CmdOrCtrl+O', click: openPlan },
        { label: '从 CAD 图纸新建（DXF）…', accelerator: 'CmdOrCtrl+Shift+D', click: importDxf },
        { label: '从户型图片新建（自动识墙）…', accelerator: 'CmdOrCtrl+Alt+G', click: importImage },
        { label: '导入户型图（描图底图）…', accelerator: 'CmdOrCtrl+Alt+I', click: importUnderlay },
        { label: '保存方案…', accelerator: 'CmdOrCtrl+S', click: savePlan },
        { label: '另存为副本…', accelerator: 'CmdOrCtrl+Shift+S', click: savePlan },
        { type: 'separator' },
        { label: '打开数据目录', click: () => shell.openPath(DATA.dir) },
        { label: '最近打开', submenu: recentItems },
        { type: 'separator' },
        { label: '导出图纸（PDF / DXF）', click: () => clickByText('导出图纸') },
        { type: 'separator' },
        { label: '退出', accelerator: 'Alt+F4', click: () => app.quit() },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', click: () => API.undo() },
        { label: '重做', accelerator: 'CmdOrCtrl+Y', click: () => API.redo() },
        { type: 'separator' },
        { label: '重新加载页面', accelerator: 'CmdOrCtrl+F5', click: () => win && win.webContents.reload() },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '只看平面（2D）', accelerator: 'CmdOrCtrl+1', click: () => switchView('2D', '2d') },
        { label: '平面 + 立体分屏', accelerator: 'CmdOrCtrl+2', click: () => switchView('分屏', 'split') },
        { label: '只看立体（3D）', accelerator: 'CmdOrCtrl+3', click: () => switchView('3D', '3d') },
        { type: 'separator' },
        { label: '整栋楼', click: () => clickByText('整栋') },
        { label: '各层平铺', click: () => clickByText('平铺') },
        { label: '只看当前层', click: () => clickByText('单层') },
        { label: '显示下一层（含下层）', click: () => clickByText('含下层') },
        {
          label: '切换楼层',
          submenu: [
            { label: '一层 ±0.000', accelerator: 'CmdOrCtrl+Shift+1', click: () => API.goFloor(0) },
            { label: '二层 +3.120', accelerator: 'CmdOrCtrl+Shift+2', click: () => API.goFloor(1) },
            { label: '三层 +6.240', accelerator: 'CmdOrCtrl+Shift+3', click: () => API.goFloor(2) },
          ],
        },
        { type: 'separator' },
        { label: '平面适配窗口', accelerator: 'CmdOrCtrl+0', click: () => API.fit() },
        {
          label: '左右侧栏',
          submenu: [
            { label: '收起 / 展开左栏', accelerator: 'CmdOrCtrl+B', click: () => PANELS.toggle('left') },
            { label: '收起 / 展开右栏', accelerator: 'CmdOrCtrl+Shift+B', click: () => PANELS.toggle('right') },
            { type: 'separator' },
            { label: '两栏都展开', click: () => PANELS.show('both') },
            { label: '两栏都收起（画布最大化）', accelerator: 'CmdOrCtrl+Shift+M', click: () => PANELS.hide('both') },
          ],
        },
        {
          label: '外观',
          submenu: appearanceMenu(),
        },
        { label: '切换深浅色', accelerator: 'CmdOrCtrl+Shift+L', click: () => applyAppearance(wantsDark() ? 'light' : 'dark', true) },
        { label: '放大', accelerator: 'CmdOrCtrl+=', click: () => zoomStep(+0.1) },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', click: () => zoomStep(-0.1) },
        { label: '恢复默认缩放', accelerator: 'CmdOrCtrl+Shift+0', click: () => zoomSet(1) },
        { type: 'separator' },
        { label: '全屏', accelerator: 'F11', click: () => win && win.setFullScreen(!win.isFullScreen()) },
      ],
    },
    {
      label: '工具',
      submenu: [
        { label: '选择', accelerator: 'CmdOrCtrl+Alt+1', click: () => clickByText('选择') },
        { label: '画墙', accelerator: 'CmdOrCtrl+Alt+2', click: () => clickByText('画墙') },
        { label: '房间', accelerator: 'CmdOrCtrl+Alt+3', click: () => clickByText('房间') },
        { label: '门窗', accelerator: 'CmdOrCtrl+Alt+4', click: () => clickByText('门窗') },
        { label: '水电', accelerator: 'CmdOrCtrl+Alt+5', click: () => clickByText('水电') },
        { label: '管线', accelerator: 'CmdOrCtrl+Alt+6', click: () => clickByText('管线') },
        { label: '造型', accelerator: 'CmdOrCtrl+Alt+7', click: () => clickByText('造型') },
        { label: '标注', accelerator: 'CmdOrCtrl+Alt+8', click: () => clickByText('标注') },
        { label: '测量', accelerator: 'CmdOrCtrl+Alt+9', click: () => clickByText('测量') },
        { label: '拆墙', click: () => clickByText('拆墙') },
        { type: 'separator' },
        { label: '方案对账（结构 / 尺寸链 / 墙体往返）…', accelerator: 'CmdOrCtrl+Alt+A', click: runAudit },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '快捷键一览', click: showShortcuts },
        { label: '数据存在哪', click: showDataInfo },
        { label: '关于', click: showAbout },
        { type: 'separator' },
        { label: DEBUG ? '开发者工具（仅调试模式可用）' : '开发者工具', enabled: DEBUG, accelerator: DEBUG ? 'F12' : undefined, click: () => win && win.webContents.openDevTools({ mode: 'detach' }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function zoomStep(d) { const z = win.webContents.getZoomFactor(); zoomSet(z + d); }
function zoomSet(v) { win.webContents.setZoomFactor(Math.min(2, Math.max(0.6, Math.round(v * 100) / 100))); }

function showShortcuts() {
  dialog.showMessageBox(win, {
    title: '快捷键',
    message: '常用快捷键',
    detail: [
      'Ctrl+O  打开方案（.json）',
      'Ctrl+S  保存方案（默认存到安装目录的 方案\\ 文件夹）',
      'Ctrl+Z / Ctrl+Y  撤销 / 重做',
      'Ctrl+1 / 2 / 3   平面 / 分屏 / 立体',
      'Ctrl+Shift+1 / 2 / 3   切一层 / 二层 / 三层',
      'Ctrl+0  平面适配窗口      F11 全屏',
      'Ctrl+B  收起 / 展开左栏      Ctrl+Shift+B  收起 / 展开右栏',
      'Ctrl+Shift+M  两栏都收起（画布最大化）',
      'Ctrl+Shift+L  切换深色 / 浅色',
      'Ctrl+Shift+D  从 CAD 图纸（DXF）新建方案',
      'Ctrl+Alt+G  从户型图片新建方案（自动识墙）',
      'Ctrl+Alt+I  导入户型图（描图底图）',
      'Ctrl+Alt+A  方案对账（结构 / 尺寸链 / 墙体往返）',
      'Ctrl+Alt+1~9   选择 / 画墙 / 房间 / 门窗 / 水电 / 管线 / 造型 / 标注 / 测量',
      '',
      '设计器内部的操作和浏览器版完全一致：左栏点按钮，图上点位置。',
    ].join('\n'),
    buttons: ['知道了'],
    noLink: true,
  });
}

function showDataInfo() {
  dialog.showMessageBox(win, {
    title: '数据存在哪',
    message: '所有数据都在这台电脑的安装目录里',
    detail: [
      '数据目录：' + DATA.dir + (IS_FALLBACK_DATA ? '（安装目录不可写，已自动改用这个位置）' : ''),
      '导出的方案 / 图纸默认位置：' + PLAN_DIR,
      '',
      '1）设计器会随时把方案存进数据目录（关掉再开会自动恢复上次的修改）；',
      '2）想拷走 / 备份 / 换电脑，用「文件 → 保存方案」导出一份 .json；',
      '3）到了别的机器用「文件 → 打开方案」读回来就能继续改。',
      '',
      '整个软件不联网上传任何数据。',
    ].join('\n'),
    buttons: ['知道了', '打开数据目录'],
    defaultId: 0, cancelId: 0, noLink: true,
  }).then(r => { if (r.response === 1) shell.openPath(DATA.dir); });
}

function showAbout() {
  dialog.showMessageBox(win, {
    title: '关于',
    message: APP_NAME + '（桌面版）',
    detail: [
      '版本 ' + app.getVersion(),
      'Electron ' + process.versions.electron + '  ·  Chromium ' + process.versions.chrome,
      '',
      '2D 平面 / 3D 立体 / 家具 / 水电点位与回路 / 管线手绘 /',
      '半圆墙 · 拆地板 · 补地板 · 墙高洞口 / 报价 / PDF 施工图 / DXF 导出 /',
      'CAD 图纸识别导入（含尺寸标注校核、多层整栋成型）/ 户型图片自动识墙 / 方案对账。',
      '',
      '安装目录：' + (app.isPackaged ? path.dirname(process.execPath) : ROOT),
      '数据目录：' + DATA.dir,
      '',
      '本机运行，不联网上传任何数据。',
    ].join('\n'),
    buttons: ['好'],
    noLink: true,
  });
}

/* -------------------------------- 外观（深浅色） ------------------------------- */
function wantsDark() {
  if (appearance === 'dark') return true;
  if (appearance === 'light') return false;
  return nativeTheme.shouldUseDarkColors;
}

async function applyAppearance(mode, persist) {
  if (mode) appearance = mode;
  if (persist) saveState({ appearance });
  // 让系统标题栏 / 菜单栏也跟着变（Windows 10+ 支持）
  try { nativeTheme.themeSource = appearance === 'auto' ? 'system' : appearance; } catch (e) {}
  const dark = wantsDark();
  try {
    if (dark) {
      if (!darkKey) darkKey = await win.webContents.insertCSS(fs.readFileSync(THEME_DARK, 'utf8'));
    } else if (darkKey) {
      await win.webContents.removeInsertedCSS(darkKey);
      darkKey = null;
    }
  } catch (e) { console.warn('[appearance]', e.message); }
  if (win) win.setBackgroundColor(dark ? '#0f1218' : '#eef1f5');
  buildMenu();
}

function appearanceMenu() {
  const label = { light: '浅色', dark: '深色', auto: '跟随系统' };
  return ['light', 'dark', 'auto'].map(k => ({
    label: (appearance === k ? '● ' : '   ') + label[k],
    click: () => applyAppearance(k, true),
  }));
}

/* ---------------------------------- 窗口 ---------------------------------- */
function createWindow() {
  const st = loadState();
  win = new BrowserWindow({
    width: st.width || 1620,
    height: st.height || 1000,
    x: st.x, y: st.y,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#eef1f5',
    title: APP_NAME,
    icon: fs.existsSync(BUILDER_ICON) ? BUILDER_ICON : undefined,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  win.setMenuBarVisibility(true);
  win.once('ready-to-show', () => { if (IS_SELFTEST) win.showInactive(); else win.show(); });
  win.loadFile(HTML);

  win.webContents.on('did-finish-load', async () => {
    try {
      const css = fs.readFileSync(THEME, 'utf8');
      await win.webContents.insertCSS(css);
    } catch (e) { console.warn('theme', e.message); }
    // DXF 图层选择面板（页面内的浮层，样式在 theme.css 里）
    try {
      await run(fs.readFileSync(PICKER, 'utf8'));
    } catch (e) { console.warn('picker', e.message); }
    // 数字输入浮层（确认比例尺、填实际尺寸用）
    try {
      await run(fs.readFileSync(ASK, 'utf8'));
    } catch (e) { console.warn('ask', e.message); }
    // 左右栏收起/展开（贴边小把手，页面内挂载）
    try {
      await run(fs.readFileSync(SHELL, 'utf8'));
    } catch (e) { console.warn('shell', e.message); }
    // 右下角只读小徽标：提醒这是本机桌面版
    run(`(() => {
      if (document.getElementById('dsDeskBadge')) return;
      const d = document.createElement('div');
      d.id = 'dsDeskBadge';
      d.innerHTML = '<i></i>${APP_NAME} · 本地运行 v${app.getVersion()}';
      document.body.appendChild(d);
    })()`).catch(() => {});
    // 楼层快切浮层：桌面端首次默认收成小胶囊，避免压住平面图（用户点开/收起会自己记住）
    run(`(() => {
      try {
        if (localStorage.getItem('hd-dock-mini') === null) localStorage.setItem('hd-dock-mini', '1');
      } catch (e) {}
    })()`).catch(() => {});
    startBlank();
    // 外观：默认跟随系统，用户改过就按存的来
    appearance = loadState().appearance || 'auto';
    await applyAppearance(null, false);
    if (IS_SELFTEST) runSelfTest();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  const saveBounds = () => {
    if (!win || win.isDestroyed() || win.isMaximized() || win.isFullScreen()) return;
    const b = win.getBounds();
    saveState({ x: b.x, y: b.y, width: b.width, height: b.height });
  };
  win.on('resized', saveBounds);
  win.on('moved', saveBounds);
  win.on('closed', () => { win = null; });
}

async function runSelfTest() {
  const out = process.env.DS_SELFTEST_OUT || path.join(ROOT, 'build', 'selftest.png');
  const artDir = path.dirname(out);
  try { fs.mkdirSync(artDir, { recursive: true }); } catch (e) {}
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const shot = async suffix => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(out.replace(/\.png$/, suffix + '.png'), img.toPNG());
  };
  const checks = {};
  try {
    await wait(5200);

    // ===== 1. 首屏：应当是空白户型（不带任何自带数据） =====
    checks.appName = APP_NAME;
    checks.version = app.getVersion();
    checks.dataDir = DATA.dir;
    checks.dataInInstallDir = !IS_FALLBACK_DATA;
    checks.badge = await run(`(document.getElementById('dsDeskBadge')||{}).textContent || null`);
    checks.blank = await run(`(() => {
      const D = window.__designer; const p = D && D.app && D.app.plan;
      if (!p) return null;
      return { name: p.name, walls: p.walls.length, openings: p.openings.length, furniture: p.furniture.length,
               rooms: Object.keys(D.app.rooms || {}).length, elec: p.elec.length };
    })()`);
    checks.edges = await run(`[!!document.getElementById('dsEdgeLeft'), !!document.getElementById('dsEdgeRight')]`);
    await shot('');

    // ===== 2. 左右栏点一下收起 / 再点展开 =====
    checks.panelHide = await run(`window.__dsSetPanel('both','hide')`);
    await wait(800);
    checks.panelHidden = await run(`(() => {
      const l = document.getElementById('leftPanel'), r = document.querySelector('aside.right'), s = document.getElementById('stage');
      return { leftVisible: !!(l && l.offsetParent), rightVisible: !!(r && r.offsetParent), stageW: Math.round(s.getBoundingClientRect().width) };
    })()`);
    await shot('-shut');
    checks.panelShow = await run(`window.__dsSetPanel('both','show')`);
    await wait(900);
    checks.panelShown = await run(`(() => {
      const l = document.getElementById('leftPanel'), r = document.querySelector('aside.right'), s = document.getElementById('stage');
      return { leftVisible: !!(l && l.offsetParent), rightVisible: !!(r && r.offsetParent), stageW: Math.round(s.getBoundingClientRect().width) };
    })()`);

    // ===== 3. 真导入一张 CAD 图纸（夹具），验证识墙链路 =====
    const fixture = path.join(ROOT, 'build', 'fixture_cad.dxf');
    const dxfFile = process.env.DS_DXF_FILE && fs.existsSync(process.env.DS_DXF_FILE) ? process.env.DS_DXF_FILE
      : (fs.existsSync(fixture) ? fixture : null);
    if (dxfFile) {
      checks.dxfFile = path.basename(dxfFile);
      checks.dxfImport = await applyDxf(dxfFile, { interactive: false, autoMep: true, name: 'CAD 导入测试' });
      await wait(2200);
      await shot('-cad');
      checks.afterImport = await run(`(() => {
        const D = window.__designer;
        return { walls: D.app.plan.walls.length, rooms: Object.keys(D.app.rooms || {}).length, elec: D.app.plan.elec.length };
      })()`);
    }

    // ===== 3.5 位图识墙：拿合成户型图（build/fixture_plan.png）走一遍 =====
    const imgFixture = process.env.DS_IMG_FILE && fs.existsSync(process.env.DS_IMG_FILE) ? process.env.DS_IMG_FILE
      : path.join(ROOT, 'build', 'fixture_plan.png');
    if (fs.existsSync(imgFixture)) {
      checks.imageFile = path.basename(imgFixture);
      checks.imageImport = await applyImagePlan(imgFixture, { interactive: false, autoMep: true, name: '图片识墙测试', realWidthMM: 12340 });
      await wait(2000);
      await shot('-img');
      checks.afterImage = await run(`(() => {
        const D = window.__designer;
        return { walls: D.app.plan.walls.length, rooms: Object.keys(D.app.rooms || {}).length, elec: D.app.plan.elec.length };
      })()`);
    }

    // ===== 4. 往返：导出 DXF → 再识别 → 再生成方案 → 复原 =====
    try {
      const before = await run('window.__designer && window.__designer.bld ? JSON.stringify(window.__designer.bld) : null');
      const dxfText = await run(`(() => {
        const D = window.__designer;
        const p = D && D.app && D.app.plan;
        if (!p || !D.dxfBytes) return null;
        const arr = D.dxfBytes(p, 0);
        return new TextDecoder().decode(new Uint8Array(arr));
      })()`);
      checks.dxfExportBytes = dxfText ? dxfText.length : -1;
      if (dxfText) {
        const rtPath = path.join(artDir, 'roundtrip.dxf');
        fs.writeFileSync(rtPath, dxfText, 'utf8');
        checks.dxfPlanWalls = await run('window.__designer.app.plan.walls.length');
        const a = DXF.analyzeLayers(dxfText);
        const picked = a.layers.filter(o => o.suggested).map(o => o.layer);
        checks.dxfSuggested = picked;
        const rt = DXF.parse(dxfText, { layers: picked.length ? picked : undefined });
        checks.dxfRoundTripWalls = rt.ok ? rt.walls.length : -1;
        checks.dxfRoundTripStats = rt.stats || null;
        checks.dxfRoundTripOK = !!rt.ok;
        if (rt.ok) {
          const spec = DXF.toSpec(rt, 'roundtrip', { height: 3000 });
          checks.dxfImport2 = await run(`(() => {
            try {
              const b = window.__dsSpecToBuilding(${JSON.stringify(spec)});
              window.__designer.replacePlan(b);
              if (window.__designer.fit2D) window.__designer.fit2D();
              return { walls: window.__designer.app.plan.walls.length, rooms: Object.keys(window.__designer.app.rooms || {}).length, elec: window.__designer.app.plan.elec.length };
            } catch (e) { return 'ERR:' + (e && e.message); }
          })()`);
          checks.dxfAutoElec = await autoPlaceMep();
          await wait(2000);
          await shot('-dxf');
          if (before) {
            checks.dxfRestore = await run(`(() => { try {
              const b = JSON.parse(${JSON.stringify(before)});
              b.kind = 'building'; b.version = 2;
              window.__designer.replacePlan(b);
              return window.__designer.app.plan.walls.length;
            } catch (e) { return 'ERR:' + e.message; } })()`);
          }
        }
      }
    } catch (e) { checks.dxfFail = String(e && e.message); }

    // ===== 4.5 对账：尺寸标注校核 + 多层切分 + 结构报告 =====
    try {
      const fixture2 = path.join(ROOT, 'build', 'fixture_cad.dxf');
      if (fs.existsSync(fixture2)) {
        const text2 = fs.readFileSync(fixture2, 'utf8');
        const dm = DXF.analyzeDims(text2);
        const ls2 = DXF.analyzeLayers(text2).layers || [];
        const pick2 = ls2.filter(o => o.suggested).map(o => o.layer);
        const res2 = DXF.parse(text2, { layers: pick2.length ? pick2 : undefined });
        checks.dimsTotal = dm.total;
        checks.dimsVertify = DXF.verifyDims(res2.ok ? res2.walls : [], dm);
        const shift = res2.walls.map(w => ({ ...w, a: [w.a[0] + 30000, w.a[1]], b: [w.b[0] + 30000, w.b[1]] }));
        const one = DXF.splitFloors(res2.walls, {});
        const two2 = DXF.splitFloors(res2.walls.concat(shift), {});
        checks.splitSingle = one.count;
        checks.splitDouble = two2.count;
        const rep = AUDIT.audit({
          spec: DXF.toSpec(res2, '对账夹具', {}), dxfText: text2,
          layers: pick2.length ? pick2 : null,
        });
        checks.auditVerdict = rep.verdict;
        checks.auditErrors = rep.structure.errors.length;
        checks.auditWarnings = rep.structure.warnings.length;
        checks.auditDims = rep.dims ? { checked: rep.dims.checked, ok: rep.dims.ok, bad: rep.dims.bad } : null;
        checks.auditRoundtrip = rep.roundtrip ? { same: rep.roundtrip.same, walls: rep.roundtrip.walls } : null;
        fs.writeFileSync(path.join(artDir, 'audit-report.md'), rep.markdown, 'utf8');
      }
    } catch (e) { checks.auditFail = String(e && e.message); }

    // ===== 4.6 整栋（两层）成型：挑出 4 道墙复制成第二层，看设计器能否建成楼房 =====
    try {
      const base = await run('window.__designer && window.__designer.bld ? JSON.stringify(window.__designer.bld) : null');
      const f1 = DXF.parse(fs.readFileSync(path.join(ROOT, 'build', 'fixture_cad.dxf'), 'utf8'), { layers: ['WALL'] });
      if (f1.ok) {
        const g1 = DXF.reorigin(f1.walls.slice(0, Math.max(6, Math.floor(f1.walls.length / 3))), 300);
        const g2 = DXF.reorigin(f1.walls.slice(-Math.max(6, Math.floor(f1.walls.length / 3))), 300);
        const spec2 = DXF.toSpecMulti([g1, g2], ['一层', '二层'], { name: '两层对账夹具', height: 3000 });
        checks.multiSpec = await run(`(() => {
          try {
            const b = window.__dsSpecToBuilding(${JSON.stringify(spec2)});
            window.__designer.replacePlan(b);
            if (window.__designer.fit2D) window.__designer.fit2D();
            return { floors: window.__designer.bld.floors.length, names: window.__designer.bld.floors.map(f => f.plan.name),
                     perFloor: window.__designer.bld.floors.map(f => f.plan.walls.length) };
          } catch (e) { return 'ERR:' + (e && e.message); }
        })()`);
        await wait(1500);
        await shot('-multi');
      }
      if (base) {
        checks.multiRestore = await run(`(() => { try {
          const b = JSON.parse(${JSON.stringify(base)}); b.kind = 'building'; b.version = 2;
          window.__designer.replacePlan(b); return window.__designer.bld.floors.length;
        } catch (e) { return 'ERR:' + e.message; } })()`);
      }
    } catch (e) { checks.multiFail = String(e && e.message); }

    // ===== 5. 菜单项 + 菜单切视图 =====
    const menu = Menu.getApplicationMenu();
    checks.menuTop = menu ? menu.items.map(i => i.label) : [];
    checks.menuItems = menu ? menu.items.map(i => i.submenu ? i.submenu.items.length : 0) : [];
    try {
      const vm = menu.items.find(i => i.label === '视图');
      const to3d = vm.submenu.items.find(i => i.label.indexOf('只看立体') === 0);
      const to2d = vm.submenu.items.find(i => i.label.indexOf('只看平面') === 0);
      to3d.click();
      await wait(5000);
      checks.menuTo3dView = await run('window.__designer && window.__designer.app.view');
      await shot('-3d');
      to2d.click();
      await wait(2500);
      checks.menuTo2dView = await run('window.__designer && window.__designer.app.view');
    } catch (e) { checks.menuFail = String(e && e.message); }

    // ===== 6. 深色模式 =====
    try {
      await applyAppearance('dark', false);
      await wait(1800);
      await shot('-dark');
      checks.darkBg = await run('getComputedStyle(document.body).backgroundColor');
      checks.darkPanel = await run("getComputedStyle(document.getElementById('leftPanel') || document.body).backgroundColor");
      checks.darkEdge = await run(`(() => { const e=document.getElementById('dsEdgeLeft'); return e ? getComputedStyle(e).backgroundColor : null; })()`);
      checks.lightBtns = await run(`(() => {
        const out = [];
        document.querySelectorAll('button, select, .card, .chip, .tag').forEach(el => {
          const bg = getComputedStyle(el).backgroundColor;
          const m = bg.match(/\\d+/g);
          if (!m) return;
          const lum = (Number(m[0]) * 299 + Number(m[1]) * 587 + Number(m[2]) * 114) / 1000;
          if (lum > 190) out.push({ cls: el.className || el.tagName, text: (el.textContent || '').trim().slice(0, 12), bg });
        });
        return out.slice(0, 40);
      })()`);
      await applyAppearance('light', false);
      await wait(1200);
    } catch (e) { checks.darkFail = String(e && e.message); }

    fs.writeFileSync(out.replace(/\.png$/, '.json'), JSON.stringify(checks, null, 2));
    console.log('SELFTEST', JSON.stringify(checks));
  } catch (e) {
    console.error('SELFTEST FAILED', e && e.message);
  } finally {
    setTimeout(() => app.quit(), 900);
  }
}

/* ---------------------------------- 启动 ---------------------------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    recent = (loadState().recent || []).filter(f => { try { return fs.existsSync(f); } catch (e) { return false; } });
    setupDownloads();
    createWindow();
    buildMenu();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => app.quit());
}
