import { json, handleOptions, authenticateLite } from '../../../_lib.js';
import { getAccounts, saveAccounts, hashPassword } from '../../_config.js';

export async function onRequestOptions() { return handleOptions(); }

// 禁用/启用/审批/拒绝/重置密码（仅超管；写 GitHub accounts.json）
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
    } else if (action === 'approve') {
      // 审批通过：pending -> active，并让已签发的 pending 期 token（如有）失效
      user.status = 'active';
      user.tokenVersion = (user.tokenVersion || 0) + 1;
    } else if (action === 'reject') {
      // 拒绝注册：直接从账号表移除（等同删除，数据不可再登录）
      const idx = accounts.findIndex(a => a.username === targetUser);
      if (idx >= 0) accounts.splice(idx, 1);
      const okReject = await saveAccounts(env, accounts, sha);
      if (!okReject) return json({ error: '操作失败，请稍后重试' }, 502);
      return json({ ok: true, action, username: targetUser, status: 'removed' });
    } else if (action === 'resetPassword') {
      if (!newPassword || newPassword.length < 6) return json({ error: '新密码至少6位' }, 400);
      user.passwordHash = await hashPassword(newPassword);
      user.tokenVersion = (user.tokenVersion || 0) + 1;
    } else {
      return json({ error: '未知操作' }, 400);
    }
    const ok = await saveAccounts(env, accounts, sha);
    if (!ok) return json({ error: '操作失败，请稍后重试' }, 502);
    return json({ ok: true, action, username: targetUser, status: user ? user.status : 'removed' });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// 删除子账号（仅超管）：直接从账号表移除，删除后其 token 立即失效
export async function onRequestDelete(context) {
  const { request, env, params } = context;
  const auth = await authenticateLite(request, env);
  if (!auth) return json({ error: '未登录' }, 401);
  if (auth.role !== 'super_admin') return json({ error: '无权限' }, 403);

  const targetUser = decodeURIComponent(params.id);
  try {
    const { accounts, sha } = await getAccounts(env);
    const idx = accounts.findIndex(a => a.username === targetUser);
    if (idx < 0) return json({ error: '用户不存在' }, 404);
    accounts.splice(idx, 1);
    const ok = await saveAccounts(env, accounts, sha);
    if (!ok) return json({ error: '删除失败，请稍后重试' }, 502);
    return json({ ok: true, action: 'delete', username: targetUser, status: 'removed' });
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
