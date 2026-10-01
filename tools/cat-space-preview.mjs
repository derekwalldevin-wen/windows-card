/**
 * 只读预览：生成「原版 / 候选」对比图。不修改项目任何文件。
 *
 * 原版 = 真实运行中的游戏页面 + 运行时注入的测量标注层（仅 DOM 覆盖，不改源码）
 * 候选 = 示意页（同一套 CSS 变量与实测数值），明确标注「未实施」
 *
 * 运行：node tools/cat-space-preview.mjs <url> <outDir>
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import * as THREE from 'three';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\opencode\\wc-edge-preview';
const PORT = 9335;

const appUrl = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.argv[3] ?? 'preview';

// ---- 与项目源码一致的只读常量 ----
const CAM = { height: 1.15, back: 0.62, pitchDeg: 42, fovDeg: 58 };
const TABLE_BACK_Z = -2.06;
const TABLE_BACK_Z_CAND = -1.9;
const ROOM = { wallZ: -2.12, holeBottom: 0.1, holeTop: 0.49 };

// 候选的布局参数（方案见回执）
const CAND = { pad: 9, hud: 34, effectsV: 0, gap: 4, tableBackZ: TABLE_BACK_Z_CAND };
// 原版实测（?selfcheck=1）
const ORIG = {
  '390x844': { pad: 13.9, hud: 42.9, eff: 25, gap: 8.6, catTop: 98.9 },
  '360x640': { pad: 10.4, hud: 34.6, eff: 19.4, gap: 6.5, catTop: 82.7 },
};

function makeCam(h, b, p) {
  const c = new THREE.PerspectiveCamera(CAM.fovDeg, 1, 0.02, 24);
  const pitch = (p * Math.PI) / 180;
  c.position.set(0, h, b);
  c.up.set(0, 1, 0);
  c.lookAt(new THREE.Vector3(0, 0, b - h / Math.tan(pitch)));
  c.updateMatrixWorld(true);
  c.updateProjectionMatrix();
  return c;
}
function py(c, H, y, z) {
  return ((1 - new THREE.Vector3(0, y, z).project(c).y) / 2) * H;
}

function tableLine(w, H, tz) {
  const c = makeCam(CAM.height, CAM.back, CAM.pitchDeg);
  c.aspect = w / H;
  c.updateProjectionMatrix();
  return py(c, H, 0, tz);
}
function windowSpan(w, H) {
  const c = makeCam(CAM.height, CAM.back, CAM.pitchDeg);
  c.aspect = w / H;
  c.updateProjectionMatrix();
  return { top: py(c, H, ROOM.holeTop, ROOM.wallZ), bottom: py(c, H, ROOM.holeBottom, ROOM.wallZ) };
}

const VIEWPORTS = [
  { name: '390x844', w: 390, h: 844 },
  { name: '360x640', w: 360, h: 640 },
];

// ---- 标注层：仅运行时注入，不改源码 ----
// 用普通函数 + JSON 传参，避免模板字符串插值出错
function overlayInPage(d) {
  const prev = document.getElementById('__catspace_overlay');
  if (prev) prev.remove();
  const wrap = document.createElement('div');
  wrap.id = '__catspace_overlay';
  wrap.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:9999;font-family:system-ui,sans-serif';

  const bands = [
    { y0: d.catTop, y1: d.catTop + d.catH, color: '#2f7fd0', label: '猫咪可用区 ' + d.catH + 'px', dash: '' },
    { y0: d.headTop, y1: d.headBottom, color: '#e0552f', label: '头+耳安全区 ' + (d.headBottom - d.headTop) + 'px', dash: '5 3' },
    { y0: d.tableLine, y1: d.tableLine + 1, color: '#c8143c', label: '3D 桌沿 y=' + d.tableLine, dash: '' },
    { y0: d.handTop, y1: d.handBottom, color: '#1f9d55', label: '手牌 4+4 y=' + d.handTop + '~' + d.handBottom, dash: '' },
  ];
  for (const b of bands) {
    const el = document.createElement('div');
    el.style.cssText =
      'position:absolute;left:0;right:0;top:' + b.y0 + 'px;height:' + Math.max(1, b.y1 - b.y0) +
      'px;border-top:1px ' + b.dash + ' ' + b.color +
      ';border-bottom:1px ' + b.dash + ' ' + b.color +
      ';background:' + b.color + '14';
    const t = document.createElement('span');
    t.textContent = b.label;
    t.style.cssText =
      'position:absolute;right:2px;top:1px;font-size:10px;line-height:1.3;color:#fff;background:' +
      b.color + ';padding:0 3px;border-radius:2px;white-space:nowrap';
    el.appendChild(t);
    wrap.appendChild(el);
  }

  const win = document.createElement('div');
  win.style.cssText =
    'position:absolute;left:0;right:0;top:' + d.winTop + 'px;height:' + Math.max(1, d.winBottom - d.winTop) +
    'px;border:1px dashed #8a5ac8;background:#8a5ac810';
  const wt = document.createElement('span');
  wt.textContent = '窗（不构成猫咪上边界）';
  wt.style.cssText =
    'position:absolute;left:2px;top:1px;font-size:10px;line-height:1.3;color:#fff;background:#8a5ac8;padding:0 3px;border-radius:2px;white-space:nowrap';
  win.appendChild(wt);
  wrap.appendChild(win);
  document.body.appendChild(wrap);
  return true;
}
const OVERLAY_CALL = (data) => `(${overlayInPage.toString()})(${JSON.stringify(data)})`;

async function waitForDevTools() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return r.json();
    } catch { /* 等待 */ }
    await delay(250);
  }
  throw new Error('DevTools 未就绪');
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
      if (m.id !== undefined) { const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } } }); }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('超时 ' + method)); } }, 30000); });
  }
}

