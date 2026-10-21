// 共享工作台数据：所有登录用户（主账号+子账号）读写同一份
// 存到 xinzhihai-data 仓的 shared_workspace.json
import { getGithubToken, corsHeaders } from '../_config.js';

const GITHUB_OWNER = 'wuxin209';
const GITHUB_REPO = 'xinzhihai-data';
const GITHUB_PATH = 'shared_workspace.json';

let _cache = null;
let _cacheAt = 0;
const CACHE_TTL = 10000; // 10秒短缓存

function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64ToUtf8(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function fetchFromGitHub(env) {
  const token = getGithubToken(env);
  const resp = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PATH}`, {
    headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'xinzhihai-pages' }
  });
  if (resp.status === 404) return { data: {}, sha: null };
  if (!resp.ok) return { error: `HTTP ${resp.status}` };
  const j = await resp.json();
  return { data: JSON.parse(b64ToUtf8(j.content)), sha: j.sha };
}

async function pushToGitHub(env, data, sha) {
  const token = getGithubToken(env);
  const body = {
    message: `更新共享数据 ${new Date().toISOString()}`,
    content: utf8ToB64(JSON.stringify(data))
  };
  if (sha) body.sha = sha;
  const resp = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PATH}`, {
    method: 'PUT',
    headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'xinzhihai-pages' },
    body: JSON.stringify(body)
  });
  if (resp.ok) {
    const j = await resp.json();
    return { ok: true, sha: j.content.sha };
  }
  // 409 sha冲突，重拉再试一次
  if (resp.status === 409) {
    const latest = await fetchFromGitHub(env);
    if (latest.data && !latest.error) {
      const retryBody = { message: body.message, content: body.content, sha: latest.sha };
      const r2 = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PATH}`, {
        method: 'PUT',
        headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'xinzhihai-pages' },
        body: JSON.stringify(retryBody)
      });
      if (r2.ok) { const j = await r2.json(); return { ok: true, sha: j.content.sha }; }
    }
  }
  return { ok: false, status: resp.status };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

// GET - 读取共享数据
export async function onRequestGet(context) {
  try {
    const now = Date.now();
    if (_cache && now - _cacheAt < CACHE_TTL) {
      return new Response(JSON.stringify({ success: true, data: _cache.data }), { headers: corsHeaders });
    }
    const { data, sha, error } = await fetchFromGitHub(context.env);
    if (error) return new Response(JSON.stringify({ error }), { status: 500, headers: corsHeaders });
    _cache = { data, sha };
    _cacheAt = now;
    return new Response(JSON.stringify({ success: true, data }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
}

// POST - 写入共享数据（全量覆盖，前端合并后传）
export async function onRequestPost(context) {
  return handleSave(context);
}

// PUT - 同POST（兼容前端fetch PUT请求）
export async function onRequestPut(context) {
  return handleSave(context);
}

async function handleSave(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const data = body.data || body;
    if (!data || typeof data !== 'object') {
      return new Response(JSON.stringify({ error: 'data 必须是对象' }), { status: 400, headers: corsHeaders });
    }
    const latest = await fetchFromGitHub(context.env);
    const result = await pushToGitHub(context.env, data, latest.sha);
    if (!result.ok) return new Response(JSON.stringify({ error: '保存失败', status: result.status }), { status: 500, headers: corsHeaders });
    _cache = { data, sha: result.sha };
    _cacheAt = Date.now();
    return new Response(JSON.stringify({ success: true, sha: result.sha }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
}
