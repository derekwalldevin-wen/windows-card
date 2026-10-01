import { buildDeck, shuffle, type Card } from './cards.ts';
import { evaluate, type HandEvaluation } from './evaluate.ts';

export const HAND_SIZE = 8;
export const MIN_SELECT = 1;
export const MAX_SELECT = 5;
export const MAX_DISCARDS = 3;

export type Phase = 'playing' | 'over';

export interface PlayRecord {
  kind: 'play' | 'discard';
  cards: Card[];
  /** 出牌时为本次结算；弃牌时为 null */
  evaluation: HandEvaluation | null;
  handSizeAfter: number;
  deckRemainingAfter: number;
}

export interface SessionState {
  seed: number;
  /** 抽牌堆，index 0 为下一张要抽的牌 */
  deck: Card[];
  hand: Card[];
  /** 选中的牌，按点选顺序 */
  selectedIds: string[];
  discardsLeft: number;
  totalScore: number;
  handsPlayed: number;
  lastPlay: PlayRecord | null;
  phase: Phase;
  /** 最近一次动作被拒绝的原因（仅供界面提示，不参与规则） */
  lastReject: string | null;
}

export type SessionAction =
  | { type: 'toggle'; id: string }
  | { type: 'play' }
  | { type: 'discard' }
  | { type: 'restart'; seed?: number }
  | { type: 'clearReject' };

export interface CreateSessionOptions {
  /** 测试用：注入自定义牌堆（可小于 52 张以验证牌堆耗尽） */
  deck?: Card[];
}

function drawUpTo(deck: Card[], hand: Card[], target: number): { deck: Card[]; hand: Card[] } {
  const need = Math.max(0, target - hand.length);
  if (need === 0) return { deck, hand };
  const take = Math.min(need, deck.length);
  const rest = deck.slice(take);
  return { deck: rest, hand: [...hand, ...deck.slice(0, take)] };
}

/** 开一局新的练习。同一种子必然得到完全相同的初始手牌与牌堆顺序。 */
export function createSession(seed: number, options: CreateSessionOptions = {}): SessionState {
  const source = options.deck ?? buildDeck();
  const shuffled = shuffle(source, seed);
  const { deck, hand } = drawUpTo(shuffled, [], HAND_SIZE);
  return {
    seed,
    deck,
    hand,
    selectedIds: [],
    discardsLeft: MAX_DISCARDS,
    totalScore: 0,
    handsPlayed: 0,
    lastPlay: null,
    phase: 'playing',
    lastReject: null,
  };
}

function selectedCards(state: SessionState): Card[] {
  const byId = new Map(state.hand.map((c) => [c.id, c]));
  const out: Card[] = [];
  for (const id of state.selectedIds) {
    const c = byId.get(id);
    if (c) out.push(c);
  }
  return out;
}

/** 当前选择的预览结果。纯计算，不改变任何状态。 */
export function previewSelection(state: SessionState): HandEvaluation | null {
  if (state.selectedIds.length === 0) return null;
  return evaluate(selectedCards(state));
}

function reject(state: SessionState, reason: string): SessionState {
  return { ...state, lastReject: reason };
}

/**
 * 唯一的规则状态机。纯函数、同步、无副作用。
 *
 * 关键性质：
 *  - `play` / `discard` 执行后会清空选择，因此**连续重复点击第二次必然被拒绝**，
 *    不会重复计分或重复补牌（见 tests/session.test.ts）。
 *  - 结算在 reducer 内**同步完成**，不依赖任何动画结束回调。
 *  - 已出 / 已弃的牌永久离开牌堆，不会被重新洗入。
 */
export function reduce(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'clearReject':
      return state.lastReject === null ? state : { ...state, lastReject: null };

    case 'restart': {
      const seed = action.seed ?? state.seed;
      return createSession(seed);
    }

    case 'toggle': {
      if (state.phase === 'over') return reject(state, '本局练习已结束，请点「重新练习」。');
      const inHand = state.hand.some((c) => c.id === action.id);
      if (!inHand) return reject(state, '这张牌不在手牌里。');

      if (state.selectedIds.includes(action.id)) {
        return {
          ...state,
          selectedIds: state.selectedIds.filter((id) => id !== action.id),
          lastReject: null,
        };
      }
      if (state.selectedIds.length >= MAX_SELECT) {
        return reject(state, `一次最多选 ${MAX_SELECT} 张。`);
      }
      return {
        ...state,
        selectedIds: [...state.selectedIds, action.id],
        lastReject: null,
      };
    }

    case 'play': {
      if (state.phase === 'over') return reject(state, '本局练习已结束，请点「重新练习」。');
      const picked = selectedCards(state);
      if (picked.length < MIN_SELECT) {
        return reject(state, `至少选 ${MIN_SELECT} 张才能出牌。`);
      }
      if (picked.length > MAX_SELECT) {
        return reject(state, `一次最多 ${MAX_SELECT} 张。`);
      }

      const evaluation = evaluate(picked);
      const pickedIds = new Set(state.selectedIds);
      const handAfterRemove = state.hand.filter((c) => !pickedIds.has(c.id));
      const { deck, hand } = drawUpTo(state.deck, handAfterRemove, HAND_SIZE);

      return {
        ...state,
        deck,
        hand,
        selectedIds: [],
        totalScore: state.totalScore + evaluation.score,
        handsPlayed: state.handsPlayed + 1,
        phase: hand.length === 0 ? 'over' : 'playing',
        lastReject: null,
        lastPlay: {
          kind: 'play',
          cards: picked,
          evaluation,
          handSizeAfter: hand.length,
          deckRemainingAfter: deck.length,
        },
      };
    }

    case 'discard': {
      if (state.phase === 'over') return reject(state, '本局练习已结束，请点「重新练习」。');
      if (state.discardsLeft <= 0) {
        return reject(state, `本局 ${MAX_DISCARDS} 次弃牌已用完。`);
      }
      const picked = selectedCards(state);
      if (picked.length < MIN_SELECT) {
        return reject(state, `至少选 ${MIN_SELECT} 张才能弃牌。`);
      }
      if (picked.length > MAX_SELECT) {
        return reject(state, `一次最多 ${MAX_SELECT} 张。`);
      }

      const pickedIds = new Set(state.selectedIds);
      const handAfterRemove = state.hand.filter((c) => !pickedIds.has(c.id));
      const { deck, hand } = drawUpTo(state.deck, handAfterRemove, HAND_SIZE);

      return {
        ...state,
        deck,
        hand,
        selectedIds: [],
        discardsLeft: state.discardsLeft - 1,
        phase: hand.length === 0 ? 'over' : 'playing',
        lastReject: null,
        lastPlay: {
          kind: 'discard',
          cards: picked,
          evaluation: null,
          handSizeAfter: hand.length,
          deckRemainingAfter: deck.length,
        },
      };
    }

    default:
      return state;
  }
}
