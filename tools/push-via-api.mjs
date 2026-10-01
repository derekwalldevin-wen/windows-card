/**
 * 用 GitHub REST API 推送提交（绕过 git push 的连接问题）。
 *
 * 背景：本机 `git push` 持续报 `Failed to connect to github.com port 443`，
 * 但同机 `Invoke-WebRequest https://api.github.com/` 是 200 —— 
 * 说明是 git 自带的传输层被中间设备拦了，走 .NET 的 HTTP 栈反而通。
 *
 * 做法：Contents API 逐文件提交。不新建分支、不改远端历史、不删除任何东西，
 * 只把本地某个 commit 相对 base 的差异写上去。
 *
 * 凭据来自 git credential manager（缓存的 OAuth token），不落盘、不打印。
 *
 * 运行：node tools\push-via-api.mjs <owner/repo> <本地分支> <base 短 SHA>
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const REPO = process.argv[2] ?? 'derekwalldevin-wen/windows-card';
const BRANCH = process.argv[3] ?? 'main';
const BASE = process.argv[4] ?? '';

/** 从 git credential manager 取已缓存的凭据，不打印内容 */
function getToken() {
  const input = 'protocol=https\nhost=github.com\n\n';
  const out = execFileSync('git', ['credential', 'fill'], { input, encoding: 'utf8' });
  const m = /^password=(.*)$/m.exec(out);
  if (!m || !m[1]) throw new Error('git credential 里没有 password');
  return m[1].trim();
}

const token = getToken();
const api = async (path, init = {}) => {
  const r = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      'User-Agent': 'windows-card-push',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }
  if (!r.ok) {
    const msg = data?.message ?? text.slice(0, 200);
    throw new Error(`${r.status} ${msg}`);
  }
  return data;
};

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

// ---- 1. 确认身份与远端状态 ----
const me = await api('/user');
console.log(`身份：${me.login}`);

const repo = await api(`/repos/${REPO}`);
console.log(`仓库：${repo.full_name}　可见性：${repo.private ? '私有' : '公开'}`);

const remoteRef = await api(`/repos/${REPO}/git/ref/heads/${BRANCH}`);
const remoteSha = remoteRef.object.sha;
const localSha = git('rev-parse', 'HEAD');
console.log(`远端 ${BRANCH}：${remoteSha.slice(0, 7)}`);
console.log(`本地 HEAD ：${localSha.slice(0, 7)}`);

if (remoteSha === localSha) {
  console.log('\n远端已是最新，无需推送。');
  process.exit(0);
}

// ---- 2. 列出本次要提交的文件 ----
// 只提交本地比 base 多出的文件（新增或修改），不碰删除
const base = BASE || remoteSha;
const names = git('diff', '--name-status', base, localSha)
  .split('\n')
  .filter(Boolean)
  .map((l) => l.split('\t'))
  .filter(([status]) => status !== 'D')
  .map(([, ...rest]) => rest[rest.length - 1]);

if (!names.length) {
  console.log('\n没有需要上传的文件。');
  process.exit(0);
}

console.log(`\n待提交 ${names.length} 个文件：`);
for (const n of names) console.log(`  ${n}`);

// 逐个用 Contents API 写入
for (const path of names) {
  const content = readFileSync(path);

  // Contents API 的 sha 必须是**远端当前**那个文件的 blob，
  // 不是我们要写入的 blob —— 传错了会 409。
  // 远端文件可能不存在（新增）或已被别人改过（冲突），所以先查。
  const remotePath = `/repos/${REPO}/contents/${path}?ref=${BRANCH}`;
  let currentSha;
  try {
    const existing = await api(remotePath);
    currentSha = existing.sha;
  } catch (e) {
    if (!String(e.message).startsWith('404')) throw e;
    currentSha = undefined; // 新增文件
  }

  // 若远端内容与本地已一致（可能是上次部分成功的重跑），跳过
  if (currentSha) {
    const remoteContent = await api(remotePath);
    if (remoteContent.encoding === 'base64' && remoteContent.content) {
      const remoteBuf = Buffer.from(remoteContent.content.replace(/\n/g, ''), 'base64');
      if (remoteBuf.equals(content)) {
        console.log(`  = ${path}（远端已是该内容，跳过）`);
        continue;
      }
    }
  }

  const body = {
    message: `更新 ${path}`,
    content: content.toString('base64'),
    branch: BRANCH,
    ...(currentSha ? { sha: currentSha } : {}),
  };
  await api(`/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  console.log(`  ✓ ${path}`);
}

console.log('\n全部文件已通过 API 写入远端。');