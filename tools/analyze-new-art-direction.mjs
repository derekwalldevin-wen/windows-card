/**
 * 只读测算：按新版美术参考图的比例，反推猫咪需要的空间，
 * 以及当前投影差多少、需要什么样的桌沿/机位改动才能满足。
 * 不修改任何项目文件。
 *
 * 运行：node tools/analyze-new-art-direction.mjs
 */
import * as THREE from 'three';

const CAM = { height: 1.15, back: 0.62, pitchDeg: 42, fovDeg: 58 };
const TABLE_BACK_Z = -2.06;
const TABLE_FRONT_Z = 0.35;
const ROOM = { wallZ: -2.12, holeBottom: 0.1, holeTop: 0.49 };
const PROP_Z = { books: -1.8, bigPlant: -1.45, teacup: -1.78, smallPlant: -1.42 };

const VPS = [
  { name: '390x844', w: 390, h: 844 },
  { name: '360x640', w: 360, h: 640 },
  { name: '430x932', w: 430, h: 932 },
];

function cam(h, b, p) {
  const c = new THREE.PerspectiveCamera(CAM.fovDeg, 1, 0.02, 24);
  const pitch = (p * Math.PI) / 180;
  c.position.set(0, h, b);
  c.up.set(0, 1, 0);
  c.lookAt(new THREE.Vector3(0, 0, b - h / Math.tan(pitch)));
  c.updateMatrixWorld(true);
  c.updateProjectionMatrix();
  return c;
}
const projY = (c, H, y, z) => ((1 - new THREE.Vector3(0, y, z).project(c).y) / 2) * H;
/** 某深度处，屏幕宽度对应的世界半宽（像素→世界） */
const halfWWorldAt = (c, z) => {
  const near = new THREE.Vector3(0, 0, z);
  const a = near.clone().project(c);
  const b2 = new THREE.Vector3(1, 0, z).project(c);
  return Math.abs(b2.x - a.x) / 2; // ndc 半宽
};

console.log('=== A. 参考图比例读数（人工目测，有 ±2% 误差）===');
console.log('  参考图约 936×1664，各区纵向占比：');
console.log('    HUD            2.1% ~ 6.3%   (高 4.2%)');
console.log('    猫咪（耳尖→胸被桌沿切断）6.0% ~ 37.3%  (高 31.3%)');
console.log('    小计分牌       41.5% ~ 46.6%  (高 5.1%)');
console.log('    已选提示 pill   48.0% ~ 50.8%  (高 2.8%)');
console.log('    手牌 4+4       51.4% ~ 85.1%  (高 33.7%)');
console.log('    按钮           89.5% ~ 96.2%  (高 6.7%)');
console.log('  猫咪横向：枝角猫约 30%~75% 屏宽(45%)；翼猫展翼预计需 70%~80% 屏宽。');

console.log('\n=== B. 参考图反推出的目标（换算到 px）===');
const TARGET = {};
for (const v of VPS) {
  const catTop = v.h * 0.06, catBot = v.h * 0.373;
  TARGET[v.name] = {
    catTop: Math.round(catTop), catBottom: Math.round(catBot),
    catH: Math.round(catBot - catTop),
    needHalfWFrac: 0.80, // 翼猫：需要可见半宽 ≥ 屏宽的 40%
  };
  console.log(`  ${v.name}: 猫咪区 y=${TARGET[v.name].catTop}~${TARGET[v.name].catBot} 高=${TARGET[v.name].catH}px；翼猫需可见半宽 ≥ ${Math.round(v.w * 0.4 * 1000) / 1000 * 1000 / 1000 * 100}px(即 ≥${(v.w * 0.4).toFixed(0)}px)`);
}

console.log('\n=== C. 新版布局：把中部空白回收后，猫咪能拿到多少 ===');
// 新版竖向预算（不含猫咪）
function budget(w, h, cardH) {
  const padTop = Math.max(10, Math.round(w * 0.031));
  const padBot = Math.max(12, Math.round(w * 0.036));
  const hud = Math.round(w * 0.103);            // 单行紧凑 HUD ≈ 40px@390
  const g = Math.round(w * 0.026);              // 统一间距 ≈ 10px
  const plate = Math.round(w * 0.118);          // 小计分牌 ≈ 46px
  const pill = Math.round(w * 0.062);           // 已选 pill ≈ 24px
  const hand = cardH * 2 + g;
  const act = Math.round(w * 0.138);            // 按钮 ≈ 54px
  const fixed = padTop + hud + g + g + plate + Math.round(g * 0.6) + pill + g + hand + g + act + padBot;
  return { fixed, padTop, hud, g, plate, pill, hand, act, padBot, catTop: padTop + hud + g };
}
for (const v of VPS) {
  const cardH = Math.round((v.w - Math.round(v.w * 0.082) * 2 - Math.round(v.w * 0.026) * 3) / 4 * 1.4);
  const b = budget(v.w, v.h, cardH);
  const c = cam(CAM.height, CAM.back, CAM.pitchDeg);
  c.aspect = v.w / v.h; c.updateProjectionMatrix();
  const line = projY(c, v.h, 0, TABLE_BACK_Z);
  const avail = Math.round(line - b.catTop);
  const t = TARGET[v.name];
  console.log(`  ${v.name}  手牌单行高=${cardH}px`);
  console.log(`    固定占用=${b.fixed}px  猫咪区顶=${b.catTop}px  当前桌沿y=${line.toFixed(0)}`);
  console.log(`    → 猫咪可用 = ${avail}px ；参考图需要 ${t.catH}px ；缺口 ${t.catH - avail}px`);
}

