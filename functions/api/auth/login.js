// 登录接口 - 简化版
export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const { username, password } = body;
    if (!username || !password) {
      return new Response(JSON.stringify({ error: '用户名和密码不能为空' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    // 简化验证：任何符合格式的账号都允许登录（数据在前端localStorage）
    const token = btoa(username + ':' + Date.now()) + '.' + btoa(Math.random().toString(36));
    return new Response(JSON.stringify({
      success: true,
      token,
      username,
      message: '登录成功'
    }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
