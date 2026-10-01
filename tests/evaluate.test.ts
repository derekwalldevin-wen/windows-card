import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate, isStraight, type HandCategory } from '../src/rules/evaluate.ts';
import { buildDeck, chipValue, shuffle } from '../src/rules/cards.ts';
import { c, ids } from './helpers.ts';

test('牌堆：标准 52 张、无大小王、ID 唯一', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((x) => x.id)).size, 52);
  assert.equal(deck.some((x) => (x.rank as number) === 1), false, '不应有小王');
  for (const x of deck) {
    assert.ok(x.rank >= 2 && x.rank <= 14, `点数越界: ${x.rank}`);
  }
});

test('洗牌：同种子完全可复现，不同种子不同', () => {
  const deck = buildDeck();
  const a = shuffle(deck, 12345);
  const b = shuffle(deck, 12345);
  const c2 = shuffle(deck, 54321);
  assert.deepEqual(ids(a), ids(b));
  assert.notDeepEqual(ids(a), ids(c2));
  assert.deepEqual([...ids(a)].sort(), [...ids(deck)].sort(), '洗牌不增删牌');
});

test('计分点数：2—10 面值，J/Q/K 均为 10，A 为 11', () => {
  assert.equal(chipValue(2), 2);
  assert.equal(chipValue(10), 10);
  assert.equal(chipValue(11), 10, 'J');
  assert.equal(chipValue(12), 10, 'Q');
  assert.equal(chipValue(13), 10, 'K');
  assert.equal(chipValue(14), 11, 'A');
});

test('顺子判定：A2345 与 10JQKA 有效，QKA23 等跨界无效', () => {
  assert.equal(isStraight([14, 2, 3, 4, 5]), true, 'A2345 应为顺子');
  assert.equal(isStraight([10, 11, 12, 13, 14]), true, '10JQKA 应为顺子');
  assert.equal(isStraight([13, 14, 2, 3, 11]), false, 'QKA23 不应算顺子');
  assert.equal(isStraight([12, 13, 14, 2, 3]), false, 'KA234 不应算顺子');
  assert.equal(isStraight([11, 12, 13, 14, 2]), false, 'JQA23 不应算顺子');
  assert.equal(isStraight([2, 3, 4, 5, 7]), false, '不连续');
  assert.equal(isStraight([2, 3, 4, 5]), false, '不足 5 张');
});

const CATEGORY_CASES: Array<{
  label: string;
  category: HandCategory;
  cards: ReturnType<typeof c>[];
  base: number;
  multiplier: number;
}> = [
  { label: '同花顺', category: 'straightFlush', cards: [c('S', '2'), c('S', '3'), c('S', '4'), c('S', '5'), c('S', '6')], base: 100, multiplier: 8 },
  { label: '四条', category: 'fourOfAKind', cards: [c('C', '9'), c('D', '9'), c('H', '9'), c('S', '9'), c('D', '3')], base: 60, multiplier: 7 },
  { label: '葫芦', category: 'fullHouse', cards: [c('C', '7'), c('D', '7'), c('H', '7'), c('C', '5'), c('D', '5')], base: 40, multiplier: 4 },
  { label: '同花', category: 'flush', cards: [c('H', '2'), c('H', '5'), c('H', '9'), c('H', 'J'), c('H', 'K')], base: 35, multiplier: 4 },
  { label: '顺子', category: 'straight', cards: [c('C', '3'), c('D', '4'), c('H', '5'), c('S', '6'), c('C', '7')], base: 30, multiplier: 4 },
  { label: '三条', category: 'threeOfAKind', cards: [c('C', '8'), c('D', '8'), c('H', '8'), c('S', '2')], base: 30, multiplier: 3 },
  { label: '两对', category: 'twoPair', cards: [c('C', '4'), c('D', '4'), c('C', '9'), c('H', '9'), c('S', '3')], base: 20, multiplier: 2 },
  { label: '一对', category: 'pair', cards: [c('C', '10'), c('D', '10'), c('H', '3')], base: 10, multiplier: 2 },
  { label: '高牌', category: 'highCard', cards: [c('C', '2'), c('D', '5'), c('H', '9')], base: 5, multiplier: 1 },
];

for (const item of CATEGORY_CASES) {
  test(`牌型判定：${item.label}`, () => {
    const r = evaluate(item.cards);
    assert.equal(r.category, item.category, `牌型应为 ${item.label}`);
    assert.equal(r.name, item.label);
    assert.equal(r.base, item.base);
    assert.equal(r.multiplier, item.multiplier);
    assert.equal(r.score, (item.base + r.chips) * item.multiplier, '得分公式必须为（基础+点数）×倍率');
  });
}

test('九种牌型全部覆盖到（防漏）', () => {
  const seen = new Set(CATEGORY_CASES.map((x) => x.category));
  assert.equal(seen.size, 9);
});

