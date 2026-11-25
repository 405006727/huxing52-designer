// ===== 52户型装修设计 · 桌面版：交付包（看板图 + 设备档案 + 配电箱表） =====
// 纯 Node、零依赖、不联网。输入是设计器导出的整栋 building JSON，输出：
//   ① 顶视平面图（SVG，可控矢量化）—— 交付图（带点位编号）/ 看板底图（干净）/ 夜底
//   ② 设备档案 + 实体映射表（CSV / Markdown，给智能家居对接用）
//   ③ 配电箱回路表（按点位的回路归类 + 负荷 / 电流 / 线径 / 断路器核算）
//   ④ HA picture-elements 可直接用的坐标 JSON + YAML 片段
//
// 口径说明：
//   · 房间归属靠墙面栅格做泛洪（cell=100mm），不依赖设计器内部运行态。
//   · 负荷一律「估算」：点位本身只说明装什么，不说明装多大功率，默认功率见 KINDS.watt，
//     可在 devices JSON 里逐条改；表内标了“估算”的地方都不该直接当施工依据。
//   · 线径 / 断路器按家用常见做法给建议值，属参考，需持证电工按现场复核。

(function () {
  'use strict';

  var INF = 1e9;
  var U = 220;            // 单相电压
  var PF_MOTOR = 0.9;     // 空调 / 电机类功率因数

  /* ------------------------------ 点位品类表 ------------------------------ */
  // 名称 / 简称 / 分组 取自设计器自己的点位目录，保证两处叫法一致。
  // domain: 建议的 HA 实体域；watt: 默认功率估算（W）；circuit: 回路归类
  var KINDS = {
    // 灯具（照明回路）
    light:    { name: '吸顶灯',     short: '灯', group: '灯具', domain: 'light',  watt: 12,  circuit: 'light' },
    pendant:  { name: '吊灯',       short: '吊', group: '灯具', domain: 'light',  watt: 40,  circuit: 'light' },
    downlight:{ name: '筒灯',       short: '筒', group: '灯具', domain: 'light',  watt: 7,   circuit: 'light' },
    spot:     { name: '射灯',       short: '射', group: '灯具', domain: 'light',  watt: 7,   circuit: 'light' },
    wallLamp: { name: '壁灯',       short: '壁', group: '灯具', domain: 'light',  watt: 8,   circuit: 'light' },
    strip:    { name: 'LED 灯带',   short: '带', group: '灯具', domain: 'light',  watt: 20,  circuit: 'light', line: true },
    track:    { name: '磁吸轨道灯', short: '轨', group: '灯具', domain: 'light',  watt: 15,  circuit: 'light', line: true },
    linear:   { name: '线性灯',     short: '线', group: '灯具', domain: 'light',  watt: 15,  circuit: 'light', line: true },

    // 开关（照明回路的控制端）
    switch1:  { name: '单控开关',   short: '开', group: '开关', domain: 'switch', watt: 0, circuit: 'light', control: true },
    switch2:  { name: '双控开关',   short: '双', group: '开关', domain: 'switch', watt: 0, circuit: 'light', control: true },
    switch3:  { name: '三开开关',   short: '三', group: '开关', domain: 'switch', watt: 0, circuit: 'light', control: true },
    dimmer:   { name: '调光开关',   short: '调', group: '开关', domain: 'light',  watt: 0, circuit: 'light', control: true },

    // 强电（插座回路 / 专用回路）
    socket:   { name: '五孔插座',   short: '插', group: '强电', domain: 'switch', watt: 300,  circuit: 'socket' },
    socketUSB:{ name: 'USB 插座',   short: 'U', group: '强电', domain: 'switch', watt: 30,   circuit: 'socket' },
    socketW:  { name: '防水插座',   short: '防', group: '强电', domain: 'switch', watt: 300,  circuit: 'socket', wet: true },
    socket4:  { name: '四孔插座',   short: '四', group: '强电', domain: 'switch', watt: 300,  circuit: 'socket' },
    socketSw: { name: '带开关插座', short: '开', group: '强电', domain: 'switch', watt: 300,  circuit: 'socket' },
    socketReserve: { name: '预留线口', short: '留', group: '强电', domain: 'switch', watt: 0, circuit: 'socket' },
    socketFloor:   { name: '地插',    short: '地', group: '强电', domain: 'switch', watt: 300, circuit: 'socket' },
    socketHood:    { name: '烟机插座', short: '烟', group: '强电', domain: 'switch', watt: 250, circuit: 'socket' },
    socket16: { name: '16A 插座',   short: '16', group: '强电', domain: 'switch', watt: 2000, circuit: 'dedicated', breaker: 25, wire: 4 },
    socketAC: { name: '空调插座',   short: '空', group: '强电', domain: 'switch', watt: 1200, circuit: 'dedicated', breaker: 20, wire: 2.5, motor: true },
    socketACW:{ name: '空调开关',   short: '空开', group: '开关', domain: 'switch', watt: 1200, circuit: 'dedicated', breaker: 20, wire: 2.5, motor: true },
    socketEV: { name: '充电桩电源', short: '充', group: '强电', domain: 'switch', watt: 7000, circuit: 'dedicated', breaker: 32, wire: 6 },
    socketHeat:{ name: '地暖温控',  short: '暖', group: '开关', domain: 'climate', watt: 1800, circuit: 'dedicated', breaker: 20, wire: 2.5, rcbo: true },
    panel:    { name: '强电箱',     short: '强', group: '强电', domain: 'sensor', watt: 0, circuit: 'incoming' },

    // 弱电
    weak:     { name: '弱电箱',     short: '弱', group: '弱电', domain: 'sensor', watt: 0, circuit: 'weak' },
    net:      { name: '网络插座',   short: '网', group: '弱电', domain: 'sensor', watt: 0, circuit: 'weak' },
    tv:       { name: '电视插座',   short: '视', group: '弱电', domain: 'sensor', watt: 0, circuit: 'weak' },
    intercom: { name: '可视对讲',   short: '讲', group: '弱电', domain: 'sensor', watt: 5, circuit: 'weak' },
    smoke:    { name: '烟感 / 燃气报警', short: '感', group: '弱电', domain: 'binary_sensor', watt: 3, circuit: 'weak' },
    camera:   { name: '摄像头',     short: '摄', group: '弱电', domain: 'camera', watt: 8, circuit: 'weak' },

    // 给水 / 排水（不占断路器）
    cold:     { name: '冷水点',     short: '冷', group: '给水', domain: 'sensor', watt: 0, circuit: 'water' },
    hot:      { name: '热水点',     short: '热', group: '给水', domain: 'sensor', watt: 0, circuit: 'water' },
    waterIn:  { name: '进水总阀',   short: '阀', group: '给水', domain: 'sensor', watt: 0, circuit: 'water' },
    waste:    { name: '墙排水口',   short: '排', group: '给水', domain: 'sensor', watt: 0, circuit: 'water' },

    // 暖通
    gas:      { name: '燃气点位',   short: '气', group: '暖通燃气', domain: 'sensor', watt: 0, circuit: 'gas' },
    acHole:   { name: '空调孔',     short: '孔', group: '暖通燃气', domain: 'sensor', watt: 0, circuit: 'none' },
    curtain:  { name: '窗帘电机',   short: '帘', group: '暖通燃气', domain: 'cover', watt: 100, circuit: 'dedicated', breaker: 10, wire: 1.5 },
    fan:      { name: '换气扇',     short: '风', group: '暖通燃气', domain: 'fan', watt: 60, circuit: 'dedicated', breaker: 10, wire: 1.5 },
  };

  var GROUP_COLOR = {
    '灯具': '#f59f00', '强电': '#e03131', '开关': '#1971c2', '弱电': '#0c8599',
    '给水': '#0ca678', '暖通燃气': '#e8590c',
  };
  var GROUP_ORDER = ['灯具', '强电', '开关', '弱电', '给水', '暖通燃气'];

  // 房间名 → entity_id 前缀（HA 里实体 id 只能用拉丁字母）
  var ROOM_SLUG = {
    '客厅': 'keting', '餐厅': 'canting', '主卧': 'zhuwo', '次卧': 'ciwo', '卧室': 'woshi',
    '儿童房': 'ertongfang', '老人房': 'laorenfang', '书房': 'shufang', '厨房': 'chufang',
    '卫生间': 'weishengjian', '主卫': 'zhuwei', '客卫': 'kewei', '公卫': 'gongwei',
    '阳台': 'yangtai', '生活阳台': 'shenghuoyangtai', '玄关': 'xuanguan', '走廊': 'zoulang',
    '过道': 'guodao', '衣帽间': 'yimaojian', '储物间': 'chuwujian', '洗衣房': 'xiyifang',
    '茶室': 'chashi', '影音室': 'yinyingshi', '健身房': 'jianshenfang', '车库': 'cheku',
    '庭院': 'tingyuan', '露台': 'lutai', '设备间': 'shebeijian', '楼梯': 'louti',
  };

  var CIRCUIT_RULES = {
    light:     { title: '照明回路',   wire: 1.5, breaker: 10, maxPoints: 20, rcbo: false },
    socket:    { title: '插座回路',   wire: 2.5, breaker: 16, maxPoints: 8,  rcbo: true },
    dedicated: { title: '专用回路',   wire: 2.5, breaker: 20, maxPoints: 1,  rcbo: true },
    weak:      { title: '弱电（信息箱）', wire: 0, breaker: 0, maxPoints: 99, rcbo: false },
    water:     { title: '给排水点位',  wire: 0, breaker: 0, maxPoints: 99, rcbo: false },
    gas:       { title: '燃气点位',    wire: 0, breaker: 0, maxPoints: 99, rcbo: false },
    none:      { title: '土建点位',    wire: 0, breaker: 0, maxPoints: 99, rcbo: false },
  };

  // 电流 → 建议铜芯线径（mm²），家用常见档位
  function wireFor(amp) {
    if (amp <= 10) return 1.5;
    if (amp <= 16) return 2.5;
    if (amp <= 25) return 4;
    if (amp <= 32) return 6;
    return 10;
  }

  /* -------------------------------- 小工具 -------------------------------- */
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d || 0); }
  function round(v, p) { var k = Math.pow(10, p || 0); return Math.round(v * k) / k; }
  function pct(v, total) { return total > 0 ? round(v / total * 100, 1) : 0; }

  function segDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    if (!L2) return Math.hypot(px - ax, py - ay);
    var t = ((px - ax) * dx + (py - ay) * dy) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  // 线段相交（不含共端点之外的退化情形，够用）
  function segCross(a, b, c, d) {
    function o(p, q, r) { var v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); return v > 0 ? 1 : v < 0 ? -1 : 0; }
    var o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
    return o1 !== o2 && o3 !== o4;
  }

  function escapeXml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  /* --------------------------- building → 规整模型 --------------------------- */
  // 楼层显示名：设计器里 plan.name 常是「方案名 · 一层」，直接用会跟标题重复
  function floorLabel(bname, shortName, planName, idx) {
    var b = String(bname || '').trim(), s = String(shortName || '').trim(), p = String(planName || '').trim();
    if (s && s !== p) return s;
    if (b && p.indexOf(b) === 0) {
      var tail = p.slice(b.length).replace(/^[\s·\-—|]+/, '').trim();
      if (tail) return tail;
    }
    if (p && p !== b) return p;
    return '第' + (idx + 1) + '层';
  }
  // 设计器里墙的 a/b 是节点 id，楼板厚 slab、层高 height 都在楼层上
  function modelFromBuilding(bld) {
    var src = bld || {};
    var slab = num(src.slab, 120), base = num(src.base, 0);
    var floors = (src.floors || []).map(function (f, idx) {
      var p = f.plan || f || {};
      var nodeMap = {};
      (p.nodes || []).forEach(function (n) { if (n && n.id) nodeMap[n.id] = [num(n.x), num(n.y)]; });
      function pt(v) {
        if (Array.isArray(v)) return [num(v[0]), num(v[1])];
        if (v && typeof v === 'object') return [num(v.x), num(v.y)];
        if (typeof v === 'string' && nodeMap[v]) return nodeMap[v].slice();
        return null;
      }
      var walls = (p.walls || []).map(function (w) {
        var a = pt(w.a || w.p1), b = pt(w.b || w.p2);
        if (!a || !b) return null;
        var len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        return { a: a, b: b, t: num(w.t || w.thick, 200), bearing: !!w.bearing, len: len, id: w.id || '' };
      }).filter(function (w) { return w && w.len > 1; });

      var rooms = (p.rooms || []).map(function (r, i) {
        return { id: r.id || ('room' + i), name: String(r.name || ('房间' + (i + 1))), x: num(r.x), y: num(r.y), mat: r.mat || '' };
      });

      var elec = (p.elec || []).map(function (e, i) {
        return {
          id: e.id || ('e' + i), kind: String(e.kind || 'light'),
          x: num(e.x), y: num(e.y), rot: num(e.rot), h: num(e.h),
          links: Array.isArray(e.links) ? e.links.slice() : [],
        };
      }).filter(function (e) { return isFinite(e.x) && isFinite(e.y); });

      return {
        index: idx, name: floorLabel(src.name, f.name, p.name, idx),
        height: num(p.height, 3000), walls: walls, rooms: rooms, elec: elec,
        openings: (p.openings || []).length, furniture: (p.furniture || []).length,
      };
    }).filter(function (f) { return f.walls.length || f.elec.length; });

    return { name: String(src.name || '未命名户型'), slab: slab, base: base, floors: floors };
  }

  /* ------------------------- 房间栅格（泛洪求归属 + 净面积） ------------------------- */
  function roomsOfFloor(floor, opt) {
    opt = opt || {};
    var cell = num(opt.cell, 100), margin = num(opt.margin, 600);
    var walls = floor.walls || [], seeds = floor.rooms || [];
    if (!walls.length) {
      return { cell: cell, origin: [0, 0], gw: 0, gh: 0, at: function () { return -1; }, rooms: [] };
    }
    var minx = INF, miny = INF, maxx = -INF, maxy = -INF;
    walls.forEach(function (w) {
      minx = Math.min(minx, w.a[0], w.b[0]); maxx = Math.max(maxx, w.a[0], w.b[0]);
      miny = Math.min(miny, w.a[1], w.b[1]); maxy = Math.max(maxy, w.a[1], w.b[1]);
    });
    seeds.forEach(function (s) { minx = Math.min(minx, s.x); maxx = Math.max(maxx, s.x); miny = Math.min(miny, s.y); maxy = Math.max(maxy, s.y); });
    var ox = Math.floor((minx - margin) / cell) * cell;
    var oy = Math.floor((miny - margin) / cell) * cell;
    var gw = Math.ceil((maxx - ox + margin) / cell) + 1;
    var gh = Math.ceil((maxy - oy + margin) / cell) + 1;

    // blocked：格子中心落在墙体厚度内即视为墙
    var blocked = new Uint8Array(gw * gh);
    for (var gy = 0; gy < gh; gy++) {
      var cy = oy + (gy + 0.5) * cell;
      for (var gx = 0; gx < gw; gx++) {
        var cx = ox + (gx + 0.5) * cell, hit = 0;
        for (var wi = 0; wi < walls.length && !hit; wi++) {
          var w = walls[wi];
          if (segDist(cx, cy, w.a[0], w.a[1], w.b[0], w.b[1]) <= w.t / 2 + cell * 0.2) hit = 1;
        }
        if (hit) blocked[gy * gw + gx] = 1;
      }
    }

    var owner = new Int16Array(gw * gh).fill(-1);
    var queue = new Int32Array(gw * gh);
    var rooms = seeds.map(function (s, i) { return { id: s.id, name: s.name, index: i, cells: 0, sx: s.x, sy: s.y, minx: INF, miny: INF, maxx: -INF, maxy: -INF }; });
    rooms.forEach(function (room) {
      var sx = Math.floor((room.sx - ox) / cell), sy = Math.floor((room.sy - oy) / cell);
      if (sx < 0 || sy < 0 || sx >= gw || sy >= gh) return;
      if (blocked[sy * gw + sx]) return;
      var head = 0, tail = 0;
      queue[tail++] = sy * gw + sx;
      owner[sy * gw + sx] = room.index;
      while (head < tail) {
        var cur = queue[head++];
        var cx2 = cur % gw, cy2 = (cur - cx2) / gw;
        var nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var k = 0; k < 4; k++) {
          var nx = cx2 + nb[k][0], ny = cy2 + nb[k][1];
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          var ni = ny * gw + nx;
          if (blocked[ni] || owner[ni] !== -1) continue;
          owner[ni] = room.index;
          queue[tail++] = ni;
        }
      }
    });

    rooms.forEach(function (room, i) {
      var c = 0, ax = 0, ay = 0, mnx = INF, mny = INF, mxx = -INF, mxy = -INF;
      for (var gy2 = 0; gy2 < gh; gy2++) for (var gx2 = 0; gx2 < gw; gx2++) {
        if (owner[gy2 * gw + gx2] !== i) continue;
        c++;
        var mx = ox + (gx2 + 0.5) * cell, my = oy + (gy2 + 0.5) * cell;
        ax += mx; ay += my;
        mnx = Math.min(mnx, mx); mxx = Math.max(mxx, mx); mny = Math.min(mny, my); mxy = Math.max(mxy, my);
      }
      room.cells = c;
      room.areaM2 = round(c * cell * cell / 1e6, 2);
      room.cx = c ? ax / c : room.sx;
      room.cy = c ? ay / c : room.sy;
      if (c) { room.bbox = [mnx, mny, mxx, mxy]; } else { room.areaM2 = 0; }
    });

    return {
      cell: cell, origin: [ox, oy], gw: gw, gh: gh,
      rooms: rooms,
      at: function (x, y) {
        var gx3 = Math.floor((x - ox) / cell), gy3 = Math.floor((y - oy) / cell);
        if (gx3 < 0 || gy3 < 0 || gx3 >= gw || gy3 >= gh) return -1;
        return owner[gy3 * gw + gx3];
      },
    };
  }

  // 点位落不到房间里（贴在墙上 / 落在洞口）时，用“到房间种子点的连线不被墙挡住”找最近的房间
  function roomBySight(px, py, floor, seeds) {
    if (!seeds || !seeds.length) return '';
    var walls = (floor.walls || []).filter(function (w) { return segDist(px, py, w.a[0], w.a[1], w.b[0], w.b[1]) > w.t / 2 + 60; });
    var best = null, bestD = INF;
    seeds.forEach(function (s) {
      var blocked = false;
      for (var i = 0; i < walls.length && !blocked; i++) {
        if (segCross([px, py], [s.x, s.y], walls[i].a, walls[i].b)) blocked = true;
      }
      if (blocked) return;
      var d = Math.hypot(px - s.x, py - s.y);
      if (d < bestD) { bestD = d; best = s; }
    });
    if (best) return best.name;
    // 兜底：最近种子
    bestD = INF;
    seeds.forEach(function (s) { var d = Math.hypot(px - s.x, py - s.y); if (d < bestD) { bestD = d; best = s; } });
    return best ? best.name : '';
  }

  function slugOfRoom(roomName, fallbackIndex) {
    if (!roomName) return 'r' + (fallbackIndex + 1);
    if (ROOM_SLUG[roomName]) return ROOM_SLUG[roomName];
    var m = /^房间\s*(\d+)$/.exec(roomName);
    if (m) return 'room' + m[1];
    // 未收录的名字：稳妥地退成 roomN，避免拼出非法实体 id
    for (var k in ROOM_SLUG) if (roomName.indexOf(k) === 0) return ROOM_SLUG[k];
    return 'room' + (fallbackIndex + 1);
  }

  /* ----------------------------- 设备档案 / 实体 ----------------------------- */
  // overrides: { "0:shlf3dng": {label, entityId, protocol, circuit, watt, note} } —— 手改后回灌
  function buildDevices(model, opt) {
    opt = opt || {};
    var overrides = opt.overrides || {};
    var out = [];
    (model.floors || []).forEach(function (floor) {
      var gr = roomsOfFloor(floor, opt);
      var used = {};
      floor.elec.forEach(function (e) {
        var kdef = KINDS[e.kind] || { name: e.kind, short: '?', group: '其他', domain: 'switch', watt: 0, circuit: 'socket' };
        var roomIdx = gr.at(e.x, e.y);
        var roomName = roomIdx >= 0 && gr.rooms[roomIdx] ? gr.rooms[roomIdx].name : '';
        if (!roomName) roomName = roomBySight(e.x, e.y, floor, floor.rooms);
        var key = floor.index + ':' + e.id;
        var ov = overrides[key] || {};
        var roomSlug = slugOfRoom(roomName, roomIdx >= 0 ? roomIdx : floor.rooms.length);
        var kindSlug = e.kind.replace(/[^a-z0-9]/gi, '').toLowerCase();
        var seq = (used[roomSlug + '|' + kindSlug] = (used[roomSlug + '|' + kindSlug] || 0) + 1);
        var domain = ov.domain || kdef.domain;
        // 品类名本身带数字的（switch1 / socket16 / 四孔 socket4）补个下划线，免得拼成 switch.room1_switch11
        var idTail = /[0-9]$/.test(e.kind) ? (kindSlug + '_' + seq) : (kindSlug + seq);
        var entityId = ov.entityId || (domain + '.' + roomSlug + '_' + idTail);
        out.push({
          key: key, floorIndex: floor.index, floor: floor.name, room: roomName,
          kind: e.kind, kindName: ov.kindName || kdef.name, group: kdef.group,
          x: e.x, y: e.y, h: e.h, links: e.links,
          label: ov.label || ((roomName || floor.name) + ' ' + (kdef.name) ),
          entityId: entityId, domain: domain,
          protocol: ov.protocol || (kdef.weak || kdef.group === '弱电' ? '有线（网线/弱电）' : '待定（Wi-Fi / Zigbee / Matter）'),
          circuitClass: ov.circuit || kdef.circuit,
          watt: isFinite(ov.watt) ? num(ov.watt) : num(kdef.watt),
          wattSource: isFinite(ov.watt) ? '手填' : '估算',
          note: ov.note || '',
          control: !!kdef.control, rcbo: !!kdef.rcbo, motor: !!kdef.motor,
        });
      });
    });
    return out;
  }

  /* ------------------------------- 回路分组 ------------------------------- */
  function buildCircuits(model, devices) {
    var circuits = [];
    var motors = [];
    var perFloor = {};
    devices.forEach(function (d) { (perFloor[d.floorIndex] = perFloor[d.floorIndex] || []).push(d); });

    Object.keys(perFloor).forEach(function (fi) {
      var list = perFloor[fi];
      var fname = list[0].floor;
      var seq = 0;
      function push(cls, title, items, extra) {
        seq += 1;
        var rule = CIRCUIT_RULES[cls] || CIRCUIT_RULES.socket;
        var watts = items.reduce(function (n, it) { return n + num(it.watt); }, 0);
        var pf = items.some(function (it) { return it.motor; }) ? PF_MOTOR : 1;
        var amp = items.some(function (it) { return it.motor; }) ? round(watts / (U * pf), 1) : round(watts / U, 1);
        var breaker = num(extra && extra.breaker, num(rule.breaker));
        var wire = num(extra && extra.wire, num(rule.wire));
        if (!wire && amp > 0) wire = wireFor(amp);
        var rcbo = (extra && extra.rcbo != null) ? extra.rcbo : rule.rcbo;
        circuits.push({
          floorIndex: num(fi), floor: fname,
          no: 'F' + (num(fi) + 1) + '-' + seq,
          title: title, cls: cls,
          points: items.length, watts: round(watts, 0), amp: amp,
          breaker: breaker, wire: wire, rcbo: !!rcbo,
          overload: breaker > 0 && amp > breaker * 0.95,
          entities: items.map(function (it) { return it.label; }),
          note: (extra && extra.note) || (rule.maxPoints < items.length ? '点数偏多（建议≤' + rule.maxPoints + '）' : ''),
        });
      }

      // 照明：整层一组，点数过多按房间拆两路
      var lights = list.filter(function (d) { return d.circuitClass === 'light' && !d.control; });
      var ctrls = list.filter(function (d) { return d.circuitClass === 'light' && d.control; });
      if (lights.length) {
        if (lights.length <= CIRCUIT_RULES.light.maxPoints) push('light', '照明回路', lights.concat(ctrls));
        else {
          var half = Math.ceil(lights.length / 2);
          push('light', '照明回路（1）', lights.slice(0, half));
          push('light', '照明回路（2）', lights.slice(half).concat(ctrls));
        }
      } else if (ctrls.length) push('light', '照明回路（仅开关）', ctrls);

      // 插座：按房间聚，累计 ≤8 点合一路
      var sockets = list.filter(function (d) { return d.circuitClass === 'socket'; });
      var byRoom = {};
      sockets.forEach(function (d) { var r = d.room || '未分区'; (byRoom[r] = byRoom[r] || []).push(d); });
      Object.keys(byRoom).forEach(function (room) {
        var items = byRoom[room];
        var chunks = [], cur = [];
        items.forEach(function (it) {
          cur.push(it);
          if (cur.length >= CIRCUIT_RULES.socket.maxPoints) { chunks.push(cur); cur = []; }
        });
        if (cur.length) chunks.push(cur);
        chunks.forEach(function (ch, i) {
          var wet = ch.some(function (it) { return (KINDS[it.kind] || {}).wet; }) || /卫|厨/.test(room);
          push('socket', (room || '插座') + ' 插座回路' + (chunks.length > 1 ? '（' + (i + 1) + '）' : ''), ch,
            { rcbo: true, breaker: wet ? 20 : 16, note: wet ? '湿区，须带 30mA 漏保' : '' });
        });
      });

      // 专用回路：一个点位一路（空调 / 16A / 充电桩 / 地暖 / 窗帘 / 换气扇）
      list.filter(function (d) { return d.circuitClass === 'dedicated'; }).forEach(function (d) {
        var kdef = KINDS[d.kind] || {};
        push('dedicated', d.room + ' ' + d.kindName, [d], {
          breaker: kdef.breaker, wire: kdef.wire, rcbo: kdef.rcbo != null ? kdef.rcbo : true,
          note: kdef.motor ? '电机类，启动电流按 1.5 倍留余量' : '',
        });
        if (kdef.motor) motors.push(d);
      });

      // 弱电 / 给水 / 燃气 / 土建：只统计，不占断路器
      ['weak', 'water', 'gas', 'none'].forEach(function (cls) {
        var items = list.filter(function (d) { return d.circuitClass === cls; });
        if (!items.length) return;
        var rule = CIRCUIT_RULES[cls];
        circuits.push({
          floorIndex: num(fi), floor: fname, no: '', title: rule.title, cls: cls,
          points: items.length, watts: round(items.reduce(function (n, it) { return n + num(it.watt); }, 0), 0),
          amp: 0, breaker: 0, wire: 0, rcbo: false, overload: false,
          entities: items.map(function (it) { return it.label; }), note: '不占断路器，按分管/信息箱计',
        });
      });
    });

    // 总进线核算
    var totalW = circuits.reduce(function (n, c) { return n + (c.cls === 'weak' || c.cls === 'water' || c.cls === 'gas' || c.cls === 'none' ? 0 : c.watts); }, 0);
    var demand = round(totalW * 0.8, 0);              // 同时系数 0.8
    var totalAmp = round(demand / U, 1);
    var mainBreaker = totalAmp <= 40 ? 40 : totalAmp <= 50 ? 50 : totalAmp <= 63 ? 63 : 80;
    var summary = {
      totalW: round(totalW, 0), demandW: demand, totalAmp: totalAmp,
      mainBreaker: mainBreaker, supply: totalAmp > 63 ? '建议三相进线（或分相）' : '单相 220V 足够',
      circuits: circuits.filter(function (c) { return c.breaker > 0; }).length,
      overload: circuits.filter(function (c) { return c.overload; }),
    };
    return { circuits: circuits, summary: summary };
  }

  /* --------------------------------- SVG 出图 --------------------------------- */
  var PALETTE = {
    day: {
      bg: '#fbfaf6', paper: '#ffffff', wall: '#3c4148', bearing: '#20242a', thin: '#8b929c',
      text: '#252a31', sub: '#6b7280', dot: '#e03131', legend: '#ffffff', grid: '#e7e5df',
    },
    night: {
      bg: '#0f1218', paper: '#131822', wall: '#c9d3e2', bearing: '#eef3fb', thin: '#5c6675',
      text: '#e8edf5', sub: '#8f9bad', dot: '#ffb340', legend: '#1a2130', grid: '#1f2735',
    },
  };

  function floorExtents(floor, opt) {
    var side = num(opt && opt.side, 420), top = num(opt && opt.top, 1400), bottom = num(opt && opt.bottom, 1500);
    if (!floor.walls.length) return { ox: 0, oy: 0, w: 1000, h: 1000 };
    var minx = INF, miny = INF, maxx = -INF, maxy = -INF;
    floor.walls.forEach(function (w) {
      minx = Math.min(minx, w.a[0] - w.t / 2, w.b[0] - w.t / 2);
      maxx = Math.max(maxx, w.a[0] + w.t / 2, w.b[0] + w.t / 2);
      miny = Math.min(miny, w.a[1] - w.t / 2, w.b[1] - w.t / 2);
      maxy = Math.max(maxy, w.a[1] + w.t / 2, w.b[1] + w.t / 2);
    });
    return { ox: minx - side, oy: miny - top, w: (maxx - minx) + side * 2, h: (maxy - miny) + top + bottom };
  }

  // variant: { dots:bool, palette:'day'|'night', legend:bool, title:string, stats:{} }
  function svgFloor(model, floor, variant, opt) {
    opt = opt || {};
    variant = variant || {};
    var pal = PALETTE[variant.palette === 'night' ? 'night' : 'day'];
    var ext = floorExtents(floor, opt);
    var dots = variant.dots !== false;
    var legendOn = variant.legend !== false;
    var devices = variant.devices || [];

    var parts = [];
    parts.push('<?xml version="1.0" encoding="UTF-8"?>');
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + [ext.ox, ext.oy, ext.w, ext.h].map(function (v) { return round(v, 1); }).join(' ') + '" width="' + num(opt.width, 1600) + '" height="' + Math.round(num(opt.width, 1600) * ext.h / ext.w) + '" font-family="Microsoft YaHei, PingFang SC, Noto Sans SC, sans-serif">');
    parts.push('<rect x="' + round(ext.ox, 1) + '" y="' + round(ext.oy, 1) + '" width="' + round(ext.w, 1) + '" height="' + round(ext.h, 1) + '" fill="' + pal.bg + '"/>');

    // 图名
    var title = variant.title || (model.name + ' · ' + floor.name);
    parts.push('<text x="' + round(ext.ox + 280, 1) + '" y="' + round(ext.oy + 520, 1) + '" font-size="280" fill="' + pal.text + '" font-weight="700">' + escapeXml(title) + '</text>');
    if (variant.subtitle) {
      parts.push('<text x="' + round(ext.ox + 285, 1) + '" y="' + round(ext.oy + 1020, 1) + '" font-size="190" fill="' + pal.sub + '">' + escapeXml(variant.subtitle) + '</text>');
    }

    // 北针
    var nx = ext.ox + ext.w - 760, ny = ext.oy + 620;
    parts.push('<g><circle cx="' + round(nx, 1) + '" cy="' + round(ny, 1) + '" r="260" fill="none" stroke="' + pal.thin + '" stroke-width="12"/>' +
      '<path d="M ' + round(nx, 1) + ' ' + round(ny - 230, 1) + ' L ' + round(nx + 90, 1) + ' ' + round(ny + 150, 1) + ' L ' + round(nx, 1) + ' ' + round(ny + 70, 1) + ' L ' + round(nx - 90, 1) + ' ' + round(ny + 150, 1) + ' Z" fill="' + pal.text + '"/>' +
      '<text x="' + round(nx, 1) + '" y="' + round(ny + 400, 1) + '" font-size="180" fill="' + pal.sub + '" text-anchor="middle">N</text></g>');

    // 墙
    parts.push('<g stroke-linecap="square">');
    floor.walls.forEach(function (w) {
      var color = w.bearing ? pal.bearing : pal.wall;
      parts.push('<line x1="' + round(w.a[0], 1) + '" y1="' + round(w.a[1], 1) + '" x2="' + round(w.b[0], 1) + '" y2="' + round(w.b[1], 1) + '" stroke="' + color + '" stroke-width="' + round(w.t, 1) + '"/>');
    });
    parts.push('</g>');

    // 点位（先画点，房间名后画，保证名字不被点压住）
    if (dots) {
      devices.forEach(function (d, i) {
        var c = GROUP_COLOR[d.group] || pal.dot;
        parts.push('<circle cx="' + round(d.x, 1) + '" cy="' + round(d.y, 1) + '" r="115" fill="' + c + '" fill-opacity="0.92" stroke="' + pal.paper + '" stroke-width="22"/>');
        if (variant.numbers !== false) {
          var numLabel = d.n != null ? d.n : (i + 1);
          parts.push('<text x="' + round(d.x, 1) + '" y="' + round(d.y + 55, 1) + '" font-size="120" fill="#ffffff" text-anchor="middle">' + numLabel + '</text>');
        }
      });
    }

    // 房间名 + 净面积（描边晕开，压在点位上也看得清）
    floor.rooms.forEach(function (r) {
      if (r.areaM2 === 0) return;                                  // 房间名落在别人区域里（种子点重叠），不画
      var near = dots && devices.some(function (d) { return Math.hypot(d.x - r.x, d.y - r.y) < 560; });
      var ly = r.y + (near ? 640 : 0);
      var halo = ' stroke="' + pal.bg + '" stroke-width="70" paint-order="stroke"';
      parts.push('<text x="' + round(r.x, 1) + '" y="' + round(ly, 1) + '" font-size="200" fill="' + pal.text + '" text-anchor="middle"' + halo + '>' + escapeXml(r.name) + '</text>');
      if (r.areaM2 != null) {
        parts.push('<text x="' + round(r.x, 1) + '" y="' + round(ly + 290, 1) + '" font-size="150" fill="' + pal.sub + '" text-anchor="middle"' + halo + '>' + r.areaM2.toFixed(1) + ' m²</text>');
      }
    });

    // 图框下沿（只有带图例的交付图才画）
    if (legendOn) {
      parts.push('<line x1="' + round(ext.ox + 160, 1) + '" y1="' + round(ext.oy + ext.h - 1250, 1) + '" x2="' + round(ext.ox + ext.w - 160, 1) + '" y2="' + round(ext.oy + ext.h - 1250, 1) + '" stroke="' + pal.thin + '" stroke-width="10" opacity="0.55"/>');
    }

    // 图例
    if (legendOn) {
      var lx = ext.ox + 260, ly = ext.oy + ext.h - 950;
      parts.push('<text x="' + round(lx, 1) + '" y="' + round(ly, 1) + '" font-size="170" fill="' + pal.sub + '">图例</text>');
      var groups = GROUP_ORDER.filter(function (g) { return dots && devices.some(function (d) { return d.group === g; }); });
      groups.forEach(function (g, i) {
        var gx = lx + 700 + (i % 6) * 1300, gy = ly - 60 + Math.floor(i / 6) * 360;
        parts.push('<circle cx="' + round(gx, 1) + '" cy="' + round(gy, 1) + '" r="100" fill="' + GROUP_COLOR[g] + '"/>');
        parts.push('<text x="' + round(gx + 180, 1) + '" y="' + round(gy + 60, 1) + '" font-size="140" fill="' + pal.text + '">' + escapeXml(g) + '</text>');
      });
      // 比例尺 1m
      var sx = lx, sy = ly + 620;
      parts.push('<line x1="' + round(sx, 1) + '" y1="' + round(sy, 1) + '" x2="' + round(sx + 1000, 1) + '" y2="' + round(sy, 1) + '" stroke="' + pal.text + '" stroke-width="30"/>');
      parts.push('<line x1="' + round(sx, 1) + '" y1="' + round(sy - 90, 1) + '" x2="' + round(sx, 1) + '" y2="' + round(sy + 90, 1) + '" stroke="' + pal.text + '" stroke-width="30"/>');
      parts.push('<line x1="' + round(sx + 1000, 1) + '" y1="' + round(sy - 90, 1) + '" x2="' + round(sx + 1000, 1) + '" y2="' + round(sy + 90, 1) + '" stroke="' + pal.text + '" stroke-width="30"/>');
      parts.push('<text x="' + round(sx + 1200, 1) + '" y="' + round(sy + 70, 1) + '" font-size="150" fill="' + pal.sub + '">1 米（图上尺寸单位 mm）</text>');
    }

    // 右下角表签（贴下沿往上堆）
    if (variant.stats && variant.stats.length) {
      var tx = ext.ox + ext.w - 300, ty0 = ext.oy + ext.h - 170;
      var lines = variant.stats;
      lines.forEach(function (s, i) {
        var ty = ty0 - (lines.length - 1 - i) * 210;
        parts.push('<text x="' + round(tx, 1) + '" y="' + round(ty, 1) + '" font-size="140" fill="' + pal.sub + '" text-anchor="end">' + escapeXml(s) + '</text>');
      });
    }

    parts.push('</svg>');
    return parts.join('\n');
  }

  /* --------------------- 看板坐标（picture-elements） --------------------- */
  function boardForFloor(model, floor, devices, variant, opt) {
    var ext = floorExtents(floor, opt);
    var items = devices.map(function (d, i) {
      return {
        n: d.n != null ? d.n : (i + 1),
        label: d.label, entity: d.entityId, domain: d.domain,
        room: d.room, kind: d.kindName,
        leftPct: pct(d.x - ext.ox, ext.w), topPct: pct(d.y - ext.oy, ext.h),
        x: round(d.x, 1), y: round(d.y, 1),
      };
    });
    return {
      floor: floor.name, floorIndex: floor.index,
      image: variant.imageName, imageSize: { w: num(opt && opt.width, 1600), h: Math.round(num(opt && opt.width, 1600) * ext.h / ext.w) },
      viewBoxMM: { x: round(ext.ox, 1), y: round(ext.oy, 1), w: round(ext.w, 1), h: round(ext.h, 1) },
      rooms: floor.rooms.map(function (r) { return { name: r.name, areaM2: r.areaM2, seed: [r.x, r.y] }; }),
      elements: items,
    };
  }

  function pictureElementsYaml(board, opts) {
    opts = opts || {};
    var imagePath = opts.imagePath || ('/local/floorplan/' + board.image);
    var lines = [
      '# 52户型装修设计 · ' + board.floor + ' 看板（Home Assistant picture-elements）',
      '# 底图放到 HA 的 config/www/floorplan/ 下；实体 id 是建议值，实际以你接入的集成为准。',
      'type: picture-elements',
      'image: ' + imagePath,
      'elements:',
    ];
    board.elements.forEach(function (el) {
      lines.push('  - type: ' + (el.domain === 'light' ? 'state-icon' : 'state-icon'));
      lines.push('    entity: ' + el.entity);
      lines.push('    title: ' + el.label);
      lines.push('    style:');
      lines.push('      left: ' + el.leftPct + '%');
      lines.push('      top: ' + el.topPct + '%');
      lines.push('      --mdc-icon-size: 22px');
    });
    if (board.rooms.length) {
      lines.push('  # 房间名水印（不绑实体，纯标注，可删）');
      board.rooms.forEach(function (r) {
        var ext = board.viewBoxMM;
        lines.push('  - type: state-label');
        lines.push('    entity: sensor.none');
        lines.push('    style:');
        lines.push('      left: ' + pct(r.seed[0] - ext.x, ext.w) + '%');
        lines.push('      top: ' + pct(r.seed[1] - ext.y, ext.h) + '%');
        lines.push('      color: rgba(255,255,255,0.55)');
        lines.push('      font-size: 11px');
        lines.push('    text: ' + r.name);
      });
    }
    return lines.join('\n');
  }

  /* --------------------------------- 表格 --------------------------------- */
  function devicesCsv(devices) {
    var head = ['序号', '楼层', '房间', '点位', '名称', '组别', '建议实体域', '建议 entity_id', '协议', '回路类型', '功率W', '功率来源', '高度mm', '备注'];
    var rows = devices.map(function (d, i) {
      return [i + 1, d.floor, d.room, d.kind, d.kindName, d.group, d.domain, d.entityId, d.protocol,
        (CIRCUIT_RULES[d.circuitClass] || {}).title || d.circuitClass, d.watt, d.wattSource, d.h, d.note].map(csvCell).join(',');
    });
    return '\ufeff' + head.join(',') + '\r\n' + rows.join('\r\n') + '\r\n';
  }
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function devicesMarkdown(model, devices) {
    var md = [];
    md.push('# 设备档案 / 实体映射表');
    md.push('');
    md.push('- 方案：' + model.name);
    md.push('- 点位总数：' + devices.length + ' 个（灯具/开关/插座/弱电/给水/暖通分列）');
    md.push('- entity_id 是按「房间拼音_品类+序号」拼的建议值，可在 `data\\设备档案\\设备档案.json` 里逐条改，改完重新导出会沿用。');
    md.push('- 协议一栏未接实物前都是「待定」，接好后建议同步写回档案。');
    md.push('');
    var groups = GROUP_ORDER.concat(['其他']);
    groups.forEach(function (g) {
      var list = devices.filter(function (d) { return d.group === g; });
      if (!list.length) return;
      md.push('## ' + g + '（' + list.length + ' 个）');
      md.push('');
      md.push('| # | 楼层 | 房间 | 点位 | 建议 entity_id | 域 | 功率(W) |');
      md.push('| --- | --- | --- | --- | --- | --- | --- |');
      devices.forEach(function (d, i) {
        if (d.group !== g) return;
        md.push('| ' + (i + 1) + ' | ' + d.floor + ' | ' + (d.room || '—') + ' | ' + d.kindName + ' | `' + d.entityId + '` | ' + d.domain + ' | ' + (d.watt || '0') + (d.wattSource === '估算' ? '（估算）' : '') + ' |');
      });
      md.push('');
    });
    return md.join('\n');
  }

  function circuitsCsv(rep) {
    var head = ['回路号', '楼层', '回路名', '类型', '点位数', '负荷W', '计算电流A', '断路器A', '导线mm²', '漏保', '超载', '备注'];
    var rows = rep.circuits.map(function (c) {
      return [c.no, c.floor, c.title, c.cls, c.points, c.watts, c.amp, c.breaker || '—', c.wire || '—', c.rcbo ? '是' : '否', c.overload ? '是' : '', c.note].map(csvCell).join(',');
    });
    return '\ufeff' + head.join(',') + '\r\n' + rows.join('\r\n') + '\r\n';
  }

  function circuitsMarkdown(model, rep) {
    var s = rep.summary;
    var md = [];
    md.push('# 配电箱回路表（估算）');
    md.push('');
    md.push('- 方案：' + model.name);
    md.push('- 装接总功率：' + (s.totalW / 1000).toFixed(1) + ' kW；按同时系数 0.8 折算 ' + (s.demandW / 1000).toFixed(1) + ' kW（' + s.demandW + ' W）');
    md.push('- 计算电流：约 ' + s.totalAmp + ' A → 建议总断路器 ' + s.mainBreaker + ' A；' + s.supply);
    md.push('- 占断路器回路 ' + s.circuits + ' 路；点位功率是按品类默认值估的，热水器/烤箱/大功率设备请在档案里改成铭牌值。');
    md.push('');
    md.push('| 回路号 | 楼层 | 回路 | 点位数 | 负荷 W | 电流 A | 断路器 | 导线 mm² | 30mA 漏保 | 备注 |');
    md.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    rep.circuits.forEach(function (c) {
      md.push('| ' + (c.no || '—') + ' | ' + c.floor + ' | ' + c.title + ' | ' + c.points + ' | ' + c.watts + ' | ' + (c.amp || '—') +
        ' | ' + (c.breaker ? 'C' + c.breaker : '—') + ' | ' + (c.wire || '—') + ' | ' + (c.rcbo ? '是' : '否') + ' | ' +
        [c.overload ? '**超载**' : '', c.note].filter(Boolean).join('；') + ' |');
    });
    md.push('');
    if (s.overload.length) {
      md.push('## 需要处理的超载回路');
      md.push('');
      s.overload.forEach(function (c) { md.push('- ' + (c.no || c.title) + '：' + c.amp + ' A 已超过 C' + c.breaker + ' 的 95%，建议拆路或升规格'); });
      md.push('');
    }
    md.push('> 本表是方案阶段的估算，不是施工依据：分路、线径、断路器、漏保选型须由持证电工按现场负荷、线长、环境温度复核（参考 GB 50096、GB/T 16895 系列）。');
    return md.join('\n');
  }

  /* -------------------------------- 交付总装 -------------------------------- */
  // 返回 { ok, summary, files: [{name, type, content, png?:bool}] }
  function delivery(bld, opt) {
    opt = opt || {};
    var model = modelFromBuilding(bld);
    if (!model.floors.length) return { ok: false, error: '当前没有可导出的方案（墙和点位都为空）' };

    var devices = buildDevices(model, { overrides: opt.overrides || {}, cell: opt.cell });
    // 图上编号跟设备清单「序号」一致（跨层连续），避免多层时每层都从 1 重来
    devices.forEach(function (d, i) { d.n = i + 1; });
    var rep = buildCircuits(model, devices);
    var files = [];
    var boards = [];
    var stamp = opt.stamp || new Date().toISOString().slice(0, 10);

    // 设备档案（可手改的母表）
    var archive = devices.map(function (d) {
      return { key: d.key, floor: d.floor, room: d.room, kind: d.kind, label: d.label, entityId: d.entityId, domain: d.domain,
        protocol: d.protocol, circuit: d.circuitClass, watt: d.watt, note: d.note };
    });
    files.push({ name: '设备档案.json', type: 'json', content: JSON.stringify(archive, null, 1) });
    files.push({ name: '设备清单.csv', type: 'csv', content: devicesCsv(devices) });
    files.push({ name: '设备清单.md', type: 'md', content: devicesMarkdown(model, devices) });
    files.push({ name: '配电箱回路表.csv', type: 'csv', content: circuitsCsv(rep) });
    files.push({ name: '配电箱回路表.md', type: 'md', content: circuitsMarkdown(model, rep) });

    // 逐层出图
    var mergedTotal = 0;
    model.floors.forEach(function (floor) {
      var gr = roomsOfFloor(floor, { cell: opt.cell });
      var floorRooms = floor.rooms.map(function (r, i) {
        var g = gr.rooms[i];
        return { id: r.id, name: r.name, x: r.x, y: r.y, areaM2: g ? g.areaM2 : null };
      });
      var floorLike = { name: floor.name, index: floor.index, walls: floor.walls, rooms: floorRooms };
      var fdev = devices.filter(function (d) { return d.floorIndex === floor.index; });
      var wallLen = floor.walls.reduce(function (n, w) { return n + w.len; }, 0);
      var netArea = floorRooms.reduce(function (n, r) { return n + (r.areaM2 || 0); }, 0);
      var merged = floorRooms.filter(function (r) { return !r.areaM2; }).length;
      mergedTotal += merged;
      var stats = [
        '墙 ' + floor.walls.length + ' 面 / 墙长 ' + (wallLen / 1000).toFixed(1) + ' m',
        '房间 ' + floorRooms.filter(function (r) { return !!r.areaM2; }).length + ' 个 / 净面积 ' + netArea.toFixed(1) + ' m²',
        '点位 ' + fdev.length + ' 个',
        merged ? merged + ' 个房间名与他房重叠（图上已合并）' : '',
        '出图 ' + stamp + '（52户型装修设计）',
      ].filter(Boolean);

      var base = floor.name.replace(/[\\/:*?"<>|\s]+/g, '') || ('F' + (floor.index + 1));

      // ① 交付图（带点位编号 + 图例）
      var svgDeliver = svgFloor(model, floorLike, {
        dots: true, numbers: true, palette: 'day', legend: true,
        title: model.name + ' · ' + floor.name + ' 交付图', subtitle: '顶视正交 · 图上尺寸单位 mm',
        devices: fdev, stats: stats,
      }, { width: opt.width || 2000 });
      files.push({ name: base + '-交付图.svg', type: 'svg', content: svgDeliver, png: true, width: opt.width || 2000 });

      // ② 看板底图（干净：只留墙、房间名、标题）日 / 夜。上下留白比交付图窄，当背景更整
      var cleanOpt = { width: 1600, top: 1400, bottom: 340, side: 420 };
      ['day', 'night'].forEach(function (mode) {
        var clean = svgFloor(model, floorLike, {
          dots: false, legend: false, palette: mode,
          title: floor.name + (mode === 'night' ? '（夜）' : ''),
          subtitle: mode === 'night' ? '看板底图 · 夜景底' : '看板底图 · 白天底',
          stats: [],
        }, cleanOpt);
        var suffix = mode === 'night' ? '夜' : '日';
        var fname = base + '-看板底图-' + suffix;
        files.push({ name: fname + '.svg', type: 'svg', content: clean, png: true, width: 1600 });
        boards.push({ mode: suffix, base: base, board: boardForFloor(model, floorLike, fdev, { imageName: fname + '.png' }, cleanOpt) });
      });
    });

    boards.forEach(function (item) {
      var b = item.board;
      files.push({ name: '看板坐标-' + item.base + '-' + item.mode + '.json', type: 'json', content: JSON.stringify(b, null, 1) });
      files.push({ name: 'picture-elements-' + item.base + '-' + item.mode + '.yaml', type: 'yaml', content: pictureElementsYaml(b, { imagePath: '/local/floorplan/' + b.image }) });
    });

    // 说明
    var readme = [
      '# 交付说明',
      '',
      '- 方案：' + model.name + '，' + model.floors.length + ' 层；点位 ' + devices.length + ' 个。',
      '- 本包由「52户型装修设计」导出，内容全部来自当前方案，未联网。',
    ];
    if (mergedTotal) readme.push('- 有 ' + mergedTotal + ' 个房间名与本层其他房间落在同一连通区域，图上已合并显示；把房间名拖到各房间中部后重新导出即可分开。');
    readme = readme.concat([
      '',
      '## 文件怎么用',
      '',
      '| 文件 | 用途 |',
      '| --- | --- |',
      '| `*-交付图.svg / .png` | 带点位编号的平面图，打印或发给电工；编号与 `设备清单` 的「序号」一一对应 |',
      '| `*-看板底图-日/夜.svg / .png` | 给 Home Assistant / 自家面板当背景图，干净无点位 |',
      '| `看板坐标-*.json` | 每层每个点位在图上的百分比坐标 + 建议 entity_id |',
      '| `picture-elements-*.yaml` | 可直接贴进 HA 卡片的 YAML 片段 |',
      '| `设备清单.csv / .md` | 设备档案与实体映射表 |',
      '| `配电箱回路表.csv / .md` | 回路、负荷、电流、线径、断路器（估算） |',
      '| `设备档案.json` | 母表；改完放回 `data\\设备档案\\设备档案.json`，下次导出会沿用你的改动 |',
      '',
      '## 口径与边界',
      '',
      '- 图上坐标是毫米，比例尺按 1 米标注；顶视正交投影，可直接量图。',
      '- 房间净面积按 100mm 栅格泛洪算出，扣掉了墙体占位；房间名贴到谁家区域就算谁家。',
      '- 功率是按品类默认值估的（灯具 7~40W、插座 300W、挂机 1200W、16A 2000W、充电桩 7kW），不代表实际设备铭牌；请对照档案改。',
      '- 线径与断路器是家用常见做法的建议值，不是施工依据：须持证电工按现场负荷、线长与规范复核。',
      '- entity_id 是建议命名（房间拼音_品类+序号）；能否真正控制，取决于你接入的集成本身（米家/涂鸦/Matter 等），本软件不接管设备。',
    ]);
    files.push({ name: '交付说明.md', type: 'md', content: readme.join('\n') });

    var pngCount = files.filter(function (f) { return f.png; }).length;
    return {
      ok: true, model: model, devices: devices, circuits: rep.circuits, summary: rep.summary,
      files: files, boards: boards, pngCount: pngCount,
      stats: {
        floors: model.floors.length, walls: model.floors.reduce(function (n, f) { return n + f.walls.length; }, 0),
        devices: devices.length, circuits: rep.circuits.length, breakers: rep.summary.circuits,
        svg: files.filter(function (f) { return f.type === 'svg'; }).length,
        png: pngCount, totalW: rep.summary.totalW, demandW: rep.summary.demandW, mainBreaker: rep.summary.mainBreaker,
      },
    };
  }

  module.exports = {
    KINDS: KINDS,
    GROUP_COLOR: GROUP_COLOR,
    modelFromBuilding: modelFromBuilding,
    roomsOfFloor: roomsOfFloor,
    roomBySight: roomBySight,
    buildDevices: buildDevices,
    buildCircuits: buildCircuits,
    svgFloor: svgFloor,
    floorExtents: floorExtents,
    boardForFloor: boardForFloor,
    pictureElementsYaml: pictureElementsYaml,
    devicesCsv: devicesCsv,
    devicesMarkdown: devicesMarkdown,
    circuitsCsv: circuitsCsv,
    circuitsMarkdown: circuitsMarkdown,
    delivery: delivery,
  };
})();
