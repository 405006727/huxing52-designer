// 交付包单测：node build/unit_deliver.js [spec 夹具]
// ① 用 spec_fixture.json 验证「节点 id 引用」的墙能被解开
// ② 用一座合成两层楼验证房间泛洪、设备档案、回路核算、出图与看板坐标
const fs = require('fs');
const path = require('path');
const D = require('../app/deliver.js');

const fail = [];
function ok(cond, msg) { if (!cond) fail.push(msg); }

/* ---------- ① 真实夹具：墙用节点 id 引用 ---------- */
let specWalls = 0;
try {
  const spec = JSON.parse(fs.readFileSync(process.argv[2] || path.join(__dirname, 'spec_fixture.json'), 'utf8'));
  const f = spec.floors[0];
  const nodes = [], walls = [];
  f.walls.forEach((w, i) => {
    nodes.push({ id: 'n' + i + 'a', x: w.a[0], y: w.a[1] }, { id: 'n' + i + 'b', x: w.b[0], y: w.b[1] });
    walls.push({ a: 'n' + i + 'a', b: 'n' + i + 'b', t: w.t, bearing: i < 6 });
  });
  const bld = { name: '夹具方案', slab: 120, floors: [{ id: 'f1', name: '一层', plan: { name: '一层', height: 3000, nodes, walls, rooms: [{ id: 'r1', x: 5000, y: 4000, name: '客厅' }], elec: [{ id: 'e1', kind: 'light', x: 5000, y: 4000, h: 0 }] } }] };
  const m = D.modelFromBuilding(bld);
  specWalls = m.floors[0].walls.length;
  ok(specWalls === f.walls.length, '节点引用解不开：' + specWalls + '/' + f.walls.length);
  ok(m.floors[0].walls.every(w => w.len > 1), '有零长墙');
} catch (e) { fail.push('夹具解析失败：' + e.message); }

