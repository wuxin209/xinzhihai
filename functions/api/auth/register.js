// 注册接口 - 数据存入GitHub私有仓库
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
    if (username.length < 2) {
      return new Response(JSON.stringify({ error: '用户名至少2个字符' }), { status: 400, headers: corsHeaders });
    }
    if (password.length < 6) {
      return new Response(JSON.stringify({ error: '密码至少6个字符' }), { status: 400, headers: corsHeaders });
    }

    const { accounts, sha } = await getAccounts(context.env);
    
    // 检查用户名是否已存在
    if (accounts.find(a => a.username === username)) {
      return new Response(JSON.stringify({ error: '该用户名已被注册' }), { status: 409, headers: corsHeaders });
    }

    const passwordHash = await hashPassword(password);
    const newAccount = {
      username,
      passwordHash,
      role: 'user',
      createdAt: new Date().toISOString(),
      lastLogin: null,
      status: 'active'
    };

    accounts.push(newAccount);
    const saved = await saveAccounts(context.env, accounts, sha);
    
    if (!saved) {
      return new Response(JSON.stringify({ error: '注册失败，请稍后重试' }), { status: 500, headers: corsHeaders });
    }

    const token = btoa(username + ':' + Date.now()) + '.' + btoa(Math.random().toString(36));
    return new Response(JSON.stringify({
      success: true,
      token,
      username,
      role: 'user',
      message: '注册成功'
    }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
}
