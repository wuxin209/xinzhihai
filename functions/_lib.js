// 共享工具函数 - Cloudflare Pages Functions
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS }
  });
}

// CORS preflight
function handleOptions() {
  return new Response(null, { headers: CORS });
}

// PBKDF2 密码哈希
async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const saltBuf = salt ? hexToBuf(salt) : crypto.getRandomValues(new Uint8Array(16));
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBuf, iterations: 10000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return { hash: bufToHex(bits), salt: bufToHex(saltBuf) };
}

async function verifyPassword(password, hash, salt) {
  const result = await hashPassword(password, salt);
  return result.hash === hash;
}

// JWT 简单实现 (HMAC-SHA256)
async function signJWT(payload, secret) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify({ ...payload, iat: Date.now() }));
  const data = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
}

async function verifyJWT(token, secret) {
  try {
    const [header, body, sig] = token.split('.');
    const data = `${header}.${body}`;
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBuf = Uint8Array.from(atob(sig), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBuf, new TextEncoder().encode(data));
    if (!valid) return null;
    return JSON.parse(atob(body));
  } catch { return null; }
}

// 设备指纹
function getFingerprint(request) {
  const ua = request.headers.get('user-agent') || '';
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  return btoa(ua + ip).substring(0, 32);
}

function getIP(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
}

// 认证中间件
async function authenticate(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const secret = env.JWT_SECRET || 'xinzhihai-default-secret-change-me';
  const payload = await verifyJWT(token, secret);
  if (!payload) return null;
  if (!env || !env.XINZHAI_KV) return null;
  // 检查token版本
  const userStr = await env.XINZHAI_KV.get(`user:${payload.username}`);
  if (!userStr) return null;
  const user = JSON.parse(userStr);
  if (payload.tv !== user.tokenVersion) return null;
  return { ...payload, user };
}

// 建立登录会话：把用户档案写入 KV（供 authenticate / 团队列表读取），并签发真正的 JWT
// 修复历史问题：login/register 原签发不可校验的 btoa 令牌且不写 KV，导致 authenticate 永远 401、云同步与团队管理失效
async function createSession(env, account) {
  const role = account.role || 'user';
  const tv = account.tokenVersion || 0;
  const rec = {
    username: account.username,
    nickname: account.nickname || account.username,
    role,
    status: account.status || 'active',
    createdAt: account.createdAt || new Date().toISOString(),
    lastLogin: new Date().toISOString(),
    tokenVersion: tv
  };
  try { if (env && env.XINZHAI_KV) await env.XINZHAI_KV.put(`user:${account.username}`, JSON.stringify(rec)); }
  catch (e) { return { __kvError: String(e && e.message || e), __rec: rec }; }
  const secret = (env && env.JWT_SECRET) || 'xinzhihai-default-secret-change-me';
  return await signJWT({ username: account.username, role, tv }, secret);
}

function bufToHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToBuf(hex) {
  return new Uint8Array(hex.match(/.{2}/g).map(b => parseInt(b, 16)));
}

export { json, handleOptions, hashPassword, verifyPassword, signJWT, verifyJWT, createSession, getFingerprint, getIP, authenticate, CORS };
