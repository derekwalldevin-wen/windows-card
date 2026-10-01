import {
  createSession,
  previewSelection,
  reduce,
  type SessionAction,
  type SessionState,
} from './rules/session.ts';
import type { HandEvaluation } from './rules/evaluate.ts';

/**
 * 唯一权威状态。UI 只能读取与 dispatch，不得自行推导任何规则结果。
 * 全部同步：结算在 dispatch 返回前完成，动画只负责展示结果。
 */
export type Listener = (state: SessionState, action: SessionAction) => void;

export const DEFAULT_SEED = 20260930;

let state: SessionState = createSession(readSeedFromUrl());
const listeners = new Set<Listener>();

function readSeedFromUrl(): number {
  if (typeof location === 'undefined') return DEFAULT_SEED;
  const raw = new URLSearchParams(location.search).get('seed');
  if (raw === null) return DEFAULT_SEED;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : DEFAULT_SEED;
}

export function getSession(): SessionState {
  return state;
}

/** 当前选择的预览（与真实结算走同一套 evaluate，不改变任何状态）。 */
export function getPreview(): HandEvaluation | null {
  return previewSelection(state);
}

export function dispatch(action: SessionAction): SessionState {
  const next = reduce(state, action);
  if (next !== state) {
    state = next;
    for (const listener of listeners) listener(state, action);
  }
  return state;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
