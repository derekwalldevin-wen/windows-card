import * as THREE from 'three';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * 固定视角设计参数（本轮为占位，可整体调整）。
 * 世界坐标：桌面顶面 y = 0，相机在 +z 前方，墙与窗在 -z 方向。
 *
 * 俯角是本项目最关键的一个美术取舍：
 *  - 俯角越大 → 牌面越接近正视图（可读性好），但窗户/墙面占屏越多、桌面越小；
 *  - 俯角越小 → 桌面占比大、透视更强，但平放的牌会被压扁到接近正方形。
 * 取 42° 时：窗约 3%～25%、墙 25%～36%、桌面 36%～100%，接近概念图比例，
 * 平放卡牌的垂直压缩约 cos(42°) ≈ 0.74（第 2 步需 dot 确认是否可接受）。
 */
export const CAMERA_DESIGN = {
  height: 1.15,
  back: 0.62,
  pitchDeg: 42,
  fovDeg: 58,
  near: 0.02,
  far: 24,
} as const;

/** 牌局区在世界中的尺寸上限（米）。解算结果会被夹紧到这里。 */
export const PLAY_LIMITS = {
  halfW: 0.42,
  halfD: 0.95,
  centerZ: -1.0,
} as const;

export interface RectPx {
  /** 相对画布左上角的中心 */
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface PlayFit {
  halfW: number;
  halfD: number;
  centerX: number;
  centerZ: number;
  /** 实际投影到屏幕的矩形（画布像素），用于验收对齐精度 */
  screen: RectPx;
  /** 是否被 halfW/halfD 上限夹紧（夹紧＝牌局区小于界面牌局区，居中显示） */
  clamped: boolean;
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function projectBounds(
  camera: THREE.PerspectiveCamera,
  centerX: number,
  centerZ: number,
  halfW: number,
  halfD: number,
): Bounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const c = new THREE.Vector3();
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      c.set(centerX + sx * halfW, 0, centerZ + sz * halfD).project(camera);
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y);
      maxY = Math.max(maxY, c.y);
    }
  }
  return { minX, maxX, minY, maxY };
}

interface Pose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
}

/** 设计位姿：由高度 / 后撤距离 / 俯角推出相机位置与朝向。 */
export function designPose(): Pose {
  const { height, back, pitchDeg } = CAMERA_DESIGN;
  const pitch = THREE.MathUtils.degToRad(pitchDeg);
  const target = new THREE.Vector3(0, 0, back - height / Math.tan(pitch));
  const position = new THREE.Vector3(0, height, back);
  const forward = target.clone().sub(position).normalize();
  const right = new THREE.Vector3().crossVectors(forward, WORLD_UP).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();

  const m = new THREE.Matrix4().lookAt(position, target, WORLD_UP);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(m);
  return { position, quaternion, forward, right, up };
}

/**
 * 把世界里的「牌局矩形」对齐到屏幕上某个 DOM 矩形。
 *
 * 关键设计：**相机位姿在整个生命周期内永不改变**（角度、距离、位置都固定），
 * 美术构图因此完全稳定、任何视口下都不会漂移。
 * 对齐只通过调整世界矩形的 centerX / centerZ / halfW / halfD 完成，
 * 四个自由度分别对应屏幕上的 x、y、宽、高四项约束，各自独立收敛。
 *
 * 未来把卡牌按这个矩形摆放，就自动与 DOM 槽位对齐。
 */
