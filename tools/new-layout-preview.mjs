/**
 * 只读预览：按新版美术方向生成布局候选示意图（390×844 / 360×640）。
 * 不修改 src/。示意中的空间比例取自 tools/analyze-*.mjs 的投影复算值，
 * 但画面本身是示意，**不代表已通过投影验证的最终观感**。
 *
 * 运行：node tools/new-layout-preview.mjs <outDir>
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import * as THREE from 'three';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\opencode\\wc-edge-nl';
const PORT = 9336;
const outDir = process.argv[2] ?? 'preview';

// 当前相机（back=0.62）下的桌面映射，投影复算值
const CAM = { height: 1.15, back: 0.62, pitchDeg: 42, fovDeg: 58 };
function proj(w, h, z, y = 0) {
  const c = new THREE.PerspectiveCamera(CAM.fovDeg, 1, 0.02, 24);
  const p = (CAM.pitchDeg * Math.PI) / 180;
  c.position.set(0, CAM.height, CAM.back);
  c.up.set(0, 1, 0);
  c.lookAt(new THREE.Vector3(0, 0, CAM.back - CAM.height / Math.tan(p)));
  c.updateMatrixWorld(true);
  c.aspect = w / h;
  c.updateProjectionMatrix();
  return ((1 - new THREE.Vector3(0, y, z).project(c).y) / 2) * h;
}
function halfW(w, h, z) {
  const c = new THREE.PerspectiveCamera(CAM.fovDeg, 1, 0.02, 24);
  const p = (CAM.pitchDeg * Math.PI) / 180;
  c.position.set(0, CAM.height, CAM.back);
  c.up.set(0, 1, 0);
  c.lookAt(new THREE.Vector3(0, 0, CAM.back - CAM.height / Math.tan(p)));
  c.updateMatrixWorld(true);
  c.aspect = w / h;
  c.updateProjectionMatrix();
  const a = new THREE.Vector3(0, 0, z).project(c);
  const b = new THREE.Vector3(1, 0, z).project(c);
  return (Math.abs(b.x - a.x) / 2) * (w / 2);
}

// ---- 新版配色（第4条：降红褐、偏灰鼠尾草绿、暖白纸+细金棕边）----
const C = {
  paper: '#f6efe1',
  paperDeep: '#e7dcc6',
  goldLine: '#a8845a',
  wood: '#a9855f',
  woodDeep: '#7d5f42',
  sage: '#9aa48c',
  sageDeep: '#7c8670',
  sageLight: '#b3bbab',
  coral: '#cd7d63',
  coralDeep: '#a9614c',
  green: '#6f8a63',
  greenDeep: '#5a7350',
  ink: '#4a4136',
};

/** 页眉高度：说明条占位，视口本体坐标不受影响 */
const CAPH = 40;

