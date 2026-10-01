import { defineConfig } from 'vite';

export default defineConfig({
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
