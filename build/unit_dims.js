// 尺寸标注校核 + 多层切分单测：node build/unit_dims.js [dxf]
const fs = require('fs');
const path = require('path');
const DXF = require('../app/dxf.js');

const file = process.argv[2] || path.join(__dirname, 'fixture_cad.dxf');
const text = fs.readFileSync(file, 'utf8');

const layers = DXF.analyzeLayers(text).layers || [];
const picked = (layers.filter(l => /WALL|墙|Q|A-WALL/i.test(l.layer)).map(l => l.layer)[0]) || (layers[0] && layers[0].layer);
const res = DXF.parse(text, { layers: [picked] });
if (!res.ok) { console.error('parse fail', res.error); process.exit(1); }

const dim = DXF.analyzeDims(text);
const vr = DXF.verifyDims(res.walls, dim);

console.log('图层', picked, '墙', res.walls.length, '| 标注', dim.dims.length, '文字尺寸', dim.texts.length, '跳过', dim.skipped);
console.log('标注样例', JSON.stringify(dim.dims.slice(0, 3).concat(dim.texts.slice(0, 3))));
console.log('对账 已核', vr.checked, 'OK', vr.ok, '偏差', vr.badFlag, '未匹配', vr.unmatched, '非正交', vr.skipped);

// 多层切分：① 单张平面应当切不出层；② 复制一份 +30000mm 后应当切成 2 层
const single = DXF.splitFloors(res.walls, { gap: 2200, minWalls: 4 });
const shift = res.walls.map(w => ({ ...w, a: [w.a[0] + 30000, w.a[1]], b: [w.b[0] + 30000, w.b[1]] }));
const two = res.walls.concat(shift);
const sp = DXF.splitFloors(two, { gap: 2200, minWalls: 4 });
console.log('单张平面 → 层数', single.count, JSON.stringify(single.floors));
console.log('并排两份 → 层数', sp.count, 'multi=', sp.multi, JSON.stringify(sp.floors));

const fail = [];
if (!dim.dims.length && !dim.texts.length) fail.push('一个尺寸都没读到');
if (single.count !== 1) fail.push('单张平面被误切成 ' + single.count + ' 层');
if (sp.count !== 2) fail.push('两层切分失败: ' + sp.count);
if (vr.checked === 0) fail.push('对账一条都没匹配上');
fs.writeFileSync(path.join(__dirname, 'unit_dims.json'), JSON.stringify({ dims: dim, verify: vr, single: single.floors, split: sp.floors, multi: sp.multi }, null, 1));
if (fail.length) { console.error('FAIL', fail.join(' | ')); process.exit(1); }
console.log('PASS');
