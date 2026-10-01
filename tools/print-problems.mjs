/**
 * 只读：打印 shot/playtest 报告里记录的控制台错误与警告，
 * 便于在 PowerShell 里避开转义问题（内联 node -e 会被引号吃掉）。
 *
 * 运行：node tools/print-problems.mjs <report.json 所在目录>
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
const list = Array.isArray(report) ? report : (report.results ?? [report]);

for (const v of list) {
  const probs = v.problems ?? [];
  const warns = v.warnings ?? [];
  console.log(`\n=== ${v.spec}　错误 ${probs.length}　警告 ${warns.length}　断言失败 ${(v.failed ?? []).length}`);
  for (const p of probs) {
    let d;
    try { d = typeof p === 'string' ? JSON.parse(p) : p; } catch { console.log('  （非 JSON）' + String(p).slice(0, 200)); continue; }
    const ex = d.exceptionDetails ?? d;
    console.log('  错误：' + (ex.text ?? ex.type ?? '?'));
    console.log('    描述：' + (ex.exception?.description ?? ex.exception?.value ?? '').split('\n')[0]);
    const frames = ex.stackTrace?.callFrames ?? [];
    for (const f of frames.slice(0, 3)) {
      console.log(`    栈：${f.functionName || '(匿名)'}  第 ${f.lineNumber + 1} 行 第 ${f.columnNumber + 1} 列`);
    }
    if (d.url) console.log('    位置：' + d.url.split('/').pop());
  }
  for (const w of warns) console.log('  警告：' + String(w).slice(0, 300));
  for (const f of v.failed ?? []) console.log('  断言失败：' + String(f).slice(0, 300));
}