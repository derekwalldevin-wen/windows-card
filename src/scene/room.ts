import * as THREE from 'three';
import { PALETTE } from './palette.ts';
import { createFoliageField, createPottedPlant } from './botanical.ts';
import { makeSoftDotTexture, mulberry32 } from './util.ts';

/**
 * 背景房间：墙、窗框、窗外景色、窗台。全部由简单几何体构成。
 * 世界坐标：桌面顶面 y = 0，墙在 -z 方向。
 *
 * 窗洞位置按 42° 俯角竖屏构图反推，目标是让画面分层接近概念图：
 *   窗 1%～15% ／ 墙 15%～20% ／ 桌面 20%～100%
 */
export const ROOM = {
  wallZ: -2.12,
  wallThickness: 0.1,
  wallHalfX: 3.0,
  wallBottom: -1.0,
  wallTop: 2.0,
  /** 窗洞 */
  holeHalfX: 0.62,
  holeBottom: 0.1,
  holeTop: 0.49,
  floorY: -1.2,
} as const;

function makeSkyTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#fdf3d8');
    g.addColorStop(0.4, '#f7f0d2');
    g.addColorStop(0.7, '#dde7c2');
    g.addColorStop(1, '#b7cd9a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function box(
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function createRoom(): THREE.Group {
  const room = new THREE.Group();
  room.name = 'room';

  const wallMat = new THREE.MeshStandardMaterial({
    color: PALETTE.wall,
    roughness: 0.96,
    metalness: 0,
  });
  const wallInsetMat = new THREE.MeshStandardMaterial({
    color: PALETTE.wallShade,
    roughness: 0.97,
    metalness: 0,
  });
  const frameMat = new THREE.MeshStandardMaterial({
    color: '#f7f2e7',
    roughness: 0.58,
    metalness: 0,
  });

  const d = ROOM.wallThickness;
  const zc = ROOM.wallZ;
  const hx = ROOM.holeHalfX;
  const y0 = ROOM.wallBottom;
  const y1 = ROOM.wallTop;
  const fullH = y1 - y0;
  const fullW = ROOM.wallHalfX * 2;
  const midY = (y0 + y1) / 2;

  // 四块墙围出窗洞
  room.add(box(hx, fullH, d, wallMat, -(ROOM.wallHalfX + hx) / 2, midY, zc));
  room.add(box(hx, fullH, d, wallMat, (ROOM.wallHalfX + hx) / 2, midY, zc));
  room.add(box(hx * 2, ROOM.holeBottom - y0, d, wallInsetMat, 0, (y0 + ROOM.holeBottom) / 2, zc));
  room.add(box(hx * 2, y1 - ROOM.holeTop, d, wallMat, 0, (y1 + ROOM.holeTop) / 2, zc));

  // 踢脚线
  room.add(box(fullW, 0.12, 0.04, frameMat, 0, y0 + 0.06, zc + d / 2 + 0.018));

  // 地板（防止视野下缘穿帮）
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 5),
    new THREE.MeshStandardMaterial({ color: '#5c3a24', roughness: 0.96, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, ROOM.floorY, 0.2);
  floor.receiveShadow = true;
  room.add(floor);

  // ---- 窗外 ----
  const outside = new THREE.Group();
  outside.name = 'outside';

  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(4.8, 3.4),
    new THREE.MeshBasicMaterial({ map: makeSkyTexture() }),
  );
  sky.position.set(0, 0.85, -3.3);
  outside.add(sky);

  const foliage = createFoliageField({
    count: 84,
    height: 1.6,
    radius: [0.05, 1.55],
    colors: [PALETTE.leafDeep, PALETTE.leaf, PALETTE.leafLight, '#93ab6c'],
    seed: 11,
    leafSize: 0.125,
  });
  foliage.position.set(0, 0.85, -2.85);
  outside.add(foliage);

  const FLOWER_COUNT = 48;
  const flowerPositions = new Float32Array(FLOWER_COUNT * 3);
  {
    const rng = mulberry32(97);
    for (let i = 0; i < FLOWER_COUNT; i++) {
      const r = 0.1 + rng() * 1.45;
      const a = rng() * Math.PI * 2;
      flowerPositions[i * 3] = Math.cos(a) * r;
      flowerPositions[i * 3 + 1] = (rng() - 0.3) * 1.6;
      flowerPositions[i * 3 + 2] = -2.8;
    }
  }
  const flowerGeometry = new THREE.BufferGeometry();
  flowerGeometry.setAttribute('position', new THREE.BufferAttribute(flowerPositions, 3));
  outside.add(
    new THREE.Points(
      flowerGeometry,
      new THREE.PointsMaterial({
        size: 0.09,
        map: makeSoftDotTexture(),
        transparent: true,
        depthWrite: false,
      }),
    ),
  );
  room.add(outside);

  // ---- 窗框 ----
  const frame = new THREE.Group();
  frame.name = 'window-frame';
  const fz = zc + d / 2 + 0.032;
  const fh = ROOM.holeTop - ROOM.holeBottom;
  const fcy = (ROOM.holeTop + ROOM.holeBottom) / 2;
  frame.add(box(0.075, fh, 0.075, frameMat, -(hx - 0.037), fcy, fz));
  frame.add(box(0.075, fh, 0.075, frameMat, hx - 0.037, fcy, fz));
  frame.add(box(hx * 2, 0.075, 0.075, frameMat, 0, ROOM.holeTop - 0.037, fz));
  // 中梃：让光影在桌面形成窗格投影
  frame.add(box(0.05, fh, 0.06, frameMat, 0, fcy, fz));
  frame.add(box(hx * 2, 0.05, 0.06, frameMat, 0, fcy, fz));
  // 窗台板
  frame.add(box(hx * 2 + 0.16, 0.06, 0.18, frameMat, 0, ROOM.holeBottom - 0.02, fz + 0.035));
  frame.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  room.add(frame);

  // 窗台上的两盆小植物
  const sillY = ROOM.holeBottom + 0.012;
  const sillLeft = createPottedPlant({
    topRadius: 0.062,
    bottomRadius: 0.045,
    height: 0.078,
    color: '#e6d9c0',
    rimColor: '#d3c5a8',
    sprigs: 5,
    length: [0.06, 0.105],
    seed: 21,
  });
  sillLeft.position.set(-0.46, sillY, fz + 0.02);
  room.add(sillLeft);

  const sillRight = createPottedPlant({
    topRadius: 0.07,
    bottomRadius: 0.05,
    height: 0.088,
    color: '#cbb9a0',
    rimColor: '#b8a68c',
    sprigs: 6,
    length: [0.07, 0.12],
    seed: 33,
  });
  sillRight.position.set(0.49, sillY, fz + 0.02);
  room.add(sillRight);

  return room;
}
