import * as THREE from 'three';
import { PALETTE, applyPaletteToCss } from './palette.ts';
import { createRoom } from './room.ts';
import { createTable, CAT_BASE_Z, TABLE_BACK_Z } from './table.ts';
import { createProps } from './props.ts';
import { CAMERA_DESIGN, PLAY_LIMITS, fitPlayRectToScreen, rectOfUnion, type PlayFit } from './camera.ts';

export interface StageDiagnostics {
  canvas: { w: number; h: number; dpr: number };
  camera: { fov: number; position: [number, number, number] };
  playRectWorld: PlayFit;
  /** 桌面后沿在画布上的屏幕 y（px）。仅作场景自检参考。 */
  tableBackLineY: number;
  /** 猫咪基座（CAT_BASE_Z）在画布上的屏幕 y（px）。猫咪区下缘应对齐这里。 */
  catBaseLineY: number;
  drawCalls: number;
  triangles: number;
  programs: number;
}

export interface Stage {
  fit: PlayFit;
  diagnostics(): StageDiagnostics;
  dispose(): void;
  onReady(cb: (d: StageDiagnostics) => void): void;
}

/** 把某个 z 平面上的原点投影到屏幕，返回画布内的 y（px）。 */
function projectPlaneY(camera: THREE.PerspectiveCamera, canvasH: number, z: number): number {
  const p = new THREE.Vector3(0, 0, z).project(camera);
  return Number((((1 - p.y) / 2) * canvasH).toFixed(1));
}

function buildLights(scene: THREE.Scene): void {
  // 环境：上方暖天光，下方木色反弹。
  // 反弹色往灰里收一点：原来的红褐色反弹会把整张桌面压出红褐味，
  // 与「木桌降红褐饱和」的目标相反。
  const hemi = new THREE.HemisphereLight(0xfff2dc, 0x8d8371, 0.95);
  scene.add(hemi);

  scene.add(new THREE.AmbientLight(0x74695a, 0.4));

  // 窗光：从墙外斜射进来，窗框与墙体会在桌面投出窗格阴影
  const sun = new THREE.DirectionalLight(0xfff2d8, 2.3);
  sun.position.set(0.3, 2.5, -4.0);
  sun.target.position.set(0, 0, -0.95);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -1.9;
  sun.shadow.camera.right = 1.9;
  sun.shadow.camera.top = 2.0;
  sun.shadow.camera.bottom = -2.0;
  sun.shadow.camera.near = 0.2;
  sun.shadow.camera.far = 10;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.01;
  scene.add(sun);
  scene.add(sun.target);

  // 相机侧柔和补光：避免阴影死黑，不投影
  const fill = new THREE.DirectionalLight(0xffe9c8, 0.82);
  fill.position.set(0.7, 1.5, 2.2);
  scene.add(fill);

  // 桌下微弱暖反弹
  const bounce = new THREE.DirectionalLight(0xffd9a8, 0.28);
  bounce.position.set(-0.5, -1.0, 0.8);
  scene.add(bounce);
}

export function createStage(
  canvas: HTMLCanvasElement,
  /** 卡牌所在的 DOM 区域（出牌展示区 + 手牌区），作为 3D 牌局矩形的对齐目标 */
  cardZones: readonly Element[],
): Stage | null {
  applyPaletteToCss();

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
  } catch (error) {
    console.error('[stage] WebGL init failed', error);
    return null;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.24;
  renderer.shadowMap.enabled = true;
  // three 0.186 起 PCFSoftShadowMap 已被移除，改用 PCFShadowMap 以保持控制台干净
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(new THREE.Color(PALETTE.wallShade), 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xefe4cc, 4.5, 13);

  const camera = new THREE.PerspectiveCamera(
    CAMERA_DESIGN.fovDeg,
    1,
    CAMERA_DESIGN.near,
    CAMERA_DESIGN.far,
  );

  buildLights(scene);
  scene.add(createRoom());
  scene.add(createTable());
  scene.add(createProps());

  const readyCallbacks: Array<(d: StageDiagnostics) => void> = [];
  let fit: PlayFit = {
    halfW: PLAY_LIMITS.halfW,
    halfD: PLAY_LIMITS.halfD,
    centerX: 0,
    centerZ: PLAY_LIMITS.centerZ,
    screen: { cx: 0, cy: 0, w: 0, h: 0 },
    clamped: false,
  };
  let disposed = false;

  function diagnostics(): StageDiagnostics {
    return {
      canvas: {
        w: renderer.domElement.width,
        h: renderer.domElement.height,
        dpr: renderer.getPixelRatio(),
      },
      camera: {
        fov: camera.fov,
        position: [
          Number(camera.position.x.toFixed(4)),
          Number(camera.position.y.toFixed(4)),
          Number(camera.position.z.toFixed(4)),
        ],
      },
      playRectWorld: fit,
      tableBackLineY: projectPlaneY(camera, canvas.clientHeight, TABLE_BACK_Z),
      catBaseLineY: projectPlaneY(camera, canvas.clientHeight, CAT_BASE_Z),
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      programs: renderer.info.programs?.length ?? 0,
    };
  }

  function render(): void {
    if (disposed) return;
    renderer.render(scene, camera);
  }

  function resize(): void {
    const parent = canvas.parentElement ?? document.body;
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fit = fitPlayRectToScreen(camera, w, h, rectOfUnion(cardZones, canvas), PLAY_LIMITS);
    render();
    const d = diagnostics();
    for (const cb of readyCallbacks) cb(d);
  }

  const onResize = (): void => {
    resize();
  };

  const onContextLost = (event: Event): void => {
    event.preventDefault();
    console.warn('[stage] WebGL context lost');
  };
  const onContextRestored = (): void => {
    console.warn('[stage] WebGL context restored');
    resize();
  };

  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  // 同步渲染首帧：不能依赖 requestAnimationFrame，
  // 因为标签页不可见时 rAF 不会触发，会导致场景一片空白。
  resize();

  // 若浏览器允许，再在下一帧补一次，吸收字体加载等晚期布局变化。
  requestAnimationFrame(() => {
    if (disposed) return;
    resize();
  });

  return {
    get fit() {
      return fit;
    },
    diagnostics,
    dispose(): void {
      disposed = true;
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Points || obj instanceof THREE.InstancedMesh) {
          obj.geometry?.dispose();
          const m = obj.material;
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m?.dispose();
        }
      });
      renderer.dispose();
    },
    onReady(cb): void {
      readyCallbacks.push(cb);
      cb(diagnostics());
    },
  };
}
