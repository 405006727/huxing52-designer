// 方案对账（结构 / 尺寸链 / 墙体往返）——桌面版菜单和命令行共用
// 依赖 app/dxf.js 的标注读取与墙体解析，不引入第三方库。
const DXF = require('./dxf.js');

function len(w) { return Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]); }
function mid(w) { return [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2]; }
function isHoriz(w) { return Math.abs(w.b[0] - w.a[0]) >= Math.abs(w.b[1] - w.a[1]); }

function pointOnWallDist(p, w) {
  const ax = w.a[0], ay = w.a[1], vx = w.b[0] - ax, vy = w.b[1] - ay;
  const L2 = vx * vx + vy * vy;
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - ax) * vx + (p[1] - ay) * vy) / L2)) : 0;
  return Math.hypot(p[0] - (ax + t * vx), p[1] - (ay + t * vy));
}

function overlapOf(a0, a1, b0, b1) {
  const lo = Math.max(Math.min(a0, a1), Math.min(b0, b1));
  const hi = Math.min(Math.max(a0, a1), Math.max(b0, b1));
  return Math.max(0, hi - lo);
}

// 结构检查：零长墙 / 重复墙 / 悬空端点 / 楼层雷同
function checkStructure(floors, opt) {
  opt = opt || {};
  const connTol = opt.connTol || 90, dupTol = opt.dupTol || 25, minLen = opt.minLen || 50;
  const out = { floors: [], errors: [], warnings: [] };
  floors.forEach((f, fi) => {
    const walls = f.walls || [];
    const short = [], dup = [], dangling = [];
    walls.forEach((w, i) => {
      const L = len(w);
      if (L < minLen) short.push({ i, len: Math.round(L) });
      for (let j = i + 1; j < walls.length; j++) {
        const v = walls[j];
        if (isHoriz(w) !== isHoriz(v)) continue;
        const sameOffset = isHoriz(w) ? Math.abs(mid(w)[1] - mid(v)[1]) : Math.abs(mid(w)[0] - mid(v)[0]);
        if (sameOffset > dupTol) continue;
        const a0 = isHoriz(w) ? w.a[0] : w.a[1], a1 = isHoriz(w) ? w.b[0] : w.b[1];
        const b0 = isHoriz(v) ? v.a[0] : v.a[1], b1 = isHoriz(v) ? v.b[0] : v.b[1];
        const ov = overlapOf(a0, a1, b0, b1);
        const minL = Math.min(L, len(v));
        if (minL > 0 && ov / minL > 0.75) dup.push({ a: i, b: j, offsetMm: Math.round(sameOffset) });
      }
      // 端点是否被别的墙接住
      [w.a, w.b].forEach((p, ei) => {
        let near = false;
        for (let k = 0; k < walls.length && !near; k++) {
          if (k === i) continue;
          if (pointOnWallDist(p, walls[k]) <= connTol) near = true;
        }
        if (!near) dangling.push({ i, end: ei ? 'b' : 'a', at: [Math.round(p[0]), Math.round(p[1])] });
      });
    });
    const info = {
      name: f.name || ('第' + (fi + 1) + '层'), walls: walls.length,
      shortWalls: short, duplicateWalls: dup, danglingEnds: dangling,
      bbox: walls.length ? DXF.bboxOf(walls).map(Math.round) : null,
      totalLengthMM: Math.round(walls.reduce((s, w) => s + len(w), 0))
    };
    out.floors.push(info);
    if (!walls.length) out.errors.push(`【${info.name}】没有任何墙体`);
    if (short.length) out.errors.push(`【${info.name}】${short.length} 段墙长度小于 ${minLen}mm`);
    if (dup.length > 2) out.warnings.push(`【${info.name}】${dup.length} 处墙体疑似重复（同位置、重叠 >75%）`);
    else if (dup.length) out.warnings.push(`【${info.name}】${dup.length} 处墙体疑似重复`);
    if (dangling.length) out.warnings.push(`【${info.name}】${dangling.length} 个墙端点没接上（可能漏墙或房间未闭合）`);
  });
  // 楼层雷同：两层墙数与总长完全一致 → 多半是复制没改
  if (floors.length > 1) {
    for (let i = 0; i < out.floors.length; i++) {
      for (let j = i + 1; j < out.floors.length; j++) {
        const a = out.floors[i], b = out.floors[j];
        if (a.walls === b.walls && a.totalLengthMM === b.totalLengthMM) {
          out.warnings.push(`【${a.name}】与【${b.name}】墙数/总长一致（${a.walls} 面 / ${a.totalLengthMM}mm），确认是否复制后未改`);
        }
      }
    }
  }
  return out;
}

