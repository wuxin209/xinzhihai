import { json, handleOptions, authenticateLite } from '../../_lib.js';
import { getAccounts, saveAccounts, hashPassword, getUserData } from '../_config.js';

export async function onRequestOptions() { return handleOptions(); }

// 获取全部子账号列表（仅超管；数据源为 GitHub 私有仓 accounts.json，个人统计来自 userdata/）
export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await authenticateLite(request, env);
  if (!auth) return json({ error: '未登录' }, 401);
  if (auth.role !== 'super_admin') return json({ error: '无权限' }, 403);

  try {
    const { accounts } = await getAccounts(env);
    const users = [];
    for (const a of accounts) {
      // 个人数据统计（best-effort，失败不阻塞列表）
      let stat = {};
      try {
        const { data } = await getUserData(env, a.username);
        if (data) stat = {
          streak: data.streak || 0,
          todoCount: (data.todos || []).length,
          hasNotes: !!data.notes,
          hasReviews: !!(data.reviews && Object.keys(data.reviews).length)
        };
      } catch (_) {}
      users.push({
        username: a.username,
        nickname: a.nickname || a.username,
        role: a.role || 'user',
        status: a.status || 'active',
        createdAt: a.createdAt,
        lastLogin: a.lastLogin,
        ...stat
      });
    }
    return json({ users, total: users.length });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// 新增子账号（仅超管；写入 GitHub accounts.json，哈希口径与登录一致）
export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await authenticateLite(request, env);
  if (!auth) return json({ error: '未登录' }, 401);
  if (auth.role !== 'super_admin') return json({ error: '无权限' }, 403);

  try {
    const { username, password, nickname } = await request.json();
    if (!username || !password || username.length < 3 || password.length < 6) {
      return json({ error: '用户名至少3位，密码至少6位' }, 400);
    }
    const { accounts, sha } = await getAccounts(env);
    if (accounts.find(a => a.username === username)) return json({ error: '用户名已存在' }, 409);

    accounts.push({
      username,
      nickname: nickname || username,
      passwordHash: await hashPassword(password),
      role: 'user',
      status: 'active',
      createdAt: new Date().toISOString(),
      lastLogin: null
    });
    const ok = await saveAccounts(env, accounts, sha);
    if (!ok) return json({ error: '创建失败，请稍后重试' }, 502);
    return json({ ok: true, user: { username, nickname: nickname || username, role: 'user' } });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
