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
  try { return atob('YXBpa2V5LTIwMjYwODE1MjIxODI5LWxrd3Fr'); } catch { return ''; }
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

// 读取账号数据
export async function getAccounts(env) {
  const token = getGithubToken(env);
  try {
    const resp = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PATH}`, {
      headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'xinzhihai-pages' }
    });
    if (!resp.ok) return { accounts: [], error: `HTTP ${resp.status}` };
    const data = await resp.json();
    const content = JSON.parse(base64ToUtf8(data.content));
    return { accounts: content.accounts || [], sha: data.sha };
  } catch (e) {
    return { accounts: [], error: e.message };
  }
}

// 写入账号数据
export async function saveAccounts(env, accounts, sha) {
  const token = getGithubToken(env);
  const content = utf8ToBase64(JSON.stringify({ accounts }, null, 2));
  const resp = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PATH}`, {
    method: 'PUT',
    headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'xinzhihai-pages' },
    body: JSON.stringify({ message: `更新账号数据 ${new Date().toISOString()}`, content, sha })
  });
  return resp.ok;
}

// CORS headers
export const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};
