import { json, handleOptions, verifyPassword, signJWT, getFingerprint, getIP } from '../_lib.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { username, password } = await request.json();
    if (!username || !password) return json({ error: '请输入用户名和密码' }, 400);
    if (!env.XINZHAI_KV) return json({ error: '存储未配置' }, 500);

    const userStr = await env.XINZHAI_KV.get(`user:${username}`);
    if (!userStr) return json({ error: '用户名或密码错误' }, 401);

    const user = JSON.parse(userStr);
    if (user.status === 'disabled') return json({ error: '账号已被禁用，请联系管理员' }, 403);

    const valid = await verifyPassword(password, user.passwordHash, user.salt);
    if (!valid) return json({ error: '用户名或密码错误' }, 401);

    const fp = getFingerprint(request);
    const ip = getIP(request);
    const isNewDevice = user.deviceFingerprint && user.deviceFingerprint !== fp;

    // 更新token版本（挤掉旧设备）
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.lastLogin = new Date().toISOString();
    user.lastIP = ip;
    if (!user.deviceFingerprint) user.deviceFingerprint = fp;
    await env.XINZHAI_KV.put(`user:${username}`, JSON.stringify(user));

    // 登录日志
    await env.XINZHAI_KV.put(`log:${username}:${Date.now()}`, JSON.stringify({
      ip, device: request.headers.get('user-agent')?.substring(0, 80),
      time: new Date().toISOString(), type: isNewDevice ? 'new_device' : 'login'
    }));

    const secret = env.JWT_SECRET || 'xinzhihai-default-secret-change-me';
    const token = await signJWT({ username, role: user.role, tv: user.tokenVersion, fp }, secret);

    return json({
      token,
      user: { username, nickname: user.nickname, role: user.role },
      newDevice: isNewDevice
    });
  } catch (e) {
    return json({ error: '登录失败: ' + e.message }, 500);
  }
}
