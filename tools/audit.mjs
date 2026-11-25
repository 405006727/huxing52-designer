// 方案对账 CLI：node tools/audit.mjs --spec plan.json [--dxf 图纸.dxf] [--layers WALL] [--out build/audit]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const AUDIT = require('../app/audit.js');
const DXF = require('../app/dxf.js');

const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}

const specFile = arg('spec', arg('plan'));
if (!specFile) {
  console.error('用法：node tools/audit.mjs --spec <方案或spec.json> [--dxf <图纸.dxf>] [--layers WALL] [--out <输出目录>]');
  process.exit(2);
}
const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
// 兼容设计器导出的 building（floors[].walls）与 spec（floors[].walls）两种
const dxfFile = arg('dxf');
let dxfText = null, layers = null;
if (dxfFile) {
  dxfText = fs.readFileSync(dxfFile, 'utf8');
  const picked = arg('layers');
  if (picked) layers = picked.split(/[,，\s]+/).filter(Boolean);
  else {
    const ls = DXF.analyzeLayers(dxfText);
    const guess = (ls.layers || []).filter(l => /WALL|墙/i.test(l.layer)).map(l => l.layer);
    layers = guess.length ? guess : null;
  }
}

const rep = AUDIT.audit({ spec, dxfText, layers });
const outDir = arg('out', path.join(process.cwd(), 'build', 'audit'));
fs.mkdirSync(outDir, { recursive: true });
const base = path.basename(specFile).replace(/\.json$/i, '');
fs.writeFileSync(path.join(outDir, base + '-report.json'), JSON.stringify(rep, null, 1));
fs.writeFileSync(path.join(outDir, base + '-report.md'), rep.markdown);

console.log(rep.markdown);
console.log('\n报告已写入：' + outDir);
process.exit(rep.structure.errors.length ? 1 : 0);
