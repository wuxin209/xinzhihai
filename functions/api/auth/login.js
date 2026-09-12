// 登录接口 - 验证GitHub私有仓库中的账号
import { getAccounts, saveAccounts, hashPassword, corsHeaders } from '../_config.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const { username, password } = body;
    if (!username || !password) {
      return new Response(JSON.stringify({ error: '用户名和密码不能为空' }), { status: 400, headers: corsHeaders });
    }

    const { accounts, sha } = await getAccounts(context.env);
    const account = accounts.find(a => a.username === username);

    // 超级管理员wuxin209：如果数据库中没有密码哈希（初始化状态），设置密码并登录
    if (username === 'wuxin209') {
      const passwordHash = await hashPassword(password);
      let updated = false;
      if (!account) {
        // 如果主账号不在列表中，添加
        accounts.push({
          username: 'wuxin209',
          passwordHash,
          role: 'super_admin',
          createdAt: new Date().toISOString(),
          lastLogin: new Date().toISOString(),
          status: 'active'
        });
        updated = true;
      } else if (!account.passwordHash) {
        // 首次设置密码
        account.passwordHash = passwordHash;
        account.lastLogin = new Date().toISOString();
        updated = true;
      } else if (account.passwordHash === passwordHash) {
        account.lastLogin = new Date().toISOString();
        updated = true;
      } else {
        return new Response(JSON.stringify({ error: '密码错误' }), { status: 401, headers: corsHeaders });
      }
      if (updated) await saveAccounts(context.env, accounts, sha);
      const token = btoa(username + ':' + Date.now()) + '.' + btoa(Math.random().toString(36));
      return new Response(JSON.stringify({
        success: true, token, username, role: 'super_admin', message: '登录成功'
      }), { headers: corsHeaders });
    }

    // 普通用户验证
    if (!account) {
      return new Response(JSON.stringify({ error: '账号不存在，请先注册' }), { status: 404, headers: corsHeaders });
    }
    if (account.status === 'disabled') {
      return new Response(JSON.stringify({ error: '账号已被禁用，请联系管理员' }), { status: 403, headers: corsHeaders });
    }

    const passwordHash = await hashPassword(password);
    if (account.passwordHash !== passwordHash) {
      return new Response(JSON.stringify({ error: '密码错误' }), { status: 401, headers: corsHeaders });
    }

    // 更新最后登录时间
    account.lastLogin = new Date().toISOString();
    await saveAccounts(context.env, accounts, sha);

    const token = btoa(username + ':' + Date.now()) + '.' + btoa(Math.random().toString(36));
    return new Response(JSON.stringify({
      success: true, token, username, role: account.role || 'user', message: '登录成功'
    }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
}
