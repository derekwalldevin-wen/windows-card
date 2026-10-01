/**
 * 用已安装的 Microsoft Edge（无额外安装、无 Playwright）通过 DevTools 协议
 * 精确设置视口并截图，同时收集控制台错误。
 *
 * 仅绑定 127.0.0.1，不开放局域网端口，不改防火墙。
 *
 * 用法：node tools/shot.mjs <url> <outDir> [spec...]
 *   spec 形如  name:WxH[:mobile]
 *   例：    node tools/shot.mjs http://127.0.0.1:5173/ shots 360x640 390x844 430x932 1440x900
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\opencode\\wc-edge-cdp';
const PORT = 9333;

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.argv[3] ?? 'shots';
const specs = process.argv.slice(4);
if (specs.length === 0) specs.push('390x844');

mkdirSync(outDir, { recursive: true });
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(PROFILE, { recursive: true });

const child = spawn(
  EDGE,
  [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--mute-audio',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${PORT}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${PROFILE}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function waitForDevTools() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return await res.json();
    } catch {
      /* 还没起来 */
    }
    await delay(250);
  }
  throw new Error('DevTools 端点未就绪');
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
          else p.resolve(msg.result);
        }
      } else {
        this.events.push(msg);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时: ${method}`));
        }
      }, 30000);
    });
  }
}

async function main() {
  const ver = await waitForDevTools();
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  let target = list.find((t) => t.type === 'page');
  if (!target) {
    await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
    const l2 = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = l2.find((t) => t.type === 'page');
  }
  if (!target) throw new Error('找不到 page target');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  const cdp = new Cdp(ws);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');

  const results = [];

  for (const spec of specs) {
    const [name, size, mobileFlag] = spec.split(':');
    const [w, h] = (size ?? '390x844').split('x').map(Number);
    const mobile = mobileFlag === 'mobile';

    cdp.events.length = 0;
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: mobile ? 2 : 1,
      mobile,
      screenWidth: w,
      screenHeight: h,
    });
    if (mobile) {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } else {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }

    await cdp.send('Page.navigate', { url });
    await delay(2600);

    const metrics = await cdp.send('Runtime.evaluate', {
      expression: `JSON.stringify({
        inner: [window.innerWidth, window.innerHeight],
        dpr: window.devicePixelRatio,
        touch: navigator.maxTouchPoints,
        stage: (() => { const s=document.getElementById('stage').getBoundingClientRect(); return [Math.round(s.width), Math.round(s.height)]; })(),
        canvas: (() => { const c=document.getElementById('scene'); return [c.width, c.height]; })(),
        scroll: [document.documentElement.scrollWidth, document.documentElement.clientWidth, document.documentElement.scrollHeight, document.documentElement.clientHeight],
        selfcheck: (() => { const e=document.getElementById('selfcheck'); return e ? e.textContent : null; })(),
        gl: (() => { const c=document.createElement('canvas'); return { webgl2: !!c.getContext('webgl2') }; })()
      })`,
      returnByValue: true,
    });

    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    const file = join(outDir, `${name}-${w}x${h}${mobile ? '-mobile' : ''}.png`);
    writeFileSync(file, Buffer.from(shot.data, 'base64'));

    const problems = cdp.events
      .filter(
        (e) =>
          (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') ||
          (e.method === 'Runtime.exceptionThrown') ||
          (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'),
      )
      .map((e) => JSON.stringify(e.params).slice(0, 400));

    const warnings = cdp.events
      .filter(
        (e) =>
          (e.method === 'Log.entryAdded' && e.params.entry.level === 'warning') ||
          (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'warning'),
      )
      .map((e) => JSON.stringify(e.params).slice(0, 300));

    const failed = cdp.events
      .filter((e) => e.method === 'Network.loadingFailed')
      .map((e) => JSON.stringify(e.params).slice(0, 200));

    results.push({
      spec,
      file,
      metrics: JSON.parse(metrics.result.value),
      problems,
      warnings,
      failed,
    });
    process.stdout.write(
      `OK ${spec} -> ${file}  errors=${problems.length} warnings=${warnings.length} netfail=${failed.length}\n`,
    );
  }

  writeFileSync(join(outDir, 'report.json'), JSON.stringify({ browser: ver.Browser, results }, null, 2));
  ws.close();
  child.kill();
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  child.kill();
  process.exit(1);
});
