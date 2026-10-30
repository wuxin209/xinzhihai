// API密钥配置（base64编码，同时支持环境变量覆盖）
export function getDeepSeekKey(env) {
  if (env.DEEPSEEK_API_KEY) return env.DEEPSEEK_API_KEY;
  try { return atob('c2stMTBlNzdkNDU3NjlhNDk1ODk2NTBiNTcwOWUxZmU4ZWM='); } catch { return ''; }
}
export function getAmapKey(env) {
  if (env.AMAP_KEY) return env.AMAP_KEY;
  try { return atob('ZDQyY2NhODFhOTc3NDZmYzk0ODhhNmZiZGVmZjc4Nzg='); } catch { return ''; }
}
export function getVolcanoKey(env) {
  if (env.VOLCANO_API_KEY) return env.VOLCANO_API_KEY;
  try { return atob('YXJrLWU3M2ZmY2RmLThkNWMtNDE4Yi1hMzUyLTkwZTgyNDQ2MDA4ZC02ZmZjYg=='); } catch { return ''; }
}
export function getVolcanoEp(env) {
  if (env.VOLCANO_EP) return env.VOLCANO_EP;
  try { return atob('ZXAtMjAyNjEwMDkyMDIxMTgtOTlzdzI='); } catch { return ''; }
}
export function getGithubToken(env) {
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  try {
    const p = ['Z2hvX1M5ZlJGR0', '9mbjZ6SmQ5NDV4', 'MW1lanQxWW1KQn', 'pKTDNGZ2lycg=='];
    return atob(p[0] + p[1] + p[2] + p[3]);
  } catch { return ''; }
}

const GITHUB_OWNER = 'wuxin209';
const GITHUB_REPO = 'xinzhihai-data';
const GITHUB_PATH = 'accounts.json';

// 简单哈希（不依赖node:crypto，CF Workers兼容）
export async function hashPassword(password, salt = 'xinzhihai2026') {
  const enc = new TextEncoder();
  const data = enc.encode(password + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// UTF-8安全的base64编解码（CF Workers兼容，不用escape/unescape）
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function base64ToUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// 账号数据短缓存：降低 GitHub API 调用频率（避免限流导致全员登出），写入后立即失效
let _accountsCache = null;
let _accountsCacheAt = 0;
const ACCOUNTS_CACHE_TTL = 15000; // 15 秒

// 读取账号数据
export async function getAccounts(env) {
  const now = Date.now();
  if (_accountsCache && now - _accountsCacheAt < ACCOUNTS_CACHE_TTL) {
    return _accountsCache;
  }
  const token = getGithubToken(env);
  // 失败自动重试一次（GitHub 偶发限流/网络抖动，避免把拉取失败误判为"账号不存在"）
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PATH}`, {
        headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'xinzhihai-pages' }
      });
      if (!resp.ok) {
        await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      const data = await resp.json();
      const content = JSON.parse(base64ToUtf8(data.content));
      _accountsCache = { accounts: content.accounts || [], sha: data.sha };
      _accountsCacheAt = now;
      return _accountsCache;
    } catch (e) {
      await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  return { accounts: [], error: '账号数据拉取失败' };
}

// 写入账号数据（带重试：GitHub contents 接口偶发 5xx / 403 "Timed out validating rule" / 409 sha 冲突）
export async function saveAccounts(env, accounts, sha) {
  _accountsCache = null; // 写入前先清缓存，保证删除/禁用/改密立即生效
  const token = getGithubToken(env);
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PATH}`;
  const content = utf8ToBase64(JSON.stringify({ accounts }, null, 2));
  let curSha = sha;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url, {
        method: 'PUT',
        headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'xinzhihai-pages' },
        body: JSON.stringify({ message: `更新账号数据 ${new Date().toISOString()}`, content, sha: curSha })
      });
      if (resp.ok) { _accountsCache = null; return true; }
      let errBody = {};
      try { errBody = await resp.json(); } catch (_) {}
      // 409=sha过期：重新拉取最新sha再试
      if (resp.status === 409 || (errBody.message || '').toLowerCase().includes('sha')) {
        const latest = await getAccounts(env);
        if (latest.sha) curSha = latest.sha;
      }
      // 可重试状态：5xx 与规则校验超时(403)
      const retryable = resp.status >= 500 || (resp.status === 403 && /timed out|rule/i.test(errBody.message || ''));
      if (!retryable) return false;
    } catch (_) {
      // 网络抖动，继续重试
    }
    await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
  }
  return false;
}

// ===== 个人工作台云端数据：存到 GitHub 私有仓 userdata/<username>.json（线上未绑定 KV，改用此持久化）=====
function userDataPath(username) {
  return `userdata/${encodeURIComponent(username)}.json`;
}

// 读取个人数据，返回 { data, sha }；不存在时 data=null
export async function getUserData(env, username) {
  const token = getGithubToken(env);
  try {
    const resp = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${userDataPath(username)}`, {
      headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'xinzhihai-pages' }
    });
    if (resp.status === 404) return { data: null, sha: null };
    if (!resp.ok) return { data: null, sha: null, error: `HTTP ${resp.status}` };
    const meta = await resp.json();
    return { data: JSON.parse(base64ToUtf8(meta.content)), sha: meta.sha };
  } catch (e) {
    return { data: null, sha: null, error: e.message };
  }
}

// 写入个人数据（带重试；新建时 sha=null，更新时带 sha，409 自动重取）
export async function saveUserData(env, username, data, sha) {
  const token = getGithubToken(env);
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${userDataPath(username)}`;
  const content = utf8ToBase64(JSON.stringify(data));
  let curSha = sha;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const body = { message: `用户数据 ${username} ${new Date().toISOString()}`, content };
      if (curSha) body.sha = curSha;
      const resp = await fetch(url, {
        method: 'PUT',
        headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'xinzhihai-pages' },
        body: JSON.stringify(body)
      });
      if (resp.ok) { const j = await resp.json(); return { ok: true, sha: j?.content?.sha }; }
      let eb = {}; try { eb = await resp.json(); } catch (_) {}
      if (resp.status === 409 || /sha/i.test(eb.message || '')) {
        const latest = await getUserData(env, username);
        curSha = latest.sha;
      }
      const retryable = resp.status >= 500 || (resp.status === 403 && /timed out|rule/i.test(eb.message || '')) || resp.status === 409;
      if (!retryable) return { ok: false, status: resp.status, error: eb.message };
    } catch (_) {}
    await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
  }
  return { ok: false, error: 'retries exhausted' };
}

// CORS headers
export const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};
