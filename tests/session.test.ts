import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildDeck } from '../src/rules/cards.ts';
import {
  HAND_SIZE,
  MAX_DISCARDS,
  MAX_SELECT,
  createSession,
  previewSelection,
  reduce,
  type SessionAction,
  type SessionState,
} from '../src/rules/session.ts';
import { evaluate } from '../src/rules/evaluate.ts';

function run(state: SessionState, ...actions: SessionAction[]): SessionState {
  return actions.reduce(reduce, state);
}

function selectAll(state: SessionState): SessionState {
  return run(state, ...state.hand.slice(0, MAX_SELECT).map((c) => ({ type: 'toggle', id: c.id }) as SessionAction));
}

test('开局：8 张手牌、牌堆 44 张、弃牌 3 次、分数 0', () => {
  const s = createSession(20260930);
  assert.equal(s.hand.length, HAND_SIZE);
  assert.equal(s.deck.length, 52 - HAND_SIZE);
  assert.equal(s.discardsLeft, MAX_DISCARDS);
  assert.equal(s.totalScore, 0);
  assert.equal(s.phase, 'playing');
  assert.equal(new Set(s.hand.map((c) => c.id)).size, HAND_SIZE, '手牌不得重复');
});

test('同种子完全可复现（手牌与牌堆顺序一致）', () => {
  const a = createSession(777);
  const b = createSession(777);
  assert.deepEqual(a.hand.map((c) => c.id), b.hand.map((c) => c.id));
  assert.deepEqual(a.deck.map((c) => c.id), b.deck.map((c) => c.id));
});

test('选牌上限 5 张：第 6 张被拒绝且给出提示', () => {
  let s = createSession(1);
  const first8 = s.hand.slice(0, 8).map((c) => c.id);
  s = run(s, ...first8.map((id) => ({ type: 'toggle', id }) as SessionAction));
  assert.equal(s.selectedIds.length, MAX_SELECT);
  assert.ok(s.lastReject, '超限应给出提示');
  assert.match(s.lastReject, /最多/);
});

test('点击同一张可取消选择', () => {
  let s = createSession(2);
  const id = s.hand[0]!.id;
  s = run(s, { type: 'toggle', id });
  assert.deepEqual(s.selectedIds, [id]);
  s = run(s, { type: 'toggle', id });
  assert.deepEqual(s.selectedIds, []);
  assert.equal(s.lastReject, null);
});

test('出牌：只结算一次，消耗全部选中牌（含陪牌），补至 8 张', () => {
  let s = createSession(3);
  s = selectAll(s);
  const picked = s.selectedIds;
  const preview = previewSelection(s);
  assert.ok(preview);
  const before = s.totalScore;
  const deckBefore = s.deck.length;

  s = run(s, { type: 'play' });

  assert.equal(s.selectedIds.length, 0);
  assert.equal(s.totalScore, before + preview.score, '总分只加一次预览得分');
  assert.equal(s.hand.length, HAND_SIZE);
  assert.equal(s.deck.length, deckBefore - picked.length);
  for (const id of picked) {
    assert.equal(s.hand.some((c) => c.id === id), false, `${id} 必须离开手牌`);
    assert.equal(s.deck.some((c) => c.id === id), false, `${id} 不得回到牌堆`);
  }
  assert.equal(s.handsPlayed, 1);
  assert.ok(s.lastPlay);
  assert.equal(s.lastPlay?.kind, 'play');
  assert.equal(s.lastPlay?.evaluation?.score, preview.score, '结算结果必须等于预览');
});

test('预览得分恒等于真实结算（多种牌型抽样）', () => {
  for (const seed of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]) {
    let s = createSession(seed);
    s = selectAll(s);
    const preview = previewSelection(s);
    assert.ok(preview, `seed ${seed} 应有预览`);
    const expected = evaluate(s.hand.slice(0, MAX_SELECT)).score;
    assert.equal(preview.score, expected);
    const delta = { seed, delta: 0 };
    s = run(s, { type: 'play' });
    delta.delta = s.totalScore;
    assert.equal(delta.delta, expected, `seed ${seed} 结算应等于预览`);
  }
});

test('连续重复点击「出牌」不会重复计分或重复补牌', () => {
  let s = createSession(11);
  s = selectAll(s);
  const pickedCount = s.selectedIds.length;
  const deckBefore = s.deck.length;

  s = run(s, { type: 'play' });
  const scoreAfterFirst = s.totalScore;
  const handAfterFirst = s.hand.map((c) => c.id);
  const deckAfterFirst = s.deck.length;

  // 模拟连点 5 次
  for (let i = 0; i < 5; i++) s = run(s, { type: 'play' });

  assert.equal(s.totalScore, scoreAfterFirst, '总分不得重复累加');
  assert.deepEqual(s.hand.map((c) => c.id), handAfterFirst, '手牌不得被再次改动');
  assert.equal(s.deck.length, deckAfterFirst, '牌堆不得被再次抽牌');
  assert.equal(deckBefore - deckAfterFirst, pickedCount, '只抽了本次选中的张数');
  assert.ok(s.lastReject, '重复点击应给出提示');
});

