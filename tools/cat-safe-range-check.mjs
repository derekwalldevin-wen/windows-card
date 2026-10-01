/**
 * 只读预览：用真实猫咪 PNG 放进候选布局，检查上下 / 左右安全范围。
 * 不修改 src/，不修改素材。
 *
 * 运行：node tools/cat-safe-range-check.mjs <素材目录> <输出目录>
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import * as THREE from 'three';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\opencode\\wc-edge-nl';
const PORT = 9338;
const TMP = join(process.env.TEMP ?? '.', 'cat-safe.html');
const dir = process.argv[2] ?? 'assets/cats';
const outDir = process.argv[3] ?? 'preview';

const CAM = { height: 1.15, back: 0.62, pitchDeg: 42, fovDeg: 58 };
function mk(w, h) {
  const c = new THREE.PerspectiveCamera(CAM.fovDeg, 1, 0.02, 24);
  const p = (CAM.pitchDeg * Math.PI) / 180;
  c.position.set(0, CAM.height, CAM.back);
  c.up.set(0, 1, 0);
  c.lookAt(new THREE.Vector3(0, 0, CAM.back - CAM.height / Math.tan(p)));
  c.updateMatrixWorld(true);
  c.aspect = w / h;
  c.updateProjectionMatrix();
  return c;
}
const pY = (c, hh, z, y = 0) => ((1 - new THREE.Vector3(0, y, z).project(c).y) / 2) * hh;
const halfW = (c, w, z) => {
  const a = new THREE.Vector3(0, 0, z).project(c);
  const b = new THREE.Vector3(1, 0, z).project(c);
  return (Math.abs(b.x - a.x) / 2) * (w / 2);
};

const C = {
  paper: '#f6efe1', paperDeep: '#e7dcc6', goldLine: '#a8845a',
  wood: '#a9855f', sage: '#9aa48c', sageDeep: '#7c8670',
  coralDeep: '#a9614c', green: '#6f8a63', greenDeep: '#5a7350', ink: '#4a4136',
};

const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png')).sort();
/** 文件名形如「窗边牌局_07森林猫_透明PNG.png」→ 取第二段并去掉序号前缀 */
const key = (f) => f.replace(/\.[^.]+$/, '').split('_')[1].replace(/^\d+/, '');
const cats = Object.fromEntries(files.map((f) => [key(f), readFileSync(join(dir, f)).toString('base64')]));
// 内容框（alpha>16），来自 tools/measure-cat-png.mjs 的测量结果
const BOX = {
  '冰翼猫': [1084, 1451, 125, 258, 1019, 1242],
  '月兔耳猫': [1082, 1454, 46, 110, 1053, 1366],
  '云朵猫': [1084, 1451, 60, 118, 1000, 1354],
  '火焰猫': [1085, 1450, 95, 92, 975, 1376],
  '水波猫': [1089, 1444, 154, 248, 1004, 1222],
  '樱花猫': [1089, 1444, 50, 47, 1009, 1379],
  '森林猫': [1083, 1452, 230, 200, 967, 1340],
};

/** 把 alpha 内容框贴到猫咪区底部居中，返回该猫的落位信息 */
function place(cat, catTop, catH) {
  const [, , bx0, by0, bx1, by1] = BOX[cat];
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
  const k = catH / bh; // 按内容高度铺满猫咪区
  const dw = bw * k, dh = bh * k;
  const img = BOX[cat];
  return {
    k, dw, dh,
    // 内容框裁切后按内容高度铺满：图片左上角对齐到 (x0 落在 left, y0 落在 top)
    left: 0, top: catTop, w: img[0], h: img[1],
    srcX: bx0, srcY: by0, srcW: bw, srcH: bh,
  };
}

