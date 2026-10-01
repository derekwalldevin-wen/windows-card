/**
 * 只读取色：从截图 PNG 采样若干点的实际 RGB，
 * 用来客观核对「木桌降红褐饱和」「桌垫偏灰鼠尾草绿」是否真的落到画面上，
 * 而不是只看 3D 材质里的基色（光照 + ACES 色调映射会整体改变观感）。
 *
 * 运行：node tools/sample-pixels.mjs <截图目录>
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

/** 解码 8bit 非隔行 RGB/RGBA PNG，返回 {w,h,rgb} */
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

const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
/** HSL 的 S（0~1）与 H（度）：用来判断「红褐饱和度」与「是否偏灰」 */
function hsl(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const mx = Math.max(rn, gn, bn), mn = Math.min(rn, gn, bn), l = (mx + mn) / 2;
  const d = mx - mn;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (mx === rn) h = 60 * (((gn - bn) / d) % 6);
  else if (mx === gn) h = 60 * ((bn - rn) / d + 2);
  else h = 60 * ((rn - gn) / d + 4);
  return { h: (h + 360) % 360, s, l };
}

/** 在 CSS 坐标 (cx,cy) 处取 scale×scale 方块的中位色 */
function at(img, scale, cx, cy, size = 5) {
  const px = Math.round(cx * scale), py = Math.round(cy * scale);
  const rs = [], gs = [], bs = [];
  for (let y = py - size; y <= py + size; y++) {
    for (let x = px - size; x <= px + size; x++) {
      if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
      const i = (y * img.w + x) * 3;
      rs.push(img.rgb[i]); gs.push(img.rgb[i + 1]); bs.push(img.rgb[i + 2]);
    }
  }
  const med = (arr) => arr.sort((a, b) => a - b)[arr.length >> 1] ?? 0;
  return { r: med(rs), g: med(gs), b: med(bs) };
}

const dir = process.argv[2];
const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();

/** 采样点按视口比例给出，避开猫咪与界面元素 */
const POINTS = [
  ['桌垫（猫左侧空白）', 0.18, 0.34],
  ['桌垫（猫右侧空白）', 0.82, 0.34],
  ['桌垫（猫前方中部）', 0.5, 0.42],
  ['裸桌（猫与计分牌之间）', 0.2, 0.5],
  ['裸桌（右缘）', 0.88, 0.5],
  ['木桌（手牌上方左侧）', 0.06, 0.68],
  ['木桌（手牌上方右侧）', 0.94, 0.68],
];

for (const f of files) {
  const img = decode(readFileSync(join(dir, f)));
  // 截图若为 DPR 2，则 CSS 视口宽 = 图宽 / (图宽 / 390)……直接用比例，无需知道 DPR
  const scale = img.w / 390; // 以 390 宽为基准换算缩放；点位本身用比例给出，故 scale 只用于取点
  console.log(`\n── ${f}  ${img.w}×${img.h}`);
  console.log('采样点'.padEnd(30) + '实测'.padEnd(10) + 'H'.padEnd(7) + 'S'.padEnd(8) + 'L');
  for (const [name, fx, fy] of POINTS) {
    const px = Math.round(fx * img.w), py = Math.round(fy * img.h);
    // 直接在图像像素上按比例取点
    const rs = [], gs = [], bs = [];
    for (let y = py - 4; y <= py + 4; y++) {
      for (let x = px - 4; x <= px + 4; x++) {
        if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
        const i = (y * img.w + x) * 3;
        rs.push(img.rgb[i]); gs.push(img.rgb[i + 1]); bs.push(img.rgb[i + 2]);
      }
    }
    const med = (arr) => arr.sort((a, b) => a - b)[arr.length >> 1] ?? 0;
    const r = med(rs), g = med(gs), b = med(bs);
    const { h, s, l } = hsl(r, g, b);
    console.log(
      name.padEnd(28) +
      hex(r, g, b).padEnd(12) +
      `${h.toFixed(0)}°`.padEnd(8) +
      `${(s * 100).toFixed(0)}%`.padEnd(9) +
      `${(l * 100).toFixed(0)}%`,
    );
  }
  void scale;
}

console.log(`
判读：
  木桌  期望 H 20~40、S ≤ 45%（降红褐饱和）；S 越高越红褐
  桌垫  期望 H 70~110、S ≤ 32%（偏灰鼠尾草绿）；S>40% 会读成森林绿`);