console.log('\n=== D. 要达到参考图比例，桌沿必须下移到多少 / 需要什么改动 ===');
for (const v of VPS) {
  const t = TARGET[v.name];
  const c = cam(CAM.height, CAM.back, CAM.pitchDeg);
  c.aspect = v.w / v.h; c.updateProjectionMatrix();
  const cur = projY(c, v.h, 0, TABLE_BACK_Z);
  const ndcNeeded = 1 - (2 * t.catBottom) / v.h;
  console.log(`  ${v.name}  需要桌沿 y=${t.catBottom}（当前 ${cur.toFixed(0)}），对应 ndcY=${ndcNeeded.toFixed(3)}`);
}

console.log('\n=== E. 机位/桌沿候选扫描（找一个够用的最小改动）===');
const CANDS = [
  { n: '现状', h: CAM.height, b: CAM.back, p: CAM.pitchDeg, tz: TABLE_BACK_Z },
  { n: '桌沿 -2.06→-1.90', h: CAM.height, b: CAM.back, p: CAM.pitchDeg, tz: -1.9 },
  { n: '桌沿 -2.06→-1.70', h: CAM.height, b: CAM.back, p: CAM.pitchDeg, tz: -1.7 },
  { n: '后撤 0.62→0.45', h: CAM.height, b: 0.45, p: CAM.pitchDeg, tz: TABLE_BACK_Z },
  { n: '后撤 0.62→0.30', h: CAM.height, b: 0.3, p: CAM.pitchDeg, tz: TABLE_BACK_Z },
  { n: '后撤 0.62→0.10', h: CAM.height, b: 0.1, p: CAM.pitchDeg, tz: TABLE_BACK_Z },
  { n: '后撤 0.00', h: CAM.height, b: 0.0, p: CAM.pitchDeg, tz: TABLE_BACK_Z },
  { n: '后撤 -0.20', h: CAM.height, b: -0.2, p: CAM.pitchDeg, tz: TABLE_BACK_Z },
  { n: '后撤 0.30 + 桌沿 -1.70', h: CAM.height, b: 0.3, p: CAM.pitchDeg, tz: -1.7 },
  { n: '后撤 0.10 + 桌沿 -1.70', h: CAM.height, b: 0.1, p: CAM.pitchDeg, tz: -1.7 },
];
for (const v of VPS) {
  console.log(`  --- ${v.name} ---`);
  console.log('    ' + '方案'.padEnd(24) + ' 桌沿y  目标y  达标  窗顶y 窗底y  翼猫可见半宽px  桌面后半(道具是否在桌内)');
  const t = TARGET[v.name];
  for (const c of CANDS) {
    const cc = cam(c.h, c.b, c.p);
    cc.aspect = v.w / v.h; cc.updateProjectionMatrix();
    const line = projY(cc, v.h, 0, c.tz);
    const wt = projY(cc, v.h, ROOM.holeTop, ROOM.wallZ);
    const wb = projY(cc, v.h, ROOM.holeBottom, ROOM.wallZ);
    const ndcHalf = halfWWorldAt(cc, c.tz);
    const halfPx = ndcHalf * (v.w / 2);
    const propsInside = c.tz <= PROP_Z.books + 0.09 ? '道具在桌内' : '道具超出桌后沿';
    console.log(
      `    ${c.n.padEnd(24)} ${line.toFixed(0).padStart(6)} ${String(t.catBottom).padStart(6)}  ${line >= t.catBottom ? '是' : '否'}  ${wt.toFixed(0).padStart(6)} ${wb.toFixed(0).padStart(5)} ${halfPx.toFixed(0).padStart(14)}  ${propsInside}`,
    );
  }
  console.log(`    翼猫要求可见半宽 ≥ ${(v.w * 0.4).toFixed(0)}px`);
}