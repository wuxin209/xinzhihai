import { json, handleOptions, authenticate, hashPassword } from '../../../_lib.js';

export async function onRequestOptions() { return handleOptions(); }

// 禁用/启用/重置密码
export async function onRequestPut(context) {
  const { request, env, params } = context;
  const auth = await authenticate(request, env);
  if (!auth) return json({ error: '未登录' }, 401);
  if (auth.role !== 'super_admin') return json({ error: '无权限' }, 403);

  const targetUser = decodeURIComponent(params.id);
  try {
    const { action, newPassword } = await request.json();
    const userStr = await env.XINZHAI_KV.get(`user:${targetUser}`);
    if (!userStr) return json({ error: '用户不存在' }, 404);
    const user = JSON.parse(userStr);

    if (action === 'disable') {
      user.status = 'disabled';
      user.tokenVersion = (user.tokenVersion || 0) + 1;
    } else if (action === 'enable') {
      user.status = 'active';
    } else if (action === 'resetPassword') {
      if (!newPassword || newPassword.length < 6) return json({ error: '新密码至少6位' }, 400);
      const { hash, salt } = await hashPassword(newPassword, null);
      user.passwordHash = hash;
      user.salt = salt;
      user.tokenVersion = (user.tokenVersion || 0) + 1;
    } else {
      return json({ error: '未知操作' }, 400);
    }
    await env.XINZHAI_KV.put(`user:${targetUser}`, JSON.stringify(user));
    return json({ ok: true, action, username: targetUser });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// 查看登录日志
export async function onRequestGet(context) {
  const { request, env, params } = context;
  const auth = await authenticate(request, env);
  if (!auth) return json({ error: '未登录' }, 401);
  if (auth.role !== 'super_admin') return json({ error: '无权限' }, 403);

  const targetUser = decodeURIComponent(params.id);
  try {
    const list = await env.XINZHAI_KV.list({ prefix: `log:${targetUser}:` });
    const logs = [];
    for (const key of list.keys.slice(-20).reverse()) {
      logs.push(JSON.parse(await env.XINZHAI_KV.get(key.name)));
    }
    return json({ logs });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
