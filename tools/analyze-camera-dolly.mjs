/** 只读测算：精细扫描「后撤 back」以满足参考图的猫咪安全范围。不修改任何文件。 */
import * as THREE from 'three';

const H = 1.15, P = 42, FOV = 58;
const TZ = -2.06, ROOMZ = -2.12, WIN_B = 0.1, WIN_T = 0.49;
const VPS = [{ n: '390x844', w: 390, h: 844 }, { n: '360x640', w: 360, h: 640 }, { n: '430x932', w: 430, h: 932 }];
const GOAL = { '390x844': 315, '360x640': 239, '430x932': 348 };
const WING = { '390x844': 156, '360x640': 144, '430x932': 172 };

function cam(b) {
  const c = new THREE.PerspectiveCamera(FOV, 1, 0.02, 24);
  const p = (P * Math.PI) / 180;
  c.position.set(0, H, b);
  c.up.set(0, 1, 0);
  c.lookAt(new THREE.Vector3(0, 0, b - H / Math.tan(p)));
  c.updateMatrixWorld(true);
  c.updateProjectionMatrix();
  return c;
}
const pY = (c, hh, y, z) => ((1 - new THREE.Vector3(0, y, z).project(c).y) / 2) * hh;
const halfW = (c, w, z) => {
  const a = new THREE.Vector3(0, 0, z).project(c);
  const b2 = new THREE.Vector3(1, 0, z).project(c);
  return (Math.abs(b2.x - a.x) / 2) * (w / 2);
};

console.log('后撤back | ' + VPS.map((v) => v.n.padEnd(22)).join(''));
console.log('         | ' + VPS.map(() => '桌沿y 达标 翼猫半宽 达标').join(' '));
for (const b of [0.62, 0.3, 0.1, -0.1, -0.2, -0.3, -0.4, -0.5, -0.6]) {
  const cells = VPS.map((v) => {
    const c = cam(b); c.aspect = v.w / v.h; c.updateProjectionMatrix();
    const line = pY(c, v.h, 0, TZ);
    const hw = halfW(c, v.w, TZ);
    return `${line.toFixed(0).padStart(6)} ${line >= GOAL[v.n] ? ' 是' : ' 否'} ${hw.toFixed(0).padStart(7)} ${hw >= WING[v.n] ? ' 是' : ' 否'}`;
  });
  console.log(`${String(b).padStart(9)} | ` + cells.join(' | '));
}

console.log('\n=== back = -0.30 时的其余影响（390×844）===');
{
  const v = VPS[0];
  const c = cam(-0.3); c.aspect = v.w / v.h; c.updateProjectionMatrix();
  console.log(`  窗洞屏幕范围     y=${pY(c, v.h, WIN_T, ROOMZ).toFixed(0)} ~ ${pY(c, v.h, WIN_B, ROOMZ).toFixed(0)}`);
  console.log(`  桌面后沿         y=${pY(c, v.h, 0, TZ).toFixed(0)}`);
  console.log(`  桌面前沿 z=0.35  y=${pY(c, v.h, 0, 0.35).toFixed(0)}`);
  for (const [n, z] of [['书堆', -1.8], ['陶罐', -1.45], ['茶杯', -1.78], ['小盆栽', -1.42]]) {
    console.log(`  ${n.padEnd(5)} z=${z}  →屏幕 y=${pY(c, v.h, 0.06, z).toFixed(0)}  可见半宽=${halfW(c, v.w, z).toFixed(0)}px`);
  }
  console.log(`  相机位置 z=-0.30（桌面 z 范围 -2.06~0.35，即相机已越过桌垫前端）`);
}