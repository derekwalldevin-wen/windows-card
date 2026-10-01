import './ui/ui.css';
import { buildLayout, initGuides, syncStageMetrics } from './ui/layout.ts';
import { createUi } from './ui/render.ts';
import { anchorToScreen, BG_ANCHOR_NORM, createBackground } from './ui/background.ts';
import { renderSelfCheck } from './dev/selfcheck.ts';
import { getSession, dispatch } from './store.ts';

function must<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`缺少节点 #${id}`);
  return node as T;
}

function main(): void {
  const stage = must<HTMLElement>('stage');
  const ui = must<HTMLElement>('ui');

  initGuides();

  // 背景层插到最底层。index.html 里还留着第 1~2 步的 <canvas id="scene">，
  // 本轮不再使用（源码与 three 依赖都保留，便于回退），
  // 但**不能只是把它藏起来就算完** —— 那样若之前创建过 Stage 实例，
  // 渲染循环与 GPU 资源仍会继续跑。本轮入口根本不再调用 createStage()，
  // 所以循环从一开始就没有启动；canvas 只是保留的空节点。
  const background = createBackground('/backgrounds/cozy-window-table-background-v1.png', stage);
  const canvasSlot = document.getElementById('scene');
  stage.insertBefore(background.root, canvasSlot ?? ui);
  canvasSlot?.setAttribute('hidden', '');

  const refs = buildLayout(stage, ui);

  /**
   * 落位一次，顺序不能颠倒：
   *   1. 按舞台宽度更新排版单位（--u 等）
   *   2. 背景按容器尺寸算缩放，写 --bg-* 变量
   *   3. 猫用背景同一套几何换算出的锚点摆位
   * 背景与猫因此永远同步，不会出现「背景按宽缩放、猫按视口高度定位」。
   */
  function relayout(): void {
    syncStageMetrics(stage);
    const fit = background.sync();
    refs.catArea.sync(anchorToScreen(fit, BG_ANCHOR_NORM.footX, BG_ANCHOR_NORM.footY));
  }

  relayout();

  const ro = new ResizeObserver(relayout);
  ro.observe(stage);

  // 背景与猫的贴图都是异步解码的，各自解码完成后再落位一次，
  // 避免用 0 宽 / 未确定的尺寸算位置。
  document.addEventListener('bg-ready', relayout);
  refs.catArea.whenReady(relayout);

  createUi(refs);

  Object.defineProperty(window, '__windowCardGame', {
    value: {
      step: 3,
      /** 背景适配读数，便于工具脚本核对缩放规则 */
      backgroundFit: () => ({
        scale: stage.style.getPropertyValue('--bg-scale'),
        w: stage.style.getPropertyValue('--bg-w'),
        h: stage.style.getPropertyValue('--bg-h'),
        x: stage.style.getPropertyValue('--bg-x'),
        y: stage.style.getPropertyValue('--bg-y'),
        fitBy: stage.dataset['bgFitBy'] ?? null,
        croppedBottom: Number(stage.dataset['bgCropBottom'] ?? '0'),
        ready: background.ready(),
      }),
      catAnchor: () => ({
        footX: refs.catArea.root.style.getPropertyValue('--cat-foot-x'),
        footY: refs.catArea.root.style.getPropertyValue('--cat-foot-y'),
        cat: refs.catArea.current().id,
      }),
      /**
       * 正常入口不应存在活动的 WebGL 渲染循环。
       * 这里主动查一次：页面上不应有已获取上下文的 canvas。
       */
      webglActive: () => {
        const canvases = Array.from(document.querySelectorAll('canvas'));
        return canvases.filter((c) => {
          if ((c as HTMLCanvasElement).hidden) return false;
          try {
            return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
          } catch {
            return false;
          }
        }).length;
      },
      session: getSession,
      dispatch,
    },
    configurable: true,
  });

  renderSelfCheck(
    stage,
    [document.querySelector('.zone-play'), document.querySelector('.zone-hand')].filter(
      (el): el is Element => el !== null,
    ),
    () => null,
    getSession,
    () => ({
      backgroundFit: {
        scale: stage.style.getPropertyValue('--bg-scale'),
        w: stage.style.getPropertyValue('--bg-w'),
        h: stage.style.getPropertyValue('--bg-h'),
        x: stage.style.getPropertyValue('--bg-x'),
        y: stage.style.getPropertyValue('--bg-y'),
        fitBy: stage.dataset['bgFitBy'] ?? null,
        croppedBottom: Number(stage.dataset['bgCropBottom'] ?? '0'),
        ready: background.ready(),
        natural: `${background.root.querySelector('img')?.naturalWidth ?? 0}x${
          background.root.querySelector('img')?.naturalHeight ?? 0
        }`,
      },
      cat: {
        id: refs.catArea.current().id,
        footX: refs.catArea.root.style.getPropertyValue('--cat-foot-x'),
        footY: refs.catArea.root.style.getPropertyValue('--cat-foot-y'),
        footXRatio: refs.catArea.placement().footX,
        footLift: refs.catArea.placement().footLift,
      },
      webglActive: false,
    }),
  );

  document.documentElement.dataset['step'] = '3';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main, { once: true });
} else {
  main();
}