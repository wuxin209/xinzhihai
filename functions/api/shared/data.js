// 共享工作台数据：所有登录用户（主账号+子账号）读写同一份
// 存到 xinzhihai-data 仓的 shared_workspace.json
import { getGithubToken, corsHeaders } from '../_config.js';

const GITHUB_OWNER = 'wuxin209';
const GITHUB_REPO = 'xinzhihai-data';
const GITHUB_PATH = 'shared_workspace.json';

let _cache = null;
let _cacheAt = 0;
const CACHE_TTL = 3000; // 3秒短缓存，减少多实例脏读

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

// 判断某个上传字段是否为"空"：null/undefined/空串/空数组/空对象都视为空，空值不覆盖云端已有数据
function isEmptyValue(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

// 数组型字段按 id + updated_at 做 last-write-wins 合并，旧tab/旧设备不会用旧状态覆盖新状态
const MERGE_BY_ID_FIELDS = ['purchase_orders', 'lead_time_records'];

function recUpdatedAt(rec) {
  if (!rec) return 0;
  const t = rec.updated_at || rec.updatedAt || rec.created_at || rec.createdAt || 0;
  const n = new Date(t).getTime();
  return isNaN(n) ? 0 : n;
}

async function handleSave(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const incoming = body.data || body;
    if (!incoming || typeof incoming !== 'object') {
      return new Response(JSON.stringify({ error: 'data 必须是对象' }), { status: 400, headers: corsHeaders });
    }
    const latest = await fetchFromGitHub(context.env);
    const existing = (latest.data && typeof latest.data === 'object') ? latest.data : {};

    // 服务端字段级合并：只有前端传来的"非空"字段才覆盖云端；空值一律保留云端原值
    const merged = { ...existing };

    // 墓碑：已被删除的 id 集合，本地旧缓存再 push 也不加回，根治删除复活
    const tombstones = new Set(Array.isArray(existing._tombstones) ? existing._tombstones.map(String) : []);

    // 先收集显式删除列表（_deleted_<field>），避免被空数组/下划线跳过逻辑漏掉
    const deletedMap = {};
    for (const k of Object.keys(incoming)) {
      if (k.startsWith('_deleted_')) {
        const field = k.slice('_deleted_'.length);
        if (Array.isArray(incoming[k])) deletedMap[field] = incoming[k].map(String);
      }
    }

    for (const key of Object.keys(incoming)) {
      // 元字段（下划线开头）不参与合并，单独处理
      if (key.startsWith('_')) continue;

      const val = incoming[key];

      // 数组型业务字段：按 id + updated_at 合并，杜绝整体覆盖导致的状态回滚/删除复活
      // 即使 val 是空数组（纯删除场景），也要走 merge 分支应用 deletedIds
      if (MERGE_BY_ID_FIELDS.includes(key) && Array.isArray(val) && Array.isArray(existing[key])) {
        const cloudMap = new Map();
        for (const rec of existing[key]) {
          if (rec && rec.id != null) cloudMap.set(String(rec.id), rec);
        }
        for (const rec of val) {
          if (!rec || rec.id == null) continue;
          const cid = String(rec.id);
          // 软删除标记：前端把记录标记为 deleted=true/status=deleted 时，从云端删除并加入墓碑
          if (rec.deleted === true || rec.status === 'deleted') {
            cloudMap.delete(cid);
            tombstones.add(cid);
            continue;
          }
          // 墓碑拦截：已删除的 id 不再加回云端（防止本地旧缓存复活）
          if (tombstones.has(cid) && !cloudMap.has(cid)) {
            continue;
          }
          const cloudRec = cloudMap.get(cid);
          if (!cloudRec) {
            cloudMap.set(cid, rec);
          } else {
            const tIn = recUpdatedAt(rec);
            const tCloud = recUpdatedAt(cloudRec);
            if (tIn >= tCloud) cloudMap.set(cid, rec);
            // 否则云端更新，保留云端记录
          }
        }
        // 显式删除列表
        if (Array.isArray(deletedMap[key])) {
          for (const did of deletedMap[key]) {
            cloudMap.delete(did);
            tombstones.add(did);
          }
        }
        merged[key] = Array.from(cloudMap.values());
        continue;
      }

      if (isEmptyValue(val)) {
        continue; // 空值跳过，保留云端已有数据
      }

      // 对象做浅合并（保留云端未上传的键），其他数组/标量直接整体覆盖
      if (typeof val === 'object' && !Array.isArray(val) && existing[key] && typeof existing[key] === 'object' && !Array.isArray(existing[key])) {
        merged[key] = { ...existing[key], ...val };
      } else {
        merged[key] = val;
      }
    }

    // 持久化墓碑（已删除 id 集合，防止本地旧缓存复活）
    merged._tombstones = Array.from(tombstones);

    const result = await pushToGitHub(context.env, merged, latest.sha);
    if (!result.ok) return new Response(JSON.stringify({ error: '保存失败', status: result.status }), { status: 500, headers: corsHeaders });
    _cache = { data: merged, sha: result.sha };
    _cacheAt = Date.now();
    return new Response(JSON.stringify({ success: true, sha: result.sha }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
}
