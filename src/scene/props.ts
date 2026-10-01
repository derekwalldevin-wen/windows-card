import * as THREE from 'three';
import { PALETTE } from './palette.ts';
import { createLeaf, createPottedPlant } from './botanical.ts';
import { mulberry32 } from './util.ts';

/**
 * 桌面道具。
 *
 * 关键布局约束：42° 俯角的竖屏构图里，越靠近屏幕下方看到的桌面越窄，
 * 所以「屏幕下方两侧」几乎没有可用桌面；而远端（画面上方）可见宽度最大。
 * 因此道具全部集中在**远端两侧的木纹区**，与概念图
 * 「书堆/陶罐在左上、茶杯在右上」一致，也与中央牌局区互不遮挡。
 * 概念图底部的虚化前景叶属于 2D 构图装饰，3D 在牌局区外取不到景，
 * 改由界面层 CSS 实现（见 ui.css 的 .decor-*）。
 */
export function createProps(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'props';
  const rng = mulberry32(4242);

  // ---- 左上：一摞旧书 ----
  const books = new THREE.Group();
  books.name = 'book-stack';
  const bookColors = ['#7d5a48', '#5f6b52', '#8a6a4a', '#6a5340'];
  let y = 0;
  for (let i = 0; i < 4; i++) {
    const w = 0.225 - i * 0.012;
    const d = 0.155 - i * 0.007;
    const h = 0.028 + rng() * 0.012;
    const color = bookColors[i % bookColors.length] ?? '#7d5a48';
    const cover = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.86, metalness: 0 }),
    );
    cover.position.set((rng() - 0.5) * 0.014, y + h / 2, (rng() - 0.5) * 0.014);
    cover.rotation.y = (rng() - 0.5) * 0.26;
    cover.castShadow = true;
    cover.receiveShadow = true;
    books.add(cover);

    const pages = new THREE.Mesh(
      new THREE.BoxGeometry(w - 0.014, h * 0.6, d - 0.01),
      new THREE.MeshStandardMaterial({ color: PALETTE.paperShade, roughness: 0.96, metalness: 0 }),
    );
    pages.position.copy(cover.position);
    pages.position.x += 0.006;
    pages.rotation.copy(cover.rotation);
    books.add(pages);
    y += h + 0.002;
  }
  books.position.set(-0.55, 0, -1.8);
  books.rotation.y = 0.3;
  group.add(books);

  // ---- 左上：大陶罐盆栽 ----
  // 侧边植物收敛：枝条数量与长度都压到原来的约 7 成，
  // 让它们退到画面两侧当边框，不与中央的猫咪争视觉重心。
  const bigPlant = createPottedPlant({
    topRadius: 0.098,
    bottomRadius: 0.068,
    height: 0.125,
    color: '#ded2ba',
    rimColor: '#c9bda4',
    sprigs: 5,
    length: [0.075, 0.115],
    seed: 61,
  });
  bigPlant.position.set(-0.6, 0, -1.47);
  group.add(bigPlant);

  // ---- 右上：陶杯 + 茶碟 ----
  const cupGroup = new THREE.Group();
  cupGroup.name = 'teacup';
  const saucer = new THREE.Mesh(
    new THREE.CylinderGeometry(0.105, 0.096, 0.014, 28),
    new THREE.MeshStandardMaterial({ color: '#f0e8d8', roughness: 0.44, metalness: 0 }),
  );
  saucer.position.y = 0.007;
  saucer.castShadow = true;
  saucer.receiveShadow = true;
  cupGroup.add(saucer);

  const cupProfile: THREE.Vector2[] = [
    new THREE.Vector2(0.0001, 0.012),
    new THREE.Vector2(0.048, 0.012),
    new THREE.Vector2(0.046, 0.019),
    new THREE.Vector2(0.056, 0.054),
    new THREE.Vector2(0.068, 0.102),
    new THREE.Vector2(0.071, 0.113),
    new THREE.Vector2(0.065, 0.114),
    new THREE.Vector2(0.054, 0.03),
    new THREE.Vector2(0.0001, 0.026),
  ];
  const cup = new THREE.Mesh(
    new THREE.LatheGeometry(cupProfile, 30),
    new THREE.MeshStandardMaterial({
      color: '#f4ecdd',
      roughness: 0.38,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  );
  cup.castShadow = true;
  cup.receiveShadow = true;
  cupGroup.add(cup);

  const handle = new THREE.Mesh(
    new THREE.TorusGeometry(0.03, 0.009, 8, 20, Math.PI * 1.25),
    new THREE.MeshStandardMaterial({ color: '#f0e7d6', roughness: 0.38, metalness: 0 }),
  );
  handle.position.set(0.074, 0.069, 0);
  handle.rotation.set(0, Math.PI / 2, -0.5);
  handle.castShadow = true;
  cupGroup.add(handle);

  const tea = new THREE.Mesh(
    new THREE.CircleGeometry(0.06, 28),
    new THREE.MeshStandardMaterial({
      color: '#9a5a2a',
      roughness: 0.12,
      metalness: 0.1,
      side: THREE.DoubleSide,
    }),
  );
  tea.rotation.x = -Math.PI / 2;
  tea.position.y = 0.096;
  cupGroup.add(tea);

  cupGroup.position.set(0.55, 0, -1.78);
  cupGroup.rotation.y = -0.55;
  group.add(cupGroup);

  // ---- 右上：小盆栽 ----
  const smallPlant = createPottedPlant({
    topRadius: 0.076,
    bottomRadius: 0.053,
    height: 0.09,
    color: '#c9b49b',
    rimColor: '#b6a189',
    sprigs: 4,
    length: [0.055, 0.09],
    seed: 83,
  });
  smallPlant.position.set(0.63, 0, -1.44);
  group.add(smallPlant);

  // ---- 木纹区散落的白花 ----
  const COUNT = 16;
  const pos = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    pos[i * 3] = side * (0.46 + rng() * 0.34);
    pos[i * 3 + 1] = 0.009 + rng() * 0.005;
    pos[i * 3 + 2] = -1.98 + rng() * 0.95;
  }
  const looseGeo = new THREE.BufferGeometry();
  looseGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  group.add(
    new THREE.Points(
      looseGeo,
      new THREE.PointsMaterial({
        size: 0.022,
        color: PALETTE.petal,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      }),
    ),
  );

  // ---- 靠墙两侧探入画面的叶片（框住构图，不遮中央）----
  // 同样收敛：叶片缩短、只留 3 片，避免压到猫咪头顶。
  const topLeaves: Array<[number, number, number, number]> = [
    [-0.66, 0.14, -2.04, 0.95],
    [0.67, 0.13, -2.04, 2.25],
    [-0.58, 0.07, -2.06, 1.3],
  ];
  for (let i = 0; i < topLeaves.length; i++) {
    const [x, yy, z, rot] = topLeaves[i] ?? [0, 0, 0, 0];
    const leaf = createLeaf({ length: 0.145, color: i % 2 === 0 ? PALETTE.leafDeep : PALETTE.leaf });
    leaf.position.set(x, yy, z);
    leaf.rotation.set(-0.9, rng() * 1.2, rot);
    group.add(leaf);
  }

  return group;
}
