import { json, handleOptions, hashPassword, signJWT, getFingerprint, getIP } from '../../_lib.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { username, password, nickname } = await request.json();
    if (!username || !password || username.length < 3 || password.length < 6) {
      return json({ error: '用户名至少3位，密码至少6位' }, 400);
    }
    if (!env.XINZHAI_KV) return json({ error: '存储未配置' }, 500);

    const existing = await env.XINZHAI_KV.get(`user:${username}`);
    if (existing) return json({ error: '该用户名已被注册' }, 409);

    const { hash, salt } = await hashPassword(password, null);
    const fp = getFingerprint(request);
    const ip = getIP(request);
    const user = {
      username, nickname: nickname || username,
      passwordHash: hash, salt,
      role: 'user',
      deviceFingerprint: fp,
      tokenVersion: 0,
      status: 'active',
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString()
    };
    await env.XINZHAI_KV.put(`user:${username}`, JSON.stringify(user));

    // 初始化用户数据
    await env.XINZHAI_KV.put(`data:${username}`, JSON.stringify({
      checkins: {}, streak: 0, todos: [], notes: '', reviews: {}, theme: 'auto'
    }));

    // 登录日志
    await env.XINZHAI_KV.put(`log:${username}:${Date.now()}`, JSON.stringify({
      ip, device: request.headers.get('user-agent')?.substring(0, 80), time: new Date().toISOString(), type: 'register'
    }));

    const secret = env.JWT_SECRET || 'xinzhihai-default-secret-change-me';
    const token = await signJWT({ username, role: 'user', tv: 0, fp }, secret);

    return json({ token, user: { username, nickname, role: 'user' } });
  } catch (e) {
    return json({ error: '注册失败: ' + e.message }, 500);
  }
}
