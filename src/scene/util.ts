import * as THREE from 'three';
import { mulberry32 } from '../lib/rng.ts';

export { mulberry32 };

/** 生成柔和圆形点纹理，用于远处的白色小花与光斑。 */
export function makeSoftDotTexture(size = 64, core = 0.42): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(core, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.72, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 木纹 / 亚麻织纹用的低频噪声纹理（程序生成，不引入外部素材）。 */
export function makeGrainTexture(
  size: number,
  base: [number, number, number],
  streak: [number, number, number],
  rng: () => number,
  horizontal: boolean,
  waveScale = 1,
): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const px = i % size;
      const py = (i / size) | 0;
      const along = horizontal ? py : px;
      const across = horizontal ? px : py;
      // 沿纹理方向拉长的低频条纹 + 细颗粒
      const wave =
        Math.sin(across * 0.09 * waveScale + Math.sin(along * 0.021) * 2.4) * 0.5 +
        Math.sin(across * 0.031 * waveScale + Math.sin(along * 0.013) * 1.7) * 0.5;
      const n = wave * 0.5 + 0.5;
      const grain = (rng() - 0.5) * 0.16;
      const t = n * 0.6 + grain + 0.2;
      const o = i * 4;
      img.data[o] = Math.max(0, Math.min(255, (base[0] + (streak[0] - base[0]) * t) | 0));
      img.data[o + 1] = Math.max(0, Math.min(255, (base[1] + (streak[1] - base[1]) * t) | 0));
      img.data[o + 2] = Math.max(0, Math.min(255, (base[2] + (streak[2] - base[2]) * t) | 0));
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
