import { json, handleOptions, authenticateLite } from '../../_lib.js';
import { getUserData, saveUserData } from '../_config.js';

const EMPTY = { checkins: {}, streak: 0, todos: [], notes: '', reviews: {}, theme: 'auto' };

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await authenticateLite(request, env);
  if (!auth) return json({ error: '未登录或token已失效' }, 401);

  try {
    const { data, error } = await getUserData(env, auth.username);
    if (error) return json({ source: 'cloud-unavailable', data: { ...EMPTY }, warning: error }, 200);
    return json({ source: 'cloud', data: data || { ...EMPTY }, updated: data?.updatedAt || null });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const auth = await authenticateLite(request, env);
  if (!auth) return json({ error: '未登录或token已失效' }, 401);

  try {
    const body = await request.json();
    // 先取现有 sha（GitHub contents 更新需要），与本次提交合并
    const existing = await getUserData(env, auth.username);
    const merged = { ...(existing.data || {}), ...body, updatedAt: new Date().toISOString() };
    const res = await saveUserData(env, auth.username, merged, existing.sha);
    if (!res.ok) return json({ error: '云端保存失败，已保留本地数据', detail: res.error || res.status }, 502);
    return json({ ok: true, updated: merged.updatedAt });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
