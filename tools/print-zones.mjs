/**
 * 只读汇总：把 shot.mjs 报告里的 selfcheck 分区数据打成表，
 * 便于逐视口核对「背景不变形 / 猫咪不出界 / 手牌与按钮完整可点」。
 *
 * 本轮起没有 3D，对齐误差 playRectWorld 等字段为空属正常。
 *
 * 运行：node tools\print-zones.mjs <report.json 所在目录>
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
const list = Array.isArray(report) ? report : (report.results ?? [report]);

const f = (z, n) => {
  const r = z[n]?.rect;
  return r ? `${r.y.toFixed(0)}~${(r.y + r.h).toFixed(0)} (${r.h.toFixed(0)})` : '—';
};
const fw = (z, n) => {
  const r = z[n]?.rect;
  return r ? `${r.w.toFixed(0)}` : '—';
};
const num = (v) => (typeof v === 'number' ? Number(v.toFixed(1)) : v);

for (const v of list) {
  const raw = v.metrics?.selfcheck;
  if (!raw) { console.log(`${v.spec}: 无 selfcheck`); continue; }
  const s = JSON.parse(raw.replace(/^SELFCHECK/, '').replace(/ENDSELFCHECK$/, ''));
  const z = Object.fromEntries(s.zones.map((x) => [x.name, x]));
  const stage = v.metrics.stage;
  const d = s.diag ?? {};
  const bg = d.backgroundFit ?? {};

  console.log(`\n=== ${v.spec}　stage ${stage[0]}×${stage[1]}　canvas ${v.metrics.canvas.join('×')} dpr ${v.metrics.dpr}`);
  console.log(
    `  背景 scale=${num(Number(bg.scale))} 缩放后 ${String(bg.w).replace('px', '')}×${String(bg.h).replace('px', '')} ` +
    `偏移(${String(bg.x).replace('px', '')},${String(bg.y).replace('px', '')}) 依据=${bg.fitBy} 底部裁切=${num(bg.croppedBottom)}px 已加载=${bg.ready}`,
  );
  const cat = d.cat ?? {};
  console.log(`  猫 ${s.cat?.name}（${s.cat?.id}）natural=${s.cat?.natural} loaded=${s.cat?.complete}  footXRatio=${cat.footXRatio} footLift=${cat.footLift}`);
  console.log(`  WebGL 活动上下文：${d.webglActive}`);

  console.log(`  HUD        ${f(z, 'hud')} 宽 ${fw(z, 'hud')}`);
  console.log(`  猫咪区     ${f(z, 'cat')}　贴图 ${f(z, 'catImg')} 宽 ${fw(z, 'catImg')}　接地影 ${f(z, 'catShadow')}`);
  console.log(`  裸桌呼吸区 ${f(z, 'spacer')}`);
  console.log(`  计分牌     ${f(z, 'plate')}　已选 pill ${f(z, 'pill')}　出牌展示区 ${f(z, 'play')}`);
  console.log(`  手牌       ${f(z, 'hand')}　第1排 ${f(z, 'handRow1')}　第2排 ${f(z, 'handRow2')}`);
  console.log(`  牌堆标记   ${f(z, 'deck')}　操作区 ${f(z, 'actions')}　弃牌 ${f(z, 'discard')}　出牌 ${f(z, 'playBtn')}`);
  console.log(`  卡牌 ${s.cards.count} 张，最小可点边 ${s.cards.minTapSide}px`);

  // 背景不变形：缩放后宽高比必须等于原图宽高比
  const bw = parseFloat(String(bg.w)), bh = parseFloat(String(bg.h));
  if (Number.isFinite(bw) && Number.isFinite(bh) && bw > 0) {
    const ar = bw / bh;
    const srcAr = 852 / 1846;
    const dev = Math.abs(ar - srcAr) / srcAr;
    console.log(`  背景宽高比 ${ar.toFixed(5)}（原图 ${srcAr.toFixed(5)}）偏差 ${(dev * 100).toFixed(3)}% → ${dev < 0.005 ? '未变形' : '⚠ 变形'}`);
    // 露底：缩放后必须至少覆盖容器
    const coverW = bw >= stage[0] - 0.5;
    const coverH = bh >= stage[1] - 0.5;
    console.log(`  覆盖：宽 ${coverW ? '足' : '⚠不足'} 高 ${coverH ? '足' : '⚠不足（会露底）'}　横向溢出 ${Math.max(0, bw - stage[0]).toFixed(0)}px`);
  }

  // 猫贴图不出界
  const img = z['catImg']?.rect;
  if (img && s.stage) {
    const leftGap = img.x - s.stage.x;
    const rightGap = s.stage.x + s.stage.w - (img.x + img.w);
    const ok = leftGap >= -0.5 && rightGap >= -0.5;
    console.log(`  猫贴图宽 ${img.w.toFixed(0)}px　左余 ${leftGap.toFixed(0)} / 右余 ${rightGap.toFixed(0)} → ${ok ? '未出界' : '⚠ 出界'}`);
    // 脚底是否落在背景锚点附近
    const footY = parseFloat(String(cat.footY));
    if (Number.isFinite(footY)) {
      const imgBottom = img.y + img.h;
      const lift = parseFloat(String(cat.footLift)) * img.h;
      const footActual = imgBottom - lift;
      console.log(`  脚底实测 y=${footActual.toFixed(0)}　锚点 y=${footY.toFixed(0)}　偏差 ${(footActual - footY).toFixed(1)}px`);
    }
  }

  const over = s.zones.filter((e) => e.overflowRight > 0.5 || e.overflowBottom > 0.5);
  console.log(over.length
    ? `  ⚠ 分区越界：${over.map((e) => `${e.name}(右+${e.overflowRight} 下+${e.overflowBottom})`).join('，')}`
    : '  所有分区均在舞台内');
}