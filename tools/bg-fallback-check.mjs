/**
 * 检查背景图加载失败时的降级：
 * 拦截背景图请求返回 404，确认页面给出明确提示、
 * 且界面与卡牌仍可正常操作（不留无法操作的空白页）。
 *
 * 运行：node tools\bg-fallback-check.mjs <dev 或 preview 地址> [输出目录]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\opencode\\wc-edge-cdp';
const PORT = 9336;
const base = (process.argv[2] ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const outDir = process.argv[3] ?? join('shots', 'fallback');
const BG_PATH = '/backgrounds/cozy-window-table-background-v1.png';

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
  let id = 0; const pending = new Map(); const errors = []; const failedReqs = [];
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
    if (m.id !== undefined) { const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params);
    else if (m.method === 'Network.loadingFailed') failedReqs.push(m.params); });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('timeout ' + method)); } }, 30000); });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });

  // 拦截背景图请求，返回 404 —— 模拟素材缺失
  await send('Network.setBlockedURLs', { urls: [`*${BG_PATH}*`] });
  await send('Network.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: `*${BG_PATH}*`, requestStage: 'Request' }] });
  await send('Fetch.failRequest', { requestId: 'x' }).catch(() => {});
  // 用 fulfillRequest 明确返回 404
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Fetch.requestPaused') {
      send('Fetch.fulfillRequest', {
        requestId: m.params.requestId,
        responseCode: 404,
        responseHeaders: [{ name: 'content-type', value: 'text/plain' }],
        body: Buffer.from('not found').toString('base64'),
      }).catch(() => {});
    }
  });

  await send('Page.navigate', { url: `${base}/` });
  await delay(3000);

  const check = async (label, expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r.result?.value;
  };

  const state = await check('state', `JSON.stringify({
    bgFailedClass: document.querySelector('.bg-layer')?.classList.contains('is-failed') === true,
    fallbackVisible: (() => { const f = document.querySelector('.bg-fallback');
      return !!f && !f.hidden && (f.textContent || '').trim().length > 0; })(),
    fallbackText: (document.querySelector('.bg-fallback')?.textContent || '').trim(),
    stageBgFlag: document.getElementById('stage')?.dataset.bg,
    // 关键：界面还能不能操作
    handCards: document.querySelectorAll('.zone-hand .card').length,
    hudVisible: (() => { const h = document.querySelector('.zone-hud'); if (!h) return false;
      const b = h.getBoundingClientRect(); return b.width > 0 && b.height > 0; })(),
    plateVisible: (() => { const p = document.querySelector('.play-plate'); if (!p) return false;
      const b = p.getBoundingClientRect(); return b.width > 0 && b.height > 0; })(),
    buttonsVisible: ['.btn-discard','.btn-play'].filter(s => {
      const el = document.querySelector(s); if (!el) return false;
      const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; }).length,
    bgLayerHasFallbackColor: (() => {
      const l = document.querySelector('.bg-layer'); if (!l) return false;
      const bg = getComputedStyle(l).backgroundImage;
      return bg.includes('gradient'); })(),
    catStillShown: (() => { const c = document.querySelector('.cat-img'); if (!c) return false;
      const b = c.getBoundingClientRect(); return b.width > 0 && b.height > 0; })(),
  })`);

  const s = JSON.parse(state);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const f = join(outDir, 'bg-failed-390x844.png');
  writeFileSync(f, Buffer.from(shot.data, 'base64'));

  // 再点一张手牌，确认仍可交互
  await send('Runtime.evaluate', { expression: `document.querySelector('.zone-hand .card')?.click()` });
  await delay(400);
  const afterClick = await check('after', `JSON.stringify({
    selected: document.querySelectorAll('.zone-hand .card[data-role="selected"]').length,
    plateTitle: document.querySelector('.play-plate-title')?.textContent,
  })`);
  const a = JSON.parse(afterClick);

  const checks = [
    ['背景层标记为失败', s.bgFailedClass],
    ['给出可见降级提示', s.fallbackVisible],
    ['提示文案非空', s.fallbackText.length > 0],
    ['降级底色为渐变（非空白）', s.bgLayerHasFallbackColor],
    ['HUD 仍可见', s.hudVisible],
    ['计分牌仍可见', s.plateVisible],
    ['两个按钮均可见', s.buttonsVisible === 2],
    [`手牌 8 张（实测 ${s.handCards}）`, s.handCards === 8],
    ['猫咪仍显示', s.catStillShown],
    ['点击手牌可选中（降级下仍可玩）', a.selected === 1],
    ['选牌后计分牌更新', (a.plateTitle ?? '') !== '选牌看分'],
    ['未捕获异常（渲染循环等）', errors.length === 0],
  ];

  console.log('=== 背景图 404 时的降级检查 ===');
  console.log(`提示文案：${s.fallbackText}`);
  console.log(`stage data-bg：${s.stageBgFlag}\n`);
  let bad = 0;
  for (const [name, ok] of checks) {
    if (!ok) bad++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  }
  writeFileSync(join(outDir, 'report.json'), JSON.stringify({ state: s, afterClick: a, errors: errors.length, checks, bad }, null, 2));
  console.log(`\n合计 ${checks.length} 项，失败 ${bad} 项`);
  console.log(`截图 → ${f}`);

  ws.close(); child.kill();
}
main().catch((e) => { console.error('FAILED:', e.stack); process.exit(1); });