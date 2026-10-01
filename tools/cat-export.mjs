/**
 * 素材管线（只读原图 → 输出派生图）：
 *   assets/cats/*.png  →  public/cats/*.png
 *
 * 做两件事：
 *   1. 裁到 alpha 内容框（阈值 16），去掉四周透明留白。
 *      素材说明要求「分别设置角色锚点」，裁掉留白后锚点就是图片底边中点。
 *   2. 等比缩放到目标高度（默认 640），够 3x DPR 下的最大显示高度用，
 *      同时把 1.3MB 的原图压到几百 KB。
 *
 * **不修改 assets/cats/ 下的任何文件**，只新增 public/cats/ 派生图。
 *
 * 运行：node tools/cat-export.mjs [目标高度]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\opencode\\wc-edge-nl';
const PORT = 9339;
const TMP = join(process.env.TEMP ?? '.', 'cat-export.html');
const SRC = 'assets/cats';
const OUT = 'public/cats';
const TARGET_H = Number(process.argv[2] ?? 640);
/** alpha 阈值：与 tools/measure-cat-png.mjs 保持一致 */
const THRESH = 16;

const files = readdirSync(SRC).filter((f) => f.toLowerCase().endsWith('.png')).sort();

/**
 * 名册：id / 中文名 / 姿态。
 * 姿态是美术元信息，脚本量不出来，必须在这里显式登记；
 * 尺寸与宽高比则由下面的像素测量自动写入 manifest，不手抄。
 */
const ROSTER = [
  { id: 'ice-wing', name: '冰翼猫', pose: '飞扑展翼', match: '01冰翼猫' },
  { id: 'moon-rabbit', name: '月兔耳猫', pose: '坐姿（长垂兔耳）', match: '02月兔耳猫' },
  { id: 'cloud', name: '云朵猫', pose: '坐姿（云绒无耳）', match: '03云朵猫' },
  { id: 'flame', name: '火焰猫', pose: '四足站立', match: '04火焰猫' },
  { id: 'ripple', name: '水波猫', pose: '坐姿', match: '05水波猫' },
  { id: 'sakura', name: '樱花猫', pose: '坐姿（花尾上翘）', match: '06樱花猫' },
  { id: 'forest', name: '森林猫', pose: '坐姿（枝角花冠）', match: '07森林猫' },
];
const rosterOf = (file) => ROSTER.find((r) => file.includes(r.match));
const missing = files.filter((f) => !rosterOf(f));
if (missing.length) throw new Error('以下文件未登记在 ROSTER：' + missing.join(', '));

const MANIFEST = 'src/ui/cat-manifest.json';
const payload = files.map((f) => ({ name: f, data: readFileSync(join(SRC, f)).toString('base64') }));

const PAYLOAD_JS = join(process.env.TEMP ?? '.', 'cat-export-payload.js');
const html = `<!doctype html><meta charset="utf-8"><body><script src="./cat-export-payload.js"></script><script>
window.__runOne = async (i, targetH, thresh) => {
  const it = window.__payload[i];
  const im = await new Promise((res, rej) => {
    const q = new Image();
    q.onload = () => res(q);
    q.onerror = () => rej(new Error('decode failed'));
    q.src = 'data:image/png;base64,' + it.data;
  });
  const w = im.naturalWidth, h = im.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(im, 0, 0);
  const px = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (px[(y * w + x) * 4 + 3] <= thresh) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return { name: it.name, error: 'empty' };
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const k = targetH / bh;
  const dw = Math.max(1, Math.round(bw * k)), dh = Math.max(1, Math.round(bh * k));
  const o = document.createElement('canvas');
  o.width = dw; o.height = dh;
  const octx = o.getContext('2d');
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  // 高质量降采样；同时抹掉去背景残留的低透明度边缘碎屑
  octx.drawImage(im, x0, y0, bw, bh, 0, 0, dw, dh);
  return {
    name: it.name, srcW: w, srcH: h, box: [x0, y0, x1, y1],
    dw, dh, ar: +(dw / dh).toFixed(4),
    png: o.toDataURL('image/png').split(',')[1],
  };
};
window.__ready = true;
</script></body>`;
writeFileSync(TMP, html);
// 载荷走 <script src>，避免把十几 MB 的 JSON 内联进 CDP 表达式里被截断
writeFileSync(PAYLOAD_JS, `window.__payload = ${JSON.stringify(payload)};`);

async function waitForDevTools() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return; } catch { /* 等 */ }
    await delay(250);
  }
  throw new Error('DevTools 未就绪');
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  rmSync(PROFILE, { recursive: true, force: true });
  mkdirSync(PROFILE, { recursive: true });
  const child = spawn(EDGE, ['--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--mute-audio',
    `--remote-debugging-port=${PORT}`, '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });
  await waitForDevTools();
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const t = list.find((x) => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
    if (m.id !== undefined) { const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } } });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('timeout ' + method)); } }, 60000); });

  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + TMP.replace(/\\/g, '/') });
  await delay(1200);

  console.log(`目标高度 ${TARGET_H}px（alpha>${THRESH} 裁框）\n`);
  console.log('输出文件'.padEnd(30) + '原图'.padEnd(14) + '裁框'.padEnd(16) + '派生图'.padEnd(14) + '宽高比'.padEnd(9) + '体积');
  const results = [];
  for (let i = 0; i < payload.length; i++) {
    const r = await send('Runtime.evaluate', {
      // Runtime.evaluate 的表达式是经典脚本，不允许顶层 await，必须包一层 async IIFE
      expression: `(async () => JSON.stringify(await window.__runOne(${i}, ${TARGET_H}, ${THRESH})))()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    results.push(JSON.parse(r.result.value));
  }

  let before = 0, after = 0;
  const manifest = [];
  for (const it of results) {
    if (it.error) { console.log(`${it.name}  ${it.error}`); continue; }
    const r = rosterOf(it.name);
    if (!r) continue;
    const file = join(OUT, `cat-${r.id}.png`);
    writeFileSync(file, Buffer.from(it.png, 'base64'));
    const sb = statSync(join(SRC, it.name)).size, sa = statSync(file).size;
    before += sb; after += sa;
    manifest.push({
      id: r.id, name: r.name, pose: r.pose,
      file: `cats/cat-${r.id}.png`,
      aspect: it.ar,
      source: { w: it.srcW, h: it.srcH, box: it.box },
      display: { w: it.dw, h: it.dh },
    });
    console.log(
      `cat-${r.id}.png`.padEnd(30) +
      `${r.name}`.padEnd(12) +
      `${it.srcW}×${it.srcH}`.padEnd(14) +
      `${it.box[2] - it.box[0] + 1}×${it.box[3] - it.box[1] + 1}`.padEnd(16) +
      `${it.dw}×${it.dh}`.padEnd(14) +
      `${it.ar}`.padEnd(9) +
      `${(sb / 1048576).toFixed(2)}MB → ${(sa / 1024).toFixed(0)}KB`,
    );
  }
  manifest.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(MANIFEST, JSON.stringify({
    note: '由 tools/cat-export.mjs 从 assets/cats 的实际像素生成，请勿手改。aspect 为宽/高。',
    targetHeight: TARGET_H,
    cats: manifest,
  }, null, 2) + '\n');
  console.log(`\n合计 ${(before / 1048576).toFixed(2)}MB → ${(after / 1024).toFixed(0)}KB`);
  console.log(`派生图：${OUT}/　名册：${MANIFEST}　（原图 ${SRC} 未改动）`);
  ws.close(); child.kill();
}
main().catch((e) => { console.error('FAILED:', e.stack); process.exit(1); });