test('弃牌：不得分、消耗选中牌、补牌、次数减 1', () => {
  let s = createSession(4);
  s = selectAll(s);
  const picked = s.selectedIds;
  const before = s.totalScore;
  s = run(s, { type: 'discard' });
  assert.equal(s.totalScore, before, '弃牌不得分');
  assert.equal(s.discardsLeft, MAX_DISCARDS - 1);
  assert.equal(s.hand.length, HAND_SIZE);
  for (const id of picked) {
    assert.equal(s.hand.some((c) => c.id === id), false);
    assert.equal(s.deck.some((c) => c.id === id), false, '弃牌不得回到牌堆');
  }
});

test('弃牌次数耗尽后被拒绝', () => {
  let s = createSession(6);
  for (let i = 0; i < MAX_DISCARDS; i++) {
    s = selectAll(s);
    s = run(s, { type: 'discard' });
    assert.equal(s.discardsLeft, MAX_DISCARDS - 1 - i);
  }
  assert.equal(s.discardsLeft, 0);
  s = selectAll(s);
  s = run(s, { type: 'discard' });
  assert.equal(s.discardsLeft, 0, '不得再减少');
  assert.ok(s.lastReject);
  assert.match(s.lastReject, /弃牌/);
});

test('空选择时出牌/弃牌均被拒绝', () => {
  let s = createSession(7);
  s = run(s, { type: 'play' });
  assert.ok(s.lastReject);
  const afterPlay = s.totalScore;
  s = run(s, { type: 'discard' });
  assert.ok(s.lastReject);
  assert.equal(s.totalScore, afterPlay);
  assert.equal(s.discardsLeft, MAX_DISCARDS, '被拒绝的动作不得改变任何数据');
});

test('牌堆不足时只补到实际可补的数量，不报错', () => {
  const small = buildDeck().slice(0, 9);
  let s = createSession(9, { deck: small });
  assert.equal(s.hand.length, 8);
  assert.equal(s.deck.length, 1);

  s = selectAll(s);
  s = run(s, { type: 'play' });
  assert.equal(s.deck.length, 0);
  assert.equal(s.hand.length, 4, '只能补到 4 张');
  assert.equal(s.phase, 'playing');

  s = selectAll(s);
  assert.equal(s.selectedIds.length, 4);
  s = run(s, { type: 'play' });
  assert.equal(s.hand.length, 0);
  assert.equal(s.phase, 'over', '没有手牌后结束练习');
});

test('结束练习后不能再出牌或弃牌，需重新练习', () => {
  const small = buildDeck().slice(0, 9);
  let s = createSession(9, { deck: small });
  s = selectAll(s);
  s = run(s, { type: 'play' });
  s = selectAll(s);
  s = run(s, { type: 'play' });
  assert.equal(s.phase, 'over');
  const score = s.totalScore;

  s = selectAll(s);
  assert.equal(s.selectedIds.length, 0, '结束后不允许再选牌');
  s = run(s, { type: 'play' });
  assert.equal(s.totalScore, score, '结束后不得再计分');
  assert.ok(s.lastReject);
});

test('重新练习：只重置当前练习状态（同种子可复现）', () => {
  let s = createSession(123);
  s = selectAll(s);
  s = run(s, { type: 'play' });
  s = selectAll(s);
  s = run(s, { type: 'discard' });
  assert.ok(s.totalScore > 0);

  const fresh = createSession(123);
  s = run(s, { type: 'restart' });
  assert.equal(s.totalScore, 0);
  assert.equal(s.discardsLeft, MAX_DISCARDS);
  assert.equal(s.hand.length, HAND_SIZE);
  assert.equal(s.selectedIds.length, 0);
  assert.equal(s.lastPlay, null);
  assert.equal(s.phase, 'playing');
  assert.deepEqual(s.hand.map((c) => c.id), fresh.hand.map((c) => c.id), '同种子重开得到同样的牌');
});

test('长跑不出现重复牌，且已出/已弃的牌不会重现', () => {
  let s = createSession(4242);
  const universe = new Set(buildDeck().map((c) => c.id));
  const removed = new Set<string>();

  for (let i = 0; i < 10; i++) {
    const handIds = s.hand.map((c) => c.id);
    const deckIds = s.deck.map((c) => c.id);

    assert.equal(new Set(handIds).size, handIds.length, '手牌内部不得重复');
    assert.equal(new Set(deckIds).size, deckIds.length, '牌堆内部不得重复');
    assert.equal(
      handIds.filter((id) => deckIds.includes(id)).length,
      0,
      '手牌与牌堆不得有交集',
    );
    for (const id of [...handIds, ...deckIds]) {
      assert.equal(universe.has(id), true, `${id} 不属于本副牌`);
      assert.equal(removed.has(id), false, `${id} 已离开牌局，不得重现`);
    }

    s = selectAll(s);
    if (s.selectedIds.length === 0) break;
    const played = [...s.selectedIds];
    s = run(s, { type: 'play' });
    for (const id of played) removed.add(id);
  }

  assert.ok(removed.size > 0, '至少应消耗过一些牌');
});

test('状态机是纯函数：相同动作序列得到相同结果', () => {
  const seq = (s: SessionState): SessionState => {
    let x = s;
    x = selectAll(x);
    x = run(x, { type: 'play' });
    x = selectAll(x);
    x = run(x, { type: 'discard' });
    return x;
  };
  const a = seq(createSession(999));
  const b = seq(createSession(999));
  assert.deepEqual(a, b);
});
