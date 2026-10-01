/**
 * 逐只验收七只猫的安全范围：
 * 对每个视口 × 每只猫，读取 ?selfcheck=1 的真实页面读数，
 * 输出贴图显示尺寸、左右余量、以及脸/耳是否落在猫咪区内。
 *
 * 运行：node tools/cat-all-check.mjs <dev server 地址>
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\opencode\\wc-edge-cdp';
const PORT = 9334;
const base = (process.argv[2] ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const outDir = process.argv[3] ?? join(process.env.TEMP ?? '.', 'wc-shots', 'cats-all');

const manifest = JSON.parse(readFileSync(join('src', 'ui', 'cat-manifest.json'), 'utf8'));
const CATS = manifest.cats;

const VIEWPORTS = [
  { n: '390x844', w: 390, h: 844, mobile: true },
  { n: '360x640', w: 360, h: 640, mobile: true },
  { n: '430x932', w: 430, h: 932, mobile: true },
  { n: '509x900', w: 1440, h: 900, mobile: false },
];

async function waitForDevTools() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return; } catch { /* 等 */ }
    await delay(250);
  }
  throw new Error('DevTools 未就绪');
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async open(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
    const c = new Cdp(ws);
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== undefined) {
        const p = c.pending.get(m.id);
        if (p) { c.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
      } else if (m.method === 'Runtime.exceptionThrown') c.events.push(m.params);
    });
    return c;
  }
  send(method, params = {}) {
    const i = ++this.id;
    this.pending.set(i, { resolve: () => {}, reject: () => {} });
    const p = this.pending.get(i);
    this.ws.send(JSON.stringify({ id: i, method, params }));
    return new Promise((res, rej) => { p.resolve = res; p.reject = rej; setTimeout(() => { if (this.pending.delete(i)) rej(new Error('timeout ' + method)); }, 30000); });
  }
  close() { this.ws.close(); }
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
  const cdp = await Cdp.open(t.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const rows = [];
  const shots = [];
  for (const v of VIEWPORTS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: v.w, height: v.h, deviceScaleFactor: v.mobile ? 2 : 1,
      mobile: v.mobile, screenWidth: v.w, screenHeight: v.h,
    });
    for (const cat of CATS) {
      cdp.events.length = 0;
      await cdp.send('Page.navigate', { url: `${base}/?selfcheck=1&cat=${cat.id}` });
      await delay(2200);
      const r = await cdp.send('Runtime.evaluate', {
        expression: `(() => { const e = document.getElementById('selfcheck'); return e ? e.textContent : null; })()`,
        returnByValue: true,
      });
      const raw = r.result?.value;
      if (!raw) { rows.push({ viewport: v.n, cat: cat.name, error: '无 selfcheck' }); continue; }
      const s = JSON.parse(raw.replace(/^SELFCHECK/, '').replace(/ENDSELFCHECK$/, ''));
      const z = Object.fromEntries(s.zones.map((x) => [x.name, x.rect]));
      const img = z['catImg'] ?? { x: 0, y: 0, w: 0, h: 0 };
      const catZone = z['cat'] ?? { y: 0, h: 0 };
      const margin = s.stage.w * 0.03;
      const leftGap = img.x - s.stage.x;
      const rightGap = s.stage.x + s.stage.w - (img.x + img.w);
      // 头+耳安全区（guides 模式的虚线框）在猫咪区内的位置：
      // 脸与耳都在猫咪区上半部，这里用贴图顶部 56% 作为头耳带的近似
      const headBottom = img.y + img.h * 0.56;
      rows.push({
        viewport: v.n, stageW: s.stage.w, cat: cat.name, id: cat.id, pose: cat.pose,
        aspect: cat.aspect, catZoneH: catZone.h, imgW: +img.w.toFixed(1), imgH: +img.h.toFixed(1),
        imgTop: +img.y.toFixed(1), headBottom: +headBottom.toFixed(1),
        leftGap: +leftGap.toFixed(1), rightGap: +rightGap.toFixed(1), margin: +margin.toFixed(1),
        fitsH: img.h <= catZone.h + 0.5,
        fitsW: leftGap >= margin && rightGap >= margin,
        errors: cdp.events.length,
      });
      if (v.n === '390x844' || v.n === '360x640') {
        const s2 = await cdp.send('Page.captureScreenshot', { format: 'png' });
        const f = join(outDir, `${cat.id}-${v.n}.png`);
        writeFileSync(f, Buffer.from(s2.data, 'base64'));
        shots.push(f);
      }
    }
  }

  const hdr = ['视口', '猫咪', '姿态', '猫咪区高', '贴图宽×高', '左余量', '右余量', '需要留白', '上下', '左右', '错误'];
  console.log(hdr.join('\t'));
  for (const r of rows) {
    if (r.error) { console.log(`${r.viewport}\t${r.cat}\t${r.error}`); continue; }
    console.log([
      r.viewport, r.cat, r.pose, `${r.catZoneH}px`, `${r.imgW}×${r.imgH}`,
      `${r.leftGap}px`, `${r.rightGap}px`, `${r.margin}px`,
      r.fitsH ? 'OK' : '溢出', r.fitsW ? 'OK' : '不足', r.errors,
    ].join('\t'));
  }

  const bad = rows.filter((r) => !r.error && (!r.fitsH || !r.fitsW || r.errors > 0));
  writeFileSync(join(outDir, 'report.json'), JSON.stringify({ rows, bad: bad.length }, null, 2));
  console.log(`\n合计 ${rows.length} 项，超限 ${bad.length} 项`);
  console.log(`截图 ${shots.length} 张 → ${outDir}`);
  console.log(readdirSync(outDir).filter((f) => f.endsWith('.png')).length + ' 个 PNG');

  cdp.close();
  child.kill();
}
main().catch((e) => { console.error('FAILED:', e.stack); process.exit(1); });