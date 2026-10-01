/**
 * 只读预览：把七只猫的**底部 30%** 拼成一张放大对照图，
 * 用来肉眼确认「裁切后的底边到底是脚、还是尾巴/装饰」。
 *
 * 自动检测脚底容易误判（坐姿猫的臀比脚掌宽、站立猫全身都宽），
 * 所以这一步靠人眼确认，再把确认结果写进配置。
 *
 * 运行：node tools\cat-feet-sheet.mjs <输出目录>
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\opencode\\wc-edge-nl';
const PORT = 9341;
const TMP = join(process.env.TEMP ?? '.', 'cat-feet-sheet.html');
const outDir = process.argv[2] ?? 'shots/cat-feet';

const feet = JSON.parse(readFileSync(join('src', 'ui', 'cat-feet.json'), 'utf8')).feet;
const files = readdirSync('public/cats').filter((f) => f.startsWith('cat-') && f.endsWith('.png')).sort();

const items = files.map((f) => {
  const id = f.replace(/^cat-/, '').replace(/\.png$/, '');
  const m = feet[id];
  return {
    id,
    name: m?.name ?? id,
    data: readFileSync(join('public/cats', f)).toString('base64'),
    footX: Math.round((m?.footXRatio ?? 0.5) * 1000) / 10,
    span: Math.round((m?.footSpanRatio ?? 0) * 100),
  };
});

const CELL = 330, HDR = 46, PAD = 12;
const cols = 4;
const rows = Math.ceil(items.length / cols);
const W = cols * CELL + (cols + 1) * PAD;
const H = HDR + rows * (CELL + PAD) + PAD;

const html = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:${W}px;height:${H}px;background:#201c17;
font-family:system-ui,'Microsoft YaHei',sans-serif;color:#f0e8d8}
.hd{height:${HDR}px;padding:8px ${PAD}px 0;font-size:13px;font-weight:700;line-height:1.45;
background:#151310;border-bottom:1px solid #4a4238}
.hd s{text-decoration:none;font-weight:400;font-size:11px;opacity:.8}
.g{display:grid;grid-template-columns:repeat(${cols},${CELL}px);gap:${PAD}px;padding:${PAD}px}
.c .win{width:${CELL}px;height:${CELL}px;position:relative;overflow:hidden;
background:repeating-conic-gradient(#38332b 0%25%,#302c25 0%50%) 50%/14px 14px;border:1px solid #4a4238}
.c .win img{position:absolute;left:0;width:100%;bottom:0}
.c .cut{position:absolute;left:0;right:0;top:0;height:30%;
background:repeating-linear-gradient(45deg,#ff5a3c22 0 8px,transparent 8px 16px);
border-bottom:2px solid #ff5a3c;pointer-events:none}
.c .cut::after{content:'上 30% 已裁掉';position:absolute;left:4px;top:3px;font-size:10px;color:#ffb3a3}
.c .vx{position:absolute;top:0;bottom:0;width:0;border-left:1px dashed #2f7fd0;pointer-events:none}
.c .vx b{position:absolute;top:2px;left:3px;font-size:9px;color:#9fd0ff;background:#0d2a45;padding:0 3px;border-radius:2px;white-space:nowrap;font-weight:400}
.c .gnd{position:absolute;left:0;right:0;bottom:0;height:2px;background:#7ad14a}
.c .gnd::after{content:'图底边';position:absolute;right:3px;bottom:3px;font-size:9px;color:#d8f5c0;background:#26401a;padding:0 3px;border-radius:2px}
.lb{font-size:11px;line-height:1.4;padding-top:4px}
.lb b{font-size:12px}.lb i{font-style:normal;opacity:.75}
</style>
<div class="hd">七猫底部 30% 放大对照 —— 确认底边是脚还是尾巴/装饰
  <s>虚线=脚底中心（自动检测）｜绿线=图片底边｜上半被裁掉，只看脚部</s></div>
<div class="g">
${items.map((it) => `<div class="c">
  <div class="win">
    <div class="cut"></div>
    <img src="data:image/png;base64,${it.data}">
    <div class="vx" style="left:${it.footX}%"><b>脚心 ${it.footX}%</b></div>
    <div class="gnd"></div>
  </div>
  <div class="lb"><b>${it.name}</b> <i>${it.id}</i><br><i>脚心 ${it.footX}%　实心脚掌占宽 ${it.span}%</i></div>
</div>`).join('')}
</div>`;
writeFileSync(TMP, html);

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
    '--disable-extensions', '--mute-audio', '--allow-file-access-from-files',
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
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1.5, mobile: false, screenWidth: W, screenHeight: H });
  await send('Page.navigate', { url: 'file:///' + TMP.replace(/\\/g, '/') });
  await delay(2500);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const f = join(outDir, 'cat-feet-sheet.png');
  writeFileSync(f, Buffer.from(s.data, 'base64'));
  console.log(`脚部对照图 → ${f}`);
  ws.close(); child.kill();
}
main().catch((e) => { console.error('FAILED:', e.stack); process.exit(1); });