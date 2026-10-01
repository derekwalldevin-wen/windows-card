import { RANK_LABEL, SUIT_SYMBOL, type Card } from '../rules/cards.ts';

/**
 * 牌面完全由程序绘制：点数、花色、牌点排布。
 * 不使用任何裁切素材，不复用概念图里的牌点。
 *
 * 整张牌就是一个 <button>，因此「视觉区域 = 点击区域 = 键盘可达区域」天然统一。
 */

type PipPos = readonly [x: number, y: number];

/** x ∈ {0, 0.5, 1}，y ∈ [0,1] 为牌面区内的相对位置。 */
const PIP_LAYOUTS: Readonly<Record<number, readonly PipPos[]>> = {
  1: [[0.5, 0.5]],
  2: [
    [0, 0],
    [1, 1],
  ],
  3: [
    [0, 0],
    [0.5, 0.5],
    [1, 1],
  ],
  4: [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ],
  5: [
    [0, 0],
    [1, 0],
    [0.5, 0.5],
    [0, 1],
    [1, 1],
  ],
  6: [
    [0, 0],
    [0, 0.5],
    [0, 1],
    [1, 0],
    [1, 0.5],
    [1, 1],
  ],
  7: [
    [0, 0],
    [0, 0.5],
    [0, 1],
    [1, 0],
    [1, 0.5],
    [1, 1],
    [0.5, 0.25],
  ],
  8: [
    [0, 0],
    [0, 0.5],
    [0, 1],
    [1, 0],
    [1, 0.5],
    [1, 1],
    [0.5, 0.25],
    [0.5, 0.75],
  ],
  9: [
    [0, 0],
    [0, 1 / 3],
    [0, 2 / 3],
    [0, 1],
    [1, 0],
    [1, 1 / 3],
    [1, 2 / 3],
    [1, 1],
    [0.5, 0.5],
  ],
  10: [
    [0, 0],
    [0, 0.2],
    [0, 0.4],
    [0, 0.6],
    [0, 0.8],
    [0, 1],
    [1, 0],
    [1, 0.2],
    [1, 0.4],
    [1, 0.6],
    [1, 0.8],
    [1, 1],
    [0.5, 0.1],
    [0.5, 0.9],
  ],
};

export type CardRole = 'plain' | 'selected' | 'scoring' | 'kicker';

export interface CardViewOptions {
  role?: CardRole;
  /** 禁用态（不可点） */
  inert?: boolean;
  /** 是否显示「计分 / 陪牌」角标 */
  roleBadge?: boolean;
}

function el(tag: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function corner(label: string, suit: string, extraClass: string): HTMLElement {
  const c = el('span', `card-corner ${extraClass}`);
  const rank = el('b', 'card-rank');
  rank.textContent = label;
  const pip = el('i', 'card-suit');
  pip.textContent = suit;
  c.append(rank, pip);
  return c;
}

function buildFace(card: Card): HTMLElement {
  const face = el('span', 'card-face');
  const symbol = SUIT_SYMBOL[card.suit] ?? '?';
  const label = RANK_LABEL[card.rank] ?? String(card.rank);

  if (card.rank === 14) {
    const big = el('span', 'card-ace');
    big.textContent = symbol;
    face.appendChild(big);
    return face;
  }

  if (card.rank >= 11) {
    const court = el('span', 'card-court');
    const letter = el('b', 'card-court-letter');
    letter.textContent = label;
    const pip = el('i', 'card-court-suit');
    pip.textContent = symbol;
    court.append(letter, pip);
    face.appendChild(court);
    return face;
  }

  const layout = PIP_LAYOUTS[card.rank] ?? [];
  for (const [x, y] of layout) {
    const pip = el('i', 'card-pip');
    pip.textContent = symbol;
    pip.style.left = `${x * 100}%`;
    pip.style.top = `${y * 100}%`;
    if (y > 0.5) pip.classList.add('is-flipped');
    face.appendChild(pip);
  }
  return face;
}

/** 造出一张牌的 DOM。整张牌即一个按钮，点击区域与视觉区域完全一致。 */
export function createCardElement(card: Card, options: CardViewOptions = {}): HTMLButtonElement {
  const { role = 'plain', inert = false, roleBadge = false } = options;

  const button = el('button', 'card') as HTMLButtonElement;
  button.type = 'button';
  button.dataset['id'] = card.id;
  button.dataset['suit'] = String(card.suit);
  button.dataset['rank'] = String(card.rank);
  button.dataset['role'] = role;
  button.setAttribute(
    'aria-label',
    `${SUIT_SYMBOL[card.suit]}${RANK_LABEL[card.rank]}`,
  );
  if (inert) {
    button.disabled = true;
  } else {
    button.setAttribute('aria-pressed', role === 'selected' ? 'true' : 'false');
  }

  const label = RANK_LABEL[card.rank] ?? String(card.rank);
  const symbol = SUIT_SYMBOL[card.suit] ?? '?';
  button.append(corner(label, symbol, 'card-corner-tl'), buildFace(card), corner(label, symbol, 'card-corner-br'));

  if (roleBadge && (role === 'scoring' || role === 'kicker')) {
    const badge = el('span', 'card-role-badge');
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = role === 'scoring' ? '计分' : '陪牌';
    button.appendChild(badge);
  }
  return button;
}
