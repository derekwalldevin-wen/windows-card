import * as THREE from 'three';
import { PALETTE } from './palette.ts';
import { mulberry32 } from './util.ts';

let cachedLeafGeometry: THREE.ShapeGeometry | null = null;

/** 单位叶片：沿 +Y 生长，长 1，最宽处半宽 0.34。 */
function leafGeometry(): THREE.ShapeGeometry {
  if (cachedLeafGeometry) return cachedLeafGeometry;
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.3, 0.18, 0.34, 0.62, 0, 1);
  s.bezierCurveTo(-0.34, 0.62, -0.3, 0.18, 0, 0);
  cachedLeafGeometry = new THREE.ShapeGeometry(s, 10);
  return cachedLeafGeometry;
}

export interface LeafOpts {
  length: number;
  color: THREE.ColorRepresentation;
  opacity?: number;
}

/** 单片叶子，原点位于叶柄。 */
export function createLeaf(opts: LeafOpts): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    color: opts.color,
    roughness: 0.86,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: opts.opacity !== undefined,
    opacity: opts.opacity ?? 1,
  });
  const mesh = new THREE.Mesh(leafGeometry(), mat);
  mesh.scale.set(opts.length * 0.68, opts.length, 1);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export interface SprigOpts {
  /** 叶片数量 */
  count?: number;
  /** 叶片长度范围 */
  length?: [number, number];
  /** 展开角度（度） */
  spread?: [number, number];
  /** 沿茎的分布：0 = 根部，1 = 尖端 */
  from?: number;
  to?: number;
  colors?: [THREE.ColorRepresentation, THREE.ColorRepresentation];
  stemColor?: THREE.ColorRepresentation;
  seed?: number;
  curve?: number;
}

/** 一根带叶的枝条：茎 + 沿茎分布的叶片。 */
export function createSprig(opts: SprigOpts = {}): THREE.Group {
  const {
    count = 7,
    length = [0.09, 0.15],
    spread = [32, 62],
    from = 0.12,
    to = 1,
    colors = [PALETTE.leaf, PALETTE.leafLight],
    stemColor = PALETTE.leafDeep,
    seed = 1,
    curve = 0.05,
  } = opts;

  const rng = mulberry32(seed);
  const group = new THREE.Group();
  const totalHeight = length[1] * 3.2;

  // 茎
  const stemCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(curve * 0.5, totalHeight * 0.45, curve * 0.2),
    new THREE.Vector3(curve, totalHeight, -curve * 0.3),
  ]);
  const stem = new THREE.Mesh(
    new THREE.TubeGeometry(stemCurve, 8, 0.006, 5, false),
    new THREE.MeshStandardMaterial({ color: stemColor, roughness: 0.9, metalness: 0 }),
  );
  stem.castShadow = true;
  group.add(stem);

  for (let i = 0; i < count; i++) {
    const t = from + ((to - from) * (i + rng() * 0.6)) / count;
    const tClamped = Math.min(1, t);
    const p = stemCurve.getPoint(tClamped);
    const len = length[0] + rng() * (length[1] - length[0]);
    const color = colors[Math.floor(rng() * colors.length)] ?? PALETTE.leaf;
    const leaf = createLeaf({ length: len, color });
    leaf.position.copy(p);
    const az = rng() * Math.PI * 2;
    const deg = spread[0] + rng() * (spread[1] - spread[0]);
    leaf.rotation.set(0, az, (deg * Math.PI) / 180);
    group.add(leaf);
  }
  return group;
}

export interface PotOpts {
  topRadius?: number;
  bottomRadius?: number;
  height?: number;
  color?: THREE.ColorRepresentation;
  rimColor?: THREE.ColorRepresentation;
}

/** 陶盆 / 陶罐：带口沿的旋转体。 */
export function createPot(opts: PotOpts = {}): THREE.Group {
  const {
    topRadius = 0.11,
    bottomRadius = 0.078,
    height = 0.13,
    color = '#ddd0b8',
    rimColor = '#cabfa6',
  } = opts;
  const group = new THREE.Group();

  const profile: THREE.Vector2[] = [
    new THREE.Vector2(0.0001, 0),
    new THREE.Vector2(bottomRadius, 0),
    new THREE.Vector2(bottomRadius * 1.02, height * 0.06),
    new THREE.Vector2(topRadius * 0.94, height * 0.78),
    new THREE.Vector2(topRadius, height * 0.9),
    new THREE.Vector2(topRadius, height),
    new THREE.Vector2(topRadius * 0.9, height),
  ];
  const body = new THREE.Mesh(
    new THREE.LatheGeometry(profile, 28),
    new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0 }),
  );
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(topRadius * 0.97, height * 0.055, 8, 28),
    new THREE.MeshStandardMaterial({ color: rimColor, roughness: 0.8, metalness: 0 }),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = height * 0.95;
  rim.castShadow = true;
  group.add(rim);

  return group;
}

export interface PottedPlantOpts extends PotOpts {
  sprigs?: number;
  length?: [number, number];
  seed?: number;
  height?: number;
}

/** 盆栽：陶盆 + 数根枝条。 */
export function createPottedPlant(opts: PottedPlantOpts = {}): THREE.Group {
  const { sprigs = 6, length = [0.1, 0.16], seed = 7, height = 0.13 } = opts;
  const group = new THREE.Group();
  const pot = createPot({ ...opts, height });
  group.add(pot);

  const rng = mulberry32(seed);
  for (let i = 0; i < sprigs; i++) {
    const s = createSprig({
      count: 5 + Math.floor(rng() * 3),
      length,
      seed: seed * 31 + i * 7,
      curve: (rng() - 0.5) * 0.12,
    });
    s.position.y = height * 0.94;
    s.rotation.y = (i / sprigs) * Math.PI * 2 + rng() * 0.7;
    s.rotation.z = (rng() - 0.5) * 0.5;
    s.scale.setScalar(0.85 + rng() * 0.35);
    group.add(s);
  }
  return group;
}

export interface FoliageFieldOpts {
  count?: number;
  /** 竖向分布范围 */
  height: number;
  /** 圆形分布半径范围 */
  radius: [number, number];
  colors: THREE.ColorRepresentation[];
  seed?: number;
  /** 叶片单位尺寸 */
  leafSize?: number;
}

/** 远处一丛圆形树叶：低面数、色块化，模拟窗外的绿。 */
export function createFoliageField(opts: FoliageFieldOpts): THREE.InstancedMesh {
  const { count = 60, height, radius, colors, seed = 3, leafSize = 0.1 } = opts;
  const rng = mulberry32(seed);
  const geo = new THREE.CircleGeometry(leafSize, 7);
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0.98 });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const r = radius[0] + rng() * (radius[1] - radius[0]);
    const a = rng() * Math.PI * 2;
    dummy.position.set(
      Math.cos(a) * r,
      (rng() - 0.5) * height + height * 0.12,
      Math.sin(a) * r * 0.28,
    );
    dummy.rotation.set(0, 0, rng() * Math.PI);
    const s = 0.6 + rng() * 0.85;
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    const c = colors[Math.floor(rng() * colors.length)] ?? PALETTE.leaf;
    color.set(c);
    color.multiplyScalar(0.82 + rng() * 0.36);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}
