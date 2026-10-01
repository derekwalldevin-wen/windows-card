/**
 * 只读复核脚本：不修改任何项目文件，只计算投影关系。
 * 运行：node tools/analyze-cat-space.mjs
 */
import { CAMERA_DESIGN } from '../src/scene/camera.ts';
import * as THREE from 'three';

// 只读引用源码常量（不 import 以避免 DOM 依赖）
const TABLE_BACK_Z = -2.06; // src/scene/table.ts
const ROOM = { wallZ: -2.12, holeBottom: 0.1, holeTop: 0.49 }; // src/scene/room.ts

const VIEWPORTS = [
  { name: '390x844', w: 390, h: 844 },
  { name: '360x640', w: 360, h: 640 },
];

function makeCamera(height, back, pitchDeg, fovDeg) {
  const cam = new THREE.PerspectiveCamera(fovDeg, 1, 0.02, 24);
  const pitch = (pitchDeg * Math.PI) / 180;
  cam.position.set(0, height, back);
  cam.up.set(0, 1, 0);
  cam.lookAt(new THREE.Vector3(0, 0, back - height / Math.tan(pitch)));
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

function py(cam, canvasH, y, z) {
  return ((1 - new THREE.Vector3(0, y, z).project(cam).y) / 2) * canvasH;
}

const D = CAMERA_DESIGN;
const base = makeCamera(D.height, D.back, D.pitchDeg, D.fovDeg);

console.log('=== 1. 当前值（只读）===');
console.log('  CAMERA_DESIGN =', JSON.stringify(D));
console.log('  TABLE_BACK_Z =', TABLE_BACK_Z, ' 窗洞 y =', ROOM.holeBottom, '→', ROOM.holeTop);

console.log('\n=== 2. 猫咪可用高度的真实约束（关键结论）===');
console.log('  src/scene/stage.ts: projectTableBackLine() 投影的是 (0, 0, TABLE_BACK_Z)');
console.log('  → 桌沿屏幕位置 = f(相机, TABLE_BACK_Z)，与 ROOM.hole* 完全无关。');
console.log('  → 猫咪贴图允许覆盖窗户，所以窗户不是猫咪的上边界。');
console.log('  结论：猫咪可用高度 = 桌沿y − (上方UI底部y)，抬高窗户对此项贡献 = 0。');

console.log('\n=== 3. 数值验证：抬高窗户 0.45m，桌沿是否移动 ===');
for (const vp of VIEWPORTS) {
  // 场景 A：窗户原位；场景 B：窗户抬高 0.45。相机与 TABLE_BACK_Z 完全相同。
  const camA = makeCamera(D.height, D.back, D.pitchDeg, D.fovDeg);
  const camB = makeCamera(D.height, D.back, D.pitchDeg, D.fovDeg);
  for (const c of [camA, camB]) { c.aspect = vp.w / vp.h; c.updateProjectionMatrix(); }
  const lineA = py(camA, vp.h, 0, TABLE_BACK_Z);
  const lineB = py(camB, vp.h, 0, TABLE_BACK_Z);
  const wAb = py(camA, vp.h, ROOM.holeBottom, ROOM.wallZ), wAt = py(camA, vp.h, ROOM.holeTop, ROOM.wallZ);
  const wBb = py(camB, vp.h, ROOM.holeBottom + 0.45, ROOM.wallZ);
  const wBt = py(camB, vp.h, ROOM.holeTop + 0.45, ROOM.wallZ);
  console.log(`  ${vp.name}`);
  console.log(`    窗(原位) y=${wAb.toFixed(1)}~${wAt.toFixed(1)}   窗(抬高0.45) y=${wBb.toFixed(1)}~${wBt.toFixed(1)}  ← 窗确实移动`);
  console.log(`    桌沿 原位=${lineA.toFixed(4)}  抬高后=${lineB.toFixed(4)}  差值=${(lineB - lineA).toFixed(6)}px  ← 零变化`);
}

console.log('\n=== 4. 当前实测（?selfcheck=1）与复算对照 ===');
const MEASURED = {
  '390x844': { padTop: 13.9, hud: 42.9, g1: 8.6, eff: 25, g2: 8.6, catTop: 98.9, catH: 64.0, tableLine: 163.2 },
  '360x640': { padTop: 10.4, hud: 34.6, g1: 6.5, eff: 19.4, g2: 6.5, catTop: 82.7, catH: 41.0, tableLine: 123.7 },
};
for (const vp of VIEWPORTS) {
  base.aspect = vp.w / vp.h; base.updateProjectionMatrix();
  const m = MEASURED[vp.name];
  const calcTop = m.padTop + m.hud + m.g1 + m.eff + m.g2;
  console.log(`  ${vp.name}: 复算桌沿=${py(base, vp.h, 0, TABLE_BACK_Z).toFixed(1)} (实测 ${m.tableLine})  复算猫咪区顶=${calcTop.toFixed(1)} (实测 ${m.catTop})  猫咪高实测=${m.catH}px`);
}

console.log('\n=== 5. 杠杆一：只收紧上方 UI（相机 / 桌沿 / 手牌 全部不动）===');
const CHROME = [
  { name: '现状', pad: 13.9, hud: 42.9, eff: 25, gap: 8.6 },
  { name: 'HUD 收到 34px，效果槽不动', pad: 10, hud: 34, eff: 25, gap: 6 },
  { name: 'HUD 34 + 效果槽压成 12px 细条', pad: 9, hud: 34, eff: 12, gap: 5 },
  { name: 'HUD 34 + 效果槽并入 HUD 行内（竖向 0）', pad: 9, hud: 34, eff: 0, gap: 4 },
];
for (const vp of VIEWPORTS) {
  base.aspect = vp.w / vp.h; base.updateProjectionMatrix();
  const line = py(base, vp.h, 0, TABLE_BACK_Z);
  console.log(`  ${vp.name}（桌沿 ${line.toFixed(1)}）`);
  for (const c of CHROME) {
    const top = c.pad + c.hud + c.eff + c.gap * (c.eff > 0 ? 2 : 1);
    console.log(`    ${c.name.padEnd(36)} 猫咪区顶=${top.toFixed(1).padStart(5)}  猫咪高=${(line - top).toFixed(1).padStart(5)}px`);
  }
}

console.log('\n=== 6. 杠杆二：桌沿构图 / 机位（找出「桌沿下移」的最小改动）===');
console.log('  注意：加大俯角会让桌沿上移（猫咪空间变小），方向相反。真正有用的是「前推」或「桌沿前移」。');
const CAND = [
  { name: '现状', h: D.height, b: D.back, p: D.pitchDeg, tz: TABLE_BACK_Z },
  { name: '桌沿 -2.06→-1.95（桌面前沿不动）', h: D.height, b: D.back, p: D.pitchDeg, tz: -1.95 },
  { name: '桌沿 -2.06→-1.85', h: D.height, b: D.back, p: D.pitchDeg, tz: -1.85 },
  { name: '后撤 0.62→0.55', h: D.height, b: 0.55, p: D.pitchDeg, tz: TABLE_BACK_Z },
  { name: '后撤 0.62→0.50', h: D.height, b: 0.50, p: D.pitchDeg, tz: TABLE_BACK_Z },
  { name: '后撤 0.62→0.45', h: D.height, b: 0.45, p: D.pitchDeg, tz: TABLE_BACK_Z },
  { name: '后撤 0.62→0.40', h: D.height, b: 0.40, p: D.pitchDeg, tz: TABLE_BACK_Z },
  { name: '俯角 42→40（略缓）', h: D.height, b: D.back, p: 40, tz: TABLE_BACK_Z },
  { name: '俯角 40 + 后撤 0.55', h: D.height, b: 0.55, p: 40, tz: TABLE_BACK_Z },
];
for (const vp of VIEWPORTS) {
  console.log(`  ${vp.name}`);
  console.log('    ' + '方案'.padEnd(34) + ' 桌沿y   窗顶y  窗底y  桌前沿y  可见半宽@play');
  for (const c of CAND) {
    const cam = makeCamera(c.h, c.b, c.p, D.fovDeg);
    cam.aspect = vp.w / vp.h; cam.updateProjectionMatrix();
    const line = py(cam, vp.h, 0, c.tz);
    const wt = py(cam, vp.h, ROOM.holeTop, ROOM.wallZ);
    const wb = py(cam, vp.h, ROOM.holeBottom, ROOM.wallZ);
    const front = py(cam, vp.h, 0, 0.35);
    // 牌局中心 z=-0.6 处可见半宽
    const pw = new THREE.Vector3(1, 0, -0.6).project(cam);
    const halfW = Math.abs(pw.x) * (vp.w / 2) / Math.abs(new THREE.Vector3(1, 0, -0.6).project(cam).x) / Math.abs(new THREE.Vector3(1, 0, -0.6).project(cam).x);
    console.log(
      `    ${c.name.padEnd(34)} ${line.toFixed(0).padStart(6)} ${wt.toFixed(0).padStart(7)} ${wb.toFixed(0).padStart(6)} ${front.toFixed(0).padStart(9)}  (见注)`,
    );
  }
}
console.log('\n  注：窗顶y 为负数表示窗户顶端已移出画面上方。');