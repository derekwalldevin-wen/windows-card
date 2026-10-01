/**
 * 七猫 × 四视口逐只验收：猫脚是否落在背景桌垫上、是否出界、背景是否同步。
 *
 * 缩放规则与落位都在页面里算好了，这里只读 ?selfcheck=1 的真实读数，
 * 不另起一套推算，避免「工具算一套、页面算另一套」。
 *
 * 运行：node tools\cat-bg-check.mjs <dev server 地址> [输出目录]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\opencode\\wc-edge-cdp';
const PORT = 9334;
const base = (process.argv[2] ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const outDir = process.argv[3] ?? 'shots/cat-bg';

const manifest = JSON.parse(readFileSync(join('src', 'ui', 'cat-manifest.json'), 'utf8'));
const placementSrc = readFileSync(join('src', 'ui', 'cat-placement.ts'), 'utf8');

/** 从 cat-placement.ts 里读出手工锚点表，避免在工具里重复抄一份 */
function parsePlacement() {
  const block = placementSrc.slice(
    placementSrc.indexOf('CAT_PLACEMENT'),
    placementSrc.indexOf('DEFAULT_PLACEMENT'),
  );
  const out = {};
  const re = /'?([\w-]+)'?\s*:\s*\{\s*footX:\s*([\d.]+)\s*,\s*footLift:\s*([\d.]+)\s*,\s*scale:\s*([\d.]+)\s*\}/g;
  let m;
  while ((m = re.exec(block)) !== null) out[m[1]] = { footX: +m[2], footLift: +m[3], scale: +m[4] };
  return out;
}
const PLACEMENT = parsePlacement();

const VIEWPORTS = [
  { n: '390x844', w: 390, h: 844, mobile: true },
  { n: '360x640', w: 360, h: 640, mobile: true },
  { n: '430x932', w: 430, h: 932, mobile: true },
  { n: '509x900', w: 1440, h: 900, mobile: false },
];

/** 背景桌垫在原图里的范围（measure-background.mjs 实测） */
const RUNNER = { top: 348, bottom: 600, left: 54, right: 793 };
const BG = { w: 852, h: 1846 };

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
    for (const cat of manifest.cats) {
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
      const bg = s.diag?.backgroundFit ?? {};
      const place = PLACEMENT[cat.id] ?? { footX: 0.5, footLift: 0, scale: 1 };

      // 猫脚落点：由贴图矩形 + 逐猫锚点换算，与页面用的是同一套定义
      const footX = img.x + place.footX * img.w;
      const footY = img.y + img.h - place.footLift * img.h;

      // 换算回背景原图坐标，用于判断是否落在桌垫上。
      // 注意：footX/footY 是 **视口坐标**，而 bg.x 是相对 stage 的，
      // 桌面端 stage 居中（stage.x ≠ 0），必须先减掉 stage 偏移。
      const scale = parseFloat(bg.scale);
      const bx = parseFloat(String(bg.x));
      const bw = parseFloat(String(bg.w));
      const bh = parseFloat(String(bg.h));
      const relX = footX - s.stage.x;
      const relY = footY - s.stage.y;
      const origX = bw > 0 ? ((relX - bx) / bw) * BG.w : -1;
      const origY = bh > 0 ? (relY / bh) * BG.h : -1;
      const onRunner =
        origY >= RUNNER.top && origY <= RUNNER.bottom && origX >= RUNNER.left && origX <= RUNNER.right;

      // 猫顶是否顶到 HUD（HUD 底部读数）
      const hudBottom = (z['hud']?.y ?? 0) + (z['hud']?.h ?? 0);
      const clearOfHud = img.y >= hudBottom - 0.5;

      // 横向余量
      const leftGap = img.x - s.stage.x;
      const rightGap = s.stage.x + s.stage.w - (img.x + img.w);

      rows.push({
        viewport: v.n, stageW: Math.round(s.stage.w), stageH: Math.round(s.stage.h),
        cat: cat.name, id: cat.id,
        bgScale: +scale.toFixed(4), bgFitBy: bg.fitBy,
        bgCrop: +parseFloat(String(bg.croppedBottom)).toFixed(0),
        imgW: +img.w.toFixed(1), imgH: +img.h.toFixed(1),
        footX: +footX.toFixed(1), footY: +footY.toFixed(1),
        origX: Math.round(origX), origY: Math.round(origY),
        onRunner, clearOfHud,
        leftGap: +leftGap.toFixed(1), rightGap: +rightGap.toFixed(1),
        ready: s.ready?.bg === true && s.ready?.cat === true,
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

  const hdr = ['视口', '猫咪', '背景scale', '贴图宽×高', '脚底(屏幕)', '脚底(原图)', '在桌垫上', '不压HUD', '左余', '右余', '就绪', '错误'];
  console.log(hdr.join('\t'));
  for (const r of rows) {
    if (r.error) { console.log(`${r.viewport}\t${r.cat}\t${r.error}`); continue; }
    console.log([
      r.viewport, r.cat, r.bgScale,
      `${r.imgW}×${r.imgH}`,
      `(${r.footX.toFixed(0)},${r.footY.toFixed(0)})`,
      `(${r.origX},${r.origY})`,
      r.onRunner ? 'OK' : '⚠不在',
      r.clearOfHud ? 'OK' : '⚠压住',
      r.leftGap.toFixed(0), r.rightGap.toFixed(0),
      r.ready ? 'OK' : '未就绪', r.errors,
    ].join('\t'));
  }

  const bad = rows.filter((r) => !r.error && (!r.onRunner || !r.clearOfHud || r.leftGap < -0.5 || r.rightGap < -0.5 || !r.ready || r.errors > 0));
  writeFileSync(join(outDir, 'report.json'), JSON.stringify({
    runner: RUNNER,
    bg: BG,
    rows,
    bad: bad.length,
    failedRows: bad,
  }, null, 2));
  console.log(`\n合计 ${rows.length} 项，问题 ${bad.length} 项`);
  if (bad.length) for (const b of bad) console.log(`  ⚠ ${b.viewport} ${b.cat}: 脚底(${b.origX},${b.origY}) 在桌垫=${b.onRunner} 压HUD=${!b.clearOfHud} 左余${b.leftGap} 右余${b.rightGap}`);
  console.log(`截图 ${shots.length} 张 → ${outDir}`);

  cdp.close();
  child.kill();
}
main().catch((e) => { console.error('FAILED:', e.stack); process.exit(1); });