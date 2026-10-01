/**
 * 背景层：一张静态窗边背景图，取代 Three.js 场景。
 *
 * 缩放规则（统一一套变换，猫咪与界面共用）：
 *   scale = max(containerW / BG.w, containerH / BG.h) 的**最小**可用值，
 *   实际用「优先铺满宽度」：scale = containerW / BG.w
 *   - 若 scale*BG.h >= containerH：宽高都能铺满，按宽度铺，垂直居中；
 *   - 若 scale*BG.h < containerH（长屏）：按高度铺，水平居中取最小覆盖，
 *     两侧超出部分被裁（不拉伸）。
 *   绝不做非等比拉伸。
 *
 * 顶部对齐：短屏时优先保窗户（BG_ANCHORS.windowBottom 以上不裁），
 * 所以垂直偏移取「顶部对齐」，多出来的高度裁在底部（桌面上，无信息）。
 *
 * 输出 CSS 变量（写在 stage 上）：
 *   --bg-scale     当前缩放倍数
 *   --bg-w/--bg-h  缩放后的像素尺寸
 *   --bg-x/--bg-y  在容器内的偏移（左上角）
 * 猫咪落位用同一组变量换算，见 cat.ts 的 syncCatTransform()。
 */
import { BG_SIZE, BG_ANCHORS } from './cat-placement.ts';

export interface BackgroundFit {
  scale: number;
  w: number;
  h: number;
  x: number;
  y: number;
  /** 缩放由宽度还是高度决定 */
  fitBy: 'width' | 'height';
  /** 底部被裁掉多少像素 */
  croppedBottom: number;
}

export function computeBackgroundFit(containerW: number, containerH: number): BackgroundFit {
  const scaleW = containerW / BG_SIZE.w;
  const scaleH = containerH / BG_SIZE.h;
  const scale = Math.max(scaleW, scaleH);
  const w = BG_SIZE.w * scale;
  const h = BG_SIZE.h * scale;
  return {
    scale,
    w,
    h,
    x: (containerW - w) / 2,
    y: 0,
    fitBy: scaleH > scaleW ? 'height' : 'width',
    croppedBottom: Math.max(0, h - containerH),
  };
}

/**
 * 猫脚锚点在背景图上的**归一化**位置。
 *
 * 用归一化而不是像素，是为了让「按高度铺满」和「按宽度铺满」两种模式下
 * 猫都能落在桌垫的同一个位置 —— 只乘 scale 会在两种模式下偏掉。
 */
export const BG_ANCHOR_NORM = {
  footX: BG_ANCHORS.foot.x / BG_SIZE.w,
  footY: BG_ANCHORS.foot.y / BG_SIZE.h,
} as const;

/**
 * 猫脚锚点换算成容器内的屏幕坐标。
 *
 * 与 computeBackgroundFit 同一套几何：背景图左上角在 (x, y)，
 * 缩放 scale，所以图内归一化点 (u,v) 的屏幕位置是
 *   x + u*w,  y + v*h
 * 猫咪与背景共享这一份计算，不存在第二套定位逻辑。
 */
export function anchorToScreen(
  fit: BackgroundFit,
  u: number,
  v: number,
): { x: number; y: number } {
  return { x: fit.x + u * fit.w, y: fit.y + v * fit.h };
}

export function applyBackgroundVars(stage: HTMLElement, fit: BackgroundFit): void {
  const s = stage.style;
  s.setProperty('--bg-scale', `${fit.scale}`);
  s.setProperty('--bg-w', `${fit.w}px`);
  s.setProperty('--bg-h', `${fit.h}px`);
  s.setProperty('--bg-x', `${fit.x}px`);
  s.setProperty('--bg-y', `${fit.y}px`);
}

/**
 * 背景层控制器。
 * 只做一件事：把图片按上面的规则摆好，并在图片出错时给出降级提示。
 * 不创建 WebGL 上下文，不跑渲染循环。
 */
export interface BackgroundLayer {
  root: HTMLElement;
  /** 重新按容器尺寸计算并落位，返回本次适配结果 */
  sync(): BackgroundFit;
  /** 背景是否已成功加载 */
  ready(): boolean;
  dispose(): void;
}

const FALLBACK_TEXT =
  '背景图加载失败。游戏功能不受影响，可继续选牌计分。';

export function createBackground(src: string, stage: HTMLElement): BackgroundLayer {
  const root = document.createElement('div');
  root.className = 'bg-layer';
  root.setAttribute('aria-hidden', 'true');

  const img = document.createElement('img');
  img.className = 'bg-img';
  img.decoding = 'async';
  img.loading = 'eager';
  img.alt = '';
  img.draggable = false;
  root.appendChild(img);

  const fallback = document.createElement('div');
  fallback.className = 'bg-fallback';
  fallback.hidden = true;
  fallback.innerHTML = `<p>${FALLBACK_TEXT}</p>`;
  root.appendChild(fallback);

  let loaded = false;
  let failed = false;

  const onLoad = (): void => {
    loaded = true;
    failed = false;
    fallback.hidden = true;
    root.classList.remove('is-failed');
    stage.dataset['bg'] = 'ready';
    stage.classList.remove('bg-failed');
    // 通知外部（猫咪）重新落位：图片真实尺寸这时才确定
    document.dispatchEvent(new CustomEvent('bg-ready'));
  };
  const onError = (): void => {
    failed = true;
    loaded = false;
    // 降级：保留一个纯色底，界面与卡牌仍完全可操作
    root.classList.add('is-failed');
    fallback.hidden = false;
    stage.dataset['bg'] = 'failed';
    stage.classList.add('bg-failed');
    console.warn('[background] 背景图加载失败，已降级为纯色底');
  };

  img.addEventListener('load', onLoad);
  img.addEventListener('error', onError);

  /** 重新计算并落位，返回本次的适配结果（供猫咪锚点换算复用） */
  function sync(): BackgroundFit {
    const r = stage.getBoundingClientRect();
    const fallback = computeBackgroundFit(
      r.width > 0 ? r.width : BG_SIZE.w,
      r.height > 0 ? r.height : BG_SIZE.h,
    );
    if (r.width <= 0 || r.height <= 0) return fallback;
    const fit = computeBackgroundFit(r.width, r.height);
    applyBackgroundVars(stage, fit);
    // 图片尺寸与偏移由 CSS 变量驱动，避免 JS 与样式两套尺寸
    img.style.width = 'var(--bg-w)';
    img.style.height = 'var(--bg-h)';
    img.style.left = 'var(--bg-x)';
    img.style.top = 'var(--bg-y)';
    stage.dataset['bgScale'] = fit.scale.toFixed(5);
    stage.dataset['bgFitBy'] = fit.fitBy;
    stage.dataset['bgCropBottom'] = fit.croppedBottom.toFixed(1);
    return fit;
  }

  img.src = src;
  // 图片已在缓存里时 load 可能已经触发过了，这里补一次判定
  if (img.complete && img.naturalWidth > 0) onLoad();

  return {
    root,
    sync,
    ready: () => loaded && !failed,
    dispose(): void {
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onError);
      img.removeAttribute('src');
      root.remove();
    },
  };
}