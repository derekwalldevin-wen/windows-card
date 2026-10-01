import { defineConfig } from 'vite';

/**
 * 站点部署的基路径。
 *
 * 本机开发与预览用根路径；GitHub Pages 挂在
 * https://<user>.github.io/<repo>/ 下，资源必须带 /<repo>/ 前缀，
 * 否则 index.html 里的 /assets/... 与 /cats/... 会 404。
 *
 * 通过环境变量 BASE_PATH 切换，本机命令不需要改动：
 *   npm run dev / build            → base = '/'（本机）
 *   BASE_PATH=/windows-card/ build → base = '/windows-card/'（Pages）
 *
 * 放在 import.meta.env.BASE_URL 里由 Vite 注入，运行期代码就能读到同一个值，
 * 避免「构建期是一套、运行期又硬编码另一套」。
 */
const base = process.env['BASE_PATH'] ?? '/';

export default defineConfig({
  base,

  // 仅本机可访问：不开放局域网端口，不改防火墙。
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    open: false,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: false,
    open: false,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
  },
});
