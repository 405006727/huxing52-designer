#!/usr/bin/env node
/* 从安装好的 52户型装修设计 里解出前端源码（app.asar → 解包目录）
   用法：
     node tools/extract-app.mjs "C:\Users\你\AppData\Local\Programs\52户型装修设计\resources\app.asar"
     node tools/extract-app.mjs --dir "D:\52户型装修设计\resources\app.asar" --out ./unpacked
   依赖：首次会由 npx 自动拉 @electron/asar（需要 Node 18+ 与网络） */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, copyFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.resolve('unpacked');
const asar = args.find(a => a && !a.startsWith('--') && a !== (outIdx >= 0 ? args[outIdx + 1] : ''));

if (!asar || !existsSync(asar)) {
  console.error('用法：node tools/extract-app.mjs <resources/app.asar 路径> [--out 输出目录]');
  console.error('一般安装位置：%LOCALAPPDATA%\\Programs\\52户型装修设计\\resources\\app.asar');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
console.log('解包', asar, '→', outDir);
execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['--yes', '@electron/asar', 'extract', asar, outDir], { stdio: 'inherit' });

// 顺便把主题层和设计器本体拷到仓库对应位置（方便直接 npx electron . 跑起来）
const want = ['main.js', 'theme.css', 'theme-dark.css', path.join('app', 'designer.html'), path.join('app', 'dxf.js')];
for (const rel of want) {
  const src = path.join(outDir, rel);
  if (!existsSync(src)) continue;
  const dst = path.resolve(rel);
  mkdirSync(path.dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  console.log('已同步', rel, statSync(dst).size, 'bytes');
}
console.log('完成。之后 npm install && npx electron . 就能跑起来。');
