/**
 * 浏览器交互验证：用已安装的 Edge + DevTools 协议，真实点击走一遍
 * 选牌 → 取消 → 出牌 → 弃牌 → 弃牌耗尽 → 重复点击 → 重新练习，
 * 并在关键节点截图、比对预览分数与真实结算。
 *
 * 仅绑定 127.0.0.1，不开放局域网端口。
 *
 * 用法：node tools/playtest.mjs <url> <outDir> [width] [height]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\opencode\\wc-edge-play';
const PORT = 9334;

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.argv[3] ?? 'playtest';
const W = Number(process.argv[4] ?? 390);
const H = Number(process.argv[5] ?? 844);

mkdirSync(outDir, { recursive: true });
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(PROFILE, { recursive: true });

const child = spawn(
  EDGE,
  [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--hide-scrollbars', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    `--remote-debugging-port=${PORT}`, '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${PROFILE}`, 'about:blank',
  ],
  { stdio: 'ignore' },
);

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
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== undefined) { const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } }
      else this.events.push(m);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error(`CDP 超时 ${method}`)); } }, 30000);
    });
  }
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}\n`);
}

async function main() {
  await waitForDevTools();
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = list.find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  const cdp = new Cdp(ws);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: 2, mobile: true, screenWidth: W, screenHeight: H,
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Page.navigate', { url });
  await delay(2600);

  const evalJs = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
    return r.result.value;
  };
  const shot = async (name) => {
    const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const f = join(outDir, `${name}.png`);
    writeFileSync(f, Buffer.from(s.data, 'base64'));
    return f;
  };

  // 用真实鼠标事件点击（走浏览器命中测试，与手指落点一致）
  const clickSel = async (sel, nth = 0) => {
    const box = await evalJs(`(() => {
      const els = document.querySelectorAll(${JSON.stringify(sel)});
      const el = els[${nth}];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!box) throw new Error(`找不到元素 ${sel}[${nth}]`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', {
        type, x: box.x, y: box.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0,
      });
    }
    await delay(160);
  };

  const state = () => evalJs(`(() => { const s = window.__windowCardGame.session();
    return { seed: s.seed, hand: s.hand.map(c => c.id), selected: s.selectedIds, deck: s.deck.length,
             discardsLeft: s.discardsLeft, totalScore: s.totalScore, phase: s.phase,
             lastReject: s.lastReject, lastPlay: s.lastPlay ? { kind: s.lastPlay.kind, n: s.lastPlay.cards.length,
             name: s.lastPlay.evaluation ? s.lastPlay.evaluation.name : null,
             score: s.lastPlay.evaluation ? s.lastPlay.evaluation.score : null } : null }; })()`);

  const preview = () => evalJs(`(() => {
    const el = document.querySelector('.preview-text');
    return el ? el.textContent : null; })()`);

  // ---- 1. 初始状态 ----
  let s = await state();
  check('开局 8 张手牌 / 牌堆 44 / 弃牌 3 次 / 分数 0',
    s.hand.length === 8 && s.deck === 44 && s.discardsLeft === 3 && s.totalScore === 0,
    JSON.stringify({ hand: s.hand.length, deck: s.deck, discardsLeft: s.discardsLeft, score: s.totalScore }));
  await shot('01-initial');

  // ---- 2. 选 3 张 ----
  await clickSel('.zone-hand .card', 0);
  await clickSel('.zone-hand .card', 1);
  await clickSel('.zone-hand .card', 2);
  s = await state();
  check('点击 3 张后进入选中态', s.selected.length === 3, `selected=${s.selected.join(',')}`);
  const domSelected = await evalJs(`document.querySelectorAll('.zone-hand .card[data-role="selected"]').length`);
  check('DOM 选中态与状态一致', domSelected === 3, `dom=${domSelected}`);
  await shot('02-selected-3');

  // ---- 3. 再点同一张取消 ----
  await clickSel('.zone-hand .card', 1);
  s = await state();
  check('再次点击同一张可取消', s.selected.length === 2, `selected=${s.selected.join(',')}`);

  // ---- 4. 选满 5 张 ----
  await clickSel('.zone-hand .card', 1);
  await clickSel('.zone-hand .card', 3);
  await clickSel('.zone-hand .card', 4);
  s = await state();
  check('可选到 5 张上限', s.selected.length === 5, `selected=${s.selected.join(',')}`);

  // ---- 5. 第 6 张被拒绝 ----
  await clickSel('.zone-hand .card', 5);
  s = await state();
  check('第 6 张被拒绝并提示', s.selected.length === 5 && !!s.lastReject, `n=${s.selected.length} reject=${s.lastReject}`);
  const toastVisible = await evalJs(`document.querySelector('.toast').classList.contains('is-visible')`);
  check('超限提示可见', toastVisible === true);

  // ---- 6. 预览分数 ----
  const previewText = await preview();
  const previewScore = Number((previewText.match(/=\s*(\d+)/) ?? [])[1] ?? NaN);
  check('预览条显示牌型与预计得分', Number.isFinite(previewScore) && previewScore > 0, previewText);
  await shot('03-preview-5');

  // ---- 7. 出牌（连续点击 4 次模拟连点）----
  const before = await state();
  const beforeHand = before.hand.join(',');
  await clickSel('.btn-play');
  await clickSel('.btn-play');
  await clickSel('.btn-play');
  await clickSel('.btn-play');
  s = await state();
  check('出牌：总分增加且等于预览分数',
    s.totalScore === previewScore,
    `total=${s.totalScore} preview=${previewScore}`);
  check('出牌：手牌回到 8 张', s.hand.length === 8, `hand=${s.hand.length}`);
  check('出牌：已选清空', s.selected.length === 0);
  check('连点不会重复计分',
    s.totalScore === previewScore && s.lastPlay !== null && s.lastPlay.n === 5,
    `lastPlay=${JSON.stringify(s.lastPlay)}`);
  check('连点不会重复补牌（手牌仍为 8）', s.hand.length === 8);
  const deckAfter = s.deck;
  check('连点后牌堆只减少 5 张', deckAfter === before.deck - 5, `deck ${before.deck} -> ${deckAfter}`);
  const playedGone = await evalJs(`(() => {
    const st = window.__windowCardGame.session();
    const handIds = new Set(st.hand.map(c => c.id));
    const deckIds = new Set(st.deck.map(c => c.id));
    const played = ${JSON.stringify(before.selected)};
    return { stillInHand: played.filter(id => handIds.has(id)), stillInDeck: played.filter(id => deckIds.has(id)) };
  })()`);
  check('已出的牌不再出现在手牌或牌堆',
    playedGone.stillInHand.length === 0 && playedGone.stillInDeck.length === 0,
    JSON.stringify(playedGone));
  await shot('04-after-play');

  // ---- 8. 计分牌 / 陪牌 角标 ----
  const badges = await evalJs(`(() => ({
    scoring: document.querySelectorAll('.zone-play .card[data-role="scoring"]').length,
    kicker: document.querySelectorAll('.zone-play .card[data-role="kicker"]').length,
    total: document.querySelectorAll('.zone-play .card').length,
  }))()`);
  check('出牌展示区区分计分牌与陪牌',
    badges.total === 5 && badges.scoring + badges.kicker === 5,
    JSON.stringify(badges));

  // ---- 9. 弃牌 3 次耗尽 ----
  for (let i = 0; i < 3; i++) {
    await clickSel('.zone-hand .card', 0);
    await clickSel('.zone-hand .card', 1);
    await clickSel('.btn-discard');
  }
  s = await state();
  check('弃牌 3 次后次数用尽', s.discardsLeft === 0, `left=${s.discardsLeft}`);
  await clickSel('.zone-hand .card', 0);
  await clickSel('.zone-hand .card', 1);
  const discardState = await evalJs(`(() => {
    const b = document.querySelector('.btn-discard');
    const st = window.__windowCardGame.session();
    return { disabled: b.disabled, label: b.textContent, left: st.discardsLeft, selected: st.selectedIds.length };
  })()`);
  check('弃牌用尽：按钮禁用且标注已用完，选牌仍可用，次数不扣',
    discardState.disabled === true &&
    /用完/.test(discardState.label) &&
    discardState.left === 0 &&
    discardState.selected === 2,
    JSON.stringify(discardState));
  await shot('05-discards-used');

  // ---- 10. 重新练习 ----
  await evalJs(`(() => { window.__windowCardGame.dispatch({ type: 'restart' }); })()`);
  await delay(200);
  s = await state();
  check('重新练习：分数/弃牌/手牌全部复位',
    s.totalScore === 0 && s.discardsLeft === 3 && s.hand.length === 8 && s.selected.length === 0,
    JSON.stringify({ score: s.totalScore, discards: s.discardsLeft, hand: s.hand.length }));
  const afterRestart = await evalJs(`(() => {
    const p = document.querySelector('.btn-play');
    const d = document.querySelector('.btn-discard');
    const r = document.querySelector('.btn-restart');
    return { playHidden: p.hidden, playDisabledNoSel: p.disabled, discardDisabled: d.disabled, restartHidden: r.hidden };
  })()`);
  check('重新练习后按钮恢复初始态（未选牌时出牌禁用，弃牌可用，重新练习隐藏）',
    afterRestart.playHidden === false && afterRestart.playDisabledNoSel === true &&
    afterRestart.discardDisabled === true && afterRestart.restartHidden === true,
    JSON.stringify(afterRestart));
  await clickSel('.zone-hand .card', 0);
  const bothEnabled = await evalJs(`(() => ({
    play: document.querySelector('.btn-play').disabled === false,
    discard: document.querySelector('.btn-discard').disabled === false }))()`);
  check('重新练习后选 1 张，出牌与弃牌同时可用', bothEnabled.play === true && bothEnabled.discard === true,
    JSON.stringify(bothEnabled));
  await shot('06-after-restart');

  // ---- 11. 牌堆耗尽 → 结束 ----
  await evalJs(`(() => {
    // 反复出牌直到结束
    let guard = 0;
    while (window.__windowCardGame.session().phase === 'playing' && guard++ < 60) {
      const st = window.__windowCardGame.session();
      for (const c of st.hand) window.__windowCardGame.dispatch({ type: 'toggle', id: c.id });
      window.__windowCardGame.dispatch({ type: 'play' });
    }
  })()`);
  await delay(250);
  s = await state();
  check('牌堆耗尽后练习结束', s.phase === 'over' && s.hand.length === 0,
    `phase=${s.phase} hand=${s.hand.length} deck=${s.deck} score=${s.totalScore}`);
  const restartShown = await evalJs(`(() => {
    const r = document.querySelector('.btn-restart'); const p = document.querySelector('.btn-play');
    return { restartVisible: !r.hidden, playHidden: p.hidden }; })()`);
  check('结束后显示「重新练习」并隐藏出牌/弃牌',
    restartShown.restartVisible === true && restartShown.playHidden === true,
    JSON.stringify(restartShown));
  await shot('07-game-over');

  await clickSel('.btn-restart');
  s = await state();
  check('点击「重新练习」可复位', s.phase === 'playing' && s.totalScore === 0, `phase=${s.phase}`);

  // ---- 12. 控制台 ----
  const errors = cdp.events.filter((e) =>
    (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') ||
    (e.method === 'Runtime.exceptionThrown') ||
    (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'));
  const warnings = cdp.events.filter((e) =>
    (e.method === 'Log.entryAdded' && e.params.entry.level === 'warning') ||
    (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'warning'));
  check('交互过程中控制台无错误', errors.length === 0, `${errors.length} 条`);
  check('交互过程中控制台无警告', warnings.length === 0, `${warnings.length} 条`);

  const failed = results.filter((r) => !r.pass);
  writeFileSync(join(outDir, 'playtest.json'), JSON.stringify({ viewport: [W, H], results }, null, 2));
  process.stdout.write(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}\n`);
  ws.close();
  child.kill();
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => { console.error('FAILED:', e.message); child.kill(); process.exit(1); });
