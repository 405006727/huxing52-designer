// 位图识墙单测：node build/unit_imgwall.js [gray 文件]
// 读取裸灰度（w,h,bytes）→ 跑识别 → 输出统计与一阶断言
const fs = require('fs');
const path = require('path');
const IMG = require('../app/imgwall.js');

const file = process.argv[2] || path.join(__dirname, 'fixture_plan.gray');
const buf = fs.readFileSync(file);
const w = buf.readUInt32LE(0), h = buf.readUInt32LE(4);
const gray = new Uint8Array(buf.subarray(8, 8 + w * h));

const t0 = Date.now();
const res = IMG.detect(gray, w, h, {});
const ms = Date.now() - t0;

const out = {
  ms,
  ok: res.ok,
  error: res.error || null,
  walls: res.walls ? res.walls.length : 0,
  vertical: res.walls ? res.walls.filter(o => o.dir === 'v').length : 0,
  horizontal: res.walls ? res.walls.filter(o => o.dir === 'h').length : 0,
  thicknessPx: res.thicknessPx,
  inkRatio: res.inkRatio,
  inverted: res.inverted,
  bboxPx: res.bboxPx,
};

let mmPerPx = 10.98;
try {
  const meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture_plan.meta.json'), 'utf8'));
  mmPerPx = meta.truth.mmPerPx;
  out.meta = meta.truth;
} catch (e) {}

if (res.walls) {
  const mm = IMG.toMillisWalls(res.walls, mmPerPx, {});
  out.mmWalls = mm.length;
  const xs = [], ys = [];
  mm.forEach(wl => { xs.push(wl.a[0], wl.b[0]); ys.push(wl.a[1], wl.b[1]); });
  out.mmExtent = [Math.round(Math.min(...xs)), Math.round(Math.min(...ys)), Math.round(Math.max(...xs)), Math.round(Math.max(...ys))];
  out.thickMM = (mm.map(w2 => w2.t).sort((a, b) => a - b)[Math.floor(mm.length / 2)] || 0);
}

console.log(JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(__dirname, 'unit_imgwall.json'), JSON.stringify({ ...out, wallsPx: res.walls }, null, 1));

const fail = [];
if (!res.ok) fail.push('识别失败: ' + (res.error || ''));
else {
  if (out.walls < 8) fail.push('墙太少: ' + out.walls);
  if (out.vertical < 3) fail.push('竖墙太少: ' + out.vertical);
  if (out.horizontal < 3) fail.push('横墙太少: ' + out.horizontal);
}
if (fail.length) { console.error('FAIL', fail.join(' | ')); process.exit(1); }
console.log('PASS');
