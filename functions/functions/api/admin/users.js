import { json, handleOptions, authenticate, hashPassword, signJWT } from '../../_lib.js';

export async function onRequestOptions() { return handleOptions(); }

// 获取全部子账号列表
export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await authenticate(request, env);
  if (!auth) return json({ error: '未登录' }, 401);
  if (auth.role !== 'super_admin') return json({ error: '无权限' }, 403);

  try {
    const list = await env.XINZHAI_KV.list({ prefix: 'user:' });
    const users = [];
    for (const key of list.keys) {
      const u = JSON.parse(await env.XINZHAI_KV.get(key.name));
      const dataStr = await env.XINZHAI_KV.get(`data:${u.username}`);
      const data = dataStr ? JSON.parse(dataStr) : {};
      users.push({
        username: u.username,
        nickname: u.nickname,
        role: u.role,
        status: u.status,
        createdAt: u.createdAt,
        lastLogin: u.lastLogin,
        lastIP: u.lastIP,
        streak: data.streak || 0,
        todoCount: (data.todos || []).length,
        hasNotes: !!data.notes,
        hasReviews: !!data.reviews && Object.keys(data.reviews).length > 0
      });
    }
    return json({ users, total: users.length });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// 新增子账号
export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await authenticate(request, env);
  if (!auth) return json({ error: '未登录' }, 401);
  if (auth.role !== 'super_admin') return json({ error: '无权限' }, 403);

  try {
    const { username, password, nickname } = await request.json();
    if (!username || !password || username.length < 3 || password.length < 6) {
      return json({ error: '用户名至少3位，密码至少6位' }, 400);
    }
    const existing = await env.XINZHAI_KV.get(`user:${username}`);
    if (existing) return json({ error: '用户名已存在' }, 409);

    const { hash, salt } = await hashPassword(password, null);
    const user = {
      username, nickname: nickname || username,
      passwordHash: hash, salt,
      role: 'user', status: 'active',
      tokenVersion: 0,
      createdAt: new Date().toISOString(),
      lastLogin: null
    };
    await env.XINZHAI_KV.put(`user:${username}`, JSON.stringify(user));
    await env.XINZHAI_KV.put(`data:${username}`, JSON.stringify({
      checkins: {}, streak: 0, todos: [], notes: '', reviews: {}, theme: 'auto'
    }));
    return json({ ok: true, user: { username, nickname, role: 'user' } });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
