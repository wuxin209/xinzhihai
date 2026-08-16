// 账号管理接口 - 主账号查看/管理所有子账号
import { getAccounts, saveAccounts, hashPassword, corsHeaders } from '../_config.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

// GET - 获取账号列表
export async function onRequestGet(context) {
  try {
    const { accounts } = await getAccounts(context.env);
    // 不返回密码哈希
    const safeAccounts = accounts.map(a => ({
      username: a.username,
      role: a.role || 'user',
      createdAt: a.createdAt,
      lastLogin: a.lastLogin,
      status: a.status || 'active'
    }));
    return new Response(JSON.stringify({ success: true, accounts: safeAccounts }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
}

// POST - 新增子账号 / 重置密码 / 禁用启用
export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const { action, username, password, adminUser } = body;

    // 简单验证：只有wuxin209能管理
    if (adminUser !== 'wuxin209') {
      return new Response(JSON.stringify({ error: '无权限' }), { status: 403, headers: corsHeaders });
    }

    const { accounts, sha } = await getAccounts(context.env);

    if (action === 'add') {
      if (!username || !password) {
        return new Response(JSON.stringify({ error: '用户名和密码不能为空' }), { status: 400, headers: corsHeaders });
      }
      if (accounts.find(a => a.username === username)) {
        return new Response(JSON.stringify({ error: '用户名已存在' }), { status: 409, headers: corsHeaders });
      }
      const passwordHash = await hashPassword(password);
      accounts.push({
        username, passwordHash, role: 'user',
        createdAt: new Date().toISOString(), lastLogin: null, status: 'active'
      });
    } else if (action === 'reset') {
      const acc = accounts.find(a => a.username === username);
      if (!acc) return new Response(JSON.stringify({ error: '账号不存在' }), { status: 404, headers: corsHeaders });
      acc.passwordHash = await hashPassword(password || '123456');
    } else if (action === 'toggle') {
      const acc = accounts.find(a => a.username === username);
      if (!acc) return new Response(JSON.stringify({ error: '账号不存在' }), { status: 404, headers: corsHeaders });
      acc.status = acc.status === 'disabled' ? 'active' : 'disabled';
    } else if (action === 'delete') {
      const idx = accounts.findIndex(a => a.username === username);
      if (idx === -1) return new Response(JSON.stringify({ error: '账号不存在' }), { status: 404, headers: corsHeaders });
      if (username === 'wuxin209') return new Response(JSON.stringify({ error: '不能删除主账号' }), { status: 400, headers: corsHeaders });
      accounts.splice(idx, 1);
    } else {
      return new Response(JSON.stringify({ error: '未知操作' }), { status: 400, headers: corsHeaders });
    }

    await saveAccounts(context.env, accounts, sha);
    const safeAccounts = accounts.map(a => ({
      username: a.username, role: a.role || 'user',
      createdAt: a.createdAt, lastLogin: a.lastLogin, status: a.status || 'active'
    }));
    return new Response(JSON.stringify({ success: true, accounts: safeAccounts }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
}