// 候选示意页（独立文件，不参与游戏构建）
function candidateHtml(w, h, o) {
  const u = w / 100;
  const scale = (n) => Math.max(4, Math.min(60, n * u));
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>
*{box-sizing:border-box}html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;
font-family:system-ui,'Microsoft YaHei',sans-serif;background:#2a1f16}
.wrap{position:relative;width:${w}px;height:${h}px;background:
 linear-gradient(180deg,#efe6d2 0%,#e9dfc9 ${Math.round((o.tableLine / h) * 100)}%,#8a5a38 ${Math.round((o.tableLine / h) * 100)}%,#6b4529 100%)}
.ui{position:absolute;inset:0;display:flex;flex-direction:column;gap:${o.gap}px;
padding:${o.pad}px ${Math.round(u * 7)}px}
.hud{height:${o.hud}px;border-radius:999px;background:linear-gradient(180deg,rgba(247,240,226,.95),rgba(231,219,196,.92));
border:1px solid rgba(176,141,87,.5);display:flex;align-items:center;gap:8px;padding:0 10px;font-size:11px;color:#463c30}
.badge{background:linear-gradient(180deg,#e0b563,#b08d57);color:#40301c;border-radius:999px;padding:2px 7px;font-weight:700;font-size:10px}
.eff{margin-left:auto;display:flex;gap:5px}
.eff i{width:9px;height:9px;border:1px dashed rgba(70,60,48,.5);border-radius:3px}
.cat{flex:0 0 auto;height:${o.catH}px;position:relative;overflow:visible}
.fig{position:absolute;left:50%;bottom:0;transform:translateX(-50%);height:100%;aspect-ratio:200/214;
display:flex;align-items:flex-end;justify-content:center}
.fig svg{width:100%;height:100%}
.occ{position:absolute;left:-2%;right:-2%;bottom:0;height:22%;
background:linear-gradient(to bottom,rgba(120,78,46,0),rgba(104,66,38,.7) 40%,rgba(84,52,30,.96))}
.spacer{flex:1 1 auto}
.play{flex:0 0 auto;min-height:${Math.round(u * 20)}px;border-radius:${scale(5.5)}px;
border:1px solid rgba(247,240,226,.3);background:rgba(244,236,219,.14);display:flex;align-items:center;justify-content:center;
color:rgba(246,238,218,.5);font-size:11px}
.hand{flex:0 0 auto;display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(2,1fr);gap:${o.gap}px}
.card{aspect-ratio:5/7;border-radius:6px;background:linear-gradient(168deg,#fdf7ea,#e6d9bf);
box-shadow:0 1px 2px rgba(46,32,20,.3);display:flex;align-items:center;justify-content:center;
font-weight:800;color:#3f362b;font-size:${scale(4.2)}px}
.bottom{flex:0 0 auto;display:flex;flex-direction:column;gap:${o.gap}px}
.prev{height:${Math.round(u * 6.4)}px;border-radius:999px;background:rgba(38,28,20,.62);border:1px solid rgba(247,240,226,.22);
display:flex;align-items:center;padding:0 10px;color:#f6eeda;font-size:10px}
.acts{display:flex;gap:${o.gap}px}
.btn{flex:1;height:${Math.round(u * 13)}px;border-radius:14px;display:flex;align-items:center;justify-content:center;
font-size:${scale(5)}px;font-weight:700;color:#fff8ea;background:linear-gradient(180deg,#93a684,#6d7f62)}
.btn.r{background:linear-gradient(180deg,#dd8069,#c25f48)}
.ann{position:absolute;left:0;right:0;pointer-events:none;z-index:50;font-family:system-ui,sans-serif}
.b{position:absolute;left:0;right:0;border-top:1px solid;border-bottom:1px solid}
.b span{position:absolute;right:2px;top:1px;font-size:10px;color:#fff;padding:0 3px;border-radius:2px;white-space:nowrap}
.cap{position:absolute;left:0;right:0;top:0;padding:6px 8px;font-size:12px;font-weight:700;color:#fff;background:rgba(0,0,0,.62);z-index:60;text-align:center}
</style></head><body><div class="wrap"><div class="ui">
<div class="hud"><span class="badge">练习模式</span><span>累计 0</span><span>弃牌 3/3</span><span>牌堆 44</span>
<span class="eff"><i></i><i></i><i></i></span></div>
<div class="cat"><div class="fig">
<svg viewBox="0 0 200 214" aria-hidden="true"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#cfc4b4"/><stop offset="1" stop-color="#9c9083"/></linearGradient></defs>
<g fill="url(#g)"><path d="M50 66 L41 12 L95 46 Z"/><path d="M150 66 L159 12 L105 46 Z"/>
<ellipse cx="100" cy="88" rx="52" ry="46"/><path d="M34 214 C34 150 62 126 100 126 C138 126 166 150 166 214 Z"/></g></svg>
</div><div class="occ"></div></div>
<div class="spacer"></div>
<div class="play">出牌展示区</div>
<div class="hand">${['2♥', '9♦', 'Q♥', '3♣', '2♣', 'K♠', 'K♦', 'A♥'].map((t) => `<div class="card">${t}</div>`).join('')}</div>
<div class="bottom"><div class="prev">点选手牌开始（最多 5 张）</div>
<div class="acts"><div class="btn r">弃牌 3/3</div><div class="btn">出牌</div></div></div>
</div>
<div class="ann">
 <div class="b" style="top:${o.catTop}px;height:${o.catH}px;border-color:#2f7fd0;background:#2f7fd014"><span style="background:#2f7fd0">猫咪可用区 ${o.catH}px</span></div>
 <div class="b" style="top:${o.headTop}px;height:${o.headBottom - o.headTop}px;border-color:#e0552f;background:#e0552f14;border-top-style:dashed;border-bottom-style:dashed"><span style="background:#e0552f">头+耳安全区 ${o.headBottom - o.headTop}px</span></div>
 <div class="b" style="top:${o.tableLine}px;height:1px;border:0;background:#c8143c"><span style="background:#c8143c;top:-14px">3D 桌沿 y=${Math.round(o.tableLine)}</span></div>
 <div class="b" style="top:${o.handTop}px;height:${o.handBottom - o.handTop}px;border-color:#1f9d55;background:#1f9d5514"><span style="background:#1f9d55">手牌 4+4</span></div>
</div>
<div class="cap">候选方案（示意 · 尚未实施） ${w}×${h}</div>
</div></body></html>`;
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
  const target = list.find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  const cdp = new Cdp(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const report = [];
  for (const vp of VIEWPORTS) {
    const { w, h } = vp;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true, screenWidth: w, screenHeight: h });

    const win = windowSpan(w, h);
    const tlOrig = tableLine(w, h, TABLE_BACK_Z);
    const tlCand = tableLine(w, h, CAND.tableBackZ);
    const o = ORIG[vp.name];
    const catTopOrig = o.catTop;
    const catHOrig = Math.round(tlOrig - catTopOrig);
    const catTopCand = CAND.pad + CAND.hud + CAND.effectsV + CAND.gap;
    const catHCand = Math.round(tlCand - catTopCand);
    // 头+耳安全区：占猫咪可用区上部（按占位 viewBox：耳尖 y=12 → 头底 y=134，即 5.6%~62.6%）
    const mk = (top, ch) => ({ headTop: Math.round(top + ch * 0.056), headBottom: Math.round(top + ch * 0.626) });

    // ---- 原版：真实页面 + 注入标注 ----
    await cdp.send('Page.navigate', { url: appUrl });
    await delay(2600);
    const rects = await cdp.send('Runtime.evaluate', {
      expression: `(() => { const q=(s)=>{const e=document.querySelector(s); if(!e) return null; const r=e.getBoundingClientRect(); return {y:Math.round(r.top),h:Math.round(r.height),b:Math.round(r.bottom)};};
        return { hand:q('.zone-hand'), play:q('.zone-play'), cat:q('.zone-cat'), eff:q('.zone-effects'), hud:q('.zone-hud') }; })()`,
      returnByValue: true,
    });
    const R = rects.result.value;
    const oh = mk(catTopOrig, catHOrig);
    const ovRes = await cdp.send('Runtime.evaluate', {
      expression: OVERLAY_CALL({
        catTop: catTopOrig, catH: catHOrig, tableLine: Math.round(tlOrig),
        headTop: oh.headTop, headBottom: oh.headBottom,
        handTop: R.hand.y, handBottom: R.hand.b,
        winTop: Math.round(win.top), winBottom: Math.round(win.bottom),
      }),
      returnByValue: true,
    });
    if (ovRes.exceptionDetails) {
      console.error('OVERLAY 注入失败:', JSON.stringify(ovRes.exceptionDetails).slice(0, 500));
    } else {
      console.log(`  ${vp.name} 标注层注入: ${ovRes.result?.value}`);
    }
    await delay(150);
    let s = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const fOrig = join(outDir, `${vp.name}-orig-annotated.png`);
    writeFileSync(fOrig, Buffer.from(s.data, 'base64'));

    // ---- 候选：示意页 ----
    const ch = mk(catTopCand, catHCand);
    const html = candidateHtml(w, h, {
      pad: CAND.pad, hud: CAND.hud, gap: CAND.gap,
      catTop: catTopCand, catH: catHCand, tableLine: Math.round(tlCand),
      headTop: ch.headTop, headBottom: ch.headBottom,
      handTop: R.hand.y, handBottom: R.hand.b,
    });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false, screenWidth: w, screenHeight: h });
    await cdp.send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) });
    await delay(700);
    s = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const fCand = join(outDir, `${vp.name}-candidate-schematic.png`);
    writeFileSync(fCand, Buffer.from(s.data, 'base64'));

    report.push({ viewport: vp.name, tableLineOrig: +tlOrig.toFixed(1), tableLineCand: +tlCand.toFixed(1),
      catTopOrig, catHOrig, catTopCand, catHCand,
      headOrig: [oh.headTop, oh.headBottom - oh.headTop], headCand: [ch.headTop, ch.headBottom - ch.headTop],
      hand: [R.hand.y, R.hand.b], window: [Math.round(win.top), Math.round(win.bottom)],
      files: [fOrig, fCand] });
  }

  writeFileSync(join(outDir, 'preview-report.json'), JSON.stringify(report, null, 2));
  for (const r of report) {
    console.log(`\n=== ${r.viewport} ===`);
    console.log(`  3D 桌沿      原版 y=${r.tableLineOrig}   候选 y=${r.tableLineCand}`);
    console.log(`  猫咪区顶     原版 y=${r.catTopOrig}   候选 y=${r.catTopCand}`);
    console.log(`  猫咪可用高   原版 ${r.catHOrig}px   →   候选 ${r.catHCand}px   （${r.catHCand > r.catHOrig ? '+' : ''}${r.catHCand - r.catHOrig}px）`);
    console.log(`  头+耳安全区  原版 ${r.headOrig[1]}px   →   候选 ${r.headCand[1]}px`);
    console.log(`  手牌范围     y=${r.hand[0]}~${r.hand[1]}（不变）`);
    console.log(`  窗范围       y=${r.window[0]}~${r.window[1]}（不变）`);
  }
  ws.close();
  child.kill();
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });