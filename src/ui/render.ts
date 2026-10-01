import { createCardElement } from './card.ts';
import type { UiRefs } from './layout.ts';
import { dispatch, getPreview, getSession, subscribe } from '../store.ts';
import { HAND_SIZE, MAX_DISCARDS, MAX_SELECT, type PlayRecord, type SessionState } from '../rules/session.ts';
import type { Card } from '../rules/cards.ts';
import type { HandEvaluation } from '../rules/evaluate.ts';

/** 手牌排布：4 + 4。牌不足时前面排满、后面排空。 */
export const HAND_ROWS = 4;

function rowFor(index: number): number {
  return Math.floor(index / HAND_ROWS);
}

function splitRows(hand: readonly Card[]): Card[][] {
  const rows: Card[][] = [[], [], []];
  hand.forEach((card, i) => {
    const r = rows[rowFor(i)];
    if (r) r.push(card);
  });
  return rows;
}

/** 轻量 keyed reconcile：复用已有 DOM，避免重建导致焦点丢失。 */
function reconcile<T>(
  container: HTMLElement,
  items: readonly T[],
  keyOf: (item: T) => string,
  create: (item: T) => HTMLElement,
  update: (node: HTMLElement, item: T) => void,
): void {
  const existing = new Map<string, HTMLElement>();
  for (const child of Array.from(container.children)) {
    const key = child.getAttribute('data-key');
    if (key !== null) existing.set(key, child as HTMLElement);
  }
  const wanted: HTMLElement[] = [];
  for (const item of items) {
    const key = keyOf(item);
    let node = existing.get(key);
    if (!node) {
      node = create(item);
      node.setAttribute('data-key', key);
    } else {
      existing.delete(key);
      update(node, item);
    }
    wanted.push(node);
  }
  for (const stale of existing.values()) stale.remove();
  wanted.forEach((node, i) => {
    if (container.children[i] !== node) {
      container.insertBefore(node, container.children[i] ?? null);
    }
  });
}

function formatScore(n: number): string {
  return String(n);
}

function applyHandCard(node: HTMLElement, card: Card, state: SessionState, preview: HandEvaluation | null): void {
  const selected = state.selectedIds.includes(card.id);
  node.dataset['role'] = selected ? 'selected' : 'plain';
  node.setAttribute('aria-pressed', selected ? 'true' : 'false');
  node.classList.toggle('is-scoring', selected && preview?.scoringIds.includes(card.id) === true);
  node.classList.toggle('is-kicker', selected && preview?.kickerIds.includes(card.id) === true);
  const label = node.getAttribute('aria-label') ?? card.id;
  let suffix = '';
  if (selected && preview) {
    suffix = preview.scoringIds.includes(card.id) ? '，参与计分' : '，陪牌不計分';
  }
  node.setAttribute('aria-label', `${label}${suffix}`);
}

/**
 * 桌垫上的小计分牌：实时显示当前选牌的评估；
 * 没有选牌时退回上一手出牌的结果，都没有则给引导文案。
 */
function renderPlate(refs: UiRefs, state: SessionState, preview: HandEvaluation | null): void {
  refs.legend.style.visibility = preview ? 'visible' : 'hidden';

  if (preview) {
    refs.plateTitle.textContent = preview.name;
    const kicker = preview.kickerIds.length;
    refs.plateFormula.textContent =
      `${preview.base}+${preview.chips}×${preview.multiplier}=${preview.score}` +
      (kicker > 0 ? ` · 陪牌${kicker}` : '');
    return;
  }

  const record = state.lastPlay;
  if (state.phase === 'over') {
    refs.plateTitle.textContent = '本局结束';
    refs.plateFormula.textContent = `累计 ${state.totalScore} 分 · 点「重新练习」再来一局`;
    return;
  }
  if (!record) {
    refs.plateTitle.textContent = '选牌看分';
    refs.plateFormula.textContent = `点选手牌开始（最多 ${MAX_SELECT} 张）`;
    return;
  }
  if (!record.evaluation) {
    refs.plateTitle.textContent = '已弃牌';
    refs.plateFormula.textContent =
      `${record.cards.length} 张不得分 · 手牌 ${record.handSizeAfter} · 牌堆 ${record.deckRemainingAfter}`;
    return;
  }
  const e = record.evaluation;
  refs.plateTitle.textContent = e.name;
  refs.plateFormula.textContent =
    `${e.base}+${e.chips}×${e.multiplier}=${e.score}` +
    (e.kickerIds.length > 0 ? ` · 陪牌${e.kickerIds.length}` : '');
}