/* ---------- ② 合成两层楼 ---------- */
function buildSynthetic() {
  const nodes = [], walls = [];
  const P = [[0, 0], [12000, 0], [12000, 8000], [0, 8000], [6000, 0], [6000, 8000], [0, 4000], [6000, 4000]];
  P.forEach((p, i) => nodes.push({ id: 'p' + i, x: p[0], y: p[1] }));
  function W(a, b, t, bearing) { walls.push({ a: 'p' + a, b: 'p' + b, t: t, bearing: !!bearing }); }
  W(0, 1, 240, true); W(1, 2, 240, true); W(2, 3, 240, true); W(3, 0, 240, true);
  W(1, 5, 200);      // 中竖墙（1→2 的一半？实际 12000,0 → 6000,8000 会斜，改成用同 x 的两点）
  walls.pop(); nodes.push({ id: 'p8', x: 6000, y: 0 });
  walls.push({ a: 'p8', b: 'p5', t: 200 });
  W(7, 6, 200);      // 左半的横墙 6000,4000 → 0,4000
  // 修正：W(7,6) 是 6000,4000 → 0,4000，方向反过来即可，长度一样
  const rooms = [
    { id: 'r1', x: 3000, y: 2000, name: '客厅' },
    { id: 'r2', x: 3000, y: 6000, name: '主卧' },
    { id: 'r3', x: 9000, y: 4000, name: '厨房' },
  ];
  const elec = [
    { id: 'l1', kind: 'light', x: 3000, y: 2000 },
    { id: 'l2', kind: 'downlight', x: 4200, y: 2000 },
    { id: 's1', kind: 'switch1', x: 140, y: 1900, links: ['l1'] },
    { id: 's2', kind: 'switch2', x: 5860, y: 1800, links: ['l1', 'l2'] },
    { id: 'k1', kind: 'socket', x: 140, y: 3000 },
    { id: 'k2', kind: 'socket', x: 140, y: 3400 },
    { id: 'k3', kind: 'socketUSB', x: 140, y: 3600 },
    { id: 'w1', kind: 'weak', x: 200, y: 300 },
    { id: 'w2', kind: 'net', x: 200, y: 700 },
    { id: 'w3', kind: 'tv', x: 3000, y: 120 },
    { id: 'w4', kind: 'smoke', x: 3000, y: 1000, h: 0 },
    { id: 'c1', kind: 'curtain', x: 5000, y: 120 },
    { id: 'cold1', kind: 'cold', x: 2000, y: 120 },
    { id: 'm1', kind: 'light', x: 3000, y: 6000 },
    { id: 'ac1', kind: 'socketAC', x: 140, y: 5500 },
    { id: 'ht1', kind: 'socketHeat', x: 5860, y: 5800 },
    { id: 'q1', kind: 'light', x: 9000, y: 4000 },
    { id: 'q2', kind: 'downlight', x: 9600, y: 4000 },
    { id: 'q3', kind: 'socket', x: 9000, y: 140 },
    { id: 'q4', kind: 'socketHood', x: 9400, y: 140 },
    { id: 'q5', kind: 'socket16', x: 9000, y: 7860 },
    { id: 'q6', kind: 'gas', x: 9600, y: 7860 },
  ];
  return {
    name: '合成两层楼', slab: 120, cur: 0,
    floors: [
      { id: 'f1', name: '一层', plan: { name: '一层', height: 3000, nodes, walls, rooms, elec } },
      { id: 'f2', name: '二层', plan: {
        name: '二层', height: 3000,
        nodes: [{ id: 'q0', x: 0, y: 0 }, { id: 'q1', x: 10000, y: 0 }, { id: 'q2', x: 10000, y: 6000 }, { id: 'q3', x: 0, y: 6000 }],
        walls: [{ a: 'q0', b: 'q1', t: 240, bearing: true }, { a: 'q1', b: 'q2', t: 240, bearing: true }, { a: 'q2', b: 'q3', t: 240, bearing: true }, { a: 'q3', b: 'q0', t: 240, bearing: true }],
        rooms: [{ id: 's1', x: 5000, y: 3000, name: '书房' }],
        elec: [{ id: 'b1', kind: 'pendant', x: 5000, y: 3000 }, { id: 'b2', kind: 'socket', x: 140, y: 3000 }],
      } },
    ],
  };
}

const bld = buildSynthetic();
const model = D.modelFromBuilding(bld);
ok(model.floors.length === 2, '楼层数不对');
ok(model.floors[0].walls.length === 6, '合成一层墙数 ' + model.floors[0].walls.length + '（应为 6）');

/* 房间泛洪 */
const gr = D.roomsOfFloor(model.floors[0], { cell: 100 });
ok(gr.rooms.length === 3, '房间数 ' + gr.rooms.length);
const areaSum = gr.rooms.reduce((n, r) => n + r.areaM2, 0);
ok(areaSum > 80 && areaSum < 96, '净面积合计异常 ' + areaSum.toFixed(2) + ' m²（外壳 96 m²）');
gr.rooms.forEach(r => ok(r.areaM2 > 5, '房间「' + r.name + '」面积过小 ' + r.areaM2));

