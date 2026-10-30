// 共享工作台数据：所有登录用户（主账号+子账号）读写同一份
// 存到 xinzhihai-data 仓的 shared_workspace.json
import { getGithubToken, corsHeaders } from '../_config.js';

const GITHUB_OWNER = 'wuxin209';
const GITHUB_REPO = 'xinzhihai-data';
const GITHUB_PATH = 'shared_workspace.json';
const BACKUP_PATH = 'shared_workspace_backup.json';

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

// 自动备份上一版数据到 shared_workspace_backup.json（主保存成功后执行，失败不影响主流程）
async function backupSnapshot(env, snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  try {
    const token = getGithubToken(env);
    const existing = await fetchBackupSha(env);
    const body = {
      message: `自动备份 ${new Date().toISOString()}`,
      content: utf8ToB64(JSON.stringify(snapshot))
    };
    if (existing.sha) body.sha = existing.sha;
    await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${BACKUP_PATH}`, {
      method: 'PUT',
      headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'xinzhihai-pages' },
      body: JSON.stringify(body)
    });
  } catch (_) { /* 备份失败静默忽略，不阻断主保存 */ }
}

async function fetchBackupSha(env) {
  const token = getGithubToken(env);
  const resp = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${BACKUP_PATH}`, {
    headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'xinzhihai-pages' }
  });
  if (!resp.ok) return { sha: null };
  const j = await resp.json();
  return { sha: j.sha };
}

// 订单数据只保留2个月（60天），超期自动清理，不做永久留存
const ORDER_RETENTION_DAYS = 60;
const RETENTION_MS = ORDER_RETENTION_DAYS * 24 * 60 * 60 * 1000;
// 各订单字段对应的下单时间字段（按优先级取第一个能解析到的时间）
const ORDER_TIME_FIELDS = {
  purchase_orders: ['purchase_date', 'created_at'],
  lead_time_records: ['ordered_at', 'created_at'],
};

function parseTime(item, fields) {
  for (const f of fields) {
    const v = item && item[f];
    if (v) {
      const t = new Date(v).getTime();
      if (!Number.isNaN(t)) return t;
    }
  }
  return null;
}

// 判断订单是否超过2个月保留期；取不到时间戳的记录不误删，予以保留
function isExpiredOrder(item, fields) {
  const t = parseTime(item, fields);
  if (t === null) return false;
  return Date.now() - t > RETENTION_MS;
}

// 数组按 id 智能合并去重：云端条目与前端条目按 id 合并，前端同 id 以新值覆盖；合并后剔除超过2个月的过期订单
function mergeArrays(cloudArr, localArr, timeFields) {
  const map = new Map();
  const order = [];
  const hasId = (item) => item && typeof item === 'object' && item.id;
  for (const item of cloudArr || []) {
    const key = hasId(item) ? item.id : JSON.stringify(item);
    map.set(key, item);
    order.push(key);
  }
  for (const item of localArr || []) {
    const key = hasId(item) ? item.id : JSON.stringify(item);
    if (!map.has(key)) order.push(key);
    map.set(key, item);
  }
  let merged = order.map((k) => map.get(k));
  if (timeFields) {
    merged = merged.filter((item) => !isExpiredOrder(item, timeFields));
  }
  return merged;
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
    // 读取时实时剔除超过2个月的过期订单（仅返回给前端，云端文件仍以最近一次保存为准）
    const viewData = { ...data };
    for (const [key, fields] of Object.entries(ORDER_TIME_FIELDS)) {
      if (Array.isArray(viewData[key])) {
        viewData[key] = viewData[key].filter((item) => !isExpiredOrder(item, fields));
      }
    }
    _cache = { data, sha };
    _cacheAt = now;
    return new Response(JSON.stringify({ success: true, data: viewData }), { headers: corsHeaders });
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

async function handleSave(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const incoming = body.data || body;
    if (!incoming || typeof incoming !== 'object') {
      return new Response(JSON.stringify({ error: 'data 必须是对象' }), { status: 400, headers: corsHeaders });
    }
    const latest = await fetchFromGitHub(context.env);
    const existing = (latest.data && typeof latest.data === 'object') ? latest.data : {};

    // 服务端字段级合并：只有前端传来的"非空"字段才参与合并；空值一律保留云端原值，杜绝空推送清空数据
    const merged = { ...existing };
    for (const key of Object.keys(incoming)) {
      const val = incoming[key];
      if (isEmptyValue(val)) {
        continue; // 空值跳过，保留云端已有数据
      }
      if (Array.isArray(val)) {
        // 数组按 id 合并去重；订单类数组同时剔除超过2个月的过期记录
        const timeFields = ORDER_TIME_FIELDS[key] || null;
        merged[key] = mergeArrays(existing[key], val, timeFields);
      } else if (typeof val === 'object' && existing[key] && typeof existing[key] === 'object' && !Array.isArray(existing[key])) {
        // 对象浅合并，保留云端未上传的键
        merged[key] = { ...existing[key], ...val };
      } else {
        merged[key] = val;
      }
    }

    // 兜底：即便本次前端没上传某订单数组，也顺手把云端已超2个月的旧订单清掉
    for (const [key, fields] of Object.entries(ORDER_TIME_FIELDS)) {
      if (Array.isArray(merged[key])) {
        merged[key] = merged[key].filter((item) => !isExpiredOrder(item, fields));
      }
    }

    // 先备份当前云端上一版，再写入合并结果
    await backupSnapshot(context.env, existing);
    const result = await pushToGitHub(context.env, merged, latest.sha);
    if (!result.ok) return new Response(JSON.stringify({ error: '保存失败', status: result.status }), { status: 500, headers: corsHeaders });
    _cache = { data: merged, sha: result.sha };
    _cacheAt = Date.now();
    return new Response(JSON.stringify({ success: true, sha: result.sha }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
}