function sheet(w, h, picks) {
  const u = w / 100, px = (n) => Math.round(n * u * 10) / 10;
  const c = mk(w, h);
  const tableLine = Math.round(pY(c, h, -2.06));
  const baseY = Math.round(pY(c, h, -1.0));
  const padTop = Math.round(w * 0.031), padBot = Math.round(w * 0.036), padX = Math.round(w * 0.065);
  const hud = Math.round(w * 0.103), gap = Math.round(w * 0.026);
  const catTop = padTop + hud + gap;
  const catH = baseY - catTop;
  const btn = Math.round(w * 0.138);
  const cardW = (w - padX * 2 - gap * 3) / 4, handH = Math.round(cardW * 1.4 * 2 + gap);
  const plate = Math.round(w * 0.118), pill = Math.round(w * 0.062), midGap = Math.round(w * 0.015);
  const midH = plate + midGap + pill;
  const actTop = h - padBot - btn, handTop = actTop - gap - handH, midTop = handTop - gap - midH;
  const gapTop = baseY + gap, gapH = midTop - gapTop;
  const softHW = Math.round(halfW(c, w, -1.0));
  const margin = Math.round(w * 0.03);

  const placed = picks.map((p) => ({ p, g: place(p, catTop, catH) }));

  return `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;background:#1c1814;
font-family:system-ui,'Microsoft YaHei',sans-serif;color:${C.ink}}
.row{display:flex;gap:18px;padding:14px;align-items:flex-start}
.ph{position:relative;width:${w}px;height:${h}px;overflow:hidden;flex:0 0 auto;border:1px solid #6a5f4e;
background:linear-gradient(180deg,#f0e7d3 0%,#e6dcc6 ${(tableLine / h * 100 * 0.7).toFixed(1)}%,${C.sage} ${(tableLine / h * 100 * 0.86).toFixed(1)}%,${C.sageDeep} ${(tableLine / h * 100).toFixed(1)}%,${C.wood} 100%)}
.z{position:absolute;left:0;right:0}
.hud{position:absolute;left:${padX}px;right:${padX}px;top:${padTop}px;height:${hud}px;display:flex;align-items:center;gap:${px(2)}px;
padding:0 ${px(2.4)}px;background:linear-gradient(180deg,${C.paper},${C.paperDeep});border:1px solid ${C.goldLine};border-radius:999px}
.nm{font-size:${px(3.4)}px;font-weight:800}.md{font-size:${px(2.4)}px;font-weight:700;color:#5b4a30;background:#e4cf9f;border-radius:999px;padding:${px(0.5)}px ${px(2)}px}
.sc{font-size:${px(2.6)}px}.sc b{font-size:${px(3.6)}px}.gr{margin-left:auto;font-size:${px(2.6)}px;color:#6a573a}
.cat{top:${catTop}px;height:${catH}px}
.catimg{position:absolute}
.shadow{position:absolute;left:50%;bottom:-4px;transform:translateX(-50%);height:${px(3)}px;border-radius:50%;
background:radial-gradient(closest-side,rgba(48,32,18,.45),transparent)}
.mid{top:${midTop}px;height:${midH}px;display:flex;flex-direction:column;align-items:center;gap:${midGap}px}
.plate{width:${Math.round(w * 0.42)}px;height:${plate}px;background:linear-gradient(180deg,${C.paper},${C.paperDeep});
border:1px solid ${C.goldLine};border-radius:${px(1.4)}px;display:flex;flex-direction:column;align-items:center;justify-content:center}
.plate .a{font-size:${px(3.2)}px;font-weight:800;line-height:1.15}.plate .b{font-size:${px(2.4)}px;color:#6a5c48;line-height:1.15}
.pill{height:${pill}px;display:flex;align-items:center;background:linear-gradient(180deg,#efe6d2,#e2d5bb);
border:1px solid ${C.goldLine};border-radius:999px;padding:0 ${px(3.4)}px;font-size:${px(2.3)}px}
.hand{top:${handTop}px;height:${handH}px;left:${padX}px;right:${padX}px;position:absolute;
display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(2,1fr);gap:${gap}px}
.card{position:relative;border-radius:${px(1.4)}px;background:linear-gradient(168deg,#fdf8ee,#eadfc9);
border:1px solid ${C.goldLine};box-shadow:0 1px 3px rgba(46,32,20,.28)}
.corner{position:absolute;font-weight:800;font-size:${px(3.6)}px;line-height:.95}
.tl{top:${px(1)}px;left:${px(1.6)}px}.br{bottom:${px(1)}px;right:${px(1.6)}px;transform:rotate(180deg)}
.pips{position:absolute;inset:20% 22%;display:grid;place-items:center;color:${C.coralDeep};font-size:${px(2.6)}px}
.sel{box-shadow:0 0 0 1.5px ${C.green},0 ${px(0.8)}px ${px(1.6)}px rgba(46,32,20,.3)}
.sel::after{content:'✓';position:absolute;top:${px(0.4)}px;right:${px(0.6)}px;width:${px(2)}px;height:${px(2)}px;border-radius:50%;
background:${C.green};color:#fff;font-size:${px(1.4)}px;line-height:${px(2)}px;text-align:center}
.act{top:${actTop}px;height:${btn}px;left:${padX}px;right:${padX}px;position:absolute;display:flex;align-items:center;gap:${gap}px}
.dk{font-size:${px(2.2)}px;color:#f6eedA;background:rgba(40,28,18,.55);border:1px solid rgba(246,238,218,.22);
border-radius:999px;padding:${px(0.5)}px ${px(2)}px;white-space:nowrap}
.btn{flex:1;height:100%;border-radius:${px(2.4)}px;border:1px solid ${C.goldLine};color:#fff8ea;
font-size:${px(5)}px;font-weight:700;display:flex;align-items:center;justify-content:center;letter-spacing:.1em}
.dis{background:linear-gradient(180deg,#d98a70,${C.coralDeep})}.pl{background:linear-gradient(180deg,#84a077,${C.greenDeep})}
.ann{position:absolute;left:0;right:0;pointer-events:none}
.ab{position:absolute;left:0;right:0;border-top:1px solid;border-bottom:1px solid}
.ab>span{position:absolute;right:2px;top:1px;font-size:9px;line-height:13px;color:#fff;padding:0 3px;border-radius:2px;white-space:nowrap}
.hr{position:absolute;left:0;right:0;border-left:2px solid #c8143c;border-right:2px solid #c8143c;background:#c8143c0a}
.hr b{position:absolute;left:2px;top:2px;font-size:8.5px;line-height:11px;color:#fff;background:#c8143c;padding:0 3px;border-radius:2px;white-space:nowrap;font-weight:400}
.hr i{position:absolute;left:0;right:0;top:0;bottom:0;border-left:1px dashed #7a3ec8;border-right:1px dashed #7a3ec8;background:#7a3ec80d}
.cap{font-size:12px;font-weight:700;color:#efe7d8;padding:2px 2px 6px}
.cap s{text-decoration:none;font-weight:400;font-size:11px;opacity:.8;display:block}
.box{position:absolute;border:1px dashed #ff7a00;pointer-events:none}
</style>
<div class="row">
${placed.map(({ p, g }) => {
    const [cw, ch, bx0, by0, bx1, by1] = BOX[p];
    // 按内容高度铺满猫咪区：整张图等比缩放 k 倍，
    // 让内容框的水平中点对齐屏幕中线、内容框底边对齐猫咪区底边
    const imgW = Math.round(cw * g.k), imgH = Math.round(ch * g.k);
    const bxMid = (bx0 + bx1 + 1) / 2;
    const imgLeft = Math.round(w / 2 - bxMid * g.k);
    const imgBottom = Math.round(-(ch - by1 - 1) * g.k);
    const boxLeft = imgLeft + bx0 * g.k, boxW = (bx1 - bx0 + 1) * g.k;
    const boxTop = Math.round(catTop + catH - (by1 - by0 + 1) * g.k), boxH = (by1 - by0 + 1) * g.k;
    return `<div>
  <div class="cap">${p}　${w}×${h}<s>内容框 ${bx1 - bx0 + 1}×${by1 - by0 + 1} → 显示 ${Math.round(g.dw)}×${Math.round(g.dh)}（缩放 ${g.k.toFixed(3)}）｜ 屏幕硬边 ±${Math.round(w / 2 - margin)}，桌面软边 ±${softHW}</s></div>
  <div class="ph">
    <div class="z hud"><span class="nm">窗边牌局</span><span class="md">练习模式</span><span class="sc">累计<b>0</b></span><span class="gr">⚙</span></div>
    <div class="z cat">
      <div class="shadow" style="width:${Math.round(g.dw * 0.52)}px"></div>
      <img class="catimg" src="data:image/png;base64,${cats[p]}"
        style="width:${imgW}px;height:${imgH}px;left:${imgLeft}px;bottom:${imgBottom}px">
      <div class="box" style="left:${boxLeft.toFixed(1)}px;top:${boxTop.toFixed(1)}px;width:${boxW.toFixed(1)}px;height:${boxH.toFixed(1)}px"></div>
      <div class="hr" style="top:0;bottom:0;left:${margin}px;right:${margin}px"><b>屏幕硬边 ±${Math.round(w / 2 - margin)}</b><i style="left:${w / 2 - softHW}px;right:${w / 2 - softHW}px"></i></div>
    </div>
    <div class="z mid"><div class="plate"><div class="a">一对</div><div class="b">14 × 2 = 28</div></div><div class="pill">已选 2/5</div></div>
    <div class="z hand">
      ${[['2', 1, 1], ['9', 0, 0], ['Q', 0, 0], ['3', 0, 0], ['2', 1, 1], ['K', 0, 0], ['K', 0, 0], ['A', 0, 0]]
        .map(([r, sel, red]) => `<div class="card${sel ? ' sel' : ''}"><span class="corner tl">${r}<br>${red ? '♥' : '♣'}</span><span class="corner br">${r}<br>${red ? '♥' : '♣'}</span><span class="pips">${red ? '♥' : '♣'}</span></div>`).join('')}
    </div>
    <div class="z act"><span class="dk">牌堆 44</span><div class="btn dis">弃牌 3/3</div><div class="btn pl">出牌</div></div>
    <div class="ann">
      <div class="ab" style="top:${catTop}px;height:${catH}px;border-color:#2f7fd0;background:#2f7fd014"><span style="background:#2f7fd0">猫咪区 ${catH}px（${catTop}~${baseY}）</span></div>
      <div class="ab" style="top:${tableLine}px;height:2px;border:0;background:#c8143c"><span style="background:#c8143c;top:-13px">桌沿 y=${tableLine}（未改）</span></div>
      <div class="ab" style="top:${gapTop}px;height:${gapH}px;border:0;background:repeating-linear-gradient(45deg,#ffffff10 0 6px,transparent 6px 12px)"><span style="background:#5b5346;top:2px">裸桌呼吸区 ${gapH}px</span></div>
    </div>
  </div></div>`;
  }).join('')}
</div>`;
}