/* 设备档案 */
const devices = D.buildDevices(model, {});
ok(devices.length === 24, '点位数 ' + devices.length + '（应为 24）');
const ids = devices.map(d => d.entityId);
const badId = ids.filter(id => !/^[a-z_]+\.[a-z0-9_]+$/.test(id));
ok(!badId.length, 'entity_id 非法：' + badId.join(', '));
ok(new Set(ids).size === ids.length, 'entity_id 有重复：' + ids.filter((v, i) => ids.indexOf(v) !== i).join(', '));
const byId = {};
devices.forEach(d => byId[d.key] = d);
ok(byId['0:l1'].room === '客厅', '客厅灯归属 ' + byId['0:l1'].room);
ok(byId['0:m1'].room === '主卧', '主卧灯归属 ' + byId['0:m1'].room);
ok(byId['0:q1'].room === '厨房', '厨房灯归属 ' + byId['0:q1'].room);
ok(byId['0:s1'].room === '客厅', '贴墙开关归属 ' + byId['0:s1'].room);
ok(byId['1:b1'].room === '书房', '二层灯归属 ' + byId['1:b1'].room);
ok(byId['0:l1'].entityId === 'light.keting_light1', 'entity 命名 ' + byId['0:l1'].entityId);
ok(byId['0:ac1'].entityId === 'switch.zhuwo_socketac1', 'entity 命名 ' + byId['0:ac1'].entityId);
ok(byId['0:s1'].entityId === 'switch.keting_switch1_1', '带数字品类命名 ' + byId['0:s1'].entityId);
ok(byId['0:q5'].entityId === 'switch.chufang_socket16_1', '16A 命名 ' + byId['0:q5'].entityId);
ok(byId['0:ht1'].domain === 'climate', '地暖温控域 ' + byId['0:ht1'].domain);
ok(byId['0:q5'].circuitClass === 'dedicated', '16A 应为专用回路');

/* 回路核算 */
const rep = D.buildCircuits(model, devices);
const names = rep.circuits.map(c => c.title).join(' | ');
ok(rep.circuits.filter(c => c.cls === 'light').length >= 2, '照明回路数不对：' + names);
ok(rep.circuits.some(c => c.cls === 'socket' && /厨房/.test(c.title)), '厨房插座回路缺失：' + names);
ok(rep.circuits.some(c => c.cls === 'dedicated' && /空调插座/.test(c.title) && c.breaker === 20), '空调专用回路不对');
ok(rep.circuits.some(c => c.cls === 'dedicated' && /地暖温控/.test(c.title) && c.rcbo), '地暖回路缺漏保');
ok(rep.circuits.some(c => c.cls === 'dedicated' && /16A/.test(c.title) && c.breaker === 25), '16A 回路断路器不对');
ok(rep.circuits.some(c => c.cls === 'weak'), '弱电统计缺失');
const lightC = rep.circuits.find(c => c.cls === 'light');
ok(lightC.amp === Math.round(lightC.watts / 220 * 10) / 10, '照明电流计算 ' + lightC.amp + ' / ' + lightC.watts);
ok(rep.circuits.every(c => c.overload === (c.breaker > 0 && c.amp > c.breaker * 0.95)), '超载标记逻辑不一致');
ok(rep.summary.totalW > 0 && rep.summary.demandW === Math.round(rep.summary.totalW * 0.8), '总负荷折算不对');
ok(rep.summary.mainBreaker >= 40, '总断路器 ' + rep.summary.mainBreaker);

/* 出图 */
const floorLike = { walls: model.floors[0].walls, rooms: gr.rooms.map(r => ({ id: r.id, name: r.name, x: r.x, y: r.y, areaM2: r.areaM2 })) };
const fdev = devices.filter(d => d.floorIndex === 0);
const svg = D.svgFloor(model, floorLike, { dots: true, numbers: true, legend: true, devices: fdev, title: '测试' }, { width: 2000 });
ok(svg.indexOf('<svg') === 0 || svg.indexOf('<?xml') === 0, 'SVG 头不对');
ok(/viewBox="[-\d. ]+"/.test(svg), 'SVG 缺 viewBox');
ok((svg.match(/<line /g) || []).length >= model.floors[0].walls.length, '墙线不足');
ok(svg.includes('客厅') && svg.includes('主卧'), '房间名没画上');
ok(svg.includes('图例'), '交付图缺图例');
const svgClean = D.svgFloor(model, floorLike, { dots: false, legend: false, palette: 'night', title: '夜' }, { width: 1600 });
ok(!svgClean.includes('fill-opacity="0.92"'), '干净底图不该有点位圆点');
ok(svgClean.includes('#0f1218'), '夜底配色没生效');

