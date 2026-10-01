/**
 * 统一色板：3D 材质与 CSS 界面共用同一份数值，避免两边配色漂移。
 * 本轮已按新版美术方向收敛：木桌降红褐饱和、桌垫转偏灰鼠尾草绿、
 * 面板与卡片走暖白纸 + 细金棕边。
 */
export const PALETTE = {
  /** 暖白纸张 / 界面主色 */
  paper: '#f4ecdc',
  paperDeep: '#e4d8c0',
  paperShade: '#cdbda0',

  /** 鼠尾草绿（偏灰，降低黄绿倾向） */
  sage: '#9aa48c',
  sageDeep: '#74806a',
  sageLight: '#b4bcaa',

  /** 暖珊瑚（强调 / 弃牌） */
  coral: '#cd7d63',
  coralDeep: '#a9614c',

  /** 木桌（降饱和后的暖木色） */
  wood: '#9c8467',
  woodLight: '#b99e7e',
  woodDark: '#5f4c39',

  /** 文字 / 描边 */
  ink: '#4a4136',
  inkSoft: '#6d6152',
  gold: '#a8845a',

  /** 植物 */
  leaf: '#5c7a4a',
  leafDeep: '#3f5a33',
  leafLight: '#82a067',

  /** 花 */
  petal: '#fbf6e8',
  petalShade: '#e6dcc4',

  /** 光 / 环境 */
  sky: '#fff4de',
  windowGlow: '#fff8e6',
  wall: '#e9dfc9',
  wallShade: '#d8cbb0',
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** 把色板写进 CSS 自定义属性，供界面样式统一取色。 */
export function applyPaletteToCss(root: HTMLElement = document.documentElement): void {
  for (const [key, value] of Object.entries(PALETTE)) {
    const cssVar = `--c-${key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}`;
    root.style.setProperty(cssVar, value);
  }
}
