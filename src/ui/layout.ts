/**
 * 分区骨架。
 *
 * 自上而下：
 *   背景层（z-index 0，不拦截事件）
 *   顶部信息区 → 猫咪展示区 → 裸桌弹性区 → 出牌展示区（小计分牌）
 *   → 4+4 手牌 → 操作区（牌堆标记 + 弃牌 / 出牌）
 *
 * 猫咪区不再是「撑满到某个投影线」的固定高度块，而是：
 *   高度 = 背景猫脚锚点之上、猫咪区顶之下可用空间，
 *   由 CSS 用 --cat-foot-y 直接算出，脚底永远贴住背景锚点。
 * 这样窗口尺寸变化时背景与猫同步，不需要 JS 反复测量。
 */

export const HUD_H_U = 10.3;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  attrs: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

import { createCatArea, type CatArea } from './cat.ts';

export interface UiRefs {
  stage: HTMLElement;
  catArea: CatArea;
  plateTitle: HTMLElement;
  plateFormula: HTMLElement;
  selectPill: HTMLElement;
  legend: HTMLElement;
  playCards: HTMLElement;
  handRows: HTMLElement;
  scoreValue: HTMLElement;
  deckMarker: HTMLElement;
  discardBtn: HTMLButtonElement;
  playBtn: HTMLButtonElement;
  restartBtn: HTMLButtonElement;
  toast: HTMLElement;
}

/**
 * 只搭 DOM 骨架，不碰 3D、不做测量。
 * 背景层由 main.ts 单独创建并插到 stage 最底层。
 */
export function buildLayout(stage: HTMLElement, root: HTMLElement): UiRefs {
  root.textContent = '';

  // ---- 顶部信息区：单行，只留必要信息 ----
  const hud = el('header', 'zone zone-hud');
  hud.dataset['guide'] = '顶部信息区';

  const title = el('div', 'hud-title');
  title.textContent = '窗边牌局';
  const badge = el('div', 'hud-badge');
  badge.textContent = '练习模式';
  const sep = el('span', 'hud-sep');
  sep.setAttribute('aria-hidden', 'true');
  const scoreBox = el('div', 'hud-item hud-item-end');
  const scoreLabel = el('span', 'hud-label');
  scoreLabel.textContent = '累计';
  const scoreValue = el('strong', 'hud-value');
  scoreValue.textContent = '0';
  scoreBox.append(scoreLabel, scoreValue);

  // 种子不显示：每轮随机。弃牌次数在按钮上，牌堆数在操作区标记里。
  hud.append(title, badge, sep, scoreBox);
  root.appendChild(hud);

  // ---- 猫咪展示区 ----
  // ?cat=<id> 可指定对手，仅用于验收截图核对各只猫的安全范围；正常游玩走随机
  const urlCat = new URLSearchParams(location.search).get('cat');
  const catArea = createCatArea(urlCat ?? undefined);
  root.appendChild(catArea.root);

  // 猫咪与计分牌之间的弹性裸桌
  const spacer = el('div', 'zone-spacer');
  spacer.dataset['guide'] = '裸桌呼吸区';
  root.appendChild(spacer);

  // ---- 出牌展示区：桌垫下方的木桌上，小计分牌 ----
  const play = el('section', 'zone zone-play');
  play.dataset['guide'] = '出牌展示区（小计分牌）';

  const plate = el('div', 'play-plate');
  const plateTitle = el('div', 'play-plate-title');
  plateTitle.textContent = '选牌看分';
  const plateFormula = el('div', 'play-plate-formula preview-text');
  plateFormula.textContent = '点选手牌开始';
  plate.append(plateTitle, plateFormula);

  const pill = el('div', 'play-pill');
  const selectPill = el('span', 'play-pill-text');
  selectPill.textContent = '已选 0/5';
  const legend = el('span', 'play-legend');
  legend.setAttribute('aria-hidden', 'true');
  legend.innerHTML = '<i class="dot dot-scoring"></i>计分<i class="dot dot-kicker"></i>陪牌';
  pill.append(selectPill, legend);

  const playCards = el('div', 'play-cards');
  playCards.setAttribute('aria-live', 'polite');

  play.append(plate, pill, playCards);
  root.appendChild(play);

  // ---- 手牌 4+4 ----
  // 手牌行不预置占位槽：牌面由规则层动态生成，预置槽会与真实卡牌并存导致行数翻倍。
  const hand = el('section', 'zone zone-hand');
  hand.dataset['guide'] = '手牌区 4+4';
  const handRows = el('div', 'hand-rows');
  handRows.append(
    el('div', 'slot-row hand-row', { 'data-guide': '手牌第 1 排 x4' }),
    el('div', 'slot-row hand-row', { 'data-guide': '手牌第 2 排 x4' }),
  );
  hand.appendChild(handRows);
  root.appendChild(hand);

  // ---- 操作区：牌堆标记 + 弃牌 / 出牌 ----
  const bottom = el('footer', 'zone zone-bottom');
  bottom.dataset['guide'] = '操作区';

  const actions = el('div', 'zone-actions');
  const deckMarker = el('span', 'deck-marker');
  deckMarker.textContent = '牌堆 44';
  const discardBtn = el('button', 'btn btn-discard', { type: 'button' }) as HTMLButtonElement;
  discardBtn.textContent = '弃牌 3/3';
  const playBtn = el('button', 'btn btn-play', { type: 'button' }) as HTMLButtonElement;
  playBtn.textContent = '出牌';
  const restartBtn = el('button', 'btn btn-restart', { type: 'button' }) as HTMLButtonElement;
  restartBtn.textContent = '重新练习';
  actions.append(deckMarker, discardBtn, playBtn, restartBtn);
  bottom.appendChild(actions);
  root.appendChild(bottom);

  // ---- 提示条 ----
  const toast = el('div', 'toast');
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  root.appendChild(toast);

  return {
    stage,
    catArea,
    plateTitle,
    plateFormula,
    selectPill,
    legend,
    playCards,
    handRows,
    scoreValue,
    deckMarker,
    discardBtn,
    playBtn,
    restartBtn,
    toast,
  };
}

/**
 * 按舞台实际宽度与可用高度同步排版单位。
 * 窄屏 / 矮屏 / 桌面居中竖屏都从这里推导，不写死像素。
 */
export function syncStageMetrics(stage: HTMLElement): void {
  const w = stage.getBoundingClientRect().width;
  if (w <= 0) return;
  const u = w / 100;
  const s = stage.style;
  s.setProperty('--u', `${u}px`);
  s.setProperty('--gap', `${Math.max(5, Math.min(14, u * 2.2))}px`);
  s.setProperty('--pad-x', `${Math.max(10, Math.min(30, u * 6.5))}px`);
  s.setProperty('--radius-card', `${Math.max(5, Math.min(14, u * 2.6))}px`);
  s.setProperty('--radius-panel', `${Math.max(10, Math.min(26, u * 5.5))}px`);
  s.setProperty('--fs-btn', `${Math.max(14, Math.min(23, u * 5))}px`);
  s.setProperty('--fs-small', `${Math.max(10, Math.min(14, u * 3.1))}px`);
}

/** 布局标注开关：L 键或 ?guides=1，仅用于验收截图，不影响正式布局。 */
export function initGuides(): void {
  const params = new URLSearchParams(location.search);
  document.body.classList.toggle('guides', params.get('guides') === '1');
  window.addEventListener('keydown', (e) => {
    if (e.key === 'l' || e.key === 'L') document.body.classList.toggle('guides');
  });
}