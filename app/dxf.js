// ===== 紫檀山装修设计器 · 桌面版：DXF 图纸识别模块 =====
// 纯 JS、零依赖。把 AutoCAD 导出 DXF 里的墙线还原成「墙中线 + 墙厚」，再交给设计器生成整套方案。
// 主进程 require('./app/dxf.js') 直接用；单测：node build/test_dxf.js <file.dxf> [layer,layer...]
(function () {
  'use strict';

  var SKIP_LAYER = /(DIM|标注|尺寸|TEXT|文字|AXIS|轴线|图框|TITLE|家具|FURN|门窗|DOOR|WINDOW|窗|门|HATCH|填充|配筋|钢筋|标高|ELEV|TAG|引线|LEADER|TABLE|Defpoints|打印框|WIPEOUT|TREE|植物|灯具|Lighting)/i;
  var WALL_LAYER = /(墙|WALL|A-WALL|WALLS|墙体|隔墙)/i;

  /* ------------------------------ DXF 组码读取 ------------------------------ */
  function entities(text) {
    var lines = text.split(/\r?\n/);
    var out = [], cur = null;
    for (var i = 0; i + 1 < lines.length; i += 2) {
      var code = parseInt(lines[i].trim(), 10);
      if (isNaN(code)) continue;
      var val = lines[i + 1];
      if (code === 0) {
        if (cur) out.push(cur);
        cur = { type: val.trim(), g: [] };
      } else if (cur) cur.g.push([code, val.trim()]);
    }
    if (cur) out.push(cur);
    return out;
  }

  function g1(e, code) {
    for (var i = 0; i < e.g.length; i++) if (e.g[i][0] === code) return e.g[i][1];
    return null;
  }
  function gnum(e, code) { var v = g1(e, code); return v == null ? null : Number(v); }
  function gitems(e, code) {
    var r = [];
    for (var i = 0; i < e.g.length; i++) if (e.g[i][0] === code) r.push(e.g[i][1]);
    return r;
  }

  /* ------------------------------- 图层盘点 -------------------------------- */
  // 打开图纸先把图层列出来给用户勾：CAD 里墙常画在 "0" 或自定义图层，靠名字猜不可靠
  function analyzeLayers(text) {
    var es = entities(text);
    var map = {};
    for (var i = 0; i < es.length; i++) {
      var e = es[i];
      if (e.type !== 'LINE' && e.type !== 'LWPOLYLINE' && e.type !== 'POLYLINE') continue;
      var layer = g1(e, 8) || '0';
      var len = 0;
      if (e.type === 'LINE') {
        var x1 = gnum(e, 10), y1 = gnum(e, 20), x2 = gnum(e, 11), y2 = gnum(e, 21);
        if (x1 == null || y1 == null || x2 == null || y2 == null) continue;
        len = Math.hypot(x2 - x1, y2 - y1);
      } else if (e.type === 'LWPOLYLINE') {
        var xs = gitems(e, 10).map(Number), ys = gitems(e, 20).map(Number);
        for (var k = 1; k < xs.length; k++) len += Math.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]);
      } else len = 1200; // 老式 POLYLINE 按一条墙估
      if (len < 30) continue;
      var m = map[layer] || (map[layer] = { layer: layer, count: 0, length: 0 });
      m.count++;
      m.length += len;
    }
    var list = Object.keys(map).map(function (k) { return map[k]; });
    list.sort(function (a, b) { return b.length - a.length; });
    var hasWallName = list.some(function (o) { return WALL_LAYER.test(o.layer) && !SKIP_LAYER.test(o.layer); });
    list.forEach(function (o) {
      o.skipped = SKIP_LAYER.test(o.layer);
      o.wallName = WALL_LAYER.test(o.layer);
      // 建议勾选：名字像墙的优先；没有墙名图层时，把非标注图层里线量最大的前 3 个先勾上
      o.suggested = hasWallName ? (o.wallName && !o.skipped) : false;
    });
    if (!hasWallName) {
      var cand = list.filter(function (o) { return !o.skipped; }).slice(0, 3);
      cand.forEach(function (o) { o.suggested = true; });
    } else {
      // 有墙名图层但线量占比很小（墙其实画在别的图层上）→ 顺带把线量最大的图层也勾上
      var wallLen = list.filter(function (o) { return o.wallName && !o.skipped; }).reduce(function (s, o) { return s + o.length; }, 0);
      var maxLen = list.filter(function (o) { return !o.skipped; }).reduce(function (m, o) { return Math.max(m, o.length); }, 0);
      if (maxLen > 0 && wallLen < maxLen * 0.25) {
        list.filter(function (o) { return !o.skipped && !o.wallName; }).slice(0, 2).forEach(function (o) { o.suggested = true; });
      }
    }
    return { layers: list, hasWallName: hasWallName, entityCount: es.length };
  }

  /* ------------------------------- 线段提取 -------------------------------- */
  function collectSegments(text, opt) {
    var segs = [], stats = { entities: 0, line: 0, lwpoly: 0, poly: 0, arc: 0, dropped: 0 };
    var only = opt && opt.layers && opt.layers.length ? opt.layers : null;
    var es = entities(text);
    function push(x1, y1, x2, y2, layer) {
      var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
      if (len < (opt.minSeg || 60)) { stats.dropped++; return; }
      segs.push({ x1: x1, y1: y1, x2: x2, y2: y2, len: len, layer: layer });
    }
    for (var i = 0; i < es.length; i++) {
      var e = es[i];
      if (!e.type) continue;
      stats.entities++;
      var layer = g1(e, 8) || '0';
      if (only) { if (only.indexOf(layer) === -1) continue; }
      else if (SKIP_LAYER.test(layer)) continue;

      if (e.type === 'LINE') {
        var x1 = gnum(e, 10), y1 = gnum(e, 20), x2 = gnum(e, 11), y2 = gnum(e, 21);
        if (x1 != null && y1 != null && x2 != null && y2 != null) { push(x1, y1, x2, y2, layer); stats.line++; }
      } else if (e.type === 'LWPOLYLINE') {
        var xs = gitems(e, 10).map(Number), ys = gitems(e, 20).map(Number);
        for (var k = 1; k < xs.length; k++) push(xs[k - 1], ys[k - 1], xs[k], ys[k], layer);
        if (((gnum(e, 70) || 0) & 1) && xs.length > 2) push(xs[xs.length - 1], ys[ys.length - 1], xs[0], ys[0], layer);
        stats.lwpoly++;
      } else if (e.type === 'POLYLINE') {
        var pts = [], j = i + 1;
        for (; j < es.length; j++) {
          if (es[j].type === 'VERTEX') {
            var vx = gnum(es[j], 10), vy = gnum(es[j], 20);
            if (vx != null && vy != null) pts.push([vx, vy]);
          } else if (es[j].type === 'SEQEND') break;
        }
        for (var m = 1; m < pts.length; m++) push(pts[m - 1][0], pts[m - 1][1], pts[m][0], pts[m][1], layer);
        if (((gnum(e, 70) || 0) & 1) && pts.length > 2) push(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1], layer);
        i = j; stats.poly++;
      } else if (e.type === 'ARC' || e.type === 'CIRCLE') stats.arc++;
    }
    return { segs: segs, stats: stats };
  }

  /* ------------------------------ 双线成墙 --------------------------------- */
  function pairWalls(segs, opt) {
    var TMIN = opt.tMin || 50, TMAX = opt.tMax || 460;
    var ADIFF = (opt.angleTol || 1.6) * Math.PI / 180;
    var walls = [], used = [], angles = segs.map(function (s) {
      var a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
      if (a < 0) a += Math.PI;
      if (a >= Math.PI) a -= Math.PI;
      return a;
    });
    for (var i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      var s1 = segs[i], a1 = angles[i];
      var ux = (s1.x2 - s1.x1) / s1.len, uy = (s1.y2 - s1.y1) / s1.len;
      var best = null;
      for (var j = i + 1; j < segs.length; j++) {
        if (used[j]) continue;
        var s2 = segs[j], da = Math.abs(a1 - angles[j]);
        if (da > Math.PI / 2) da = Math.PI - da;
        if (da > ADIFF) continue;
        var d1 = -uy * (s2.x1 - s1.x1) + ux * (s2.y1 - s1.y1);
        var d2 = -uy * (s2.x2 - s1.x1) + ux * (s2.y2 - s1.y1);
        if (d1 * d2 < 0) continue;
        var th = (Math.abs(d1) + Math.abs(d2)) / 2;
        if (th < TMIN || th > TMAX) continue;
        if (Math.abs(d1 - d2) > Math.max(40, th * 0.35)) continue;
        var t1 = ux * (s2.x1 - s1.x1) + uy * (s2.y1 - s1.y1);
        var t2 = ux * (s2.x2 - s1.x1) + uy * (s2.y2 - s1.y1);
        var lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(s1.len, Math.max(t1, t2)), ov = hi - lo;
        // 同一面墙的两条墙皮长度基本相等；长度差太多的多半是端头/别的墙，不能配
        var dLen = Math.abs(s1.len - s2.len);
        if (dLen > Math.max(300, Math.min(s1.len, s2.len) * 0.15)) continue;
        if (ov < Math.min(s1.len, s2.len) * 0.6) continue;
        var score = ov - dLen * 0.5;
        if (!best || score > best.score) best = { j: j, off: (d1 + d2) / 4, t: th, lo: lo, hi: hi, score: score };
      }
      if (best) {
        var half = best.off, nx = -uy * half, ny = ux * half;
        walls.push({
          a: [s1.x1 + ux * best.lo + nx, s1.y1 + uy * best.lo + ny],
          b: [s1.x1 + ux * best.hi + nx, s1.y1 + uy * best.hi + ny],
          t: Math.round(best.t / 5) * 5, layer: s1.layer
        });
        used[i] = used[best.j] = true;
      }
      if (i > 4000) break; // 超大图纸保护，剩下的走单线兜底
    }
    return { walls: walls, used: used };
  }

  /* ------------------------------ 单线兜底 --------------------------------- */
  function fallback(segs, walls, used, opt) {
    var out = walls.slice();
    for (var i = 0; i < segs.length && i < 4000; i++) {
      if (used[i]) continue;
      var s = segs[i];
      if (s.len < (opt.minSingle || 900)) continue;
      out.push({ a: [s.x1, s.y1], b: [s.x2, s.y2], t: s.len >= 3000 ? 200 : 120, layer: s.layer });
    }
    return out;
  }

  function norm(a) { while (a < 0) a += Math.PI; while (a >= Math.PI) a -= Math.PI; return a; }

  function dedupe(walls) {
    var out = [];
    for (var i = 0; i < walls.length; i++) {
      var w = walls[i];
      var mx = (w.a[0] + w.b[0]) / 2, my = (w.a[1] + w.b[1]) / 2;
      var len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      var ang = norm(Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]));
      var dup = false;
      for (var k = 0; k < out.length; k++) {
        var o = out[k];
        if (Math.abs(o.t - w.t) > 40) continue;
        var da = Math.abs(o.ang - ang);
        if (da > Math.PI / 2) da = Math.PI - da;
        if (da > 3 * Math.PI / 180) continue;
        if (Math.abs(o.len - len) > Math.max(80, len * 0.3)) continue;
        if (Math.hypot(o.mx - mx, o.my - my) > Math.max(40, w.t * 0.3)) continue;
        dup = true; break;
      }
      if (!dup) out.push({ a: w.a, b: w.b, t: w.t, layer: w.layer, mx: mx, my: my, len: len, ang: ang });
    }
    return out;
  }

  // 端点吸附：相距 < tol 的端点归成同一节点（设计器自己还会按 40mm 吸附、自动打断 T 口）
  function snapEnds(walls, tol) {
    tol = tol || 60;
    var grid = {}, clusters = [];
    function cellOf(x, y) { return Math.round(x / tol) + ':' + Math.round(y / tol); }
    function find(x, y) {
      var cx = Math.round(x / tol), cy = Math.round(y / tol);
      for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
        var list = grid[(cx + dx) + ':' + (cy + dy)];
        if (list) for (var i = 0; i < list.length; i++) if (Math.hypot(list[i].x - x, list[i].y - y) <= tol) return list[i];
      }
      return null;
    }
    function add(x, y) {
      var c = find(x, y);
      if (!c) {
        c = { x: x, y: y, sx: 0, sy: 0, n: 0 };
        var k = cellOf(x, y);
        (grid[k] = grid[k] || []).push(c);
        clusters.push(c);
      }
      c.n++; c.sx += x; c.sy += y; c.cx = c.sx / c.n; c.cy = c.sy / c.n;
      return c;
    }
    walls.forEach(function (w) { add(w.a[0], w.a[1]); add(w.b[0], w.b[1]); });
    walls.forEach(function (w) {
      var ca = find(w.a[0], w.a[1]) || { cx: w.a[0], cy: w.a[1] };
      var cb = find(w.b[0], w.b[1]) || { cx: w.b[0], cy: w.b[1] };
      w.a2 = [ca.cx, ca.cy]; w.b2 = [cb.cx, cb.cy];
    });
    return walls;
  }

  // 同一条墙常被洞口、交点切成好几段；同角度 + 同墙线位置、接口连续的合成一段
  function mergeCollinear(walls, tol) {
    tol = tol || 80;
    var groups = {};
    walls.forEach(function (w) {
      var ux = w.b[0] - w.a[0], uy = w.b[1] - w.a[1], len = Math.hypot(ux, uy);
      if (!len) return;
      ux /= len; uy /= len;
      var ang = norm(Math.atan2(uy, ux));
      var deg = Math.round(ang * 180 / Math.PI);
      var d = -uy * w.a[0] + ux * w.a[1]; // 直线到原点的有符号距离
      var k = deg + '|' + Math.round(d / 10) + '|' + Math.round(w.t / 20);
      (groups[k] = groups[k] || []).push({ w: w, ux: ux, uy: uy, d: d, t0: ux * w.a[0] + uy * w.a[1], t1: ux * w.b[0] + uy * w.b[1] });
    });
    var out = [];
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      g.sort(function (p, q) { return Math.min(p.t0, p.t1) - Math.min(q.t0, q.t1); });
      var cur = null;
      g.forEach(function (e) {
        var lo = Math.min(e.t0, e.t1), hi = Math.max(e.t0, e.t1);
        if (cur && lo - cur.hi <= tol && Math.abs(e.w.t - cur.w.t) <= 30) {
          cur.hi = Math.max(cur.hi, hi);
          return;
        }
        if (cur) out.push(cur);
        cur = { lo: lo, hi: hi, ux: e.ux, uy: e.uy, d: e.d, w: e.w };
      });
      if (cur) out.push(cur);
    });
    return out.map(function (c) {
      // 直线上的点：p = n*d + u*t，n = (-uy, ux)
      var nx = -c.uy * c.d, ny = c.ux * c.d;
      return {
        a: [nx + c.ux * c.lo, ny + c.uy * c.lo],
        b: [nx + c.ux * c.hi, ny + c.uy * c.hi],
        t: c.w.t, layer: c.w.layer
      };
    });
  }

  // 去掉离主体的“飞线”：整张大图里常混着图例、详图、零星标注
  function trimOutliers(walls) {    if (walls.length < 8) return walls;
    var ms = walls.map(function (w) { return [(w.a2[0] + w.b2[0]) / 2, (w.a2[1] + w.b2[1]) / 2]; });
    function q(arr, p) { var s = arr.slice().sort(function (a, b) { return a - b; }); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))]; }
    var xs = ms.map(function (m) { return m[0]; }), ys = ms.map(function (m) { return m[1]; });
    var x0 = q(xs, 0.04), x1 = q(xs, 0.96), y0 = q(ys, 0.04), y1 = q(ys, 0.96);
    var padX = Math.max(2000, (x1 - x0) * 0.25), padY = Math.max(2000, (y1 - y0) * 0.25);
    var keep = walls.filter(function (w, i) {
      return ms[i][0] >= x0 - padX && ms[i][0] <= x1 + padX && ms[i][1] >= y0 - padY && ms[i][1] <= y1 + padY;
    });
    return keep.length >= Math.max(4, walls.length * 0.3) ? keep : walls;
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  /* ------------------------------- 主流程 ---------------------------------- */
  function parse(text, opt) {
    opt = opt || {};
    var c = collectSegments(text, opt);
    if (!c.segs.length) return { ok: false, error: '这些图层里没读到可用的直线 / 多段线', stats: c.stats };
    var pw = pairWalls(c.segs, opt);
    var walls = fallback(c.segs, pw.walls, pw.used, opt);
    walls = dedupe(walls);
    walls = walls.filter(function (w) { return Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) >= (opt.minWall || 250); });
    if (opt.merge !== false) walls = mergeCollinear(walls, opt.mergeGap || 80);
    snapEnds(walls, opt.snap || 60);
    walls = trimOutliers(walls);

    var minx = Infinity, miny = Infinity;
    walls.forEach(function (w) { minx = Math.min(minx, w.a2[0], w.b2[0]); miny = Math.min(miny, w.a2[1], w.b2[1]); });
    var dx = 300 - minx, dy = 300 - miny;

    var seen = {}, uniq = [];
    walls.forEach(function (w) {
      var k1 = [w.a2[0], w.a2[1], w.b2[0], w.b2[1]].join(','), k2 = [w.b2[0], w.b2[1], w.a2[0], w.a2[1]].join(',');
      if (seen[k1] || seen[k2]) return;
      seen[k1] = 1;
      var ax = round1(w.a2[0] + dx), ay = round1(w.a2[1] + dy);
      var bx = round1(w.b2[0] + dx), by = round1(w.b2[1] + dy);
      if (Math.hypot(bx - ax, by - ay) < 250) return;
      uniq.push({ a: [ax, ay], b: [bx, by], t: w.t });
    });

    var bearing = uniq.filter(function (w) { return w.t >= 180; }).length;
    var bbox = uniq.reduce(function (b, w) {
      b[0] = Math.min(b[0], w.a[0], w.b[0]); b[1] = Math.min(b[1], w.a[1], w.b[1]);
      b[2] = Math.max(b[2], w.a[0], w.b[0]); b[3] = Math.max(b[3], w.a[1], w.b[1]);
      return b;
    }, [Infinity, Infinity, -Infinity, -Infinity]);
    return {
      ok: uniq.length >= 3,
      error: uniq.length >= 3 ? null : '识别出的墙太少（' + uniq.length + ' 面），换个图层试一下',
      walls: uniq,
      stats: {
        entities: c.stats.entities, line: c.stats.line, lwpolyline: c.stats.lwpoly, polyline: c.stats.poly, arc: c.stats.arc,
        segments: c.segs.length, pairedWalls: pw.walls.length, singleWalls: Math.max(0, walls.length - pw.walls.length),
        finalWalls: uniq.length, bearingWalls: bearing,
        widthMM: Math.round(bbox[2] - bbox[0]), depthMM: Math.round(bbox[3] - bbox[1])
      }
    };
  }

  /* ------------------------- 生成 spec（交给设计器） ------------------------ */
  function toSpec(result, name, opt) {
    opt = opt || {};
    return {
      name: name || '导入图纸',
      slab: opt.slab || 120,
      base: 0,
      site: { city: opt.city || '成都', month: opt.month || 9 },
      floors: [{
        name: opt.floorName || '一层',
        height: opt.height || 3000,
        walls: result.walls,
        autoElec: opt.autoElec === false ? false : true
      }]
    };
  }

  /* ---------------------- 尺寸标注：把图上的数字读出来 ---------------------- */
  // 结论口径：尺寸以标注为准。标注数字只用来「校核」识别结果，不直接改墙，
  // 因为标注与实体经常不一致（改过图不倒标注），硬改会破坏闭合关系。
  function cleanDxfText(s) {
    if (s == null) return '';
    return String(s)
      .replace(/\\P/g, ' ')
      .replace(/\\~/g, '')
      .replace(/\\[A-Za-z][^;\\]*;/g, '')
      .replace(/\\U\+([0-9A-Fa-f]{4})/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/[{}]/g, ' ')
      .replace(/%%[dpc]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseMeasure(raw) {
    var t = cleanDxfText(raw);
    if (!t) return null;
    // 面积、角度、比例、标高、平方不是长度
    if (/[°㎡%]|m²|M2|平方|标高|±|1\s*[:：]\s*\d/.test(t)) return null;
    var m = t.match(/^[+\-]?\s*(\d+(?:\.\d+)?)/);
    if (!m) return null;
    var v = Number(m[1]);
    if (!isFinite(v) || v < 60 || v > 60000) return null;
    return v;
  }

  function analyzeDims(text) {
    var es = entities(text);
    var dims = [], texts = [], skipped = 0;
    for (var i = 0; i < es.length; i++) {
      var e = es[i];
      if (e.type === 'DIMENSION') {
        var x13 = gnum(e, 13), y13 = gnum(e, 23), x14 = gnum(e, 14), y14 = gnum(e, 24);
        var tx = gnum(e, 11), ty = gnum(e, 21);
        if (tx == null) tx = gnum(e, 10);
        if (ty == null) ty = gnum(e, 20);
        var val = null;
        if (x13 != null && y13 != null && x14 != null && y14 != null) {
          val = Math.hypot(x14 - x13, y14 - y13);
          if (!isFinite(val) || val < 60 || val > 60000) val = null;
        }
        if (val == null) {
          var ov = parseMeasure(g1(e, 1));
          if (ov != null) val = ov;
        }
        if (val == null) { skipped++; continue; }
        var ang = gnum(e, 50);
        if (ang == null) ang = (Math.abs((y14 || 0) - (y13 || 0)) > Math.abs((x14 || 0) - (x13 || 0))) ? 90 : 0;
        dims.push({ value: Math.round(val), x: tx || ((x13 + x14) / 2), y: ty || ((y13 + y14) / 2), angle: normAng(ang), src: 'DIMENSION', layer: g1(e, 8) || '0' });
        continue;
      }
      if (e.type === 'TEXT' || e.type === 'MTEXT') {
        var raw = g1(e, 1) || (e.type === 'MTEXT' ? gitems(e, 3).join('') : '');
        var v2 = parseMeasure(raw);
        var px = gnum(e, 10), py = gnum(e, 20);
        if (v2 == null || px == null || py == null) { if (v2 == null) skipped++; continue; }
        texts.push({ value: Math.round(v2), x: px, y: py, angle: normAng(gnum(e, 50)), src: e.type, layer: g1(e, 8) || '0', text: cleanDxfText(raw) });
      }
    }
    return { dims: dims, texts: texts, skipped: skipped, total: dims.length + texts.length };
  }

  function normAng(a) {
    a = Number(a || 0) % 360;
    if (a < 0) a += 360;
    return Math.round(a * 100) / 100;
  }

  // 把标注和识别出的墙逐条对账：横向标注找横向墙，纵向标注找纵向墙
  function verifyDims(walls, dimList, opt) {
    opt = opt || {};
    var tolPct = opt.tolPct || 0.012, tolAbs = opt.tolAbs || 40, reach = opt.reach || 2600;
    var list = (dimList && dimList.dims) ? dimList.dims.concat(dimList.texts || []) : (dimList || []);
    var out = { checked: 0, ok: 0, badFlag: 0, skipped: 0, pairs: [], unmatched: 0 };
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      var h = Math.abs(d.angle) < 25 || Math.abs(d.angle - 180) < 25 || Math.abs(d.angle - 360) < 25;
      var v = Math.abs(d.angle - 90) < 25 || Math.abs(d.angle - 270) < 25;
      if (!h && !v) { out.skipped++; continue; }
      var best = null, nearMiss = 0;
      for (var k = 0; k < walls.length; k++) {
        var w = walls[k];
        var dx = Math.abs(w.b[0] - w.a[0]), dy = Math.abs(w.b[1] - w.a[1]);
        var isH = dx >= dy;
        if (h && !isH) continue;
        if (v && isH) continue;
        var len = Math.round(isH ? dx : dy);
        // 长度先过一道筛：标注是 400 的短尺寸不该拿 4 米的墙去对
        if (Math.abs(len - d.value) > Math.max(600, d.value * 0.45)) continue;
        if (isH) {
          var wy = (w.a[1] + w.b[1]) / 2, cx = (w.a[0] + w.b[0]) / 2;
          if (Math.abs(wy - d.y) > reach) continue;
          if (Math.abs(cx - d.x) > d.value * 0.6 + 1200) { nearMiss++; continue; }
          var cost = Math.abs(cx - d.x) + Math.abs(wy - d.y) * 0.8 + Math.abs(len - d.value) * 0.2;
        } else {
          var wx = (w.a[0] + w.b[0]) / 2, cy = (w.a[1] + w.b[1]) / 2;
          if (Math.abs(wx - d.x) > reach) continue;
          if (Math.abs(cy - d.y) > d.value * 0.6 + 1200) { nearMiss++; continue; }
          var cost = Math.abs(cy - d.y) + Math.abs(wx - d.x) * 0.8 + Math.abs(len - d.value) * 0.2;
        }
        if (!best || cost < best.cost) best = { wall: w, cost: cost, len: len };
      }
      if (!best) { out.unmatched++; continue; }
      out.checked++;
      var diff = best.len - d.value;
      var tol = Math.max(tolAbs, Math.round(d.value * tolPct));
      var keep = Math.abs(diff) <= tol;
      if (keep) out.ok++; else out.badFlag++;
      out.pairs.push({ 标注: d.value, 图长: best.len, 差: diff, 单位: 'mm', 判定: keep ? 'ok' : (Math.abs(diff) > tol * 4 ? '严重' : '偏差'), 位置: [Math.round(d.x), Math.round(d.y)], 方向: h ? '水平' : '竖直', 来源: d.src });
    }
    return out;
  }

  /* --------------------- 整栋/多层：按空隙自动切成几层 --------------------- */
  function bboxOf(walls) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (var i = 0; i < walls.length; i++) {
      var w = walls[i];
      x0 = Math.min(x0, w.a[0], w.b[0]); x1 = Math.max(x1, w.a[0], w.b[0]);
      y0 = Math.min(y0, w.a[1], w.b[1]); y1 = Math.max(y1, w.a[1], w.b[1]);
    }
    return [x0, y0, x1, y1];
  }

  // 一张图里画了几层（并排/上下摆放的多层平面）。
  // 判据：把墙投影到坐标轴，同一层内部墙的投影几乎连绵，层与层之间会出现明显的空带；
  // 用「空带宽度 vs 整张图跨度」切分，比按墙与墙两两距离聚类稳得多（大户型内部距离也很大）。
  function coverageBands(walls, ax) {
    var iv = walls.map(function (w) {
      return [Math.min(w.a[ax], w.b[ax]), Math.max(w.a[ax], w.b[ax])];
    }).sort(function (a, b) { return a[0] - b[0]; });
    var uni = [];
    for (var i = 0; i < iv.length; i++) {
      var r = iv[i], last = uni[uni.length - 1];
      if (last && r[0] <= last[1] + 2) last[1] = Math.max(last[1], r[1]);
      else uni.push([r[0], r[1]]);
    }
    return uni;
  }

  function splitRec(walls, opt, out, depth) {
    if (walls.length < opt.minWalls || depth > 5) { out.push(walls); return; }
    var bb = bboxOf(walls);
    var extent = Math.max(bb[2] - bb[0], bb[3] - bb[1], 1);
    var minBand = Math.max(opt.gap || 2200, extent * (opt.bandFrac || 0.06));
    var cut = null;
    for (var ax = 0; ax < 2; ax++) {
      var uni = coverageBands(walls, ax);
      for (var i = 1; i < uni.length; i++) {
        var band = uni[i][0] - uni[i - 1][1];
        if (band < minBand) continue;
        var mid = (uni[i][0] + uni[i - 1][1]) / 2;
        var lo = walls.filter(function (w) { return Math.max(w.a[ax], w.b[ax]) <= mid; });
        var hi = walls.filter(function (w) { return Math.min(w.a[ax], w.b[ax]) >= mid; });
        if (lo.length < opt.minWalls || hi.length < opt.minWalls) continue;
        if (!cut || band > cut.band) cut = { ax: ax, mid: mid, band: band, lo: lo, hi: hi };
      }
    }
    if (!cut) { out.push(walls); return; }
    splitRec(cut.lo, opt, out, depth + 1);
    splitRec(cut.hi, opt, out, depth + 1);
  }

  function splitFloors(walls, opt) {
    opt = opt || {};
    opt.minWalls = opt.minWalls || 4;
    var out = [];
    if (!walls || !walls.length) return { count: 0, multi: false, floors: [], groups: [] };
    splitRec(walls, opt, out, 0);
    out.sort(function (a, b) {
      var ba = bboxOf(a), bb2 = bboxOf(b);
      return (Math.round(ba[0] / 500) - Math.round(bb2[0] / 500)) || (Math.round(ba[1] / 500) - Math.round(bb2[1] / 500));
    });
    return {
      count: out.length,
      multi: out.length > 1,
      floors: out.map(function (ws, i) {
        var bb = bboxOf(ws);
        return { index: i, walls: ws.length, w: Math.round(bb[2] - bb[0]), h: Math.round(bb[3] - bb[1]), bbox: bb.map(Math.round) };
      }),
      groups: out
    };
  }

  // 每层各自挪回原点（并排画的图要各自归一，不然层与层差几万毫米）
  function reorigin(walls, pad) {
    pad = pad == null ? 300 : pad;
    var bb = bboxOf(walls);
    var dx = pad - bb[0], dy = pad - bb[1];
    return walls.map(function (w) {
      return {
        a: [Math.round(w.a[0] + dx), Math.round(w.a[1] + dy)],
        b: [Math.round(w.b[0] + dx), Math.round(w.b[1] + dy)],
        t: Math.round(w.t || 200),
        bearing: w.bearing !== false,
        ext: w.ext || null
      };
    });
  }

  // 多层 spec：一层一组墙，层高/层名可指定
  function toSpecMulti(results, names, opt) {
    opt = opt || {};
    var floors = results.map(function (walls, i) {
      return {
        name: (names && names[i]) || ['一层', '二层', '三层', '四层', '五层', '六层'][i] || ('第' + (i + 1) + '层'),
        height: (opt.heights && opt.heights[i]) || opt.height || 3000,
        walls: walls,
        autoElec: opt.autoElec === false ? false : true
      };
    });
    return {
      name: opt.name || '导入图纸（整栋）',
      slab: opt.slab || 120,
      base: 0,
      site: { city: opt.city || '成都', month: opt.month || 9 },
      floors: floors
    };
  }

  var API = {
    parse: parse, analyzeLayers: analyzeLayers, toSpec: toSpec, entities: entities,
    analyzeDims: analyzeDims, verifyDims: verifyDims, splitFloors: splitFloors,
    reorigin: reorigin, toSpecMulti: toSpecMulti, bboxOf: bboxOf
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.DSDXF = API;
})();
