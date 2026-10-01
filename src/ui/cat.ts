/**
 * 猫咪对手展示区。
 *
 * 接入方式：2D 透明贴图（DOM <img>），不引入 3D 建模 / 骨骼 / 口型。
 *
 * 落位（本轮起不再依赖 3D 投影）：
 *  1. `public/cats/` 下的派生图已由 tools/cat-export.mjs 裁到 alpha 内容框，
 *     四边透明留白已去掉。
 *  2. 脚底位置**跟随背景图坐标**：背景的缩放由 --bg-scale 给出，
 *     猫脚锚点 BG_ANCHORS.foot 换算成屏幕像素后，脚底就落在那里。
 *     窗口尺寸变化时背景与猫用同一个 scale，所以同步移动。
 *  3. 逐猫锚点不同：裁切后的底边可能是尾巴或翅膀（森林猫的尾、樱花猫的
 *     大尾巴、冰翼猫的翼下缘），见 cat-placement.ts 的手工调校表。
 *  4. 不加遮住下半身的大色块，只用一圈很淡的接地影与桌垫融合。
 */
import manifest from './cat-manifest.json';
import { placementOf, type CatPlacement } from './cat-placement.ts';

export interface CatEntry {
  readonly id: string;
  readonly name: string;
  readonly pose: string;
  /** 相对站点根的 URL（public/cats/…） */
  readonly file: string;
  /** 宽 / 高 */
  readonly aspect: number;
}

export const CATS: readonly CatEntry[] = manifest.cats.map((c) => ({
  id: c.id,
  name: c.name,
  pose: c.pose,
  file: c.file,
  aspect: c.aspect,
}));

export const DEFAULT_CAT_ID = 'forest';

export function catById(id: string): CatEntry {
  return CATS.find((c) => c.id === id) ?? CATS[0] ?? { id: '', name: '', pose: '', file: '', aspect: 1 };
}

/**
 * 站点基路径。
 *
 * 本机开发是 '/'，GitHub Pages 是 '/<repo>/'。
 * 用 import.meta.env.BASE_URL 而不是写死 '/'，否则部署后贴图全部 404。
 */
const BASE = import.meta.env.BASE_URL;

/** 猫脚锚点在容器内的屏幕坐标（由背景层用同一套几何算出） */
export interface CatAnchor {
  x: number;
  y: number;
}

export interface CatArea {
  root: HTMLElement;
  setCat(id: string): void;
  current(): CatEntry;
  placement(): CatPlacement;
  /** 按背景锚点重新落位 */
  sync(anchor: CatAnchor): void;
  /** 图片解码完成后再落位一次（解码前 rect 宽度为 0） */
  whenReady(cb: () => void): void;
}

export function createCatArea(initialId: string = DEFAULT_CAT_ID): CatArea {
  const root = document.createElement('section');
  root.className = 'zone zone-cat';
  root.dataset['guide'] = '猫咪展示区';

  const frame = document.createElement('div');
  frame.className = 'cat-frame';

  // 接地影：与桌垫融合，刻意做淡，不遮下半身
  const shadow = document.createElement('div');
  shadow.className = 'cat-shadow';
  shadow.setAttribute('aria-hidden', 'true');

  const img = document.createElement('img');
  img.className = 'cat-img';
  img.decoding = 'async';
  img.loading = 'eager';
  img.alt = '';
  img.draggable = false;

  // 头 + 耳朵安全区（仅 guides 模式）
  const safe = document.createElement('div');
  safe.className = 'cat-safe-zone';
  safe.setAttribute('aria-hidden', 'true');

  frame.append(shadow, img, safe);
  root.appendChild(frame);

  let current = catById(initialId);
  let place = placementOf(current.id);
  const readyWaiters: Array<() => void> = [];
  let isReady = false;

  function flush(): void {
    isReady = true;
    while (readyWaiters.length) readyWaiters.shift()?.();
  }

  /**
   * 落位计算。锚点由背景层用**同一套几何**换算好传进来
   * （fit.x + u*w, fit.y + v*h），猫只负责把自己的贴图对齐到那个点。
   *
   *   贴图宽 w = h × aspect
   *   贴图左 = anchor.x − footX比例×w　（让贴图上 footX 处的点压在锚点上）
   *   贴图底 = anchor.y + footLift×h　（脚底离图底边的那段要落在锚点上）
   *
   * **猫咪区本身撑开多高，由这里算完写回去**：
   * 高度 = (anchor.y + lift) − zoneTop，即「猫底到区顶」刚好容纳贴图。
   * 不能让 CSS 流式布局决定，否则 spacer 会把猫挤到只剩几十像素。
   */
  function sync(anchor: CatAnchor): void {
    const stage = root.closest('.stage') as HTMLElement | null;
    const stageRect = stage?.getBoundingClientRect();
    const zoneTop = root.getBoundingClientRect().top - (stageRect?.top ?? 0);

    // 贴图高度：填满「区顶 → 猫底」这段，扣掉脚底上提量对应的部分
    const avail = Math.max(48, anchor.y - zoneTop);
    const h = (avail / (1 + place.footLift)) * place.scale;
    const w = h * current.aspect;
    const stageW = stageRect?.width ?? w;

    // 区高 = 贴图底到区顶的距离，保证贴图完整落在区里
    const zoneH = place.footLift * h + h;
    root.style.height = `${zoneH}px`;

    img.style.height = `${h}px`;
    img.style.width = `${w}px`;
    img.style.left = `${anchor.x - place.footX * w}px`;
    img.style.bottom = `${place.footLift * h}px`;

    // 接地影贴在脚底线上，宽度略窄于身体，且不出舞台
    shadow.style.left = `${anchor.x}px`;
    shadow.style.bottom = `${place.footLift * h}px`;
    shadow.style.width = `${Math.max(24, Math.min(w * 0.6, stageW * 0.8))}px`;

    root.style.setProperty('--cat-foot-x', `${anchor.x}px`);
    root.style.setProperty('--cat-foot-y', `${anchor.y}px`);
    // 供自检与工具脚本核对
    root.dataset['catImgW'] = w.toFixed(1);
    root.dataset['catImgH'] = h.toFixed(1);
    root.dataset['catImgLeft'] = (anchor.x - place.footX * w).toFixed(1);
  }

  function apply(entry: CatEntry): void {
    place = placementOf(entry.id);
    // 走 BASE_URL：Pages 部署在 /<repo>/ 下，写死 '/' 会 404
    img.src = `${BASE}${entry.file}`;
    img.alt = `${entry.name}（${entry.pose}）`;
    root.dataset['cat'] = entry.id;
    root.dataset['catName'] = entry.name;
    root.dataset['catFootX'] = String(place.footX);
    root.dataset['catFootLift'] = String(place.footLift);
    root.dataset['catScale'] = String(place.scale);
  }

  img.addEventListener('load', flush);
  img.addEventListener('error', () => {
    root.classList.add('is-missing');
    console.warn('[cat] 猫咪贴图加载失败：', current.file);
    flush();
  });

  apply(current);
  if (img.complete && img.naturalWidth > 0) flush();

  return {
    root,
    setCat(id: string): void {
      const next = catById(id);
      if (next.id === current.id) return;
      current = next;
      root.classList.remove('is-missing');
      isReady = false;
      apply(next);
    },
    current(): CatEntry {
      return current;
    },
    placement(): CatPlacement {
      return place;
    },
    sync,
    whenReady(cb: () => void): void {
      if (isReady) cb();
      else readyWaiters.push(cb);
    },
  };
}