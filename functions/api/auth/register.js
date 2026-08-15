// 注册接口 - 简化版，实际数据存前端localStorage
export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const { username, password } = body;
    if (!username || !password) {
      return new Response(JSON.stringify({ error: '用户名和密码不能为空' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (username.length < 2) {
      return new Response(JSON.stringify({ error: '用户名至少2个字符' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (password.length < 6) {
      return new Response(JSON.stringify({ error: '密码至少6个字符' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    // 返回成功（无数据库，前端本地存储账号信息）
    const token = btoa(username + ':' + Date.now()) + '.' + btoa(Math.random().toString(36));
    return new Response(JSON.stringify({
      success: true,
      token,
      username,
      message: '注册成功'
    }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