function renderSelectPill(refs: UiRefs, state: SessionState): void {
  if (state.phase === 'over') {
    refs.selectPill.textContent = '已结束';
    return;
  }
  refs.selectPill.textContent = `已选 ${state.selectedIds.length}/${MAX_SELECT}`;
}

/** 上一手出牌的小尺寸短暂展示：只留牌面，不额外占竖向空间。 */
function renderPlayZone(refs: UiRefs, state: SessionState): void {
  const record: PlayRecord | null = state.lastPlay;
  if (!record) {
    refs.playCards.replaceChildren();
    return;
  }
  reconcile<Card>(
    refs.playCards,
    record.cards,
    (c) => c.id,
    (c) => {
      const scoring = record.evaluation?.scoringIds.includes(c.id) === true;
      return createCardElement(c, {
        role: record.evaluation ? (scoring ? 'scoring' : 'kicker') : 'plain',
        inert: true,
        roleBadge: false,
      });
    },
    (node, c) => {
      /* 展示区牌不随状态变化，仅在重建时更新 */
      void c;
      void node;
    },
  );
}

function renderActions(refs: UiRefs, state: SessionState): void {
  const over = state.phase === 'over';
  const count = state.selectedIds.length;
  const canAct = !over && count >= 1 && count <= MAX_SELECT;

  refs.playBtn.disabled = !canAct;
  refs.discardBtn.disabled = !canAct || state.discardsLeft <= 0;
  refs.restartBtn.hidden = !over;
  refs.playBtn.hidden = over;
  refs.discardBtn.hidden = over;
  refs.deckMarker.hidden = over;

  refs.discardBtn.textContent =
    state.discardsLeft > 0 ? `弃牌 ${state.discardsLeft}/${MAX_DISCARDS}` : '弃牌已用完';
  refs.playBtn.textContent = '出牌';
}

function renderHud(refs: UiRefs, state: SessionState): void {
  refs.scoreValue.textContent = formatScore(state.totalScore);
  refs.deckMarker.textContent = `牌堆 ${state.deck.length}`;
}

function renderToast(refs: UiRefs, state: SessionState): void {
  if (state.lastReject) {
    refs.toast.textContent = state.lastReject;
    refs.toast.classList.add('is-visible');
  } else {
    refs.toast.classList.remove('is-visible');
    refs.toast.textContent = '';
  }
}

function renderHand(refs: UiRefs, state: SessionState, preview: HandEvaluation | null): void {
  const rows = Array.from(refs.handRows.children) as HTMLElement[];
  const grouped = splitRows(state.hand);
  rows.forEach((row, i) => {
    const cards = grouped[i] ?? [];
    reconcile<Card>(
      row,
      cards,
      (c) => c.id,
      (c) => {
        const node = createCardElement(c, { roleBadge: false });
        node.setAttribute('data-key', c.id);
        applyHandCard(node, c, state, preview);
        return node;
      },
      (node, c) => applyHandCard(node, c, state, preview),
    );
  });
}

export function createUi(refs: UiRefs): void {
  const paint = (state: SessionState): void => {
    const preview = getPreview();
    renderHud(refs, state);
    renderPlate(refs, state, preview);
    renderSelectPill(refs, state);
    renderPlayZone(refs, state);
    renderHand(refs, state, preview);
    renderActions(refs, state);
    renderToast(refs, state);
    refs.stage.dataset['hand'] = String(state.hand.length);
    refs.stage.dataset['phase'] = state.phase;
  };

  // 手牌点击（事件委托，避免逐元素绑定）
  refs.handRows.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    const card = target?.closest<HTMLElement>('.card');
    const id = card?.dataset['id'];
    if (!id) return;
    dispatch({ type: 'toggle', id });
  });

  refs.playBtn.addEventListener('click', () => {
    dispatch({ type: 'play' });
  });
  refs.discardBtn.addEventListener('click', () => {
    dispatch({ type: 'discard' });
  });
  refs.restartBtn.addEventListener('click', () => {
    dispatch({ type: 'restart' });
  });

  subscribe((state) => paint(state));
  paint(getSession());
}

export { HAND_SIZE };
