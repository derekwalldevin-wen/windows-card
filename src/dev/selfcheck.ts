/**
 * 自检报告（仅开发验收用）。
 * 访问 ?selfcheck=1 时，把布局、3D 对齐与规则状态写进 #selfcheck，
 * 便于用无头浏览器直接读出数字，避免肉眼估算。
 * 正式使用时页面不会出现任何可见变化。
 */
import type { PlayFit } from '../scene/camera.ts';
import type { SessionState } from '../rules/session.ts';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ZoneReport {
  name: string;
  rect: Rect;
  right: number;
  bottom: number;
  overflowRight: number;
  overflowBottom: number;
  childCount: number;
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
}

function zoneReport(name: string, el: Element, stage: Rect): ZoneReport {
  const r = el.getBoundingClientRect();
  return {
    name,
    rect: rectOf(el),
    right: +r.right.toFixed(1),
    bottom: +r.bottom.toFixed(1),
    overflowRight: +Math.max(0, r.right - (stage.x + stage.w)).toFixed(1),
    overflowBottom: +Math.max(0, r.bottom - (stage.y + stage.h)).toFixed(1),
    childCount: el.children.length,
  };
}

export function renderSelfCheck(
  stageEl: HTMLElement,
  cardZones: readonly Element[],
  fit: () => PlayFit | null,
  session: () => SessionState,
  diag: () => Record<string, unknown>,
): void {
  if (new URLSearchParams(location.search).get('selfcheck') !== '1') return;

  const canvasEl = document.getElementById('scene');
  const stage = rectOf(stageEl);
  const canvas = canvasEl ? rectOf(canvasEl) : { x: 0, y: 0, w: 0, h: 0 };

  const zones: ZoneReport[] = [];
  const push = (name: string, sel: string): void => {
    const el = document.querySelector(sel);
    if (el) zones.push(zoneReport(name, el, stage));
  };
  push('hud', '.zone-hud');
  push('cat', '.zone-cat');
  push('catImg', '.cat-img');
  push('catShadow', '.cat-shadow');
  push('spacer', '.zone-spacer');
  push('play', '.zone-play');
  push('plate', '.play-plate');
  push('pill', '.play-pill');
  push('hand', '.zone-hand');
  push('handRow1', '.hand-rows > .slot-row:nth-child(1)');
  push('handRow2', '.hand-rows > .slot-row:nth-child(2)');
  push('actions', '.zone-actions');
  push('deck', '.deck-marker');
  push('discard', '.btn-discard');
  push('playBtn', '.btn-play');

  // 卡牌所在的联合矩形（画布坐标）
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const el of cardZones) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  const hasField = Number.isFinite(left);
  const fieldRect: Rect = hasField
    ? {
        x: +(left - canvas.x).toFixed(1),
        y: +(top - canvas.y).toFixed(1),
        w: +(right - left).toFixed(1),
        h: +(bottom - top).toFixed(1),
      }
    : { x: 0, y: 0, w: 0, h: 0 };

  // 本轮起没有 3D，fit 恒为 null；对齐误差无意义，置 null。
  const f = fit();
  const alignError = null;

  // 卡牌实际尺寸与点击区域
  const cards = Array.from(document.querySelectorAll<HTMLElement>('.zone-hand .card'));
  const cardRects = cards.map((c) => {
    const r = c.getBoundingClientRect();
    return {
      id: c.dataset['id'] ?? '',
      x: +r.left.toFixed(1),
      y: +r.top.toFixed(1),
      w: +r.width.toFixed(1),
      h: +r.height.toFixed(1),
      role: c.dataset['role'] ?? '',
    };
  });
  const minTap = cardRects.length
    ? +Math.min(...cardRects.map((c) => Math.min(c.w, c.h))).toFixed(1)
    : 0;

  const doc = document.documentElement;
  const s = session();
  const report: Record<string, unknown> = {
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    // 页面级就绪标志：背景图与猫贴图都解码完成后才置 true。
    // 供工具脚本判断读数是否已定稿，避免读到解码中的中间值。
    ready: (() => {
      const bgImg = document.querySelector<HTMLImageElement>('.bg-img');
      const catImg = document.querySelector<HTMLImageElement>('.cat-img');
      const layer = document.querySelector('.bg-layer');
      return {
        bg: (bgImg?.naturalWidth ?? 0) > 0 && layer?.classList.contains('is-failed') !== true,
        cat: (catImg?.naturalWidth ?? 0) > 0,
      };
    })(),
    stage,
    canvas,
    cardFieldRect: fieldRect,
    alignError,
    playRectWorld: f
      ? {
          halfW: +f.halfW.toFixed(4),
          halfD: +f.halfD.toFixed(4),
          centerX: +f.centerX.toFixed(4),
          centerZ: +f.centerZ.toFixed(4),
          clamped: f.clamped,
        }
      : null,
    scroll: {
      scrollW: doc.scrollWidth,
      clientW: doc.clientWidth,
      scrollH: doc.scrollHeight,
      clientH: doc.clientHeight,
      hasHScroll: doc.scrollWidth > doc.clientWidth,
      hasVScroll: doc.scrollHeight > doc.clientHeight,
    },
    cards: {
      count: cardRects.length,
      minTapSide: minTap,
      rects: cardRects,
    },
    session: {
      seed: s.seed,
      hand: s.hand.map((c) => c.id),
      selected: s.selectedIds,
      deck: s.deck.length,
      discardsLeft: s.discardsLeft,
      totalScore: s.totalScore,
      phase: s.phase,
    },
    zones,
    diag: diag(),
    tableBackLineY: (diag()['diag'] as { tableBackLineY?: number } | undefined)?.tableBackLineY ?? null,
    catBaseLineY: (diag()['diag'] as { catBaseLineY?: number } | undefined)?.catBaseLineY ?? null,
    cat: (() => {
      const root = document.querySelector<HTMLElement>('.zone-cat');
      const img = document.querySelector<HTMLImageElement>('.cat-img');
      return {
        id: root?.dataset['cat'] ?? null,
        name: root?.dataset['catName'] ?? null,
        src: img?.getAttribute('src') ?? null,
        natural: img ? `${img.naturalWidth}x${img.naturalHeight}` : null,
        complete: img?.complete ?? false,
        naturalW: img?.naturalWidth ?? 0,
      };
    })(),
  };

  const catImg = document.querySelector<HTMLImageElement>('.cat-img');

  /** 猫咪贴图解码完成后，重算受影响分区的矩形再定稿一次。 */
  function resettle(): void {
    for (const zn of zones) {
      const el =
        zn.name === 'catImg'
          ? catImg
          : document.querySelector(`.${zn.name.replace(/([A-Z])/g, (m) => '-' + m.toLowerCase())}`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      zn.rect = { x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
      zn.right = +r.right.toFixed(1);
      zn.bottom = +r.bottom.toFixed(1);
      zn.overflowRight = +Math.max(0, r.right - (stage.x + stage.w)).toFixed(1);
      zn.overflowBottom = +Math.max(0, r.bottom - (stage.y + stage.h)).toFixed(1);
    }
    const root = document.querySelector<HTMLElement>('.zone-cat');
    report['cat'] = {
      id: root?.dataset['cat'] ?? null,
      name: root?.dataset['catName'] ?? null,
      src: catImg?.getAttribute('src') ?? null,
      natural: catImg ? `${catImg.naturalWidth}x${catImg.naturalHeight}` : null,
      complete: catImg?.complete ?? false,
      naturalW: catImg?.naturalWidth ?? 0,
    };
    report['ready'] = (() => {
      const bi = document.querySelector<HTMLImageElement>('.bg-img');
      const ci = document.querySelector<HTMLImageElement>('.cat-img');
      const layer = document.querySelector('.bg-layer');
      return {
        bg: (bi?.naturalWidth ?? 0) > 0 && layer?.classList.contains('is-failed') !== true,
        cat: (ci?.naturalWidth ?? 0) > 0,
      };
    })();
    // diag() 里也带了背景适配读数，背景就绪后要一起刷新
    report['diag'] = diag();
    emit();
  }

  const emit = (): void => {
    // 重算后要**替换**旧节点：querySelector('#selfcheck') 只返回第一个，
    // 直接 append 会让读数停留在第一次定稿的旧值上。
    document.getElementById('selfcheck')?.remove();
    const pre = document.createElement('pre');
    pre.id = 'selfcheck';
    pre.textContent = `SELFCHECK${JSON.stringify(report)}ENDSELFCHECK`;
    pre.style.cssText = 'position:fixed;left:-99999px;top:0;';
    document.body.appendChild(pre);
    console.info('[selfcheck]', JSON.stringify(report));
  };

  emit();

  /**
   * 贴图解码前尺寸未定，分区读数会失真。
   * 背景图与猫贴图都是异步的，任一就绪都重新定稿一次。
   * 背景层在 load 时派发 document 上的 'bg-ready'。
   */
  const bgImg = document.querySelector<HTMLImageElement>('.bg-img');
  if (bgImg && !(bgImg.complete && bgImg.naturalWidth > 0)) {
    const bgOnce = (): void => {
      bgImg.removeEventListener('load', bgOnce);
      bgImg.removeEventListener('error', bgOnce);
      resettle();
    };
    bgImg.addEventListener('load', bgOnce, { once: true });
    bgImg.addEventListener('error', bgOnce, { once: true });
  }
  // 背景层可能已在 selfcheck 之前就绪，这里补一次判定
  if (bgImg && bgImg.complete && bgImg.naturalWidth > 0) queueMicrotask(resettle);

  if (catImg && !(catImg.complete && catImg.naturalWidth > 0)) {
    const catOnce = (): void => {
      catImg.removeEventListener('load', catOnce);
      catImg.removeEventListener('error', catOnce);
      resettle();
    };
    catImg.addEventListener('load', catOnce, { once: true });
    catImg.addEventListener('error', catOnce, { once: true });
  }
  if (catImg && catImg.complete && catImg.naturalWidth > 0) queueMicrotask(resettle);
}
