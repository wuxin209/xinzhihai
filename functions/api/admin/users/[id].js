import { json, handleOptions, authenticateLite } from '../../../_lib.js';
import { getAccounts, saveAccounts, hashPassword } from '../../_config.js';

export async function onRequestOptions() { return handleOptions(); }

// 禁用/启用/重置密码（仅超管；写 GitHub accounts.json）
export async function onRequestPut(context) {
  const { request, env, params } = context;
  const auth = await authenticateLite(request, env);
  if (!auth) return json({ error: '未登录' }, 401);
  if (auth.role !== 'super_admin') return json({ error: '无权限' }, 403);

  const targetUser = decodeURIComponent(params.id);
  try {
    const { action, newPassword } = await request.json();
    const { accounts, sha } = await getAccounts(env);
    const user = accounts.find(a => a.username === targetUser);
    if (!user) return json({ error: '用户不存在' }, 404);

    if (action === 'disable') {
      user.status = 'disabled';
      user.tokenVersion = (user.tokenVersion || 0) + 1;
    } else if (action === 'enable') {
      user.status = 'active';
    } else if (action === 'resetPassword') {
      if (!newPassword || newPassword.length < 6) return json({ error: '新密码至少6位' }, 400);
      user.passwordHash = await hashPassword(newPassword);
      user.tokenVersion = (user.tokenVersion || 0) + 1;
    } else {
      return json({ error: '未知操作' }, 400);
    }
    const ok = await saveAccounts(env, accounts, sha);
    if (!ok) return json({ error: '操作失败，请稍后重试' }, 502);
    return json({ ok: true, action, username: targetUser, status: user.status });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// 登录日志（当前未单独存储，返回空数组占位，避免前端报错）
export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await authenticateLite(request, env);
  if (!auth) return json({ error: '未登录' }, 401);
  if (auth.role !== 'super_admin') return json({ error: '无权限' }, 403);
  return json({ logs: [] });
}