async function waitForDevTools() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return; } catch { /* 等 */ }
    await delay(250);
  }
  throw new Error('DevTools 未就绪');
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  rmSync(PROFILE, { recursive: true, force: true });
  mkdirSync(PROFILE, { recursive: true });
  const child = spawn(EDGE, ['--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', '--mute-audio',
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
    ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('timeout ' + method)); } }, 30000); });

  await send('Page.enable');

  // 表 1：森林猫 + 冰翼猫，两个视口并排（用户点名先查这两只）
  writeFileSync(TMP, sheet(390, 844, ['森林猫', '冰翼猫']));
  const W1 = 390 * 2 + 18 + 28, H1 = 844 + 28 + 52;
  await send('Emulation.setDeviceMetricsOverride', { width: W1, height: H1, deviceScaleFactor: 2, mobile: false, screenWidth: W1, screenHeight: H1 });
  await send('Page.navigate', { url: 'file:///' + TMP.replace(/\\/g, '/') });
  await delay(2500);
  const s1 = await send('Page.captureScreenshot', { format: 'png' });
  const f1 = join(outDir, 'safe-forest-wing-390x844.png');
  writeFileSync(f1, Buffer.from(s1.data, 'base64'));
  console.log('→ ' + f1);

  writeFileSync(TMP, sheet(360, 640, ['森林猫', '冰翼猫']));
  const W2 = 360 * 2 + 18 + 28, H2 = 640 + 28 + 52;
  await send('Emulation.setDeviceMetricsOverride', { width: W2, height: H2, deviceScaleFactor: 2, mobile: false, screenWidth: W2, screenHeight: H2 });
  await send('Page.navigate', { url: 'file:///' + TMP.replace(/\\/g, '/') });
  await delay(2500);
  const s2 = await send('Page.captureScreenshot', { format: 'png' });
  const f2 = join(outDir, 'safe-forest-wing-360x640.png');
  writeFileSync(f2, Buffer.from(s2.data, 'base64'));
  console.log('→ ' + f2);

  ws.close(); child.kill();
}
main().catch((e) => { console.error('FAILED:', e.stack); process.exit(1); });