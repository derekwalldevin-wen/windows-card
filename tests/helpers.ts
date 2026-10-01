import { SUIT_CODE, type Card, type Rank, type Suit } from '../src/rules/cards.ts';

const RANK_NUM: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  J: 11, Q: 12, K: 13, A: 14,
};

/** 测试用牌构造：c('S','A') → 黑桃 A。 */
export function c(suit: 'C' | 'D' | 'H' | 'S', rank: string): Card {
  const n = RANK_NUM[rank];
  if (n === undefined) throw new Error(`未知点数: ${rank}`);
  return {
    id: `${suit}${n}`,
    suit: SUIT_CODE.indexOf(suit) as Suit,
    rank: n as Rank,
  };
}

export function ids(cards: readonly Card[]): string[] {
  return cards.map((card) => card.id);
}