// 墙体往返：拿 DXF 重解析一遍，和 spec 的墙比数量与外包尺寸
function checkRoundtrip(specFloors, dxfText, opt) {
  opt = opt || {};
  const layers = (opt.layers || []).slice();
  const res = DXF.parse(dxfText, { layers: layers.length ? layers : null });
  if (!res.ok) return { ok: false, error: res.error };
  const specWalls = specFloors.reduce((s, f) => s + (f.walls || []).length, 0);
  const dxfWalls = res.walls.length;
  const bboxD = res.walls.length ? DXF.bboxOf(res.walls) : [0, 0, 0, 0];
  const bboxS = specFloors.length && specFloors[0].walls && specFloors[0].walls.length ? DXF.bboxOf(specFloors[0].walls) : [0, 0, 0, 0];
  const diff = {
    walls: { dxf: dxfWalls, spec: specWalls, delta: specWalls - dxfWalls },
    widthMM: { dxf: Math.round(bboxD[2] - bboxD[0]), spec: Math.round(bboxS[2] - bboxS[0]) },
    depthMM: { dxf: Math.round(bboxD[3] - bboxD[1]), spec: Math.round(bboxS[3] - bboxS[1]) },
    layers: res.layers || (res.stats && res.stats.layers) || null
  };
  const wOk = Math.abs(diff.widthMM.dxf - diff.widthMM.spec) <= Math.max(60, diff.widthMM.dxf * 0.01);
  const dOk = Math.abs(diff.depthMM.dxf - diff.depthMM.spec) <= Math.max(60, diff.depthMM.dxf * 0.01);
  return { ok: res.ok, same: diff.walls.delta === 0 && wOk && dOk, ...diff, widthOk: wOk, depthOk: dOk };
}

