/**
 * 只读测量：解析素材包里的七张透明 PNG，报告真实 alpha 内容框与关键行/列的 alpha 分布。
 * 不修改任何素材文件，也不修改 src/。
 *
 * 目的：素材说明写明「各图画布尺寸不一致，未统一缩放」，
 * 所以必须按 alpha 内容框（而不是画布尺寸）来定角色的显示比例与安全范围。
 *
 * 运行：node tools/measure-cat-png.mjs [素材目录]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

/** 解码 8bit 非隔行 PNG，返回 {w,h,gray}，gray 为 0~255 的 alpha 通道 */
function decodeAlpha(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let off = 8;
  let ihdr = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        w: data.readUInt32BE(0),
        h: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr) throw new Error('缺 IHDR');
  const { w, h, bitDepth, colorType, interlace } = ihdr;
  if (bitDepth !== 8) throw new Error(`暂不支持 bitDepth=${bitDepth}`);
  if (interlace !== 0) throw new Error('暂不支持隔行 PNG');
  const chan = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!chan) throw new Error(`暂不支持 colorType=${colorType}`);
  const ai = { 0: 0, 2: -1, 3: -1, 4: 1, 6: 3 }[colorType];

  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * chan;
  const out = Buffer.alloc(stride * h);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[p++];
    const line = raw.subarray(p, p + stride);
    p += stride;
    const cur = out.subarray(y * stride, y * stride + stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= chan ? cur[x - chan] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= chan ? prev[x - chan] : 0;
      let v = line[x];
      switch (ft) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const pp = a + b - c;
          const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error(`未知 filter ${ft}`);
      }
      cur[x] = v & 0xff;
    }
  }
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = ai < 0 ? 255 : out[i * chan + ai];
  return { w, h, colorType, gray };
}

const THRESH = 16; // 忽略近乎全透明的碎屑

function measure(file) {
  const { w, h, colorType, gray } = decodeAlpha(readFileSync(file));
  let x0 = w, y0 = h, x1 = -1, y1 = -1, sum = 0;
  const rowSum = new Float64Array(h);
  const colSum = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = gray[y * w + x];
      if (a <= THRESH) continue;
      sum += a; rowSum[y] += a; colSum[x] += a;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { file: file.split(/[\\/]/).pop(), w, h, colorType, empty: true };

  // 上半 25% / 下半 25% 的 alpha 质量分布：用来判断头（含耳/角）与身体的比例
  const boxH = y1 - y0 + 1;
  const q = (lo, hi) => {
    let s = 0;
    for (let y = Math.round(y0 + boxH * lo); y <= Math.round(y0 + boxH * hi); y++) s += rowSum[y];
    return sum > 0 ? s / sum : 0;
  };
  // 极值出现的位置（顶端尖角 / 左右翼尖）
  const firstRow = (() => { for (let y = y0; y <= y1; y++) if (rowSum[y] > 0) return y; return y0; })();
  const lastRow = (() => { for (let y = y1; y >= y0; y--) if (rowSum[y] > 0) return y; return y1; })();
  const firstCol = (() => { for (let x = x0; x <= x1; x++) if (colSum[x] > 0) return x; return x0; })();
  const lastCol = (() => { for (let x = x1; x >= x0; x--) if (colSum[x] > 0) return x; return x1; })();
  // 触底检测：最后一行内容是否真的落在画布底边（决定锚点能否直接贴底）
  const touchBottom = y1 >= h - 2;
  const touchTop = y0 <= 1;
  return {
    file: file.split(/[\\/]/).pop(), w, h, colorType,
    box: [x0, y0, x1, y1], bw: x1 - x0 + 1, bh: y1 - y0 + 1,
    fillW: +((x1 - x0 + 1) / w).toFixed(3), fillH: +((y1 - y0 + 1) / h).toFixed(3),
    padTop: y0, padBot: h - 1 - y1, padL: x0, padR: w - 1 - x1,
    ar: +((x1 - x0 + 1) / (y1 - y0 + 1)).toFixed(3),
    massTop25: +q(0, 0.25).toFixed(3), massBot25: +q(0.75, 1).toFixed(3),
    massTop50: +q(0, 0.5).toFixed(3),
    firstRow, lastRow, firstCol, lastCol, touchBottom, touchTop,
  };
}

const dir = process.argv[2] ?? 'assets/cats';
const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png')).sort();
console.log(`素材目录：${dir}　共 ${files.length} 张\n`);
const rows = files.map((f) => measure(join(dir, f)));
for (const r of rows) {
  console.log(`── ${r.file}`);
  if (r.empty) { console.log('   全透明'); continue; }
  console.log(`   画布        ${r.w} × ${r.h}   colorType=${r.colorType}`);
  console.log(`   内容框      x ${r.box[0]}~${r.box[2]}（宽 ${r.bw}）  y ${r.box[1]}~${r.box[3]}（高 ${r.bh}）`);
  console.log(`   内容占画布  宽 ${(r.fillW * 100).toFixed(1)}%  高 ${(r.fillH * 100).toFixed(1)}%   内容宽高比 ${r.ar}`);
  console.log(`   四边留白    上 ${r.padTop}  下 ${r.padBot}  左 ${r.padL}  右 ${r.padR}   触底=${r.touchBottom} 触顶=${r.touchTop}`);
  console.log(`   alpha 质量  上25% ${(r.massTop25 * 100).toFixed(1)}%  上50% ${(r.massTop50 * 100).toFixed(1)}%  下25% ${(r.massBot25 * 100).toFixed(1)}%`);
}

console.log(`\n${'文件'.padEnd(34)}${'画布'.padEnd(12)}${'内容宽×高'.padEnd(14)}${'占画布宽/高'.padEnd(16)}宽高比`);
for (const r of rows) {
  if (r.empty) continue;
  console.log(
    r.file.replace('窗边牌局_', '').replace('_透明PNG.png', '').padEnd(16) +
    `${r.w}×${r.h}`.padEnd(14) +
    `${r.bw}×${r.bh}`.padEnd(16) +
    `${(r.fillW * 100).toFixed(0)}%/${(r.fillH * 100).toFixed(0)}%`.padEnd(12) +
    `${r.ar}`,
  );
}