/* 看板坐标 */
const board = D.boardForFloor(model, floorLike, fdev, { imageName: '一层-看板底图-日.png' }, { width: 1600 });
ok(board.elements.length === fdev.length, '看板元素数不对');
ok(board.elements.every(e => e.leftPct >= 0 && e.leftPct <= 100 && e.topPct >= 0 && e.topPct <= 100), '看板百分比越界');
ok(board.imageSize.w === 1600, '看板图宽 ' + board.imageSize.w);
const yaml = D.pictureElementsYaml(board);
ok(yaml.includes('type: picture-elements') && yaml.includes('entity: ' + fdev[0].entityId), 'YAML 片段不对');

/* 交付总装 */
const pack = D.delivery(bld, { width: 1600, stamp: '2026-11-25' });
ok(pack.ok, '交付包失败：' + pack.error);
const fnames = pack.files.map(f => f.name);
ok(new Set(fnames).size === fnames.length, '文件名重复：' + fnames.filter((v, i) => fnames.indexOf(v) !== i).join(', '));
ok(pack.files.every(f => f.content && f.content.length > 20), '有文件内容为空');
ok(pack.pngCount === 6, 'PNG 数 ' + pack.pngCount + '（2 层 × 3 张）');
ok(pack.stats.devices === 24, '交付统计点位数 ' + pack.stats.devices);
ok(pack.stats.floors === 2 && pack.stats.walls === 10, '交付统计楼层/墙数 ' + pack.stats.floors + '/' + pack.stats.walls);
ok(pack.stats.svg === 6, 'SVG 数 ' + pack.stats.svg);
ok(pack.stats.breakers >= 5, '断路器回路数 ' + pack.stats.breakers);
const csv = pack.files.find(f => f.name === '设备清单.csv').content;
ok(csv.trim().split('\r\n').length === 24 + 1, '设备 CSV 行数 ' + csv.trim().split('\r\n').length);
ok(pack.files.filter(f => f.type === 'yaml').length === 4, 'YAML 数不对');

/* 多层点位编号要连续（图上编号 = 设备清单序号） */
const bj1 = JSON.parse(pack.files.find(f => f.name === '看板坐标-一层-日.json').content);
const bj2 = JSON.parse(pack.files.find(f => f.name === '看板坐标-二层-日.json').content);
ok(bj2.elements[0].n === bj1.elements.length + 1, '多层编号未连续：二层首点 ' + bj2.elements[0].n + ' / 一层 ' + bj1.elements.length);

/* 覆盖：手改档案要能沿用 */
const overrides = { '0:l1': { entityId: 'light.my_ceiling', watt: 60, protocol: 'Zigbee' } };
const d2 = D.buildDevices(model, { overrides });
const l1 = d2.find(d => d.key === '0:l1');
ok(l1.entityId === 'light.my_ceiling', '覆盖 entity 失效');
ok(l1.watt === 60 && l1.wattSource === '手填', '覆盖功率失效');
ok(l1.protocol === 'Zigbee', '覆盖协议失效');

console.log(JSON.stringify({
  specWalls, floors: pack.stats.floors, walls: pack.stats.walls, rooms: gr.rooms.length,
  areaSum: +areaSum.toFixed(2), devices: pack.stats.devices, circuits: pack.circuits.length,
  breakers: pack.stats.breakers, totalW: pack.stats.totalW, demandW: pack.stats.demandW,
  mainBreaker: pack.stats.mainBreaker, files: fnames.length, png: pack.pngCount, svg: pack.stats.svg,
}, null, 1));
fs.writeFileSync(path.join(__dirname, 'unit_deliver.json'), JSON.stringify({
  stats: pack.stats, files: fnames, circuits: pack.circuits.map(c => ({ no: c.no, title: c.title, points: c.points, watts: c.watts, amp: c.amp, breaker: c.breaker, wire: c.wire, rcbo: c.rcbo })),
  devices: pack.devices.map(d => ({ key: d.key, room: d.room, kind: d.kind, entityId: d.entityId, watt: d.watt })),
}, null, 1));

if (fail.length) { console.error('FAIL ' + fail.length + ' 项:\n - ' + fail.join('\n - ')); process.exit(1); }
console.log('PASS');