function buildMarkdown(rep) {
  const L = [];
  L.push('# 方案对账报告');
  L.push('');
  L.push(`- 生成时间：${rep.generatedAt}`);
  L.push(`- 方案：${rep.plan.name || '未命名'}（${rep.plan.floors.length} 层）`);
  L.push(`- 结论：**${rep.verdict}**`);
  L.push('');
  L.push('## 一、逐层结构');
  L.push('');
  L.push('| 楼层 | 墙数 | 墙总长 | 外框尺寸 | 短墙 | 疑似重复 | 悬空端点 |');
  L.push('| --- | --- | --- | --- | --- | --- | --- |');
  rep.structure.floors.forEach(f => {
    const bb = f.bbox ? `${f.bbox[2] - f.bbox[0]}×${f.bbox[3] - f.bbox[1]}` : '—';
    L.push(`| ${f.name} | ${f.walls} | ${f.totalLengthMM} mm | ${bb} mm | ${f.shortWalls.length} | ${f.duplicateWalls.length} | ${f.danglingEnds.length} |`);
  });
  L.push('');
  if (rep.structure.errors.length || rep.structure.warnings.length) {
    L.push('### 问题清单');
    L.push('');
    rep.structure.errors.forEach(e => L.push(`- 阻塞：${e}`));
    rep.structure.warnings.forEach(e => L.push(`- 提示：${e}`));
    L.push('');
  }
  if (rep.dims) {
    L.push('## 二、尺寸标注对账');
    L.push('');
    L.push(`图上读到标注 ${rep.dims.total} 条（DIMENSION ${rep.dims.dimCount} / 文字 ${rep.dims.textCount}），可对账 ${rep.dims.checked} 条：一致 ${rep.dims.ok} 条，偏差 ${rep.dims.bad} 条，未匹配 ${rep.dims.unmatched} 条。`);
    L.push('');
    if (rep.dims.pairs.length) {
      L.push('| 标注 | 图长 | 差 | 判定 | 方向 | 位置 |');
      L.push('| --- | --- | --- | --- | --- | --- |');
      rep.dims.pairs.forEach(p => L.push(`| ${p['标注']} | ${p['图长']} | ${p['差']} | ${p['判定']} | ${p['方向']} | ${p['位置'].join(', ')} |`));
      L.push('');
    }
    L.push('> 标注只用于校核，不直接改墙：图上改过而标注没更新时，以实测图线为准，人工确认。');
    L.push('');
  }
  if (rep.roundtrip) {
    L.push('## 三、墙体往返');
    L.push('');
    if (rep.roundtrip.error) L.push(`解析失败：${rep.roundtrip.error}`);
    else {
      L.push(`- 墙数：DXF ${rep.roundtrip.walls.dxf} / 方案 ${rep.roundtrip.walls.spec}（差 ${rep.roundtrip.walls.delta}）`);
      L.push(`- 宽：DXF ${rep.roundtrip.widthMM.dxf}mm / 方案 ${rep.roundtrip.widthMM.spec}mm ${rep.roundtrip.widthOk ? '✅' : '❌'}`);
      L.push(`- 深：DXF ${rep.roundtrip.depthMM.dxf}mm / 方案 ${rep.roundtrip.depthMM.spec}mm ${rep.roundtrip.depthOk ? '✅' : '❌'}`);
      L.push(`- 一致：${rep.roundtrip.same ? '是' : '否'}`);
    }
    L.push('');
  }
  L.push('## 四、口径说明');
  L.push('');
  L.push('- 只做几何与数量对账，不含结构安全、水电承重、消防等专业结论，这些需专业人员复核。');
  L.push('- 尺寸以标注为准与国家制图习惯一致，但标注与图线冲突时以「差」值列出，由人判断。');
  return L.join('\n');
}

function audit(opts) {
  opts = opts || {};
  const spec = opts.spec || { name: '未命名', floors: [] };
  const floors = (spec.floors || []).map((f, i) => ({ name: f.name || ('第' + (i + 1) + '层'), walls: f.walls || [] }));
  const structure = checkStructure(floors, opts);
  let dims = null, roundtrip = null;
  const allWalls = floors.reduce((s, f) => s.concat(f.walls), []);
  if (opts.dxfText) {
    const d = DXF.analyzeDims(opts.dxfText);
    const vr = DXF.verifyDims(allWalls, d);
    dims = {
      total: d.total, dimCount: d.dims.length, textCount: d.texts.length, skipped: d.skipped,
      checked: vr.checked, ok: vr.ok, bad: vr.badFlag, unmatched: vr.unmatched, nonOrtho: vr.skipped,
      pairs: vr.pairs
    };
    roundtrip = checkRoundtrip(floors, opts.dxfText, { layers: opts.layers });
  }
  const rep = {
    generatedAt: opts.now || new Date().toISOString().replace('T', ' ').slice(0, 19),
    plan: { name: spec.name, floors: floors.map(f => ({ name: f.name, walls: (f.walls || []).length })) },
    structure, dims, roundtrip,
    verdict: ''
  };
  const badDims = dims ? dims.bad : 0;
  const rtBad = roundtrip && !roundtrip.error && !roundtrip.same;
  rep.verdict = structure.errors.length ? '需修改（有阻塞项）'
    : (structure.warnings.length || badDims || rtBad) ? '可用，有提示项需人工确认'
      : '通过';
  rep.markdown = buildMarkdown(rep);
  return rep;
}

module.exports = { audit, checkStructure, checkRoundtrip, buildMarkdown };
