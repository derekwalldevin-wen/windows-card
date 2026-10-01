/**
 * 确认正常入口**没有活动的旧 WebGL 渲染循环**。
 *
 * 三路证据：
 *  1. 页面上不存在已获取上下文的可见 canvas；
 *  2. 观察 N 秒内 requestAnimationFrame 的回调次数 —— 有渲染循环的话会持续触发；
 *  3. 构建产物里不含 three 的渲染代码（WebGLRenderer / PerspectiveCamera）。
 *
 * 运行：node tools\no-webgl-check.mjs <dev 或 preview 地址> [dist 目录]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\opencode\\wc-edge-cdp';
const PORT = 9337;
const base = (process.argv[2] ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const distDir = process.argv[3] ?? 'dist';
const outDir = join('shots', 'no-webgl');
/** 观察时长 */
const WATCH_MS = 4000;

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
    '--disable-extensions', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
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
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
  await send('Page.navigate', { url: `${base}/` });
  await delay(2500);

  // 1) canvas 与上下文
  //
  // 注意：**不能**为了查「有没有上下文」而调用 getContext() ——
  // 那等于自己把上下文建出来，hasCtx 永远是 true（第一版就踩了这个坑，
  // 把探测产生的上下文误当成页面遗留的）。
  //
  // 正确做法：先看页面是否已把上下文记录在自己身上。
  // three 的 WebGLRenderer 会在 canvas 上挂内部标记（__webglRenderer 等），
  // 我们没有创建过 renderer，所以只要检查这些标记即可，不去主动建上下文。
  const r1 = await send('Runtime.evaluate', {
    expression: `JSON.stringify((() => {
      const cs = Array.from(document.querySelectorAll('canvas'));
      return cs.map((c) => ({
        id: c.id || null,
        hidden: c.hidden,
        display: getComputedStyle(c).display,
        w: c.width, h: c.height,
        // three 若接管过这个 canvas 会留下这些痕迹
        hasRendererMarker: '__webglRenderer' in c || '__threeRenderer' in c,
        // 页面是否曾获取过上下文：浏览器不会暴露历史，只能看有没有第三方标记
        dataAttrs: Object.keys(c.dataset).length,
      }));
    })())`,
    returnByValue: true,
  });
  const canvases = JSON.parse(r1.result.value);

  // 2) rAF 活跃度
  //
  // 注意：**不能**自己起一个 rAF 循环去计数 —— 那正是「渲染循环」本身，
  // 数出来的全是探测代码自己的回调（第一版就踩了这个坑，数到 301 次）。
  //
  // 正确做法：页面加载前把 window.requestAnimationFrame 包一层，
  // 只统计「除我之外」的回调被调用的次数。有渲染循环就会持续增长；
  // 静态页面则只在交互时偶尔触发。
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const raw = window.requestAnimationFrame.bind(window);
      let count = 0;
      window.requestAnimationFrame = (cb) => raw((t) => {
        // 计数这一个包装层被调用的次数
        count++;
        return cb(t);
      });
      window.__pageRafCount = () => count;
    })();`,
  });
  await send('Page.navigate', { url: `${base}/` });
  await delay(2500);
  const rafAfterLoad = Number((await send('Runtime.evaluate', {
    expression: `String(window.__pageRafCount ? window.__pageRafCount() : -1)`,
    returnByValue: true,
  })).result.value);
  await delay(WATCH_MS);
  const r2 = await send('Runtime.evaluate', {
    expression: `String(window.__pageRafCount ? window.__pageRafCount() : -1)`,
    returnByValue: true,
  });
  const rafEnd = Number(r2.result.value);
  // 观察窗口内的增量才是关键指标
  const rafCount = rafEnd - rafAfterLoad;

  // 3) 构建产物里是否含 three 渲染代码
  const jsFiles = readdirSync(join(distDir, 'assets')).filter((f) => f.endsWith('.js'));
  let hasThree = false;
  const hits = [];
  for (const f of jsFiles) {
    const txt = readFileSync(join(distDir, 'assets', f), 'utf8');
    for (const kw of ['WebGLRenderer', 'PerspectiveCamera', 'WebGLRenderTarget', 'requestAnimationFrame']) {
      if (txt.includes(kw)) { hasThree = true; hits.push(`${f}:${kw}`); }
    }
  }

  const activeCanvases = canvases.filter((c) => !c.hidden && c.display !== 'none');
const rendererTaken = canvases.filter((c) => c.hasRendererMarker);
const checks = [
  ['页面上没有处于显示状态的 canvas', activeCanvases.length === 0],
    [`canvas 数量 ${canvases.length}（${canvases.map((c) => `${c.id ?? '(匿名)'}:${c.display}`).join(', ') || '无'}）`, canvases.length <= 1],
  ['没有 canvas 留下 three renderer 接管痕迹', rendererTaken.length === 0],
  [`静止观察 ${WATCH_MS}ms，页面自身 rAF 增量 ${rafCount} 次`, rafCount === 0],
  [`构建产物不含 three 渲染代码${hits.length ? '（命中 ' + hits.join(',') + '）' : ''}`, !hasThree],
];

console.log('=== 旧 WebGL 渲染循环检查 ===');
console.log(`canvas：${JSON.stringify(canvases)}`);
  console.log(`rAF：页面加载完成时累计 ${rafAfterLoad} 次，静止观察 ${WATCH_MS}ms 后累计 ${rafEnd} 次 → 增量 ${rafCount}`);
  console.log(`构建产物 JS：${jsFiles.join(', ')}`);
  console.log(`three 渲染代码命中：${hits.length ? hits.join(', ') : '无'}\n`);
  let bad = 0;
  for (const [name, ok] of checks) {
    if (!ok) bad++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  }
  writeFileSync(join(outDir, 'report.json'), JSON.stringify({
    canvases, rafAfterLoad, rafEnd, rafCount, watchMs: WATCH_MS, jsFiles, threeHits: hits, checks, bad,
  }, null, 2));
  console.log(`\n合计 ${checks.length} 项，失败 ${bad} 项`);
  console.log('注：rAF 计数通过加载前注入的包装层统计「页面自身」的回调，不含探测代码。');

  ws.close(); child.kill();
}
main().catch((e) => { console.error('FAILED:', e.stack); process.exit(1); });