/**
 * 猫咪落位配置（**手工调校**，不是自动生成）。
 *
 * 为什么不自动算：tools/measure-cat-feet.mjs 量的是「贴到图底边的那一圈」，
 * 但对下面几只它是错的：
 *   森林猫 / 樱花猫 —— 底边是大尾巴，不是脚；
 *   冰翼猫        —— 底边是右翼下缘与尾尖，脚（收拢的前爪）在更高处；
 *   云朵猫 / 火焰猫 —— 坐姿的臀比脚掌宽，「最宽的一段」会选到身体。
 * 目视核对过程见 shots/cat-feet-sheet.png（底部 30% 放大对照）。
 *
 * 字段含义（均为相对派生图的比例，0~1）：
 *   footX     脚底中心的横向位置；用于左右对齐，不是「图片居中」
 *   footLift  脚底距图片底边的高度；>0 表示底边是尾巴/翅膀，需要把脚往上提
 *   scale     显示比例系数；1 = 高度铺满到 anchor 给定的高度
 *
 * 落位时统一走：
 *   屏幕x = bgX*bgScale + footX*catW*scale
 *   屏幕y = bgY*bgScale + footLift*catH*scale
 * 与背景共用同一套 bgScale / bgOffset，所以背景与猫永远同步。
 */

/** 背景图原始尺寸（用于把锚点换算成像素） */
export const BG_SIZE = { w: 852, h: 1846 } as const;

/**
 * 背景锚点（原图像素坐标）。
 *   foot：猫咪脚底落点。实测桌垫为 y 348~600 / x 54~793，
 *        脚底取桌垫内 62% 处 y=504，水平取桌垫中心 x=424。
 *        用户建议的 (426, 520) 同样落在桌垫内，两者都在有效范围；
 *        这里取 y=504 让猫站在桌垫偏后，避免压到近处边缘。
 *   hudTop / catTop / plateTop / handTop：界面分区在背景图上的参考线，
 *        仅供 guides 模式标注核对，正式布局用 CSS 流式排布。
 */
export const BG_ANCHORS = {
  /** 猫脚落点（原图像素） */
  foot: { x: 424, y: 504 },
  /** 桌垫上沿／下沿，实测值 */
  runner: { top: 348, bottom: 600, left: 54, right: 793 },
  /** 窗户下沿实测约 y=295，短屏裁切时不能裁到这里以上 */
  windowBottom: 295,
  /** 界面分区参考线（原图像素） */
  hudTop: 20,
  catTop: 150,
  plateTop: 700,
  handTop: 1080,
} as const;

export interface CatPlacement {
  readonly footX: number;
  readonly footLift: number;
  readonly scale: number;
}

/**
 * 逐猫落位。
 *
 * footX 取目视的前爪/落地点中心：
 *   云朵猫 0.47 火焰猫 0.48 森林猫 0.42 冰翼猫 0.32
 *   月兔耳猫 0.50 水波猫 0.50 樱花猫 0.55
 * footLift 处理「底边不是脚」：
 *   森林猫 0.02（尾巴略低于爪）、樱花猫 0.03（大尾巴更低）、
 *   冰翼猫 0.10（翼与尾尖远低于收拢的前爪）
 * scale 用来在冰翼猫（最宽）与森林猫（最窄）之间做视觉体量平衡：
 *   翼展猫不缩太狠，窄猫略放大一点，否则同一屏对比时差距过刺眼。
 */
export const CAT_PLACEMENT: Readonly<Record<string, CatPlacement>> = {
  cloud: { footX: 0.47, footLift: 0.005, scale: 1.0 },
  flame: { footX: 0.48, footLift: 0.005, scale: 1.0 },
  forest: { footX: 0.42, footLift: 0.02, scale: 1.06 },
  'ice-wing': { footX: 0.32, footLift: 0.1, scale: 0.96 },
  'moon-rabbit': { footX: 0.5, footLift: 0.005, scale: 1.0 },
  ripple: { footX: 0.5, footLift: 0.005, scale: 1.0 },
  sakura: { footX: 0.55, footLift: 0.03, scale: 1.02 },
};

export const DEFAULT_PLACEMENT: CatPlacement = { footX: 0.5, footLift: 0, scale: 1 };

export function placementOf(id: string): CatPlacement {
  return CAT_PLACEMENT[id] ?? DEFAULT_PLACEMENT;
}