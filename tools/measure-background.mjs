/**
 * 只读测量：从窗边背景图里找出鼠尾草绿桌垫的实际边界，
 * 供猫咪脚底锚点与 UI 分区对齐使用。
 *
 * 桌垫是低饱和的灰绿色，判定条件：G 略大于 R、G 明显大于 B、饱和度中低。
 * 木桌是暖橙木色（R > G > B），窗户是高亮低饱和，按这些差异分开。
 *
 * 运行：node tools\measure-background.mjs [背景图]
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/** 解码 8bit 非隔行 RGB/RGBA PNG */
function decode(buf) {
  let off = 8, ihdr = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), bd: data[8], ct: data[9], il: data[12] };
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr || ihdr.bd !== 8 || ihdr.il !== 0) throw new Error('仅支持 8bit 非隔行 PNG');
  const chan = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.ct];
  if (!chan) throw new Error(`colorType=${ihdr.ct}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = ihdr.w * chan;
  const out = Buffer.alloc(stride * ihdr.h);
  let p = 0;
  for (let y = 0; y < ihdr.h; y++) {
    const ft = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, y * stride + stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= chan ? cur[x - chan] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= chan ? prev[x - chan] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  const rgb = new Uint8Array(ihdr.w * ihdr.h * 3);
  for (let i = 0; i < ihdr.w * ihdr.h; i++) {
    rgb[i * 3] = out[i * chan];
    rgb[i * 3 + 1] = out[i * chan + 1];
    rgb[i * 3 + 2] = out[i * chan + 2];
  }
  return { w: ihdr.w, h: ihdr.h, rgb };
}

const at = (img, x, y) => {
  const i = ((y | 0) * img.w + (x | 0)) * 3;
  return [img.rgb[i], img.rgb[i + 1], img.rgb[i + 2]];
};

/**
 * 是否为鼠尾草绿桌垫色。
 *
 * 实测这张图：桌垫 rgb ≈ (160~178, 152~173, 110~127)，
 * 木桌 rgb ≈ (195~218, 130~158, 66~96)，窗户/窗台 rgb ≈ (208~230, 185~215, 145~196)。
 * 区分要点不是「G 大于 R」—— 桌垫的 G 略**低于** R；
 * 真正的差异是 **色相**（桌垫在黄绿侧，木桌在橙侧）与**蓝通道**（桌垫 B 高得多）。
 * 所以判据用 HSV 色相 + B 通道下限，别用 RGB 大小关系。
 */
function isRunner(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === 0) return false;
  const d = mx - mn;
  const s = d / mx;
  // 蓝通道必须明显偏高：桌垫 B>100 且 R-B>30；木桌 R-B 通常 >90 且 B<110
  if (b < 100) return false;
  if (r - b < 30) return false;
  // 色相落在黄绿区间（约 45°~85°）
  let h;
  if (mx === r) h = 60 * (((g - b) / d) % 6);
  else if (mx === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  if (h < 0) h += 360;
  if (h < 42 || h > 88) return false;
  // 饱和度中低、亮度中等（窗台高光会被 s<0.16 挡掉）
  if (s < 0.14 || s > 0.40) return false;
  if (mx < 130 || mx > 205) return false;
  return true;
}

const file = process.argv[2] ?? 'assets/background/cozy-window-table-background-v1.png';
const img = decode(readFileSync(file));

console.log(`背景图 ${img.w} × ${img.h}`);
console.log(`建议猫脚锚点 (426, 520) → 占宽 ${((426 / img.w) * 100).toFixed(1)}% 占高 ${((520 / img.h) * 100).toFixed(1)}%\n`);

// 逐行统计桌垫色像素，找出上下左右边界
const rows = [];
for (let y = 0; y < img.h; y++) {
  let n = 0, minX = img.w, maxX = -1;
  for (let x = 0; x < img.w; x++) {
    const [r, g, b] = at(img, x, y);
    if (isRunner(r, g, b)) { n++; if (x < minX) minX = x; if (x > maxX) maxX = x; }
  }
  rows.push({ y, n, minX, maxX });
}

// 有效行：桌垫像素数超过半宽的 30%（排除边缘阴影与桌面绿植）
const thresh = img.w * 0.3;
const solid = rows.filter((r) => r.n > thresh);
if (!solid.length) {
  console.log('未检测到桌垫区域');
  process.exit(0);
}
const y0 = solid[0].y, y1 = solid[solid.length - 1].y;
// 桌垫左右边界取中段行的中位数，避免被阴影带偏
const mid = solid.slice(Math.floor(solid.length * 0.25), Math.ceil(solid.length * 0.75));
const xs = mid.flatMap((r) => [r.minX, r.maxX]).sort((a, b) => a - b);
const x0 = xs[Math.floor(xs.length * 0.05)];
const x1 = xs[Math.floor(xs.length * 0.95)];

console.log('=== 桌垫区域（灰绿判定）===');
console.log(`  y ${y0} ~ ${y1}（高 ${y1 - y0 + 1}，占图高 ${(((y1 - y0 + 1) / img.h) * 100).toFixed(1)}%）`);
console.log(`  x ${x0} ~ ${x1}（宽 ${x1 - x0 + 1}，占图宽 ${(((x1 - x0 + 1) / img.w) * 100).toFixed(1)}%）`);
console.log(`  中心 x ${Math.round((x0 + x1) / 2)}（图中心 ${Math.round(img.w / 2)}）`);

// 逐行密度剖面：用于看清桌垫上沿是否倾斜、以及下沿（近处边缘）
console.log('\n=== 逐行密度（每 40 行取样）===');
for (let y = y0; y <= y1; y += 40) {
  const r = rows[y];
  const bar = '#'.repeat(Math.round((r.n / img.w) * 40));
  console.log(`  y=${String(y).padStart(4)}　n=${String(r.n).padStart(4)}　x ${r.minX}~${r.maxX}　${bar}`);
}

// 建议脚底：桌垫纵向中部偏后（猫坐在远端，不贴最近处边缘）
const midY = Math.round(y0 + (y1 - y0) * 0.62);
console.log(`\n=== 猫咪脚底落点建议 ===`);
console.log(`  桌垫内 62% 高度处 y=${midY}（y0=${y0} y1=${y1}）`);
console.log(`  贴图中心 x=${Math.round((x0 + x1) / 2)}`);
console.log(`  该点是否在桌垫上：${isRunner(...at(img, Math.round((x0 + x1) / 2), midY)) ? '是' : '否（需复核）'}`);
console.log(`  抽样色 @(${Math.round((x0 + x1) / 2)},${midY}) = rgb(${at(img, Math.round((x0 + x1) / 2), midY).join(',')})`);

// 窗户区域大致范围（高亮低饱和），供顶部不裁窗的判断
console.log('\n=== 窗户区域（高亮度、低饱和、偏冷）===');
let wy0 = -1, wy1 = -1;
for (let y = 0; y < img.h; y++) {
  let n = 0;
  for (let x = Math.round(img.w * 0.3); x < Math.round(img.w * 0.7); x++) {
    const [r, g, b] = at(img, x, y);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const s = mx === 0 ? 0 : (mx - mn) / mx;
    if (r > 205 && g > 205 && b > 190 && s < 0.16) n++;
  }
  if (n > img.w * 0.1) { if (wy0 < 0) wy0 = y; wy1 = y; }
}
console.log(`  中央列高亮区 y ${wy0} ~ ${wy1}（占图高 ${wy0 >= 0 ? (((wy1 - wy0 + 1) / img.h) * 100).toFixed(1) + '%' : '未检出'}）`);