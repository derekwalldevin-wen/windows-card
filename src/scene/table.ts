import * as THREE from 'three';
import { makeGrainTexture, mulberry32 } from './util.ts';

/**
 * 桌面几何常量（单位米，桌面顶面 y = 0）。
 * 牌局矩形（PLAY）的实际 halfW / halfD 不在这里定死，
 * 而是由 camera.ts 在运行时按界面「牌局区」反解，
 * 这样窗宽、窄屏、桌面居中竖屏都能自动对齐。
 */

/** 桌面后沿的 z 值（墙前）。仅用于场景自检与投影参考。 */
export const TABLE_BACK_Z = -2.06;

/**
 * 猫咪基座所在的 z 值：角色站在桌垫远端，下缘落在桌垫上，
 * 由接地影收住，不再被桌面后沿切断。
 *
 * 取 −1.3 而不是 −1.0（贴桌垫最远端）：−1.0 时 360×640 与桌面端
 * 的猫咪下半身会压到计分牌，裸桌呼吸区只剩 18~22px；−1.3 把呼吸区
 * 拉回 64~170px，同时猫咪仍有 137~233px 高。
 * 见 tools/analyze-camera-dolly.mjs 与本轮布局候选的取舍表。
 */
export const CAT_BASE_Z = -1.3;

/** 桌面：宽度大于任何视口可见范围，保证左右不露桌沿。 */
const TABLE = {
  halfW: 0.7,
  frontZ: 0.35,
  backZ: TABLE_BACK_Z,
  thickness: 0.06,
} as const;

/**
 * 鼠尾草绿亚麻桌垫：只铺「出牌区 + 牌型反馈区」这一段，
 * 两侧与前方留出木纹——与概念图一致（手牌落在木桌上）。
 */
const RUNNER = {
  halfW: 0.42,
  frontZ: -1.02,
  backZ: -1.94,
  thickness: 0.007,
} as const;

export function createTable(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'table';
  const rng = mulberry32(2024);

  // ---- 木桌 ----
  // 材质基色接近白，让程序生成的木纹贴图决定颜色，避免二次相乘把木色压成暗红。
  // 木纹两端色都往灰里收，降低红褐饱和度（美术要求：木桌降饱和）。
  const woodMap = makeGrainTexture(256, [0x7c, 0x6c, 0x58], [0xc4, 0xb6, 0xa0], rng, true, 0.8);
  woodMap.repeat.set(1.2, 1);
  const woodMat = new THREE.MeshStandardMaterial({
    color: '#cdbca2',
    map: woodMap,
    roughness: 0.76,
    metalness: 0,
  });

  const topD = TABLE.frontZ - TABLE.backZ;
  const topZ = (TABLE.frontZ + TABLE.backZ) / 2;

  const top = new THREE.Mesh(new THREE.BoxGeometry(TABLE.halfW * 2, TABLE.thickness, topD), woodMat);
  top.position.set(0, -TABLE.thickness / 2, topZ);
  top.receiveShadow = true;
  top.castShadow = true;
  group.add(top);

  const edgeMat = new THREE.MeshStandardMaterial({
    color: '#9c8467',
    roughness: 0.84,
    metalness: 0,
  });
  const edge = new THREE.Mesh(new THREE.BoxGeometry(TABLE.halfW * 2 + 0.04, 0.05, topD + 0.04), edgeMat);
  edge.position.set(0, -TABLE.thickness - 0.02, topZ);
  edge.receiveShadow = true;
  edge.castShadow = true;
  group.add(edge);

  // ---- 亚麻桌垫 ----
  // 低对比 + 高频重复：只做织物质感，避免出现明显的大色带。
  // 基色刻意比 PALETTE.sage 亮一档：材质基色要经过光照与 ACES 色调映射，
  // 直接用中明度色板落到画面上会变成深森林绿（实测 L≈19%），
  // 达不到「偏灰鼠尾草绿」的要求。
  const linenMap = makeGrainTexture(256, [0xb2, 0xb8, 0xa8], [0xca, 0xcf, 0xc0], rng, false, 3.2);
  linenMap.repeat.set(6, 14);
  const linenMat = new THREE.MeshStandardMaterial({
    color: '#cdd3c2',
    map: linenMap,
    roughness: 0.99,
    metalness: 0,
  });
  const runnerD = RUNNER.frontZ - RUNNER.backZ;
  const runner = new THREE.Mesh(new THREE.BoxGeometry(RUNNER.halfW * 2, RUNNER.thickness, runnerD), linenMat);
  runner.position.set(0, RUNNER.thickness / 2, (RUNNER.frontZ + RUNNER.backZ) / 2);
  runner.receiveShadow = true;
  runner.castShadow = true;
  group.add(runner);

  // 桌垫压边线（内框浅色织带）
  const bandMat = new THREE.MeshStandardMaterial({
    color: '#dde2d3',
    roughness: 0.98,
    metalness: 0,
  });
  const inset = 0.026;
  const bandW = 0.007;
  const innerHalfW = RUNNER.halfW - inset;
  const innerFront = RUNNER.frontZ - inset;
  const innerBack = RUNNER.backZ + inset;
  const innerD = innerFront - innerBack;
  const innerZ = (innerFront + innerBack) / 2;
  const bandY = RUNNER.thickness + 0.0008;
  const mkBand = (w: number, d: number, x: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.0015, d), bandMat);
    m.position.set(x, bandY, z);
    m.receiveShadow = true;
    return m;
  };
  group.add(mkBand(innerHalfW * 2, bandW, 0, innerFront));
  group.add(mkBand(innerHalfW * 2, bandW, 0, innerBack));
  group.add(mkBand(bandW, innerD, -innerHalfW, innerZ));
  group.add(mkBand(bandW, innerD, innerHalfW, innerZ));

  // ---- 窗格光斑（与真实窗光阴影叠加，只做轻微提亮）----
  const patch = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 0.8),
    new THREE.MeshBasicMaterial({
      map: makeSunPatchTexture(),
      transparent: true,
      opacity: 0.13,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  patch.rotation.x = -Math.PI / 2;
  patch.rotation.z = -0.1;
  patch.position.set(-0.04, 0.0012, -1.5);
  patch.renderOrder = 1;
  group.add(patch);

  const patch2 = patch.clone();
  patch2.scale.set(0.9, 0.85, 1);
  patch2.position.set(0.05, 0.0012, -0.6);
  (patch2.material as THREE.MeshBasicMaterial).opacity = 0.07;
  group.add(patch2);

  return group;
}

/** 生成「窗格」形状的柔光斑贴图。 */
function makeSunPatchTexture(): THREE.Texture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    const pane = 2;
    const pad = 14;
    const cell = (size - pad * (pane + 1)) / pane;
    for (let y = 0; y < pane; y++) {
      for (let x = 0; x < pane; x++) {
        const px = pad + x * (cell + pad);
        const py = pad + y * (cell + pad);
        const g = ctx.createRadialGradient(
          px + cell / 2,
          py + cell / 2,
          cell * 0.08,
          px + cell / 2,
          py + cell / 2,
          cell * 0.8,
        );
        g.addColorStop(0, 'rgba(255,246,224,0.95)');
        g.addColorStop(0.62, 'rgba(255,240,205,0.45)');
        g.addColorStop(1, 'rgba(255,236,196,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.roundRect(px, py, cell, cell, cell * 0.14);
        ctx.fill();
      }
    }
    const fade = ctx.createRadialGradient(size / 2, size / 2, size * 0.18, size / 2, size / 2, size * 0.5);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