export function fitPlayRectToScreen(
  camera: THREE.PerspectiveCamera,
  canvasW: number,
  canvasH: number,
  target: RectPx,
  limits: typeof PLAY_LIMITS,
): PlayFit {
  const pose = designPose();

  // 相机固定：只设一次
  camera.position.copy(pose.position);
  camera.quaternion.copy(pose.quaternion);
  camera.updateMatrixWorld(true);

  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const aspect = canvasW / Math.max(1, canvasH);
  // 世界 z 轴在屏幕纵向的投影系数（俯角的 sin）
  const zToY: number = Math.max(0.2, Math.abs(pose.up.z));

  // 目标矩形（ndc）
  const goalMinX = ((target.cx - target.w / 2) / canvasW) * 2 - 1;
  const goalMaxX = ((target.cx + target.w / 2) / canvasW) * 2 - 1;
  const goalMaxY = 1 - ((target.cy - target.h / 2) / canvasH) * 2;
  const goalMinY = 1 - ((target.cy + target.h / 2) / canvasH) * 2;
  const goalW = Math.max(1e-4, goalMaxX - goalMinX);
  const goalH = Math.max(1e-4, goalMaxY - goalMinY);
  const goalCx = (goalMinX + goalMaxX) / 2;
  const goalCy = (goalMinY + goalMaxY) / 2;

  const LIMIT_X = 0.08;
  const LIMIT_Z = 0.35;
  let centerX: number = 0;
  let centerZ: number = limits.centerZ;
  let halfW = Math.min(limits.halfW, 0.18);
  let halfD = Math.min(limits.halfD, 0.35);
  const probe = new THREE.Vector3();

  const depthAt = (): number =>
    Math.max(
      0.05,
      probe.set(centerX, 0, centerZ).sub(camera.position).dot(pose.forward),
    );

  for (let round = 0; round < 24; round++) {
    // ① 尺寸：两个方向各自单调收敛
    for (let k = 0; k < 3; k++) {
      const b = projectBounds(camera, centerX, centerZ, halfW, halfD);
      halfW = THREE.MathUtils.clamp(
        halfW * (goalW / Math.max(1e-6, b.maxX - b.minX)),
        0.005,
        limits.halfW * 2,
      );
      halfD = THREE.MathUtils.clamp(
        halfD * (goalH / Math.max(1e-6, b.maxY - b.minY)),
        0.005,
        limits.halfD * 2,
      );
    }

    // ② 位置：把投影中心移到目标中心
    //    ndcX = x / (depth·tanHalf·aspect)，对 x 单调递增，故 x += errX·depth·k
    //    ndcY = up / (depth·tanHalf)，而世界 z 每 +1 使 up 减少 sin(俯角)，
    //    故 z -= errY·depth·tanHalf / sin(俯角)
    const b = projectBounds(camera, centerX, centerZ, halfW, halfD);
    const errX = goalCx - (b.minX + b.maxX) / 2;
    const errY = goalCy - (b.minY + b.maxY) / 2;
    const depth = depthAt();
    centerX = THREE.MathUtils.clamp(
      centerX + errX * depth * tanHalf * aspect,
      -LIMIT_X,
      LIMIT_X,
    );
    centerZ = THREE.MathUtils.clamp(
      centerZ - (errY * depth * tanHalf) / zToY,
      limits.centerZ - LIMIT_Z,
      limits.centerZ + LIMIT_Z,
    );
  }

  const clamped = halfW > limits.halfW || halfD > limits.halfD;
  halfW = Math.min(halfW, limits.halfW);
  halfD = Math.min(halfD, limits.halfD);

  const final = projectBounds(camera, centerX, centerZ, halfW, halfD);
  const screen: RectPx = {
    cx: (((final.minX + final.maxX) / 2) * 0.5 + 0.5) * canvasW,
    cy: (0.5 - (final.minY + final.maxY) / 4) * canvasH,
    w: ((final.maxX - final.minX) / 2) * canvasW,
    h: ((final.maxY - final.minY) / 2) * canvasH,
  };

  return { halfW, halfD, centerX, centerZ, screen, clamped };
}

/** 把 DOM 元素的矩形换算成相对画布的像素矩形。 */
export function rectOf(element: Element, canvas: HTMLCanvasElement): RectPx {
  const r = element.getBoundingClientRect();
  const c = canvas.getBoundingClientRect();
  return {
    cx: r.left - c.left + r.width / 2,
    cy: r.top - c.top + r.height / 2,
    w: r.width,
    h: r.height,
  };
}

/**
 * 取若干 DOM 元素的外包矩形（相对画布）。
 * 卡牌分布在「出牌展示区」和「手牌区」两块互不相邻的区域里，
 * 用它们的外包框作为 3D 牌局矩形的对齐目标。
 */
export function rectOfUnion(elements: readonly Element[], canvas: HTMLCanvasElement): RectPx {
  const c = canvas.getBoundingClientRect();
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const el of elements) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  if (!Number.isFinite(left)) {
    return rectOf(elements[0] as Element, canvas);
  }
  return {
    cx: left - c.left + (right - left) / 2,
    cy: top - c.top + (bottom - top) / 2,
    w: right - left,
    h: bottom - top,
  };
}
