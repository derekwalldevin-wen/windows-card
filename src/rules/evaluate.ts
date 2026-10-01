import { ACE, chipValue, type Card, type Rank } from './cards.ts';

/**
 * 牌型与计分 —— 全项目**唯一**权威实现。
 * UI、预览、结算、测试都只能调用这里，不得另写一套判定。
 *
 * 计分公式：得分 =（牌型基础筹码 + 参与计分的牌点之和） × 牌型倍率
 *
 * ⚠️ 以下均为原型测试值，不代表已完成平衡。
 */
export type HandCategory =
  | 'straightFlush'
  | 'fourOfAKind'
  | 'fullHouse'
  | 'flush'
  | 'straight'
  | 'threeOfAKind'
  | 'twoPair'
  | 'pair'
  | 'highCard';

/** 由高到低的判定顺序。 */
export const CATEGORY_ORDER: readonly HandCategory[] = [
  'straightFlush',
  'fourOfAKind',
  'fullHouse',
  'flush',
  'straight',
  'threeOfAKind',
  'twoPair',
  'pair',
  'highCard',
] as const;

export interface HandRule {
  name: string;
  base: number;
  multiplier: number;
  /** 该牌型必须恰好选满 5 张才成立 */
  needsFive: boolean;
}

export const HAND_RULES: Readonly<Record<HandCategory, HandRule>> = {
  straightFlush: { name: '同花顺', base: 100, multiplier: 8, needsFive: true },
  fourOfAKind: { name: '四条', base: 60, multiplier: 7, needsFive: false },
  fullHouse: { name: '葫芦', base: 40, multiplier: 4, needsFive: true },
  flush: { name: '同花', base: 35, multiplier: 4, needsFive: true },
  straight: { name: '顺子', base: 30, multiplier: 4, needsFive: true },
  threeOfAKind: { name: '三条', base: 30, multiplier: 3, needsFive: false },
  twoPair: { name: '两对', base: 20, multiplier: 2, needsFive: false },
  pair: { name: '一对', base: 10, multiplier: 2, needsFive: false },
  highCard: { name: '高牌', base: 5, multiplier: 1, needsFive: false },
};

export interface HandEvaluation {
  category: HandCategory;
  name: string;
  base: number;
  multiplier: number;
  /** 选中的全部牌（保持选择顺序） */
  selectedIds: string[];
  /** 参与计分的牌（保持选择顺序） */
  scoringIds: string[];
  /** 陪牌：被选中、参与消耗但不参与计分（保持选择顺序） */
  kickerIds: string[];
  /** 参与计分的牌点之和 */
  chips: number;
  /** (base + chips) × multiplier */
  score: number;
}

/** 顺子判定：A2345 与 10JQKA 有效，QKA23 等跨界组合无效。 */
export function isStraight(ranks: readonly Rank[]): boolean {
  if (ranks.length !== 5) return false;
  const uniq = Array.from(new Set(ranks)).sort((a, b) => a - b);
  if (uniq.length !== 5) return false;
  const lo = uniq[0] as Rank;
  const hi = uniq[4] as Rank;
  // 轮子顺子 A-2-3-4-5（A 视为 1）
  if (lo === 2 && hi === ACE && uniq[1] === 3 && uniq[2] === 4 && uniq[3] === 5) return true;
  return hi - lo === 4;
}

export function isFlush(cards: readonly Card[]): boolean {
  if (cards.length < 2) return false;
  const first = cards[0] as Card;
  return cards.every((c) => c.suit === first.suit);
}

function groupByRank(cards: readonly Card[]): Map<Rank, Card[]> {
  const map = new Map<Rank, Card[]>();
  for (const c of cards) {
    const list = map.get(c.rank);
    if (list) list.push(c);
    else map.set(c.rank, [c]);
  }
  return map;
}

/** 取某个点数分组内的牌（按花色固定顺序，保证结果可重复）。 */
function pickGroup(cards: readonly Card[], rank: Rank): Card[] {
  return cards
    .filter((c) => c.rank === rank)
    .slice()
    .sort((a, b) => a.suit - b.suit);
}

/**
 * 评估选中的 1—5 张牌。
 * 只计算**构成牌型**的牌；其余选中牌标记为陪牌（仍然被消耗）。
 */
export function evaluate(cards: readonly Card[]): HandEvaluation {
  if (cards.length === 0) {
    return {
      category: 'highCard',
      name: HAND_RULES.highCard.name,
      base: HAND_RULES.highCard.base,
      multiplier: HAND_RULES.highCard.multiplier,
      selectedIds: [],
      scoringIds: [],
      kickerIds: [],
      chips: 0,
      score: 0,
    };
  }

  const ranks = cards.map((c) => c.rank);
  const isFive = cards.length === 5;
  const groups = groupByRank(cards);
  const groupSizes = Array.from(groups.entries())
    .map(([rank, list]) => ({ rank, size: list.length }))
    .sort((a, b) => b.size - a.size || b.rank - a.rank);

  const top = groupSizes[0];
  const second = groupSizes[1];
  const pairRanks = groupSizes.filter((g) => g.size === 2).map((g) => g.rank);

  const flush = isFive && isFlush(cards);
  const straight = isFive && isStraight(ranks);

  let category: HandCategory;
  let scoring: Card[];

  if (flush && straight) {
    // 皇家同花顺归入同花顺
    category = 'straightFlush';
    scoring = cards.slice();
  } else if (top && top.size === 4) {
    category = 'fourOfAKind';
    scoring = pickGroup(cards, top.rank);
  } else if (top && top.size === 3 && second && second.size === 2) {
    category = 'fullHouse';
    scoring = cards.slice();
  } else if (flush) {
    category = 'flush';
    scoring = cards.slice();
  } else if (straight) {
    category = 'straight';
    scoring = cards.slice();
  } else if (top && top.size === 3) {
    category = 'threeOfAKind';
    scoring = pickGroup(cards, top.rank);
  } else if (pairRanks.length === 2) {
    category = 'twoPair';
    const a = pairRanks[0] as Rank;
    const b = pairRanks[1] as Rank;
    scoring = [...pickGroup(cards, a), ...pickGroup(cards, b)];
  } else if (pairRanks.length === 1) {
    category = 'pair';
    scoring = pickGroup(cards, pairRanks[0] as Rank);
  } else {
    // 高牌：只计最高一张；同点数时按「点数降序、花色升序」固定选定，可重复
    category = 'highCard';
    const ordered = cards.slice().sort((a, b) => b.rank - a.rank || a.suit - b.suit);
    scoring = [ordered[0] as Card];
  }

  const scoringIds = new Set(scoring.map((c) => c.id));
  const rule = HAND_RULES[category];
  const chips = scoring.reduce((sum, c) => sum + chipValue(c.rank), 0);
  const selectedIds = cards.map((c) => c.id);

  return {
    category,
    name: rule.name,
    base: rule.base,
    multiplier: rule.multiplier,
    selectedIds,
    // 保持玩家的选择顺序，便于界面按选择顺序展示
    scoringIds: selectedIds.filter((id) => scoringIds.has(id)),
    kickerIds: selectedIds.filter((id) => !scoringIds.has(id)),
    chips,
    score: (rule.base + chips) * rule.multiplier,
  };
}
