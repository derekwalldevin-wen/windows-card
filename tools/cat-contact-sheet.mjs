/**
 * 只读预览：把七张猫咪 PNG 拼成一张对照图，用于核对姿态、裁切与相对比例。
 * 不修改素材，也不修改 src/。
 *
 * 运行：node tools/cat-contact-sheet.mjs <素材目录> <输出目录>
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\opencode\\wc-edge-nl';
const PORT = 9337;
const dir = process.argv[2] ?? 'assets/cats';
const outDir = process.argv[3] ?? 'preview';
const TMP = join(process.env.TEMP ?? '.', 'cat-sheet.html');

const CELL = 400, PAD = 10, HDR = 22, LABEL = 34;
const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png')).sort();
const items = files.map((f) => ({
  name: f.replace('窗边牌局_', '').replace('_透明PNG.png', ''),
  data: readFileSync(join(dir, f)).toString('base64'),
}));

const cols = 4;
const rows = Math.ceil(items.length / cols);
const W = cols * CELL + (cols + 1) * PAD;
const H = HDR + rows * (CELL + LABEL + PAD) + PAD;

const html = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:${W}px;height:${H}px;background:#2a2620;
font-family:system-ui,'Microsoft YaHei',sans-serif;color:#efe7d8}
.hd{height:${HDR}px;display:flex;align-items:center;padding:0 ${PAD}px;font-size:13px;font-weight:700;
background:#151310;border-bottom:1px solid #4a4238}
.hd s{text-decoration:none;margin-left:auto;font-weight:400;font-size:11px;opacity:.75}
.g{display:grid;grid-template-columns:repeat(${cols},${CELL}px);gap:${PAD}px;padding:${PAD}px}
.c{width:${CELL}px}
.thumb{width:${CELL}px;height:${CELL}px;position:relative;
background:repeating-conic-gradient(#3a352c 0%25%,#33302a 0%50%) 50%/16px 16px;
border:1px solid #4a4238}
.thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.lb{height:${LABEL}px;padding-top:4px;font-size:11px;line-height:1.35}
.lb b{display:block;font-size:12px}
.lb i{font-style:normal;opacity:.72}
</style>
<div class="hd">七猫素材对照 · 原图等比 contain（未裁切、未缩放对齐） · 棋盘格为透明区<s>内容框测量见 tools/measure-cat-png.mjs</s></div>
<div class="g">
${items.map((it) => `<div class="c">
  <div class="thumb"><img src="data:image/png;base64,${it.data}"></div>
  <div class="lb"><b>${it.name}</b><i>原图画布，未做任何缩放</i></div>
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
    '--disable-extensions', '--hide-scrollbars', '--mute-audio', '--allow-file-access-from-files',
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
  const f = join(outDir, 'cat-contact-sheet.png');
  writeFileSync(f, Buffer.from(s.data, 'base64'));
  console.log(`对照图 ${W}×${H} → ${f}`);
  ws.close(); child.kill();
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });