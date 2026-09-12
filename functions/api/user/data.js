import { json, handleOptions, authenticate } from '../../_lib.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await authenticate(request, env);
  if (!auth) return json({ error: '未登录或token已失效' }, 401);

  try {
    const dataStr = await env.XINZHAI_KV.get(`data:${auth.username}`);
    const data = dataStr ? JSON.parse(dataStr) : { checkins: {}, streak: 0, todos: [], notes: '', reviews: {}, theme: 'auto' };
    return json({ source: 'cloud', data, updated: data.updatedAt || null });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const auth = await authenticate(request, env);
  if (!auth) return json({ error: '未登录或token已失效' }, 401);

  try {
    const body = await request.json();
    const data = { ...body, updatedAt: new Date().toISOString() };
    await env.XINZHAI_KV.put(`data:${auth.username}`, JSON.stringify(data));
    return json({ ok: true, updated: data.updatedAt });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
