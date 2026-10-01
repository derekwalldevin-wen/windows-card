/**
 * 本机模拟 GitHub Pages：把 dist/ 挂在 /windows-card/ 前缀下静态伺服，
 * 用于验证 Pages 构建的产物在本机也能正常加载（尤其是 base 前缀）。
 *
 * 只绑定 127.0.0.1。
 *
 * 运行：node tools\serve-pages-sim.mjs [dist 目录] [端口]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const distDir = process.argv[2] ?? 'dist';
const port = Number(process.argv[3] ?? 4180);
const PREFIX = '/windows-card/';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  let pathname = decodeURIComponent(url.pathname);

  // 必须落在 PREFIX 下，模拟 Pages 的子路径挂载
  if (!pathname.startsWith(PREFIX)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`404 本模拟器只伺服 ${PREFIX}* （请求的是 ${pathname}）`);
    return;
  }
  pathname = pathname.slice(PREFIX.length - 1); // 保留前导 /
  let filePath = join(distDir, normalize(pathname).replace(/^([/\\])+/, ''));

  try {
    const s = await stat(filePath);
    if (s.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    // Pages 的 SPA 回退：找不到就返回 index.html
    filePath = join(distDir, 'index.html');
  }

  try {
    const buf = await readFile(filePath);
    res.writeHead(200, {
      'content-type': TYPES[extname(filePath)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`404 找不到 ${filePath}`);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Pages 模拟：http://127.0.0.1:${port}${PREFIX}`);
});