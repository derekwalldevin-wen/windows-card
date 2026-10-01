/**
 * 只读测量：对每只派生猫图，检测**脚底着地点**。
 *
 * 背景：透明图裁到 alpha 内容框后，底边不一定是脚 ——
 * 樱花猫的大尾巴、水波猫的尾尖、冰翼猫的后腿都可能落到最底。
 *
 * 方法（不使用 Math.max(...大数组)，避免参数上限）：
 *  1. 求 alpha 内容框；
 *  2. 对每列求「从最底起的连续不透明像素数」colDepth；
 *  3. 着地列 = colDepth ≥ 全图最大深度 × 35%（尾巴/毛尖很浅，会被排除）；
 *  4. 对着地列的**逐行宽度**做平滑，取底部 8% 区间内宽度最大的那一段作为脚掌，
 *     脚底中心取这段的中点。
 *
 * 输出写进 src/ui/cat-feet.json（生成物，勿手改）。
 *
 * 运行：node tools\measure-cat-feet.mjs
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

function decodeAlpha(buf) {
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
  const chan = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.ct];
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
  const ai = { 0: 0, 2: -1, 3: -1, 4: 1, 6: 3 }[ihdr.ct];
  const gray = new Uint8Array(ihdr.w * ihdr.h);
  for (let i = 0; i < ihdr.w * ihdr.h; i++) gray[i] = ai < 0 ? 255 : out[i * chan + ai];
  return { w: ihdr.w, h: ihdr.h, gray };
}

const THRESH = 24;
const dir = 'public/cats';
const files = readdirSync(dir).filter((f) => f.startsWith('cat-') && f.endsWith('.png')).sort();
const manifest = JSON.parse(readFileSync(join('src', 'ui', 'cat-manifest.json'), 'utf8'));

console.log('猫id'.padEnd(14) + '派生图'.padEnd(12) + '脚掌段 x'.padEnd(16) + '脚底中心x%'.padEnd(13) + '脚掌占宽'.padEnd(11) + '脚底厚度'.padEnd(11) + '脚底离底边');
console.log('─'.repeat(90));

const results = {};
for (const f of files) {
  const id = f.replace(/^cat-/, '').replace(/\.png$/, '');
  const { w, h, gray } = decodeAlpha(readFileSync(join(dir, f)));

  // 1) alpha 内容框
  let bx0 = w, bx1 = -1, by0 = h, by1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (gray[y * w + x] <= THRESH) continue;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
    }
  }
  const cw = bx1 - bx0 + 1, ch = by1 - by0 + 1;

  

  // 3) 着地点 = **贴到图底部那一带**的列。
  //    不能用「最宽的一段」：坐姿猫的臀部比脚掌宽，站立猫全身都宽，
  //    取最宽会选到身体而不是脚。要的是真正压在地上的那一圈。
  //    取底部 band 行内持续有内容的列，band 取高度的 2.5%。
  const band = Math.max(2, Math.round(ch * 0.025));
  const colHit = new Int32Array(w);
  for (let k = 0; k < band; k++) {
    const y = by1 - k;
    for (let x = bx0; x <= bx1; x++) {
      if (gray[y * w + x] > THRESH) colHit[x]++;
    }
  }
  // 至少在 band 的 40% 行里出现的列才算着地
  const groundCols = [];
  for (let x = bx0; x <= bx1; x++) if (colHit[x] >= band * 0.4) groundCols.push(x);
  if (!groundCols.length) groundCols.push(bx0, bx1);

  // 去掉首尾各 6%，避免单根毛发 / 尾巴尖拉偏
  const cut = Math.max(1, Math.floor(groundCols.length * 0.06));
  const core = groundCols.length > cut * 2 ? groundCols.slice(cut, groundCols.length - cut) : groundCols;
  const gx0 = core[0], gx1 = core[core.length - 1];

  // 脚底中心：该区间内按「每列在 band 内的覆盖次数」加权，
  // 让实心脚掌比边缘毛发贡献更大
  let wsum = 0, xsum = 0;
  for (let x = gx0; x <= gx1; x++) {
    if (colHit[x] <= 0) continue;
    wsum += colHit[x];
    xsum += x * colHit[x];
  }
  const footCx = wsum > 0 ? xsum / wsum : (gx0 + gx1) / 2;

  // 脚掌段 = 着地列的横向跨度（只统计覆盖次数 ≥ band*0.7 的实心部分）
  const solidCols = [];
  for (let x = bx0; x <= bx1; x++) if (colHit[x] >= band * 0.7) solidCols.push(x);
  const sx0 = solidCols.length ? solidCols[0] : gx0;
  const sx1 = solidCols.length ? solidCols[solidCols.length - 1] : gx1;

  // 脚底离图底边的高度：着地列从底部起连续不透明的厚度（多列取中位）
  const depths = [];
  for (let x = gx0; x <= gx1; x++) {
    let d = 0;
    for (let y = by1; y >= by0; y--) {
      if (gray[y * w + x] <= THRESH) break;
      d++;
    }
    if (d > 0) depths.push(d);
  }
  depths.sort((a, b) => a - b);
  const medDepth = depths.length ? depths[depths.length >> 1] : 0;

  const entry = manifest.cats.find((c) => c.id === id);
  results[id] = {
    name: entry?.name ?? id,
    aspect: entry?.aspect ?? 0,
    /** 脚底中心的横向位置，相对裁切图宽度（0~1） */
    footXRatio: +((footCx - bx0) / cw).toFixed(4),
    /** 实心脚掌横向跨度占裁切图宽度 */
    footSpanRatio: +((sx1 - sx0 + 1) / cw).toFixed(3),
    /** 脚底离裁切图底边的高度占比：0 = 脚底正好在底边 */
    footLiftRatio: +((medDepth / ch).toFixed(4)),
    /** 着地厚度占图高（与 footLiftRatio 同值，保留旧字段名兼容） */
    footDepthRatio: +(medDepth / ch).toFixed(4),
    display: entry?.display ?? null,
  };

  console.log(
    id.padEnd(14) +
    `${w}×${h}`.padEnd(14) +
    `${sx0}~${sx1}`.padEnd(16) +
    `${((footCx - bx0) / cw * 100).toFixed(1)}%`.padEnd(15) +
    `${((sx1 - sx0 + 1) / cw * 100).toFixed(0)}%`.padEnd(13) +
    `${(medDepth / ch * 100).toFixed(1)}%`.padEnd(13) +
    `着地列 ${groundCols.length}/${cw}`,
  );
}

writeFileSync(
  join('src', 'ui', 'cat-feet.json'),
  JSON.stringify({
    note: '由 tools/measure-cat-feet.mjs 从 public/cats 的实际 alpha 底边测出，请勿手改。footXRatio = 脚底中心横向位置/裁切图宽；footLiftRatio = 脚底离裁切图底边的距离/图高（0 表示脚底正好在底边）。',
    feet: results,
  }, null, 2) + '\n',
);
console.log('\n已写入 src/ui/cat-feet.json');
console.log(`
判读：
  脚底中心x%   50% = 正好居中；偏得越多越需要单独锚点
  脚底离底边   0% = 脚底就是图片底边；>3% 说明底边是尾巴/毛尖，需按 footLiftRatio 上提`);