function html(w, h, o) {
  const u = w / 100;
  const px = (n) => Math.round(n * u * 10) / 10;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=${w}">
<style>
*{box-sizing:border-box}html,body{margin:0;width:${w}px;height:${h + CAPH}px;overflow:hidden;
font-family:system-ui,'Microsoft YaHei',sans-serif;color:${C.ink};background:#241b13}
.s{position:relative;width:${w}px;height:${h}px;overflow:hidden;margin-top:${CAPH}px;
background:linear-gradient(180deg,#f0e7d3 0%,#e6dcc6 ${(o.tableLine / h * 100 * 0.7).toFixed(1)}%,${C.sage} ${(o.tableLine / h * 100 * 0.86).toFixed(1)}%,${C.sageDeep} ${(o.tableLine / h * 100).toFixed(1)}%,${C.wood} 100%)}
/* 所有分区绝对定位：渲染位置与标注位置同源，便于逐像素核对 */
.edge{position:absolute;left:0;right:0;top:${o.tableLine}px;height:2px;background:#8a6a45}
.ui{position:absolute;inset:0}
.z{position:absolute;left:0;right:0}
.hud{position:absolute;left:${o.padX}px;right:${o.padX}px;top:${o.padTop}px;height:${o.hud}px;display:flex;align-items:center;gap:${px(2)}px;padding:0 ${px(2.4)}px;
background:linear-gradient(180deg,${C.paper},${C.paperDeep});border:1px solid ${C.goldLine};border-radius:999px;
box-shadow:0 1px 4px rgba(60,44,28,.22)}
.name{font-size:${px(3.4)}px;font-weight:800;letter-spacing:.04em;white-space:nowrap}
.mode{font-size:${px(2.4)}px;font-weight:700;color:#5b4a30;background:#e4cf9f;border-radius:999px;padding:${px(0.5)}px ${px(2)}px;white-space:nowrap}
.sep{width:1px;height:${px(2.8)}px;background:${C.goldLine};opacity:.6}
.score{font-size:${px(2.6)}px;white-space:nowrap}
.score b{font-size:${px(3.6)}px;margin-left:${px(0.8)}px}
.gear{margin-left:auto;width:${px(4.4)}px;height:${px(4.4)}px;border-radius:50%;border:1px solid ${C.goldLine};
background:#efe6d2;display:flex;align-items:center;justify-content:center;font-size:${px(2.6)}px;color:#6a573a}
/* 猫咪区 */
.cat{top:${o.catTop}px;height:${o.catH}px;position:relative}
.catmark{position:absolute;left:0;right:0;top:0;height:100%;border-top:1px dashed #2f7fd0;border-bottom:2px solid #c8143c;background:#2f7fd00f}
.base{position:absolute;left:0;right:0;bottom:0;height:2px;background:#c8143c}
.shadow{position:absolute;left:50%;bottom:${px(1.2)}px;transform:translateX(-50%);width:${o.shadowW}px;height:${px(3.4)}px;border-radius:50%;
background:radial-gradient(closest-side,rgba(50,34,20,.5),rgba(50,34,20,0))}
.fig{position:absolute;left:50%;bottom:${px(1.2)}px;transform:translateX(-50%);height:${o.figH}px;aspect-ratio:${o.figAR};
display:flex;align-items:flex-end;justify-content:center}
.fig svg{width:100%;height:100%;display:block}
/* 安全范围框 */
/* 安全范围框：枝角猫（高、窄）用左对齐标；翼猫（宽、矮）用右对齐标，避免互相压住 */
.sf{position:absolute;border:1px dashed #e0552f;background:#e0552f0d}
.sf span{position:absolute;font-size:9px;line-height:12px;color:#fff;padding:0 3px;border-radius:2px;white-space:nowrap}
.sftl{left:${o.padX}px;top:0}
.sftl span{left:0;bottom:100%;margin-bottom:2px;background:#e0552f}
.sftr{right:${o.padX}px;bottom:0}
.sftr span{right:0;bottom:100%;margin-bottom:2px;background:#7a3ec8}
.sfw{border-color:#7a3ec8;background:#7a3ec80f}
/* 横向刻度：硬限=屏幕边；软限=该深度可见的桌面半宽（翼可超出到背景上） */
.hruler{position:absolute;left:0;right:0;top:50%}
.hruler .soft{position:absolute;top:-1px;bottom:0;border-left:1px dashed #7a3ec8;border-right:1px dashed #7a3ec8;background:#7a3ec80d}
.hruler .hard{position:absolute;top:-1px;bottom:0;border-left:2px solid #c8143c;border-right:2px solid #c8143c;background:#c8143c0a}
.hruler b{position:absolute;top:4px;font-size:8.5px;line-height:11px;color:#fff;padding:0 3px;border-radius:2px;white-space:nowrap;font-weight:400}
.hruler .bl{left:2px;background:#c8143c}
.hruler .bm{left:50%;transform:translateX(-50%);background:#7a3ec8}
.hruler .br{right:2px;background:#c8143c}
/* 中部：小计分牌 + 已选 pill */
.mid{top:${o.midTop}px;height:${o.midH}px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:${o.midGap}px}
.plate{width:${o.plateW}px;height:${o.plate}px;background:linear-gradient(180deg,${C.paper},${C.paperDeep});border:1px solid ${C.goldLine};
border-radius:${px(1.4)}px;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(60,44,28,.2)}
.plate .a{font-size:${px(3.2)}px;font-weight:800;letter-spacing:.06em;line-height:1.15}
.plate .b{font-size:${px(2.4)}px;color:#6a5c48;line-height:1.15}
.pill{height:${o.pill}px;display:flex;align-items:center;background:linear-gradient(180deg,#efe6d2,#e2d5bb);
border:1px solid ${C.goldLine};border-radius:999px;padding:0 ${px(3.4)}px;font-size:${px(2.3)}px}
/* 手牌 */
.hand{top:${o.handTop}px;height:${o.handH}px;left:${o.padX}px;right:${o.padX}px;position:absolute;
display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(2,1fr);gap:${o.gap}px}
.card{position:relative;aspect-ratio:5/7;border-radius:${px(1.4)}px;background:linear-gradient(168deg,#fdf8ee,#eadfc9);
border:1px solid ${C.goldLine};box-shadow:0 1px 3px rgba(46,32,20,.28);padding:${px(1.2)}px}
.corner{position:absolute;font-weight:800;font-size:${px(3.6)}px;line-height:.95}
.tl{top:${px(1)}px;left:${px(1.6)}px}.br{bottom:${px(1)}px;right:${px(1.6)}px;transform:rotate(180deg)}
.pips{position:absolute;inset:20% 22%;display:grid;grid-template-columns:1fr 1fr;place-items:center;color:${C.coralDeep};font-size:${px(2.6)}px}
.red{color:${C.coralDeep}}.blk{color:#3d372c}
.sel{box-shadow:0 0 0 1.5px ${C.green},0 ${px(0.8)}px ${px(1.6)}px rgba(46,32,20,.3)}
.sel::after{content:'✓';position:absolute;top:${px(0.4)}px;right:${px(0.6)}px;width:${px(2)}px;height:${px(2)}px;border-radius:50%;
background:${C.green};color:#fff;font-size:${px(1.4)}px;line-height:${px(2)}px;text-align:center}
/* 操作区 */
.act{top:${o.actTop}px;height:${o.actH}px;left:${o.padX}px;right:${o.padX}px;position:absolute;
display:flex;align-items:center;gap:${o.gap}px}
.deck{font-size:${px(2.2)}px;color:rgba(246,238,218,.85);background:rgba(40,28,18,.55);border:1px solid rgba(246,238,218,.22);
border-radius:999px;padding:${px(0.5)}px ${px(2)}px;white-space:nowrap}
.btn{flex:1;height:100%;border-radius:${px(2.4)}px;border:1px solid ${C.goldLine};color:#fff8ea;font-size:${px(5)}px;font-weight:700;
display:flex;align-items:center;justify-content:center;letter-spacing:.1em;box-shadow:0 2px 5px rgba(40,26,16,.28)}
.dis{background:linear-gradient(180deg,#d98a70,${C.coralDeep})}
.pl{background:linear-gradient(180deg,#84a077,${C.greenDeep})}
/* 标注 */
.ann{position:absolute;left:0;right:0;pointer-events:none;z-index:60}
.ab{position:absolute;left:0;right:0;border-top:1px solid;border-bottom:1px solid}
.ab>span{position:absolute;right:2px;top:1px;font-size:9px;line-height:13px;color:#fff;padding:0 3px;border-radius:2px;white-space:nowrap}
.cap{position:absolute;left:0;right:0;top:0;height:${CAPH}px;padding:5px 8px;z-index:70;color:#fff;background:#1b1510;
font-size:11px;font-weight:700;line-height:1.45}
.cap em{font-style:normal;font-weight:400;font-size:9.5px;opacity:.9;display:block}
.cap s{text-decoration:none;float:right;font-size:9.5px;font-weight:400;opacity:.9}
</style></head><body>
<div class="cap">新版布局候选 · 示意 · 未实施 · 画面比例未通过投影验证<s>${w}×${h}</s>
  <em>桌沿 y=${o.tableLine} 为当前机位真实投影值（未改）；猫基座放在桌垫远端 z=-1.0，相机与桌面几何均不变</em></div>
<div class="s">
<div class="edge" title="当前机位桌面后沿"></div>
<div class="ui">
  <div class="hud"><span class="name">窗边牌局</span><span class="mode">练习模式</span><span class="sep"></span>
    <span class="score">累计<b>0</b></span><span class="gear">⚙</span></div>

  <div class="cat">
    <div class="shadow"></div>
    <div class="fig"><svg viewBox="0 0 200 300" aria-hidden="true">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#e8e2d6"/><stop offset="1" stop-color="#a89e8e"/></linearGradient></defs>
      <g fill="url(#g)">
        <path d="M46 96 L34 22 L96 62 Z"/><path d="M154 96 L166 22 L104 62 Z"/>
        <ellipse cx="100" cy="118" rx="58" ry="50"/>
        <path d="M26 300 C26 196 60 166 100 166 C140 166 174 196 174 300 Z"/></g></svg></div>
    <div class="sf sftl" style="width:${o.antlerW}px;height:${o.antlerH}px"><span>枝角猫安全框（高·窄）${o.antlerW}×${o.antlerH}</span></div>
    <div class="sf sftr" style="width:${o.wingW}px;height:${o.wingH}px"><span>翼猫安全框（宽）${o.wingW}×${o.wingH}</span></div>
    <div class="hruler">
      <div class="soft" style="left:${w / 2 - o.wingHW}px;right:${w / 2 - o.wingHW}px"></div>
      <div class="hard" style="left:${o.margin}px;right:${o.margin}px"></div>
      <b class="bl">屏幕硬边</b>
      <b class="bm">猫基深度可见桌面半宽 ±${o.wingHW}px</b>
      <b class="br">屏幕硬边</b>
    </div>
    <div class="base"></div>
  </div>

  <div class="z mid">
    <div class="plate"><div class="a">一对</div><div class="b">14 × 2 = 28</div></div>
    <div class="pill">已选 2/5</div>
  </div>

  <div class="z hand">
    ${[['2','♥',1,1],['9','♦',0,0],['Q','♥',0,0],['3','♣',0,0],['2','♣',1,1],['K','♠',0,0],['K','♦',0,0],['A','♥',0,0]]
      .map(([r,s,sel,red]) => `<div class="card${sel ? ' sel' : ''}">
      <span class="corner tl ${red ? 'red' : 'blk'}">${r}<br>${s}</span>
      <span class="corner br ${red ? 'red' : 'blk'}">${r}<br>${s}</span>
      <span class="pips ${red ? 'red' : 'blk'}">${s}</span></div>`).join('')}
  </div>

  <div class="z act"><span class="deck">牌堆 44</span><div class="btn dis">弃牌 3/3</div><div class="btn pl">出牌</div></div>
</div>
<div class="ann">
  <div class="ab" style="top:${o.catTop}px;height:${o.catH}px;border-color:#2f7fd0;background:#2f7fd014"><span style="background:#2f7fd0">猫咪区 ${o.catH}px（顶 ${o.catTop} → 基座 ${o.baseY}）</span></div>
  <div class="ab" style="top:${o.tableLine}px;height:2px;border:0;background:#c8143c"><span style="background:#c8143c;top:-13px">当前机位桌沿 y=${o.tableLine}（未改）</span></div>
  <div class="ab" style="top:${o.midTop}px;height:${o.midH}px;border-color:#c8143c;background:#c8143c0d"><span style="background:#c8143c">计分牌+已选 ${o.midH}px</span></div>
  <div class="ab" style="top:${o.handTop}px;height:${o.handH}px;border-color:#1f9d55;background:#1f9d5512"><span style="background:#1f9d55">手牌 4+4</span></div>
  <div class="ab" style="top:${o.actTop}px;height:${o.actH}px;border-color:#e0a02f;background:#e0a02f12"><span style="background:#e0a02f">操作区</span></div>
  <div class="ab" style="top:${o.gapTop}px;height:${o.gapH}px;border:0;background:repeating-linear-gradient(45deg,#ffffff10 0 6px,transparent 6px 12px)">
    <span style="background:#5b5346;top:2px">裸桌呼吸区 ${o.gapH}px</span></div>
</div>
</div></body></html>`;
}

async function waitForDevTools() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return; } catch {}
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
    ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('timeout ' + method)); } }, 20000); });

  await send('Page.enable');
  const report = [];
  for (const v of [{ n: '390x844', w: 390, h: 844 }, { n: '360x640', w: 360, h: 640 }]) {
    const { w, h } = v;
    const tableLine = Math.round(proj(w, h, -2.06));
    const baseY = Math.round(proj(w, h, -1.0)); // 猫基座：桌垫远端 z=-1.0
    const padTop = Math.round(w * 0.031), padBot = Math.round(w * 0.036), padX = Math.round(w * 0.065);
    const hud = Math.round(w * 0.103), gap = Math.round(w * 0.026);
    const catTop = padTop + hud + gap;
    const catH = baseY - catTop;
    // 底部锚定：操作区贴底，向上依次手牌、计分牌组；猫咪与计分牌之间是裸桌呼吸区
    const btn = Math.round(w * 0.138);
    const cardW = (w - padX * 2 - gap * 3) / 4, cardH = cardW * 1.4;
    const handH = Math.round(cardH * 2 + gap);
    const plate = Math.round(w * 0.118), pill = Math.round(w * 0.062), midGap = Math.round(w * 0.015);
    const midH = plate + midGap + pill;
    const actTop = h - padBot - btn;
    const handTop = actTop - gap - handH;
    const midTop = handTop - gap - midH;
    const gapTop = baseY + gap, gapH = midTop - gapTop;
    const wingHW = Math.round(halfW(w, h, -1.0));
    const margin = Math.round(w * 0.03);
    const o = {
      padTop, padBot, padX, hud, gap, tableLine, baseY, catTop, catH,
      figH: catH - 6, figAR: '200 / 300', shadowW: Math.round(wingHW * 1.05),
      antlerW: Math.round(w * 0.42), antlerH: Math.round(catH * 0.5),
      wingW: Math.min(w - margin * 2, Math.round(w * 0.8)), wingH: Math.round(catH * 0.3),
      wingHW, margin, midTop, midH, midGap, plate, plateW: Math.round(w * 0.42), pill,
      handTop, handH, actTop, actH: btn, gapTop, gapH,
    };
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h + CAPH, deviceScaleFactor: 2, mobile: false, screenWidth: w, screenHeight: h + CAPH });
    await send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html(w, h, o)) });
    await delay(600);
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const f = join(outDir, `newlayout-${v.n}.png`);
    writeFileSync(f, Buffer.from(s.data, 'base64'));
    report.push({ viewport: v.n, tableLine, catTop, catH, tableHalfW: wingHW, screenHardHalf: Math.round(w / 2 - margin),
      midTop, midH, handTop, handH, actTop, actBottom: actTop + btn, viewH: h, bareGap: gapH, file: f });
    console.log(`\n=== ${v.n} ===`);
    console.log(`  HUD ${padTop}~${padTop + hud}   猫咪区 ${catTop}~${baseY} = ${catH}px`);
    console.log(`  当前机位桌沿 y=${tableLine}（未改）→ 猫基座落在桌垫远端，超出桌沿 ${baseY - tableLine}px`);
    console.log(`  裸桌呼吸区 ${gapTop}~${midTop} = ${gapH}px ｜ 计分牌组 ${midH}px ｜ 手牌 ${handTop}~${handTop + handH} ｜ 操作区 ${actTop}~${actTop + btn}`);
    console.log(`  翼猫最大半宽：屏幕硬边 ±${Math.round(w / 2 - margin)}px（硬）／猫基深度可见桌面 ±${wingHW}px（软，可超到背景）`);
    console.log(`  → ${f}`);
  }
  writeFileSync(join(outDir, 'newlayout-report.json'), JSON.stringify(report, null, 2));
  ws.close(); child.kill();
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });