/**
 * 检查「调整窗口后背景与猫咪同步定位」：
 * 在同一页面里连续改视口，确认背景缩放与猫脚锚点按预期变化，
 * 且猫脚始终落在背景原图坐标的同一位置（桌垫内）。
 *
 * 运行：node tools\bg-resize-sync.mjs <dev 或 preview 地址>
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\opencode\\wc-edge-cdp';
const PORT = 9335;
const base = (process.argv[2] ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const outDir = join('shots', 'resize');

/** 背景原图尺寸与桌垫实测范围 */
const BG = { w: 852, h: 1846 };
const RUNNER = { top: 348, bottom: 600, left: 54, right: 793 };

/** 连续变化的视口：模拟拖窗口 */
const SEQUENCE = [
  { w: 390, h: 844, mobile: true },
  { w: 412, h: 915, mobile: true },
  { w: 360, h: 800, mobile: true },
  { w: 430, h: 932, mobile: true },
  { w: 360, h: 640, mobile: true },
  { w: 1440, h: 900, mobile: false },
  { w: 1280, h: 720, mobile: false },
  { w: 390, h: 844, mobile: true },
];

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
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    `--remote-debugging-port=${PORT}`, '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });
  await waitForDevTools();
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const t = list.find((x) => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
    if (m.id !== undefined) { const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params); });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('timeout ' + method)); } }, 30000); });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: `${base}/?selfcheck=1&cat=forest` });
  await delay(2500);

  const read = async () => {
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        const e = document.getElementById('selfcheck');
        const g = (s) => document.querySelector(s);
        const rect = (s) => { const el = g(s); if (!el) return null; const b = el.getBoundingClientRect();
          return { x: b.left, y: b.top, w: b.width, h: b.height }; };
        const stage = rect('#stage');
        const img = rect('.cat-img');
        const sh = rect('.cat-shadow');
        return JSON.stringify({
          stage, img, shadow: sh,
          bg: {
            scale: getComputedStyle(g('#stage')).getPropertyValue('--bg-scale').trim(),
            w: getComputedStyle(g('#stage')).getPropertyValue('--bg-w').trim(),
            h: getComputedStyle(g('#stage')).getPropertyValue('--bg-h').trim(),
            x: getComputedStyle(g('#stage')).getPropertyValue('--bg-x').trim(),
          },
          catFootXRatio: g('.zone-cat')?.dataset.catFootX,
          catFootLift: g('.zone-cat')?.dataset.catFootLift,
          scroll: [document.documentElement.scrollWidth, document.documentElement.clientWidth,
                   document.documentElement.scrollHeight, document.documentElement.clientHeight],
        });
      })()`,
      returnByValue: true,
    });
    return JSON.parse(r.result.value);
  };

  console.log('视口'.padEnd(12) + 'bgScale'.padEnd(11) + '背景缩放后'.padEnd(18) + '猫贴图'.padEnd(14) + '猫脚(舞台内)'.padEnd(16) + '猫脚(原图)'.padEnd(15) + '在桌垫上'.padEnd(11) + '影贴脚');
  console.log('─'.repeat(110));

  const rows = [];
  for (const v of SEQUENCE) {
    errors.length = 0;
    await send('Emulation.setDeviceMetricsOverride', {
      width: v.w, height: v.h, deviceScaleFactor: v.mobile ? 2 : 1,
      mobile: v.mobile, screenWidth: v.w, screenHeight: v.h,
    });
    await delay(700);
    const d = await read();
    const stage = d.stage;
    const img = d.img;
    const footXRel = parseFloat(d.catFootXRatio);
    const lift = parseFloat(d.catFootLift);
    // 猫脚落点：贴图矩形 + 逐猫锚点
    const footX = img.x + footXRel * img.w;
    const footY = img.y + img.h - lift * img.h;
    const relX = footX - stage.x;
    const relY = footY - stage.y;
    const bw = parseFloat(d.bg.w), bh = parseFloat(d.bg.h), bx = parseFloat(d.bg.x);
    const origX = ((relX - bx) / bw) * BG.w;
    const origY = (relY / bh) * BG.h;
    const onRunner = origY >= RUNNER.top && origY <= RUNNER.bottom && origX >= RUNNER.left && origX <= RUNNER.right;
    // 接地影中心是否也在脚底附近
    const shCx = d.shadow ? d.shadow.x + d.shadow.w / 2 : NaN;
    const shadowAligned = Math.abs(shCx - footX) < Math.max(6, img.w * 0.15);

    rows.push({ viewport: `${v.w}x${v.h}`, mobile: v.mobile, scale: parseFloat(d.bg.scale), footX, footY, origX, origY, onRunner, shadowAligned, errors: errors.length, scroll: d.scroll });

    console.log(
      `${v.w}x${v.h}`.padEnd(12) +
      parseFloat(d.bg.scale).toFixed(4).padEnd(11) +
      `${bw.toFixed(0)}×${bh.toFixed(0)}`.padEnd(18) +
      `${img.w.toFixed(0)}×${img.h.toFixed(0)}`.padEnd(14) +
      `(${relX.toFixed(0)},${relY.toFixed(0)})`.padEnd(18) +
      `(${origX.toFixed(0)},${origY.toFixed(0)})`.padEnd(16) +
      (onRunner ? 'OK' : '⚠不在').padEnd(12) +
      (shadowAligned ? 'OK' : '⚠偏') +
      (errors.length ? `  ⚠ ${errors.length} 错误` : ''),
    );
  }

  writeFileSync(join(outDir, 'report.json'), JSON.stringify({ runner: RUNNER, bg: BG, rows }, null, 2));
  const bad = rows.filter((r) => !r.onRunner || !r.shadowAligned || r.errors > 0);
  console.log(`\n合计 ${rows.length} 个视口切换，问题 ${bad.length} 个`);
  if (bad.length) for (const b of bad) console.log(`  ⚠ ${b.viewport}: 桌垫=${b.onRunner} 影对齐=${b.shadowAligned} 错误=${b.errors}`);

  ws.close(); child.kill();
}
main().catch((e) => { console.error('FAILED:', e.stack); process.exit(1); });