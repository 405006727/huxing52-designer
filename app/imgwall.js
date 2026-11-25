// ===== 52户型装修设计 · 桌面版：位图户型识墙模块 =====
// 纯 JS、零依赖、不联网。把户型图（PNG/JPG 截图、售楼处户型图、酷家乐效果图）里
// 的墙线估成「墙中线 + 墙厚」，输出像素坐标，再由调用方按用户填的实际尺寸换算成毫米。
//
// 两条互补的取墙路径，结果最后合并去重：
//   ① 实心墙（涂黑/灰填充、粗描边）：先做距离变换去掉细线（文字、家具、尺寸线），
//      只留「够粗」的笔画，再按行/列游程切成横墙、竖墙，测量厚度。
//   ② 双线墙（两条 1~2px 细线夹白）：细线游程 + 平行配对（间距 4~22px、
//      长度相近、重叠 ≥70%），中点即墙中线，间距即墙厚。
// 最后统一过一遍：长度/厚度过滤、同线去重、端点吸附。
// 单测：node build/unit_imgwall.js <w> <h> <gray 文件>

(function () {
  'use strict';

  var INF = 1e9;

  /* ------------------------------- 基础工具 -------------------------------- */
  function toGrayFromRGBA(rgba, w, h) {
    // 透明按白底合成（截图导出常带 alpha）
    var gray = new Uint8Array(w * h);
    for (var i = 0, p = 0; i < w * h; i++, p += 4) {
      var a = rgba[p + 3] === undefined ? 255 : rgba[p + 3];
      var r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
      if (a < 255) {
        var k = a / 255;
        r = Math.round(r * k + 255 * (1 - k));
        g = Math.round(g * k + 255 * (1 - k));
        b = Math.round(b * k + 255 * (1 - k));
      }
      gray[i] = (r * 299 + g * 587 + b * 114) / 1000;
    }
    return gray;
  }

  function medianOf(arr) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    return s[Math.floor(s.length / 2)];
  }

  // 四边采样判断背景亮度，深底（黑底 CAD 截图）自动反相
  function normalizePolarity(gray, w, h) {
    var samples = [];
    var step = Math.max(1, Math.floor((w + h) / 400));
    for (var x = 0; x < w; x += step) { samples.push(gray[x], gray[(h - 1) * w + x]); }
    for (var y = 0; y < h; y += step) { samples.push(gray[y * w], gray[y * w + w - 1]); }
    var bg = medianOf(samples);
    var inverted = bg < 110;
    var out = new Uint8Array(gray.length);
    for (var i = 0; i < gray.length; i++) out[i] = inverted ? 255 - gray[i] : gray[i];
    return { gray: out, inverted: inverted, bg: bg };
  }

  // Otsu 阈值
  function otsu(gray) {
    var hist = new Float64Array(256);
    for (var i = 0; i < gray.length; i++) hist[gray[i]]++;
    var total = gray.length, sum = 0;
    for (var t = 0; t < 256; t++) sum += t * hist[t];
    var wB = 0, sumB = 0, best = 0, thr = 128;
    for (var k = 0; k < 256; k++) {
      wB += hist[k];
      if (!wB) continue;
      var wF = total - wB;
      if (!wF) break;
      sumB += k * hist[k];
      var mB = sumB / wB, mF = (sum - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = k; }
    }
    return thr;
  }

  function buildInk(gray, w, h, thr) {
    var ink = new Uint8Array(w * h);
    var count = 0;
    for (var i = 0; i < gray.length; i++) {
      if (gray[i] < thr) { ink[i] = 1; count++; }
    }
    return { ink: ink, count: count, thr: thr };
  }

  // 距离变换（两遍扫描，8 邻域 chamfer）
  function distanceTransform(ink, w, h) {
    var d = new Float32Array(w * h);
    for (var i = 0; i < w * h; i++) d[i] = ink[i] ? INF : 0;
    var A = 1, B = 1.4142;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var idx = y * w + x;
        if (!d[idx]) continue;
        var m = d[idx];
        if (x > 0) m = Math.min(m, d[idx - 1] + A);
        if (y > 0) {
          m = Math.min(m, d[idx - w] + A);
          if (x > 0) m = Math.min(m, d[idx - w - 1] + B);
          if (x < w - 1) m = Math.min(m, d[idx - w + 1] + B);
        }
        d[idx] = m;
      }
    }
    for (var y2 = h - 1; y2 >= 0; y2--) {
      for (var x2 = w - 1; x2 >= 0; x2--) {
        var i2 = y2 * w + x2;
        if (!d[i2]) continue;
        var m2 = d[i2];
        if (x2 < w - 1) m2 = Math.min(m2, d[i2 + 1] + A);
        if (y2 < h - 1) {
          m2 = Math.min(m2, d[i2 + w] + A);
          if (x2 < w - 1) m2 = Math.min(m2, d[i2 + w + 1] + B);
          if (x2 > 0) m2 = Math.min(m2, d[i2 + w - 1] + B);
        }
        d[i2] = m2;
      }
    }
    return d;
  }

  /* ---------------------------- 游程 → 线段候选 ---------------------------- */
  // 逐列（vertical=true）或逐行求连续游程；再把相邻列/行上位置相近的游程并成一条
  function runsToBars(mask, w, h, vertical, minLen, maxThk) {
    var bars = [];
    if (vertical) {
      var active = []; // {x0,x1,y0,y1}
      for (var x = 0; x < w; x++) {
        var runs = [];
        var y = 0;
        while (y < h) {
          if (mask[y * w + x]) {
            var y0 = y;
            while (y < h && mask[y * w + x]) y++;
            if (y - y0 >= minLen) runs.push([y0, y - 1]);
          } else y++;
        }
        active = closeBars(active, runs, x, 'v');
        bars = bars.concat(active.closed || []);
        active.closed = null;
        active = active.open || [];
      }
      bars = bars.concat(active || []);
    } else {
      var activeH = [];
      for (var yy = 0; yy < h; yy++) {
        var runsH = [];
        var x2 = 0;
        while (x2 < w) {
          if (mask[yy * w + x2]) {
            var x0 = x2;
            while (x2 < w && mask[yy * w + x2]) x2++;
            if (x2 - x0 >= minLen) runsH.push([x0, x2 - 1]);
          } else x2++;
        }
        var wrapped = closeBars(activeH, runsH, yy, 'h');
        bars = bars.concat(wrapped.closed || []);
        activeH = wrapped.open || [];
      }
      bars = bars.concat(activeH || []);
    }
    return bars.filter(function (b) {
      var a0 = vertical ? b.y0 : b.x0, a1 = vertical ? b.y1 : b.x1;
      var t0 = vertical ? b.x0 : b.y0, t1 = vertical ? b.x1 : b.y1;
      return (t1 - t0 + 1) <= maxThk && (a1 - a0 + 1) >= minLen;
    });

    // 把当前坐标上的 runs 与上一条同位置的 bar 合并；不匹配的先关掉
    function closeBars(open, runs, pos, kind) {
      var closed = [], nextOpen = [];
      for (var i = 0; i < open.length; i++) open[i].matched = false;
      for (var r = 0; r < runs.length; r++) {
        var a0 = runs[r][0], a1 = runs[r][1], hit = null;
        for (var k = 0; k < open.length; k++) {
          var b = open[k];
          if (b.matched) continue;
          var ov = Math.min(b.a1, a1) - Math.max(b.a0, a0) + 1;
          var lenMin = Math.min(b.a1 - b.a0 + 1, a1 - a0 + 1);
          var near = Math.abs(b.a0 - a0) <= 2 && Math.abs(b.a1 - a1) <= 2;
          if (near || ov >= lenMin * 0.6) { hit = b; break; }
        }
        if (hit) {
          hit.matched = true;
          hit.a0 = Math.min(hit.a0, a0);
          hit.a1 = Math.max(hit.a1, a1);
          hit.axis1 = pos;
          if (kind === 'v') { hit.y0 = hit.a0; hit.y1 = hit.a1; hit.x1 = pos; }
          else { hit.x0 = hit.a0; hit.x1 = hit.a1; hit.y1 = pos; }
          nextOpen.push(hit);
        } else {
          nextOpen.push(kind === 'v'
            ? { x0: pos, x1: pos, y0: a0, y1: a1, a0: a0, a1: a1, axis0: pos, axis1: pos }
            : { y0: pos, y1: pos, x0: a0, x1: a1, a0: a0, a1: a1, axis0: pos, axis1: pos });
        }
      }
      for (var j = 0; j < open.length; j++) {
        if (!open[j].matched) closed.push(open[j]);
      }
      return { closed: closed, open: nextOpen };
    }
  }

  function barLen(b, vertical) {
    return (vertical ? (b.y1 - b.y0) : (b.x1 - b.x0)) + 1;
  }
  function barThk(b, vertical) {
    return (vertical ? (b.x1 - b.x0) : (b.y1 - b.y0)) + 1;
  }
  function barMid(b, vertical) {
    return vertical ? (b.x0 + b.x1) / 2 : (b.y0 + b.y1) / 2;
  }
  function barA0(b, vertical) { return vertical ? b.y0 : b.x0; }
  function barA1(b, vertical) { return vertical ? b.y1 : b.x1; }

  /* -------------------------- 双线墙：细线平行配对 -------------------------- */
  function pairThinBars(thinBars, vertical, minGap, maxGap) {
    var out = [];
    var used = [];
    for (var i = 0; i < thinBars.length; i++) {
      if (used[i]) continue;
      var a = thinBars[i], la = barLen(a, vertical), ma = barMid(a, vertical);
      var best = null;
      for (var j = i + 1; j < thinBars.length; j++) {
        if (used[j]) continue;
        var b = thinBars[j], lb = barLen(b, vertical), mb = barMid(b, vertical);
        var gap = Math.abs(mb - ma);
        if (gap < minGap || gap > maxGap) continue;
        var ov = Math.min(barA1(a, vertical), barA1(b, vertical)) - Math.max(barA0(a, vertical), barA0(b, vertical)) + 1;
        var lenMin = Math.min(la, lb);
        if (ov < lenMin * 0.7) continue;
        if (Math.abs(la - lb) > Math.max(8, lenMin * 0.25)) continue;
        var score = ov / lenMin - gap / maxGap;
        if (!best || score > best.score) best = { j: j, score: score, gap: gap,
          a0: Math.max(barA0(a, vertical), barA0(b, vertical)),
          a1: Math.min(barA1(a, vertical), barA1(b, vertical)),
          mid: (ma + mb) / 2 };
      }
      if (best) {
        used[i] = used[best.j] = true;
        var c = best.mid, t = Math.max(2, Math.round(best.gap));
        out.push(vertical
          ? { x0: c - t / 2, x1: c + t / 2, y0: best.a0, y1: best.a1 }
          : { y0: c - t / 2, y1: c + t / 2, x0: best.a0, x1: best.a1 });
      }
    }
    return out;
  }

  /* ------------------------------- 去重 ----------------------------------- */
  function dedupeBars(bars, vertical) {
    var out = [];
    for (var i = 0; i < bars.length; i++) {
      var w = bars[i], dup = false;
      for (var k = 0; k < out.length; k++) {
        var o = out[k];
        var dMid = Math.abs(barMid(o, vertical) - barMid(w, vertical));
        if (dMid > Math.max(barThk(o, vertical), barThk(w, vertical)) * 0.9 + 2) continue;
        var ov = Math.min(barA1(o, vertical), barA1(w, vertical)) - Math.max(barA0(o, vertical), barA0(w, vertical)) + 1;
        var lenMin = Math.min(barLen(o, vertical), barLen(w, vertical));
        if (ov < lenMin * 0.6) continue;
        dup = true;
        // 留下更长更粗的那条
        if (barLen(w, vertical) * (1 + barThk(w, vertical) / 50) > barLen(o, vertical) * (1 + barThk(o, vertical) / 50)) out[k] = w;
        break;
      }
      if (!dup) out.push(w);
    }
    return out;
  }

  /* --------------- 用原始墨迹校正墙厚与中线（距离变换只留了墙芯） --------------- */
  function refineWalls(walls, ink, w, h) {
    // 在一条墙的 30% / 50% / 70% 位置各量一次厚度，取中位数——避开交叉口附近的加粗
    function sampleV(yc, xc) {
      if (yc < 0 || yc >= h) return null;
      var sx = -1;
      for (var d = 0; d <= 8 && sx < 0; d++) {
        if (xc - d >= 0 && ink[yc * w + xc - d]) sx = xc - d;
        else if (xc + d < w && ink[yc * w + xc + d]) sx = xc + d;
      }
      if (sx < 0) return null;
      var xa = sx, xb = sx;
      while (xa - 1 >= 0 && ink[yc * w + xa - 1]) xa--;
      while (xb + 1 < w && ink[yc * w + xb + 1]) xb++;
      return { t: xb - xa + 1, c: (xa + xb) / 2 };
    }
    function sampleH(xc, yc) {
      if (xc < 0 || xc >= w) return null;
      var sy = -1;
      for (var d = 0; d <= 8 && sy < 0; d++) {
        if (yc - d >= 0 && ink[(yc - d) * w + xc]) sy = yc - d;
        else if (yc + d < h && ink[(yc + d) * w + xc]) sy = yc + d;
      }
      if (sy < 0) return null;
      var ya = sy, yb = sy;
      while (ya - 1 >= 0 && ink[(ya - 1) * w + xc]) ya--;
      while (yb + 1 < h && ink[(yb + 1) * w + xc]) yb++;
      return { t: yb - ya + 1, c: (ya + yb) / 2 };
    }
    function median3(list) {
      var v = list.filter(function (x) { return x; }).sort(function (a, b) { return a - b; });
      return v.length ? v[Math.floor(v.length / 2)] : null;
    }

    walls.forEach(function (o) {
      if (o.dir === 'v') {
        var ys = [o.y0 + (o.y1 - o.y0) * 0.3, (o.y0 + o.y1) / 2, o.y0 + (o.y1 - o.y0) * 0.7];
        var xs2 = ys.map(function (yy) { return sampleV(Math.round(yy), Math.round(o.x)); });
        var t2 = median3(xs2.map(function (s) { return s && s.t; }));
        if (t2) {
          o.t = t2;
          var cs = xs2.filter(Boolean).map(function (s) { return s.c; }).sort(function (a, b) { return a - b; });
          if (cs.length) o.x = cs[Math.floor(cs.length / 2)];
        }
        // 端点向两侧延伸（贴到交叉处），最多延 3 倍墙厚
        var lim = Math.max(6, Math.round(o.t * 3));
        var tx = Math.round(o.x), e = 0;
        while (e < lim && o.y0 - 1 >= 0 && ink[(o.y0 - 1) * w + tx]) { o.y0--; e++; }
        e = 0;
        while (e < lim && o.y1 + 1 < h && ink[(o.y1 + 1) * w + tx]) { o.y1++; e++; }
      } else {
        var xs3 = [o.x0 + (o.x1 - o.x0) * 0.3, (o.x0 + o.x1) / 2, o.x0 + (o.x1 - o.x0) * 0.7];
        var ys3 = xs3.map(function (xx) { return sampleH(Math.round(xx), Math.round(o.y)); });
        var t3 = median3(ys3.map(function (s) { return s && s.t; }));
        if (t3) {
          o.t = t3;
          var cs2 = ys3.filter(Boolean).map(function (s) { return s.c; }).sort(function (a, b) { return a - b; });
          if (cs2.length) o.y = cs2[Math.floor(cs2.length / 2)];
        }
        var lim2 = Math.max(6, Math.round(o.t * 3));
        var ty = Math.round(o.y), e2 = 0;
        while (e2 < lim2 && o.x0 - 1 >= 0 && ink[ty * w + (o.x0 - 1)]) { o.x0--; e2++; }
        e2 = 0;
        while (e2 < lim2 && o.x1 + 1 < w && ink[ty * w + (o.x1 + 1)]) { o.x1++; e2++; }
      }
    });
    return walls;
  }

  /* ----------------------------- 主识别流程 --------------------------------- */
  function detect(gray, w, h, opt) {
    opt = opt || {};
    var norm = normalizePolarity(gray, w, h);
    var thr = opt.thr || otsu(norm.gray);
    var inkInfo = buildInk(norm.gray, w, h, thr);
    var ink = inkInfo.ink;
    var inkRatio = inkInfo.count / (w * h);
    if (inkRatio < 0.012) {
      return { ok: false, error: '这张图像素里几乎读不到线条（墨迹只有 ' + (inkRatio * 100).toFixed(1) + '%），换一张清晰的户型图试试' };
    }

    var minSide = Math.min(w, h);
    var maxSide = Math.max(w, h);
    // 笔画粗度下限：细线（1~3px）先剔掉
    var thinMax = Math.max(3, Math.round(maxSide / 900));
    var thickMin = thinMax + 1;
    var maxThk = Math.max(6, Math.round(maxSide * 0.012));
    var minLenPx = Math.max(14, Math.round(minSide * 0.02));

    // ① 实心墙路径：距离变换 → 只留粗笔画
    var dist = distanceTransform(ink, w, h);
    var core = new Uint8Array(w * h);
    for (var i = 0; i < w * h; i++) core[i] = dist[i] >= thickMin ? 1 : 0;
    var barsV = runsToBars(core, w, h, true, Math.max(minLenPx, thickMin * 3), maxThk);
    var barsH = runsToBars(core, w, h, false, Math.max(minLenPx, thickMin * 3), maxThk);

    // ② 双线墙路径：细线配对（把细线层单独拿出来）
    var thinMask = new Uint8Array(w * h);
    for (var j = 0; j < w * h; j++) {
      thinMask[j] = (ink[j] && dist[j] <= thickMin) ? 1 : 0;
    }
    var thinV = runsToBars(thinMask, w, h, true, Math.max(minLenPx, 24), 3);
    var thinH = runsToBars(thinMask, w, h, false, Math.max(minLenPx, 24), 3);
    var pairMinGap = Math.max(3, Math.round(maxSide / 400));
    var pairMaxGap = Math.max(8, Math.round(maxSide / 120));
    var pairedV = pairThinBars(thinV, true, pairMinGap, pairMaxGap);
    var pairedH = pairThinBars(thinH, false, pairMinGap, pairMaxGap);

    var vAll = dedupeBars(barsV.concat(pairedV), true);
    var hAll = dedupeBars(barsH.concat(pairedH), false);

    // 太短 / 太细的丢掉；横竖都满足的保留（墙埛很常见）
    var keptV = vAll.filter(function (b) { return barLen(b, true) >= minLenPx && barThk(b, true) >= 1.5; });
    var keptH = hAll.filter(function (b) { return barLen(b, false) >= minLenPx && barThk(b, false) >= 1.5; });

    // 主方向去重之后，把「横墙的厚度 → 短竖条」这类伪墙再查一遍
    var walls = [];
    keptV.forEach(function (b) { walls.push({ dir: 'v', x: barMid(b, true), y0: b.y0, y1: b.y1, t: barThk(b, true) }); });
    keptH.forEach(function (b) { walls.push({ dir: 'h', y: barMid(b, false), x0: b.x0, x1: b.x1, t: barThk(b, false) }); });

    // 统计：墙厚中位数、外框
    walls = refineWalls(walls, ink, w, h);
    var tMed = medianOf(walls.map(function (o) { return o.t; })) || 2;
    walls = walls.filter(function (o) {
      var len = o.dir === 'v' ? (o.y1 - o.y0 + 1) : (o.x1 - o.x0 + 1);
      return len >= Math.max(minLenPx, tMed * 2.2) && o.t >= 1.5;
    });

    var minx = INF, miny = INF, maxx = -INF, maxy = -INF;
    walls.forEach(function (o) {
      if (o.dir === 'v') { minx = Math.min(minx, o.x - o.t / 2); maxx = Math.max(maxx, o.x + o.t / 2); miny = Math.min(miny, o.y0); maxy = Math.max(maxy, o.y1); }
      else { miny = Math.min(miny, o.y - o.t / 2); maxy = Math.max(maxy, o.y + o.t / 2); minx = Math.min(minx, o.x0); maxx = Math.max(maxx, o.x1); }
    });

    return {
      ok: walls.length >= 3,
      error: walls.length >= 3 ? null : '只认出 ' + walls.length + ' 面墙，图上墙体可能太细或线条太杂',
      walls: walls,
      inverted: norm.inverted,
      thr: thr,
      inkRatio: Number(inkRatio.toFixed(4)),
      thicknessPx: tMed,
      bboxPx: walls.length ? { x0: minx, y0: miny, x1: maxx, y1: maxy, w: maxx - minx, h: maxy - miny } : null,
    };
  }

  /* -------------------- 像素墙 → 毫米墙（交给设计器） ---------------------- */
  // mmPerPx 由用户填的实际尺寸算出；输出格式与 app/dxf.js 的 walls 一致（墙中线 a/b + 厚度 t）
  function toMillisWalls(pxWalls, mmPerPx, opt) {
    opt = opt || {};
    var tCap = opt.maxThick || 400, tFloor = opt.minThick || 60;
    // 户型图上墙厚一般是一致的：取中位厚度统一用，避免个别墙在交叉处被量成两倍粗
    var ts = pxWalls.map(function (o) { return o.t; }).sort(function (a, b) { return a - b; });
    var tPx = ts.length ? ts[Math.floor(ts.length / 2)] : 0;
    var tUni = Math.max(tFloor, Math.min(tCap, Math.round(tPx * mmPerPx / 10) * 10));
    var raw = pxWalls.map(function (o) {
      var t = opt.uniform === false ? Math.max(tFloor, Math.min(tCap, Math.round(o.t * mmPerPx / 10) * 10)) : tUni;
      if (o.dir === 'v') {
        return { a: [o.x * mmPerPx, o.y0 * mmPerPx], b: [o.x * mmPerPx, o.y1 * mmPerPx], t: t };
      }
      return { a: [o.x0 * mmPerPx, o.y * mmPerPx], b: [o.x1 * mmPerPx, o.y * mmPerPx], t: t };
    });
    // 原点挪到左上留 300mm；坐标取整
    var minx = INF, miny = INF;
    raw.forEach(function (w) {
      minx = Math.min(minx, w.a[0], w.b[0]);
      miny = Math.min(miny, w.a[1], w.b[1]);
    });
    var dx = 300 - minx, dy = 300 - miny;
    return raw.map(function (w) {
      return {
        a: [Math.round((w.a[0] + dx) * 10) / 10, Math.round((w.a[1] + dy) * 10) / 10],
        b: [Math.round((w.b[0] + dx) * 10) / 10, Math.round((w.b[1] + dy) * 10) / 10],
        t: w.t,
      };
    });
  }

  var API = { detect: detect, toMillisWalls: toMillisWalls, toGrayFromRGBA: toGrayFromRGBA, otsu: otsu };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.DSIMG = API;
})();
