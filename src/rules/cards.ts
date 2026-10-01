import { mulberry32 } from '../lib/rng.ts';

/** 花色：0 梅花 / 1 方块 / 2 红桃 / 3 黑桃（与 UI 绘制顺序一致） */
export type Suit = 0 | 1 | 2 | 3;

/** 点数：2..10 为面值，11 = J，12 = Q，13 = K，14 = A（A 为最大） */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export const ACE: Rank = 14;

export interface Card {
  /** 全局唯一 ID，例："S14"（花色字母 + 点数） */
  id: string;
  suit: Suit;
  rank: Rank;
}

export const SUIT_CODE = ['C', 'D', 'H', 'S'] as const;
export const SUIT_SYMBOL = ['♣', '♦', '♥', '♠'] as const;
export const SUIT_NAME = ['梅花', '方块', '红桃', '黑桃'] as const;
export const RANK_LABEL: Record<Rank, string> = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
};

/** 点数 → 计分用数值：2—10 面值，J/Q/K 均为 10，A 为 11。 */
export function chipValue(rank: Rank): number {
  if (rank === ACE) return 11;
  if (rank >= 11) return 10;
  return rank;
}

/** 标准 52 张，无大小王。每张牌 ID 唯一。 */
export function buildDeck(): Card[] {
  const cards: Card[] = [];
  for (let s = 0; s < 4; s++) {
    const suit = s as Suit;
    for (let r = 2; r <= 14; r++) {
      const rank = r as Rank;
      cards.push({ id: `${SUIT_CODE[suit]}${rank}`, suit, rank });
    }
  }
  return cards;
}

/**
 * Fisher–Yates 洗牌。
 * 纯函数：同种子必然得到同一顺序，便于复现与回归测试。
 */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice();
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export function cardById(id: string): Card {
  const suit = SUIT_CODE.indexOf(id[0] as (typeof SUIT_CODE)[number]) as Suit;
  const rank = Number(id.slice(1)) as Rank;
  return { id, suit, rank };
}

export function cardsById(ids: readonly string[]): Card[] {
  return ids.map(cardById);
}
