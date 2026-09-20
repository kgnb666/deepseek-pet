#!/usr/bin/env node
/**
 * 动画素材交付校验（规格见 docs/ANIMATION_ASSETS_SPEC.md）。
 * 用法：node tools/validate-anim-assets.mjs [目录=assets/animations]
 * 校验：统一画布 / 帧命名连续 / RGBA 透明 / 锚点一致（最底部不透明像素行，误差≤2px）。
 * 只依赖 node 内置模块（PNG 解码用 zlib + 手写 unfilter，支持 8-bit RGB/RGBA 非隔行）。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = process.argv[2] || path.join(root, 'assets', 'animations');

function readPNG(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8;
  let w = 0;
  let h = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) {
    return { w, h, colorType, skip: `bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}` };
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const row = raw.subarray(p, p + stride);
    p += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = x >= bpp && prev ? prev[x - bpp] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  // 锚点 = 最底部存在不透明像素的行（从最后一行向上找）
  let anchorRow = -1;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      const a = colorType === 6 ? out[y * stride + x * 4 + 3] : 255;
      if (a > 16) {
        anchorRow = y;
        break;
      }
    }
    if (anchorRow >= 0) break;
  }
  return { w, h, colorType, anchorRow };
}

const problems = [];
const notes = [];
const states = fs.existsSync(dir) ? fs.readdirSync(dir).filter((s) => fs.statSync(path.join(dir, s)).isDirectory()) : [];
let checked = 0;
let canvasRef = null;

for (const state of states.sort()) {
  const stateDir = path.join(dir, state);
  const segs = fs.readdirSync(stateDir).filter((s) => fs.statSync(path.join(stateDir, s)).isDirectory());
  for (const seg of segs) {
    const files = fs.readdirSync(path.join(dir, state, seg)).filter((f) => f.endsWith('.png')).sort();
    if (files.length === 0) {
      problems.push(`${state}/${seg}: 目录里没有 PNG 帧`);
      continue;
    }
    checked += files.length;
    let sizeRef = null;
    let anchorMin = Infinity;
    let anchorMax = -Infinity;
    let alphaWarn = false;
    for (const f of files) {
      let info;
      try {
        info = readPNG(path.join(dir, state, seg, f));
      } catch (e) {
        problems.push(`${state}/${seg}/${f}: 解析失败 ${e.message}`);
        continue;
      }
      if (info.skip) {
        notes.push(`${state}/${seg}/${f}: 跳过像素校验（${info.skip}），仅查尺寸`);
      }
      if (!sizeRef) sizeRef = `${info.w}x${info.h}`;
      else if (sizeRef !== `${info.w}x${info.h}`) problems.push(`${state}/${seg}/${f}: 尺寸 ${info.w}x${info.h} 与该段 ${sizeRef} 不一致`);
      if (!canvasRef) canvasRef = `${info.w}x${info.h}`;
      else if (canvasRef !== `${info.w}x${info.h}`) problems.push(`${state}/${seg}/${f}: 画布 ${info.w}x${info.h} 与全局 ${canvasRef} 不一致`);
      if (info.colorType !== 6) alphaWarn = true;
      if (typeof info.anchorRow === 'number' && info.anchorRow >= 0) {
        anchorMin = Math.min(anchorMin, info.anchorRow);
        anchorMax = Math.max(anchorMax, info.anchorRow);
      }
    }
    if (alphaWarn) notes.push(`${state}/${seg}: 存在非 RGBA 帧（无透明通道？请导出 RGBA）`);
    if (anchorMax - anchorMin > 2) {
      problems.push(`${state}/${seg}: 锚点漂移 ${anchorMax - anchorMin}px（脚底位置在帧间不一致，上限 2px）`);
    }
    // 帧号连续性
    const nums = files.map((f) => Number(/(\d+)\.png$/.exec(f)?.[1] ?? NaN)).filter(Number.isFinite);
    if (nums.length > 1 && nums.at(-1) - nums[0] !== nums.length - 1) {
      notes.push(`${state}/${seg}: 帧号不连续（${nums[0]}..${nums.at(-1)} 共 ${nums.length} 帧）——确认是否有意跳帧`);
    }
    console.log(`✔ ${state}/${seg}: ${files.length} 帧 ${sizeRef} 锚点行 ${anchorMin}..${anchorMax}`);
  }
}

if (fs.existsSync(dir)) {
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.webm'))) {
    notes.push(`${f}: WebM 素材，跳过自动校验（请确认 VP9 + yuva420p 带 alpha）`);
  }
}

console.log(`\n已检查 ${checked} 帧 / ${states.length} 个状态目录`);
for (const n of notes) console.log(`ℹ ${n}`);
if (problems.length) {
  console.log(`\n✖ ${problems.length} 个问题：`);
  for (const p of problems) console.log(`  ✖ ${p}`);
  process.exit(1);
}
if (checked === 0) {
  console.log('（目录为空——把素材按 docs/ANIMATION_ASSETS_SPEC.md 放进来后再跑）');
}