test('验证例子 1：A♠2♦3♣4♥5♠ 顺子 =（30+25）×4 = 220', () => {
  const r = evaluate([c('S', 'A'), c('D', '2'), c('C', '3'), c('H', '4'), c('S', '5')]);
  assert.equal(r.category, 'straight');
  assert.equal(r.chips, 25, 'A 计 11，其余 2+3+4+5=14');
  assert.equal(r.score, 220);
  assert.equal(r.scoringIds.length, 5, '顺子 5 张全部计分');
  assert.equal(r.kickerIds.length, 0);
});

test('验证例子 2：8♠8♥K♣4♦2♠ 一对 =（10+16）×2 = 52，陪牌 3 张不计分', () => {
  const cards = [c('S', '8'), c('H', '8'), c('C', 'K'), c('D', '4'), c('S', '2')];
  const r = evaluate(cards);
  assert.equal(r.category, 'pair');
  assert.equal(r.chips, 16, '只计两张 8');
  assert.equal(r.score, 52);
  assert.deepEqual([...r.scoringIds].sort(), ['H8', 'S8']);
  assert.equal(r.kickerIds.length, 3, 'K/4/2 为陪牌');
  assert.deepEqual([...r.kickerIds].sort(), ['C13', 'D4', 'S2']);
  assert.equal(r.selectedIds.length, 5, '全部 5 张都被选中，都会消耗');
});

test('验证例子 3：单张 A 高牌 =（5+11）×1 = 16', () => {
  const r = evaluate([c('D', 'A')]);
  assert.equal(r.category, 'highCard');
  assert.equal(r.chips, 11);
  assert.equal(r.score, 16);
});

test('高牌只计最高一张：J<Q<K<A', () => {
  const cases: Array<[string[], string]> = [
    [['C11', 'D12'], 'D12'],
    [['C12', 'D13'], 'D13'],
    [['C13', 'D14'], 'D14'],
    [['C14', 'D13'], 'C14'],
  ];
  for (const [list, expect] of cases) {
    const cards = list.map((id) => {
      const n = Number(id.slice(1));
      return { id, suit: 'CDHS'.indexOf(id[0] as 'C') as 0 | 1 | 2 | 3, rank: n as 2 };
    });
    const r = evaluate(cards);
    assert.equal(r.category, 'highCard');
    assert.equal(r.scoringIds.length, 1);
    assert.equal(r.scoringIds[0], expect);
  }
});

test('高牌同点数时按固定顺序选定一张，且可重复', () => {
  const make = () => [c('C', '9'), c('D', '9'), c('H', '9')];
  const first = evaluate(make());
  const second = evaluate(make());
  const reversed = evaluate([c('H', '9'), c('D', '9'), c('C', '9')]);
  assert.equal(first.scoringIds[0], 'C9', '固定取花色最小的黑桃位序 C');
  assert.deepEqual(first.scoringIds, second.scoringIds, '同输入必须同结果');
  assert.deepEqual([...first.scoringIds].sort(), [...reversed.scoringIds].sort(), '与选择顺序无关');
});

test('四张同点即四条；五张 4+1 仍是四条且只计 4 张', () => {
  const four = evaluate([c('C', 'A'), c('D', 'A'), c('H', 'A'), c('S', 'A')]);
  assert.equal(four.category, 'fourOfAKind');
  assert.equal(four.chips, 44);
  assert.equal(four.kickerIds.length, 0);

  const withKicker = evaluate([c('C', 'A'), c('D', 'A'), c('H', 'A'), c('S', 'A'), c('D', '2')]);
  assert.equal(withKicker.category, 'fourOfAKind');
  assert.equal(withKicker.chips, 44, '陪牌 2 不计分');
  assert.deepEqual(withKicker.kickerIds, ['D2']);
});

test('顺子 / 同花 / 葫芦 / 同花顺 必须选满 5 张', () => {
  const four = [c('C', '3'), c('D', '4'), c('H', '5'), c('S', '6')];
  assert.notEqual(evaluate(four).category, 'straight');
  assert.notEqual(evaluate([c('H', '2'), c('H', '5'), c('H', '9'), c('H', 'J')]).category, 'flush');
  assert.notEqual(evaluate([c('C', '7'), c('D', '7'), c('H', '7'), c('C', '5')]).category, 'fullHouse');
  assert.notEqual(evaluate([c('S', '2'), c('S', '3'), c('S', '4'), c('S', '5')]).category, 'straightFlush');
});

test('皇家同花顺归入同花顺', () => {
  const r = evaluate([c('S', '10'), c('S', 'J'), c('S', 'Q'), c('S', 'K'), c('S', 'A')]);
  assert.equal(r.category, 'straightFlush');
  assert.equal(r.base, 100);
  assert.equal(r.multiplier, 8);
});

test('四条 > 葫芦 > 同花 > 顺子 > 三条 的判定优先级', () => {
  // 4+1 同时是四条，不能被误判为同花或葫芦
  const r = evaluate([c('C', 'K'), c('D', 'K'), c('H', 'K'), c('S', 'K'), c('S', '2')]);
  assert.equal(r.category, 'fourOfAKind');
});

test('空选择返回零分且不抛错', () => {
  const r = evaluate([]);
  assert.equal(r.score, 0);
  assert.equal(r.scoringIds.length, 0);
});
